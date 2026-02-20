"""Yandex.Direct API integration."""
import asyncio
from datetime import datetime, date
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from app.database import get_db
from app.models import User, Project, Integration
from app.auth import get_current_user
from app.integrations import verify_project_access, refresh_integration_token

router = APIRouter(prefix="/direct")

# Yandex.Direct API URLs
DIRECT_API_URL = "https://api.direct.yandex.com/json/v5"
DIRECT_SANDBOX_URL = "https://api-sandbox.direct.yandex.com/json/v5"


async def get_direct_integration(
    project_id: int,
    current_user: User,
    db: AsyncSession
) -> Integration:
    """Get Yandex.Direct integration for a project."""
    await verify_project_access(project_id, current_user, db)
    
    result = await db.execute(
        select(Integration)
        .where(Integration.project_id == project_id, Integration.type == "yandex_direct")
    )
    integration = result.scalar_one_or_none()
    
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Yandex.Direct not connected. Please connect it first."
        )
    
    # Refresh token if needed
    access_token = await refresh_integration_token(integration, db)
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Failed to refresh Yandex.Direct token. Please reconnect."
        )
    
    return integration


async def call_direct_api(
    method: str,
    params: dict,
    access_token: str,
    use_sandbox: bool = False
) -> dict:
    """Call Yandex.Direct API."""
    url = f"{DIRECT_SANDBOX_URL if use_sandbox else DIRECT_API_URL}/{method}"
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            url,
            json={"method": "get", "params": params},
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept-Language": "ru",
                "Content-Type": "application/json",
            },
            timeout=30.0
        )
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Yandex.Direct API error: {response.text}"
            )
        
        data = response.json()
        
        if "error" in data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Yandex.Direct API error: {data['error']}"
            )
        
        return data.get("result", {})


DIRECT_REPORT_FIELDS_WHITELIST = {
    "CampaignId", "CampaignName", "Date",
    "Impressions", "Clicks", "Cost", "Ctr", "AvgCpc",
    "Conversions", "ConversionRate", "CostPerConversion",
}


async def fetch_direct_stats(
    integration: Integration,
    date_from: str,
    date_to: str,
    campaign_ids: Optional[List[int]] = None,
    group_by: str = "campaign",
    direct_fields: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch Direct statistics for the given period.
    Returns list of row dicts (lowercase keys). Uses Reports API when possible,
    fallback to campaigns with Statistics on 201/202 or non-200.
    """
    selection_criteria: Dict[str, Any] = {
        "DateFrom": date_from,
        "DateTo": date_to,
    }
    if campaign_ids:
        selection_criteria["Filter"] = [{
            "Field": "CampaignId",
            "Operator": "IN",
            "Values": campaign_ids,
        }]

    if direct_fields:
        field_names = [f for f in direct_fields if f in DIRECT_REPORT_FIELDS_WHITELIST]
    else:
        field_names = []
    if not field_names:
        field_names = [
            "CampaignId", "CampaignName",
            "Impressions", "Clicks", "Cost", "Ctr", "AvgCpc",
            "Conversions", "ConversionRate", "CostPerConversion",
        ]
    if group_by == "day" and "Date" not in field_names:
        field_names.insert(0, "Date")

    params = {
        "SelectionCriteria": selection_criteria,
        "FieldNames": field_names,
        "ReportName": f"Report_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
        "ReportType": "CAMPAIGN_PERFORMANCE_REPORT",
        "DateRangeType": "CUSTOM_DATE",
        "Format": "TSV",
        "IncludeVAT": "YES",
        "IncludeDiscount": "NO",
    }

    url = f"{DIRECT_API_URL}/reports"
    headers = {
        "Authorization": f"Bearer {integration.access_token}",
        "Accept-Language": "ru",
        "Content-Type": "application/json",
        "processingMode": "auto",
        "returnMoneyInMicros": "false",
        "skipReportHeader": "true",
        "skipReportSummary": "true",
    }
    max_retries = 3
    retry_delay_seconds = 5

    async with httpx.AsyncClient() as client:
        for attempt in range(max_retries):
            response = await client.post(
                url,
                json={"params": params},
                headers=headers,
                timeout=60.0,
            )

            if response.status_code == 200 and response.text.strip():
                lines = response.text.strip().split("\n")
                if len(lines) >= 2:
                    report_headers = lines[0].split("\t")
                    data = []
                    for line in lines[1:]:
                        values = line.split("\t")
                        row = {}
                        for i, header in enumerate(report_headers):
                            if i < len(values):
                                value = values[i]
                                if header in ["Impressions", "Clicks", "Conversions"]:
                                    row[header.lower()] = int(value) if value else 0
                                elif header in ["Cost", "Ctr", "AvgCpc", "ConversionRate", "CostPerConversion"]:
                                    row[header.lower()] = float(value) if value else 0.0
                                else:
                                    row[header.lower()] = value
                        data.append(row)
                    return data

            if response.status_code in (201, 202):
                # Report is being generated; wait and retry with same params
                if attempt < max_retries - 1:
                    await asyncio.sleep(retry_delay_seconds)
                    continue
            break

    # Fallback: campaigns with Statistics (campaign-level aggregate)
    criteria = {"Ids": campaign_ids} if campaign_ids else {}
    campaigns_result = await call_direct_api(
        "campaigns",
        {
            "SelectionCriteria": criteria,
            "FieldNames": ["Id", "Name", "Statistics"],
        },
        integration.access_token,
    )
    campaigns = campaigns_result.get("Campaigns", [])
    return [
        {
            "campaign_id": c["Id"],
            "campaign_name": c["Name"],
            "impressions": c.get("Statistics", {}).get("Impressions", 0),
            "clicks": c.get("Statistics", {}).get("Clicks", 0),
            "cost": c.get("Statistics", {}).get("Cost", 0),
        }
        for c in campaigns
    ]


@router.get("/campaigns")
async def get_campaigns(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get list of campaigns from Yandex.Direct."""
    integration = await get_direct_integration(project_id, current_user, db)
    
    result = await call_direct_api(
        "campaigns",
        {
            "SelectionCriteria": {},
            "FieldNames": [
                "Id", "Name", "Status", "State", "Type",
                "StartDate", "DailyBudget", "Statistics"
            ],
        },
        integration.access_token
    )
    
    campaigns = result.get("Campaigns", [])
    
    # Transform to simpler format
    return [
        {
            "id": c["Id"],
            "name": c["Name"],
            "status": c.get("Status"),
            "state": c.get("State"),
            "type": c.get("Type"),
            "start_date": c.get("StartDate"),
            "daily_budget": c.get("DailyBudget", {}).get("Amount"),
        }
        for c in campaigns
    ]


@router.get("/stats")
async def get_stats(
    project_id: int,
    date_from: str = Query(..., description="Start date (YYYY-MM-DD)"),
    date_to: str = Query(..., description="End date (YYYY-MM-DD)"),
    campaign_ids: Optional[str] = Query(None, description="Comma-separated campaign IDs"),
    group_by: str = Query("day", description="Group by: day, week, month, campaign"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get statistics from Yandex.Direct."""
    integration = await get_direct_integration(project_id, current_user, db)
    ids_list = [int(x.strip()) for x in campaign_ids.split(",")] if campaign_ids else None
    data = await fetch_direct_stats(integration, date_from, date_to, ids_list, group_by)
    columns = list(data[0].keys()) if data else []
    return {"columns": columns, "data": data, "row_count": len(data)}
