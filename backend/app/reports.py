"""Reports API with transformation pipeline."""
import asyncio
import hashlib
import json
import logging
import time
from datetime import datetime, timedelta, date
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, async_session_maker
from app.models import User, Project, Integration, Report, ReportRun
from app.schemas import (
    ReportCreate, ReportUpdate, ReportResponse, ReportListItem,
    ReportRunResponse, PreviewRequest, PreviewResponse
)
from app.auth import get_current_user
from app.integrations import verify_project_access, refresh_integration_token
from app.transformations import TransformationPipeline, TransformationError
from app.direct import get_direct_integration, fetch_direct_stats
from app.metrika import get_metrika_integration, call_metrika_api
from app.google_sheets import get_sheets_integration, ExportRequest, do_export_to_sheets

router = APIRouter()

logger = logging.getLogger(__name__)

# #14: id отчётов, для которых прямо сейчас идёт прогон. Один процесс uvicorn ->
# множества в памяти достаточно, чтобы не пускать второй параллельный /run того же
# отчёта (иначе двойной экспорт в Sheets и гонка записи в SQLite).
_running_reports: set[int] = set()

# Живые фоновые задачи прогонов. asyncio держит задачу только слабой ссылкой:
# без этого множества сборщик мусора может убить выгрузку на середине.
_run_tasks: set[asyncio.Task] = set()


def get_date_range(period_config: dict) -> tuple[str, str]:
    """Get date range from period configuration."""
    period_type = period_config.get("type", "last_7_days")

    today = date.today()

    if period_type == "today":
        date_from = today
        date_to = today
    elif period_type == "yesterday":
        date_from = today - timedelta(days=1)
        date_to = today - timedelta(days=1)
    elif period_type == "last_7_days":
        date_from = today - timedelta(days=7)
        date_to = today - timedelta(days=1)
    elif period_type == "last_14_days":
        date_from = today - timedelta(days=14)
        date_to = today - timedelta(days=1)
    elif period_type == "last_15_days":
        date_from = today - timedelta(days=15)
        date_to = today - timedelta(days=1)
    elif period_type == "last_30_days":
        date_from = today - timedelta(days=30)
        date_to = today - timedelta(days=1)
    elif period_type == "last_90_days":
        date_from = today - timedelta(days=90)
        date_to = today - timedelta(days=1)
    elif period_type == "this_month":
        date_from = today.replace(day=1)
        date_to = today
    elif period_type == "last_month":
        first_of_month = today.replace(day=1)
        last_month_end = first_of_month - timedelta(days=1)
        date_from = last_month_end.replace(day=1)
        date_to = last_month_end
    elif period_type == "custom":
        date_from = period_config.get("date_from") or str(today - timedelta(days=7))
        date_to = period_config.get("date_to") or str(today - timedelta(days=1))
        return date_from, date_to
    else:
        date_from = today - timedelta(days=7)
        date_to = today - timedelta(days=1)

    return str(date_from), str(date_to)


# ============== Pipeline: датасеты -> шаги -> сшивка -> группировка ==============

# Кэш сырых выгрузок (состояние 1): пока пользователь итерирует трансформации
# в конструкторе, внешние API не дёргаются повторно. Кэш в памяти процесса —
# при рестарте бэкенда просто выгрузим заново.
FETCH_CACHE_TTL_SECONDS = 600
FETCH_CACHE_MAX_ENTRIES = 200
_fetch_cache: Dict[str, tuple[float, List[Dict[str, Any]]]] = {}


def _dataset_cache_key(project_id: int, source_params: dict, date_from: str, date_to: str) -> str:
    payload = json.dumps(
        [project_id, source_params, date_from, date_to],
        sort_keys=True, ensure_ascii=False, default=str,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def _cache_get(key: str) -> Optional[List[Dict[str, Any]]]:
    entry = _fetch_cache.get(key)
    if not entry:
        return None
    stored_at, rows = entry
    if time.monotonic() - stored_at > FETCH_CACHE_TTL_SECONDS:
        _fetch_cache.pop(key, None)
        return None
    # Копии строк: дальнейшие шаги не должны портить кэш
    return [dict(r) for r in rows]


def _cache_put(key: str, rows: List[Dict[str, Any]]) -> None:
    if len(_fetch_cache) >= FETCH_CACHE_MAX_ENTRIES:
        oldest = min(_fetch_cache, key=lambda k: _fetch_cache[k][0])
        _fetch_cache.pop(oldest, None)
    _fetch_cache[key] = (time.monotonic(), [dict(r) for r in rows])


def _dataset_source_params(dataset: dict) -> dict:
    """Параметры датасета, влияющие на выгрузку (без шагов трансформаций)."""
    return {k: v for k, v in dataset.items() if k not in ("steps", "label")}


async def fetch_dataset(
    dataset: dict,
    period: dict,
    project_id: int,
    current_user: User,
    db: AsyncSession,
    refresh: bool = False,
) -> List[Dict[str, Any]]:
    """Fetch dataset rows (state 1), using the server-side cache."""
    date_from, date_to = get_date_range(period)
    cache_key = _dataset_cache_key(project_id, _dataset_source_params(dataset), date_from, date_to)

    if not refresh:
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

    dataset_type = dataset.get("type")
    if dataset_type == "direct":
        integration = await get_direct_integration(project_id, current_user, db)
        campaign_ids = dataset.get("campaign_ids") or []
        rows = await fetch_direct_stats(
            integration,
            date_from,
            date_to,
            campaign_ids=campaign_ids if campaign_ids else None,
            group_by=dataset.get("group_by") or "campaign",
            direct_fields=dataset.get("fields"),
            include_vat=dataset.get("include_vat", True),
        )
    elif dataset_type == "metrika":
        rows = await fetch_metrika_rows(
            dataset, date_from, date_to, project_id, current_user, db
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown dataset type: {dataset_type}"
        )

    _cache_put(cache_key, rows)
    return rows


async def fetch_metrika_rows(
    source: dict,
    date_from: str,
    date_to: str,
    project_id: int,
    current_user: User,
    db: AsyncSession,
) -> List[Dict[str, Any]]:
    """Fetch and normalize Metrika rows (shared by v1 and v2 pipelines)."""
    integration = await get_metrika_integration(project_id, current_user, db)
    counter_id = source.get("counter_id")
    goals = source.get("goals") or []
    config_metrics = source.get("metrics")
    config_dimensions = source.get("dimensions")

    if not counter_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="counter_id is required for Metrika source"
        )

    metrics = config_metrics if config_metrics else ["ym:s:visits", "ym:s:users", "ym:s:bounceRate"]
    if goals:
        metrics = list(metrics) + [f"ym:s:goal{g}reaches" for g in goals]
    metrics_str = ",".join(metrics) if isinstance(metrics, list) else metrics

    dimensions = config_dimensions if config_dimensions else ["ym:s:UTMSource", "ym:s:UTMCampaign"]
    dimensions_str = ",".join(dimensions) if isinstance(dimensions, list) else dimensions

    result = await call_metrika_api(
        "stat/v1/data",
        {
            "ids": counter_id,
            "date1": date_from,
            "date2": date_to,
            "metrics": metrics_str,
            "dimensions": dimensions_str,
            "accuracy": "full",
            "limit": 10000,
        },
        integration.access_token,
    )

    data_result = result.get("data", [])
    query = result.get("query", {})
    metric_names = [m.replace("ym:s:", "") for m in query.get("metrics", [])]
    dimension_keys = query.get("dimensions", [])

    rows = []
    for item in data_result:
        dims = item.get("dimensions", [])
        mets = item.get("metrics", [])
        row = {}
        for i, dim in enumerate(dims):
            key = dimension_keys[i].replace("ym:s:", "").replace(":", "_") if i < len(dimension_keys) else f"dim_{i}"
            row[key] = dim.get("name")
        for i, m in enumerate(mets):
            metric_name = metric_names[i] if i < len(metric_names) else f"metric_{i}"
            row[metric_name] = m
        rows.append(row)

    return rows


def _result_table(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Build {columns, data, row_count}; columns = union over all rows."""
    columns: List[str] = []
    seen = set()
    for row in rows:
        for key in row.keys():
            if key not in seen:
                seen.add(key)
                columns.append(key)
    return {"columns": columns, "data": rows, "row_count": len(rows)}


def _run_steps(dataset_id: str, rows: List[Dict[str, Any]], steps: List[dict]) -> List[Dict[str, Any]]:
    """Apply dataset steps (state 2) in an isolated namespace."""
    prepared = [{**step, "source": dataset_id} for step in steps]
    pipeline = TransformationPipeline(prepared)
    try:
        result = pipeline.run({dataset_id: rows})
    except TransformationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Датасет '{dataset_id}', ошибка шага: {e}",
        )
    return result.get(dataset_id, rows)


async def run_pipeline_v2(
    config: dict,
    project_id: int,
    current_user: User,
    db: AsyncSession,
    stage: str = "final",
    dataset_id: Optional[str] = None,
    refresh: bool = False,
) -> Dict[str, Any]:
    """Run the staged pipeline.

    Стадии: fetched (состояние 1, один датасет) -> transformed (состояние 2,
    один датасет) -> merged (состояние 3а, после сшивки) -> final (после
    группировки; то, что уходит в экспорт).
    """
    datasets = config.get("datasets") or []
    period = config.get("period") or {}

    if not datasets:
        return {"columns": [], "data": [], "row_count": 0}

    ids = [d.get("id") for d in datasets]
    if len(ids) != len(set(ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dataset ids must be unique"
        )

    # Для стадий одного датасета не выгружаем остальные
    if stage in ("fetched", "transformed"):
        target_id = dataset_id or ids[0]
        target = next((d for d in datasets if d.get("id") == target_id), None)
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Dataset '{target_id}' not found"
            )
        rows = await fetch_dataset(target, period, project_id, current_user, db, refresh)
        if stage == "transformed" and target.get("steps"):
            # to_thread: шаги считаются синхронно и на пользовательских regex/формулах
            # могут занять минуты. В единственном процессе uvicorn это заблокировало бы
            # весь сервис, поэтому уводим CPU-работу из event loop.
            rows = await asyncio.to_thread(_run_steps, target_id, rows, target["steps"])
        return _result_table(rows)

    # Полный прогон: все датасеты + их шаги
    data: Dict[str, List[Dict[str, Any]]] = {}
    for dataset in datasets:
        ds_id = dataset.get("id")
        rows = await fetch_dataset(dataset, period, project_id, current_user, db, refresh)
        if dataset.get("steps"):
            rows = await asyncio.to_thread(_run_steps, ds_id, rows, dataset["steps"])
        data[ds_id] = rows

    # Состояние 3а: сшивка
    merge = config.get("merge") or {}
    result_key = config.get("result_dataset") or ids[0]
    if merge.get("enabled"):
        left = merge.get("left") or ids[0]
        right = merge.get("right") or (ids[1] if len(ids) > 1 else None)
        join_config = {
            "type": "join",
            "left": left,
            "right": right,
            # Составной ключ имеет приоритет; одиночный — для старых конфигов
            "left_on": merge.get("left_keys") or merge.get("left_key"),
            "right_on": merge.get("right_keys") or merge.get("right_key"),
            "how": merge.get("how") or "left",
        }
        pipeline = TransformationPipeline([join_config])
        try:
            data = await asyncio.to_thread(pipeline.run, data)
        except TransformationError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Ошибка сшивки: {e}",
            )
        result_key = left

    if stage == "merged":
        return _result_table(data.get(result_key, []))

    # Состояние 3б: группировка результата
    grouping = config.get("grouping") or {}
    if grouping.get("enabled") and grouping.get("columns"):
        group_config = {
            "type": "group_by",
            "source": result_key,
            "columns": grouping.get("columns"),
            "aggregations": grouping.get("aggregations") or {},
        }
        pipeline = TransformationPipeline([group_config])
        try:
            data = await asyncio.to_thread(pipeline.run, data)
        except TransformationError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Ошибка группировки: {e}",
            )

    return _result_table(data.get(result_key, []))


# ============== Report CRUD ==============

@router.get("/projects/{project_id}/reports", response_model=List[ReportListItem])
async def get_reports(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get all reports for a project with their last run."""
    await verify_project_access(project_id, current_user, db)

    result = await db.execute(
        select(Report)
        .where(Report.project_id == project_id)
        .order_by(Report.created_at.desc())
    )
    reports = result.scalars().all()

    last_runs: Dict[int, ReportRunResponse] = {}
    if reports:
        runs_result = await db.execute(
            select(ReportRun)
            .where(ReportRun.report_id.in_([r.id for r in reports]))
            .order_by(ReportRun.started_at.desc(), ReportRun.id.desc())
        )
        for run in runs_result.scalars():
            if run.report_id not in last_runs:
                last_runs[run.report_id] = ReportRunResponse.model_validate(run)

    items = []
    for report in reports:
        item = ReportListItem.model_validate(report)
        item.last_run = last_runs.get(report.id)
        items.append(item)
    return items


@router.post("/projects/{project_id}/reports", response_model=ReportResponse, status_code=status.HTTP_201_CREATED)
async def create_report(
    project_id: int,
    report_data: ReportCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create a new report."""
    await verify_project_access(project_id, current_user, db)
    
    report = Report(
        project_id=project_id,
        name=report_data.name,
        config=report_data.config.model_dump()
    )
    
    db.add(report)
    await db.commit()
    await db.refresh(report)
    
    return report


@router.get("/projects/{project_id}/reports/{report_id}", response_model=ReportResponse)
async def get_report(
    project_id: int,
    report_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get a specific report."""
    await verify_project_access(project_id, current_user, db)
    
    result = await db.execute(
        select(Report)
        .where(Report.id == report_id, Report.project_id == project_id)
    )
    report = result.scalar_one_or_none()
    
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found"
        )
    
    return report


@router.put("/projects/{project_id}/reports/{report_id}", response_model=ReportResponse)
async def update_report(
    project_id: int,
    report_id: int,
    report_data: ReportUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update a report."""
    await verify_project_access(project_id, current_user, db)
    
    result = await db.execute(
        select(Report)
        .where(Report.id == report_id, Report.project_id == project_id)
    )
    report = result.scalar_one_or_none()
    
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found"
        )
    
    if report_data.name is not None:
        report.name = report_data.name
    if report_data.config is not None:
        report.config = report_data.config.model_dump()
    
    await db.commit()
    await db.refresh(report)
    
    return report


@router.delete("/projects/{project_id}/reports/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_report(
    project_id: int,
    report_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Delete a report."""
    await verify_project_access(project_id, current_user, db)
    
    result = await db.execute(
        select(Report)
        .where(Report.id == report_id, Report.project_id == project_id)
    )
    report = result.scalar_one_or_none()
    
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found"
        )
    
    await db.delete(report)
    await db.commit()


# ============== Report Preview & Run ==============

@router.post("/projects/{project_id}/reports/preview")
async def preview_report(
    project_id: int,
    request: PreviewRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Preview report data without saving or exporting.

    Для конфигов v2 поддерживает стадии пайплайна (fetched/transformed/
    merged/final) и превью отдельного датасета.
    """
    await verify_project_access(project_id, current_user, db)
    config = request.config if isinstance(request.config, dict) else request.config.model_dump()
    if config.get("version") != 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported config version: expected version 2"
        )
    return await run_pipeline_v2(
        config, project_id, current_user, db,
        stage=request.stage,
        dataset_id=request.dataset_id,
        refresh=request.refresh,
    )


def _error_text(exc: BaseException) -> str:
    """Человекочитаемый текст ошибки прогона (detail у HTTPException или str)."""
    detail = getattr(exc, "detail", None)
    if isinstance(detail, list):
        detail = detail[0] if detail else None
    if detail is not None and not isinstance(detail, str):
        detail = str(detail)
    return detail or str(exc) or exc.__class__.__name__


async def _finalize_run_failed(run_id: int, message: str) -> None:
    """Пометить прогон упавшим, обязательно в ОТДЕЛЬНОЙ сессии.

    Сессия, в которой случилась ошибка, может быть непригодна (оборванная
    транзакция), а прогон, застрявший в статусе running, навсегда блокирует
    отчёт для повторного запуска и заставляет фронт ждать вечно.
    """
    try:
        async with async_session_maker() as db:
            run = await db.get(ReportRun, run_id)
            if run is None:
                return
            run.status = "failed"
            run.completed_at = datetime.utcnow()
            run.error_message = message[:2000]
            await db.commit()
    except Exception:
        logger.exception("Не удалось записать ошибку прогона %s", run_id)


async def _run_and_export(
    run: ReportRun,
    report: Report,
    project_id: int,
    user: User,
    db: AsyncSession,
) -> None:
    """Пайплайн -> экспорт -> отметка об успехе. Ошибки поднимает наверх."""
    if (report.config or {}).get("version") != 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Отчёт в устаревшем формате конфигурации — пересоздайте его в конструкторе",
        )

    data_result = await run_pipeline_v2(report.config, project_id, user, db, stage="final")

    export_config = report.config.get("export") or {}
    export_type = export_config.get("type") or "google_sheets"

    # Экспорт чистит лист перед записью, поэтому пустой результат СТИРАЕТ
    # клиентскую таблицу. Пустота почти всегда означает проблему (опечатка
    # в ключе сшивки, нет данных за период, слишком строгий фильтр), а не
    # намерение обнулить отчёт — не экспортируем и говорим об этом явно.
    if not data_result["data"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Пайплайн вернул 0 строк — экспорт отменён, чтобы не стереть "
                "данные в таблице. Проверьте период, фильтры и ключи сшивки."
            ),
        )

    if export_type == "google_sheets":
        sheets_integration = await get_sheets_integration(project_id, user, db)
        spreadsheet_id = export_config.get("spreadsheet_id")
        if export_config.get("create_new"):
            # Явный режим «новая таблица при каждом запуске»
            spreadsheet_id = None
        if spreadsheet_id is not None and isinstance(spreadsheet_id, str) and not spreadsheet_id.strip():
            spreadsheet_id = None
        sheet_name = (export_config.get("sheet_name") or report.name or "Report").strip() or "Report"
        export_request = ExportRequest(
            spreadsheet_id=spreadsheet_id,
            sheet_name=sheet_name,
            title=f"{report.name} - {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            columns=data_result["columns"],
            data=data_result["data"],
        )
        export_result = await do_export_to_sheets(sheets_integration, export_request)
        run.result_url = export_result.get("spreadsheet_url") or ""

    run.status = "completed"
    run.completed_at = datetime.utcnow()


async def _execute_report_run(
    run_id: int, report_id: int, project_id: int, user_id: int
) -> None:
    """Фоновая задача прогона.

    Своя сессия БД: сессия HTTP-запроса закрывается сразу после ответа 202.
    Освобождение отчёта в finally обязательно — иначе повторный запуск станет
    невозможен до перезапуска процесса.
    """
    try:
        try:
            async with async_session_maker() as db:
                run = await db.get(ReportRun, run_id)
                if run is None:
                    logger.error("Прогон %s исчез до начала выполнения", run_id)
                    return
                user = await db.get(User, user_id)
                if user is None:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Пользователь не найден",
                    )
                report = await db.get(Report, report_id)
                if report is None or report.project_id != project_id:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Report not found",
                    )
                await _run_and_export(run, report, project_id, user, db)
                await db.commit()
                logger.info("Прогон %s отчёта %s завершён", run_id, report_id)
        except asyncio.CancelledError:
            # Остановка сервиса на середине выгрузки: пробуем отметить, а если
            # loop уже закрывается — прогон подберёт mark_interrupted_runs.
            await _finalize_run_failed(
                run_id, "Прогон прерван остановкой сервиса — запустите выгрузку заново."
            )
            raise
        except Exception as e:
            logger.warning("Прогон %s отчёта %s упал: %s", run_id, report_id, e)
            await _finalize_run_failed(run_id, _error_text(e))
    finally:
        _running_reports.discard(report_id)


async def mark_interrupted_runs() -> int:
    """Отметить на старте прогоны, оставшиеся от прошлого процесса.

    Фоновые задачи живут в памяти процесса: рестарт контейнера убивает их, а
    строки остаются в статусе running навсегда — фронт ждёт результата, которого
    уже никто не считает.
    """
    async with async_session_maker() as db:
        result = await db.execute(
            select(ReportRun).where(ReportRun.status.in_(("running", "pending")))
        )
        runs = list(result.scalars())
        for run in runs:
            run.status = "failed"
            run.completed_at = datetime.utcnow()
            run.error_message = (
                "Прогон прерван перезапуском сервиса — запустите выгрузку заново."
            )
        if runs:
            await db.commit()
            logger.warning("Прогонов помечено прерванными при старте: %d", len(runs))
        return len(runs)


@router.post(
    "/projects/{project_id}/reports/{report_id}/run",
    response_model=ReportRunResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def run_report(
    project_id: int,
    report_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Поставить прогон отчёта в работу и сразу вернуть запись о нём.

    Выгрузка Директа и Метрики плюс запись в Google Sheets регулярно длится
    дольше, чем живёт HTTP-соединение через Cloudflare Tunnel (~100 с): раньше
    пользователь гарантированно получал 524, хотя прогон втихую доходил до
    конца. Теперь ответ 202 отдаётся сразу, а результат фронт забирает из
    GET /projects/{project_id}/reports/{report_id}/runs/{run_id}.
    """
    await verify_project_access(project_id, current_user, db)

    result = await db.execute(
        select(Report)
        .where(Report.id == report_id, Report.project_id == project_id)
    )
    report = result.scalar_one_or_none()

    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found"
        )

    # #14: не пускаем второй параллельный прогон этого же отчёта. Проверка и
    # добавление атомарны (между ними нет await), поэтому лишний лок не нужен.
    if report_id in _running_reports:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Отчёт уже выполняется. Дождитесь завершения текущего запуска.",
        )
    _running_reports.add(report_id)

    spawned = False
    try:
        # Период резолвим в даты сразу — история хранит факт, а не пресет
        period_from, period_to = get_date_range((report.config or {}).get("period") or {})
        run = ReportRun(
            report_id=report_id,
            status="running",
            period_from=period_from,
            period_to=period_to,
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)

        task = asyncio.create_task(
            _execute_report_run(run.id, report_id, project_id, current_user.id)
        )
        _run_tasks.add(task)
        task.add_done_callback(_run_tasks.discard)
        spawned = True
        return run
    finally:
        # Задача снимает пометку сама; освобождаем её только если не запустились
        if not spawned:
            _running_reports.discard(report_id)


@router.get("/projects/{project_id}/reports/{report_id}/runs", response_model=List[ReportRunResponse])
async def get_report_runs(
    project_id: int,
    report_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get run history for a report."""
    await verify_project_access(project_id, current_user, db)

    report_result = await db.execute(
        select(Report)
        .where(Report.id == report_id, Report.project_id == project_id)
    )
    if not report_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found"
        )

    result = await db.execute(
        select(ReportRun)
        .where(ReportRun.report_id == report_id)
        .order_by(ReportRun.started_at.desc(), ReportRun.id.desc())
        .limit(20)
    )
    runs = result.scalars().all()

    return runs


@router.get(
    "/projects/{project_id}/reports/{report_id}/runs/{run_id}",
    response_model=ReportRunResponse,
)
async def get_report_run(
    project_id: int,
    report_id: int,
    run_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Статус одного прогона — фронт опрашивает его, пока идёт фоновая выгрузка."""
    await verify_project_access(project_id, current_user, db)

    result = await db.execute(
        select(ReportRun)
        .join(Report, ReportRun.report_id == Report.id)
        .where(
            ReportRun.id == run_id,
            ReportRun.report_id == report_id,
            Report.project_id == project_id,
        )
    )
    run = result.scalar_one_or_none()

    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Run not found"
        )

    return run
