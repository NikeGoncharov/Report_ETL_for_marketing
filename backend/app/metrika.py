"""Yandex.Metrika API integration."""
from datetime import datetime, date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from app.database import get_db
from app.models import User, Project, Integration
from app.auth import get_current_user
from app.integrations import verify_project_access, refresh_integration_token

router = APIRouter(prefix="/metrika")

# Yandex.Metrika API URL
METRIKA_API_URL = "https://api-metrika.yandex.net"


async def get_metrika_integration(
    project_id: int,
    current_user: User,
    db: AsyncSession
) -> Integration:
    """Get Yandex.Metrika integration for a project."""
    await verify_project_access(project_id, current_user, db)
    
    result = await db.execute(
        select(Integration)
        .where(Integration.project_id == project_id, Integration.type == "yandex_metrika")
    )
    integration = result.scalar_one_or_none()
    
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Yandex.Metrika not connected. Please connect it first."
        )
    
    # Refresh token if needed
    access_token = await refresh_integration_token(integration, db)
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Failed to refresh Yandex.Metrika token. Please reconnect."
        )
    
    return integration


async def call_metrika_api(
    endpoint: str,
    params: dict,
    access_token: str
) -> dict:
    """Call Yandex.Metrika API."""
    url = f"{METRIKA_API_URL}/{endpoint}"
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            url,
            params=params,
            headers={
                "Authorization": f"OAuth {access_token}",
            },
            timeout=30.0
        )
        
        if response.status_code != 200:
            error_detail = response.text
            try:
                error_json = response.json()
                error_detail = error_json.get("message", error_detail)
            except:
                pass
            
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Yandex.Metrika API error: {error_detail}"
            )
        
        return response.json()


@router.get("/counters")
async def get_counters(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get list of Metrika counters available to the user."""
    integration = await get_metrika_integration(project_id, current_user, db)
    
    result = await call_metrika_api(
        "management/v1/counters",
        {},
        integration.access_token
    )
    
    counters = result.get("counters", [])
    
    return [
        {
            "id": c["id"],
            "name": c.get("name", f"Counter {c['id']}"),
            "site": c.get("site"),
            "status": c.get("status"),
        }
        for c in counters
    ]


@router.get("/goals")
async def get_goals(
    project_id: int,
    counter_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get goals for a specific counter."""
    integration = await get_metrika_integration(project_id, current_user, db)
    
    result = await call_metrika_api(
        f"management/v1/counter/{counter_id}/goals",
        {},
        integration.access_token
    )
    
    goals = result.get("goals", [])
    
    return [
        {
            "id": g["id"],
            "name": g.get("name", f"Goal {g['id']}"),
            "type": g.get("type"),
        }
        for g in goals
    ]


@router.get("/stats")
async def get_stats(
    project_id: int,
    counter_id: int,
    date_from: str = Query(..., description="Start date (YYYY-MM-DD)"),
    date_to: str = Query(..., description="End date (YYYY-MM-DD)"),
    metrics: str = Query(
        "ym:s:visits,ym:s:users,ym:s:bounceRate,ym:s:pageDepth,ym:s:avgVisitDurationSeconds",
        description="Comma-separated metrics"
    ),
    dimensions: Optional[str] = Query(
        None,
        description="Comma-separated dimensions (e.g., ym:s:date,ym:s:trafficSource)"
    ),
    goal_id: Optional[int] = Query(None, description="Goal ID for conversion metrics"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get statistics from Yandex.Metrika."""
    integration = await get_metrika_integration(project_id, current_user, db)
    
    params = {
        "ids": counter_id,
        "date1": date_from,
        "date2": date_to,
        "metrics": metrics,
        "accuracy": "full",
    }
    
    if dimensions:
        params["dimensions"] = dimensions
    
    if goal_id:
        # Add goal-specific metrics
        goal_metrics = [
            f"ym:s:goal{goal_id}reaches",
            f"ym:s:goal{goal_id}conversionRate",
        ]
        params["metrics"] = f"{metrics},{','.join(goal_metrics)}"
    
    result = await call_metrika_api(
        "stat/v1/data",
        params,
        integration.access_token
    )
    
    # Parse response
    query = result.get("query", {})
    data_result = result.get("data", [])
    
    # Get column names
    metric_names = [m.replace("ym:s:", "") for m in query.get("metrics", [])]
    dimension_names = [d.replace("ym:s:", "") for d in query.get("dimensions", [])]
    columns = dimension_names + metric_names
    
    # Transform data
    rows = []
    for item in data_result:
        row = {}
        
        # Add dimensions
        for i, dim in enumerate(item.get("dimensions", [])):
            dim_name = dimension_names[i] if i < len(dimension_names) else f"dim_{i}"
            row[dim_name] = dim.get("name") or dim.get("id")
        
        # Add metrics
        for i, metric_value in enumerate(item.get("metrics", [])):
            metric_name = metric_names[i] if i < len(metric_names) else f"metric_{i}"
            row[metric_name] = metric_value
        
        rows.append(row)
    
    return {
        "columns": columns,
        "data": rows,
        "row_count": len(rows),
        "totals": result.get("totals", []),
    }


@router.get("/sources")
async def get_traffic_sources(
    project_id: int,
    counter_id: int,
    date_from: str = Query(..., description="Start date (YYYY-MM-DD)"),
    date_to: str = Query(..., description="End date (YYYY-MM-DD)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get traffic sources breakdown."""
    integration = await get_metrika_integration(project_id, current_user, db)
    
    result = await call_metrika_api(
        "stat/v1/data",
        {
            "ids": counter_id,
            "date1": date_from,
            "date2": date_to,
            "metrics": "ym:s:visits,ym:s:users,ym:s:bounceRate",
            "dimensions": "ym:s:trafficSource",
            "accuracy": "full",
        },
        integration.access_token
    )
    
    data_result = result.get("data", [])
    
    sources = []
    for item in data_result:
        dims = item.get("dimensions", [])
        metrics = item.get("metrics", [])
        
        sources.append({
            "source": dims[0].get("name") if dims else "Unknown",
            "visits": metrics[0] if len(metrics) > 0 else 0,
            "users": metrics[1] if len(metrics) > 1 else 0,
            "bounce_rate": metrics[2] if len(metrics) > 2 else 0,
        })
    
    return sources


@router.get("/utm")
async def get_utm_stats(
    project_id: int,
    counter_id: int,
    date_from: str = Query(..., description="Start date (YYYY-MM-DD)"),
    date_to: str = Query(..., description="End date (YYYY-MM-DD)"),
    utm_param: str = Query("ym:s:UTMSource", description="UTM parameter dimension"),
    goal_id: Optional[int] = Query(None, description="Goal ID for conversions"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get UTM-based statistics for joining with Direct data."""
    integration = await get_metrika_integration(project_id, current_user, db)
    
    metrics = "ym:s:visits,ym:s:users,ym:s:bounceRate"
    
    if goal_id:
        metrics += f",ym:s:goal{goal_id}reaches,ym:s:goal{goal_id}conversionRate"
    
    result = await call_metrika_api(
        "stat/v1/data",
        {
            "ids": counter_id,
            "date1": date_from,
            "date2": date_to,
            "metrics": metrics,
            "dimensions": utm_param,
            "accuracy": "full",
            "limit": 10000,
        },
        integration.access_token
    )
    
    data_result = result.get("data", [])
    
    rows = []
    for item in data_result:
        dims = item.get("dimensions", [])
        mets = item.get("metrics", [])
        
        row = {
            "utm_value": dims[0].get("name") if dims else "Unknown",
            "visits": mets[0] if len(mets) > 0 else 0,
            "users": mets[1] if len(mets) > 1 else 0,
            "bounce_rate": mets[2] if len(mets) > 2 else 0,
        }
        
        if goal_id and len(mets) > 3:
            row["conversions"] = mets[3]
            row["conversion_rate"] = mets[4] if len(mets) > 4 else 0
        
        rows.append(row)
    
    columns = ["utm_value", "visits", "users", "bounce_rate"]
    if goal_id:
        columns.extend(["conversions", "conversion_rate"])
    
    return {
        "columns": columns,
        "data": rows,
        "row_count": len(rows),
    }
