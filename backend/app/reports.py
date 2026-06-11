"""Reports API with transformation pipeline."""
import hashlib
import json
import time
from datetime import datetime, timedelta, date
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, Project, Integration, Report, ReportRun
from app.schemas import (
    ReportCreate, ReportUpdate, ReportResponse,
    ReportRunResponse, PreviewRequest, PreviewResponse, ReportConfig
)
from app.auth import get_current_user
from app.integrations import verify_project_access, refresh_integration_token
from app.transformations import TransformationPipeline, TransformationError
from app.direct import get_direct_integration, fetch_direct_stats
from app.metrika import get_metrika_integration, call_metrika_api
from app.google_sheets import get_sheets_integration, ExportRequest, do_export_to_sheets

router = APIRouter()


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


async def fetch_source_data(
    source_config: dict,
    period: dict,
    project_id: int,
    current_user: User,
    db: AsyncSession
) -> List[Dict[str, Any]]:
    """Fetch data from a source (Direct or Metrika)."""
    source_type = source_config.get("type")
    date_from, date_to = get_date_range(period)
    
    if source_type == "direct":
        integration = await get_direct_integration(project_id, current_user, db)
        campaign_ids = source_config.get("campaign_ids") or []
        group_by = source_config.get("direct_group_by", "campaign")
        direct_fields = source_config.get("direct_fields")
        data = await fetch_direct_stats(
            integration,
            date_from,
            date_to,
            campaign_ids=campaign_ids if campaign_ids else None,
            group_by=group_by,
            direct_fields=direct_fields,
        )
        return data
    
    elif source_type == "metrika":
        return await fetch_metrika_rows(
            source_config, date_from, date_to, project_id, current_user, db
        )

    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown source type: {source_type}"
        )


# ============== Pipeline v2: датасеты -> шаги -> сшивка -> группировка ==============

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
            rows = _run_steps(target_id, rows, target["steps"])
        return _result_table(rows)

    # Полный прогон: все датасеты + их шаги
    data: Dict[str, List[Dict[str, Any]]] = {}
    for dataset in datasets:
        ds_id = dataset.get("id")
        rows = await fetch_dataset(dataset, period, project_id, current_user, db, refresh)
        if dataset.get("steps"):
            rows = _run_steps(ds_id, rows, dataset["steps"])
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
            "left_on": merge.get("left_key"),
            "right_on": merge.get("right_key"),
            "how": merge.get("how") or "left",
        }
        pipeline = TransformationPipeline([join_config])
        try:
            data = pipeline.run(data)
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
            data = pipeline.run(data)
        except TransformationError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Ошибка группировки: {e}",
            )

    return _result_table(data.get(result_key, []))


async def run_report_pipeline(
    config: dict,
    project_id: int,
    current_user: User,
    db: AsyncSession
) -> Dict[str, Any]:
    """Run the full report pipeline: fetch -> transform -> return data."""
    sources = config.get("sources", [])
    period = config.get("period", {"type": "last_7_days"})
    transformations = config.get("transformations", [])
    
    # Fetch data from all sources
    data = {}
    for source_config in sources:
        source_id = source_config.get("id", source_config.get("type"))
        source_data = await fetch_source_data(
            source_config, period, project_id, current_user, db
        )
        # Per-source transformations
        source_transformations = source_config.get("source_transformations") or []
        if source_transformations:
            pipeline = TransformationPipeline(source_transformations)
            try:
                single_source_data = {source_id: source_data}
                single_source_data = pipeline.run(single_source_data)
                source_data = single_source_data.get(source_id, source_data)
            except TransformationError as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Source '{source_id}' transformation error: {e}",
                )
        data[source_id] = source_data

    # Apply global transformations
    if transformations:
        pipeline = TransformationPipeline(transformations)
        try:
            data = pipeline.run(data)
        except TransformationError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Transformation error: {e}"
            )
    
    # Get the result (first source or specified output)
    if data:
        result_key = list(data.keys())[0]
        result_data = data[result_key]
        
        # Get columns from data
        columns = []
        if result_data:
            columns = list(result_data[0].keys())
        
        return {
            "columns": columns,
            "data": result_data,
            "row_count": len(result_data)
        }
    
    return {"columns": [], "data": [], "row_count": 0}


# ============== Report CRUD ==============

@router.get("/projects/{project_id}/reports", response_model=List[ReportResponse])
async def get_reports(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get all reports for a project."""
    await verify_project_access(project_id, current_user, db)
    
    result = await db.execute(
        select(Report)
        .where(Report.project_id == project_id)
        .order_by(Report.created_at.desc())
    )
    reports = result.scalars().all()
    
    return reports


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
    if config.get("version") == 2:
        return await run_pipeline_v2(
            config, project_id, current_user, db,
            stage=request.stage,
            dataset_id=request.dataset_id,
            refresh=request.refresh,
        )
    result = await run_report_pipeline(config, project_id, current_user, db)
    return result


@router.post("/projects/{project_id}/reports/{report_id}/run", response_model=ReportRunResponse)
async def run_report(
    project_id: int,
    report_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Run a report and export to Google Sheets."""
    await verify_project_access(project_id, current_user, db)
    
    # Get report
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
    
    # Create run record
    run = ReportRun(
        report_id=report_id,
        status="running"
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    
    try:
        # Run pipeline
        if report.config.get("version") == 2:
            data_result = await run_pipeline_v2(
                report.config, project_id, current_user, db, stage="final"
            )
        else:
            data_result = await run_report_pipeline(
                report.config,
                project_id,
                current_user,
                db
            )

        # Get export config (default to google_sheets so old reports still export)
        export_config = report.config.get("export") or {}
        export_type = export_config.get("type") or "google_sheets"

        if export_type == "google_sheets":
            sheets_integration = await get_sheets_integration(project_id, current_user, db)
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
            run.status = "completed"
            run.completed_at = datetime.utcnow()
            run.result_url = export_result.get("spreadsheet_url") or ""
        else:
            run.status = "completed"
            run.completed_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(run)
        
    except Exception as e:
        run.status = "failed"
        run.completed_at = datetime.utcnow()
        run.error_message = getattr(e, "detail", str(e))
        if isinstance(run.error_message, list):
            run.error_message = run.error_message[0] if run.error_message else str(e)
        elif not isinstance(run.error_message, str):
            run.error_message = str(e)
        await db.commit()
        await db.refresh(run)
    
    return run


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
        .order_by(ReportRun.started_at.desc())
        .limit(20)
    )
    runs = result.scalars().all()

    return runs
