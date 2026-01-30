"""Yandex.Direct API integration."""
from datetime import datetime, date
from typing import List, Optional
import json

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
    db: AsyncSession = Depends(get_db)
):
    """Get statistics from Yandex.Direct."""
    integration = await get_direct_integration(project_id, current_user, db)
    
    # Build selection criteria
    selection_criteria = {
        "DateFrom": date_from,
        "DateTo": date_to,
    }
    
    if campaign_ids:
        selection_criteria["Filter"] = [{
            "Field": "CampaignId",
            "Operator": "IN",
            "Values": [int(id.strip()) for id in campaign_ids.split(",")]
        }]
    
    # Determine report type
    report_type = "CAMPAIGN_PERFORMANCE_REPORT"
    
    # Build field names based on grouping
    field_names = [
        "CampaignId", "CampaignName",
        "Impressions", "Clicks", "Cost", "Ctr", "AvgCpc",
        "Conversions", "ConversionRate", "CostPerConversion"
    ]
    
    if group_by == "day":
        field_names.insert(0, "Date")
    
    # For Direct API v5, we need to use Reports service
    # Simplified version - using campaigns stats
    params = {
        "SelectionCriteria": selection_criteria,
        "FieldNames": field_names,
        "ReportName": f"Report_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
        "ReportType": report_type,
        "DateRangeType": "CUSTOM_DATE",
        "Format": "TSV",
        "IncludeVAT": "YES",
        "IncludeDiscount": "NO",
    }
    
    # Call reports API
    url = f"{DIRECT_API_URL}/reports"
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            url,
            json={"params": params},
            headers={
                "Authorization": f"Bearer {integration.access_token}",
                "Accept-Language": "ru",
                "Content-Type": "application/json",
                "processingMode": "auto",
                "returnMoneyInMicros": "false",
                "skipReportHeader": "true",
                "skipReportSummary": "true",
            },
            timeout=60.0
        )
        
        if response.status_code == 201 or response.status_code == 202:
            # Report is being generated, need to wait
            # For simplicity, we'll return a placeholder
            return {
                "status": "processing",
                "message": "Report is being generated. Please try again in a few seconds."
            }
        
        if response.status_code != 200:
            # Try to get campaigns with basic stats instead
            campaigns_result = await call_direct_api(
                "campaigns",
                {
                    "SelectionCriteria": {},
                    "FieldNames": ["Id", "Name", "Statistics"],
                },
                integration.access_token
            )
            
            campaigns = campaigns_result.get("Campaigns", [])
            
            return {
                "columns": ["campaign_id", "campaign_name", "impressions", "clicks", "cost"],
                "data": [
                    {
                        "campaign_id": c["Id"],
                        "campaign_name": c["Name"],
                        "impressions": c.get("Statistics", {}).get("Impressions", 0),
                        "clicks": c.get("Statistics", {}).get("Clicks", 0),
                        "cost": c.get("Statistics", {}).get("Cost", 0),
                    }
                    for c in campaigns
                ],
                "row_count": len(campaigns)
            }
        
        # Parse TSV response
        lines = response.text.strip().split("\n")
        if len(lines) < 2:
            return {"columns": field_names, "data": [], "row_count": 0}
        
        headers = lines[0].split("\t")
        data = []
        
        for line in lines[1:]:
            values = line.split("\t")
            row = {}
            for i, header in enumerate(headers):
                if i < len(values):
                    # Convert numeric fields
                    value = values[i]
                    if header in ["Impressions", "Clicks", "Conversions"]:
                        row[header.lower()] = int(value) if value else 0
                    elif header in ["Cost", "Ctr", "AvgCpc", "ConversionRate", "CostPerConversion"]:
                        row[header.lower()] = float(value) if value else 0.0
                    else:
                        row[header.lower()] = value
            data.append(row)
        
        return {
            "columns": [h.lower() for h in headers],
            "data": data,
            "row_count": len(data)
        }
