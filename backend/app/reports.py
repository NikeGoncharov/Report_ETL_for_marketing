"""Reports API with transformation pipeline."""
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
    
    if period_type == "last_7_days":
        date_from = today - timedelta(days=7)
        date_to = today - timedelta(days=1)
    elif period_type == "last_14_days":
        date_from = today - timedelta(days=14)
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
        date_from = period_config.get("date_from", str(today - timedelta(days=7)))
        date_to = period_config.get("date_to", str(today - timedelta(days=1)))
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
        integration = await get_metrika_integration(project_id, current_user, db)
        counter_id = source_config.get("counter_id")
        goals = source_config.get("goals", [])
        config_metrics = source_config.get("metrics")
        config_dimensions = source_config.get("dimensions")

        if not counter_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="counter_id is required for Metrika source"
            )

        metrics = config_metrics if (config_metrics and len(config_metrics) > 0) else ["ym:s:visits", "ym:s:users", "ym:s:bounceRate"]
        if goals:
            metrics = list(metrics) + [f"ym:s:goal{g}reaches" for g in goals]
        metrics_str = ",".join(metrics) if isinstance(metrics, list) else metrics

        dimensions = config_dimensions if (config_dimensions and len(config_dimensions) > 0) else ["ym:s:UTMSource", "ym:s:UTMCampaign"]
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

        data = []
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
            data.append(row)

        return data
    
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown source type: {source_type}"
        )


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
    """Preview report data without saving or exporting."""
    await verify_project_access(project_id, current_user, db)
    config = request.config if isinstance(request.config, dict) else request.config.model_dump()
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
    
    result = await db.execute(
        select(ReportRun)
        .where(ReportRun.report_id == report_id)
        .order_by(ReportRun.started_at.desc())
        .limit(20)
    )
    runs = result.scalars().all()
    
    return runs
