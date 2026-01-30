"""Google Sheets API integration."""
from typing import List, Optional, Any
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
import httpx

from app.database import get_db
from app.models import User, Project, Integration
from app.auth import get_current_user
from app.integrations import verify_project_access, refresh_integration_token

router = APIRouter(prefix="/sheets")

# Google APIs URLs
SHEETS_API_URL = "https://sheets.googleapis.com/v4/spreadsheets"
DRIVE_API_URL = "https://www.googleapis.com/drive/v3/files"


class ExportRequest(BaseModel):
    """Request for exporting data to Google Sheets."""
    spreadsheet_id: Optional[str] = None  # If None, create new spreadsheet
    sheet_name: str = "Report"
    title: Optional[str] = None  # For new spreadsheets
    columns: List[str]
    data: List[dict]


class CreateSpreadsheetRequest(BaseModel):
    """Request for creating a new spreadsheet."""
    title: str


async def get_sheets_integration(
    project_id: int,
    current_user: User,
    db: AsyncSession
) -> Integration:
    """Get Google Sheets integration for a project."""
    await verify_project_access(project_id, current_user, db)
    
    result = await db.execute(
        select(Integration)
        .where(Integration.project_id == project_id, Integration.type == "google_sheets")
    )
    integration = result.scalar_one_or_none()
    
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google Sheets not connected. Please connect it first."
        )
    
    # Refresh token if needed
    access_token = await refresh_integration_token(integration, db)
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Failed to refresh Google token. Please reconnect."
        )
    
    return integration


@router.get("/list")
async def list_spreadsheets(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List spreadsheets accessible to the user."""
    integration = await get_sheets_integration(project_id, current_user, db)
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            DRIVE_API_URL,
            params={
                "q": "mimeType='application/vnd.google-apps.spreadsheet'",
                "fields": "files(id,name,createdTime,modifiedTime,webViewLink)",
                "orderBy": "modifiedTime desc",
                "pageSize": 50,
            },
            headers={
                "Authorization": f"Bearer {integration.access_token}",
            },
            timeout=30.0
        )
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Google Drive API error: {response.text}"
            )
        
        data = response.json()
        files = data.get("files", [])
        
        return [
            {
                "id": f["id"],
                "name": f["name"],
                "created_at": f.get("createdTime"),
                "modified_at": f.get("modifiedTime"),
                "url": f.get("webViewLink"),
            }
            for f in files
        ]


@router.get("/{spreadsheet_id}/sheets")
async def get_spreadsheet_sheets(
    project_id: int,
    spreadsheet_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get sheets in a spreadsheet."""
    integration = await get_sheets_integration(project_id, current_user, db)
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{SHEETS_API_URL}/{spreadsheet_id}",
            params={"fields": "sheets.properties"},
            headers={
                "Authorization": f"Bearer {integration.access_token}",
            },
            timeout=30.0
        )
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Google Sheets API error: {response.text}"
            )
        
        data = response.json()
        sheets = data.get("sheets", [])
        
        return [
            {
                "id": s["properties"]["sheetId"],
                "title": s["properties"]["title"],
                "index": s["properties"]["index"],
            }
            for s in sheets
        ]


@router.post("/create")
async def create_spreadsheet(
    project_id: int,
    request: CreateSpreadsheetRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create a new spreadsheet."""
    integration = await get_sheets_integration(project_id, current_user, db)
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            SHEETS_API_URL,
            json={
                "properties": {
                    "title": request.title,
                },
            },
            headers={
                "Authorization": f"Bearer {integration.access_token}",
                "Content-Type": "application/json",
            },
            timeout=30.0
        )
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Failed to create spreadsheet: {response.text}"
            )
        
        data = response.json()
        
        return {
            "id": data["spreadsheetId"],
            "url": data["spreadsheetUrl"],
            "title": data["properties"]["title"],
        }


@router.post("/export")
async def export_to_sheets(
    project_id: int,
    request: ExportRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Export data to Google Sheets."""
    integration = await get_sheets_integration(project_id, current_user, db)
    
    spreadsheet_id = request.spreadsheet_id
    
    async with httpx.AsyncClient() as client:
        # Create new spreadsheet if needed
        if not spreadsheet_id:
            title = request.title or f"RePort Export {datetime.now().strftime('%Y-%m-%d %H:%M')}"
            
            create_response = await client.post(
                SHEETS_API_URL,
                json={
                    "properties": {"title": title},
                    "sheets": [{"properties": {"title": request.sheet_name}}],
                },
                headers={
                    "Authorization": f"Bearer {integration.access_token}",
                    "Content-Type": "application/json",
                },
                timeout=30.0
            )
            
            if create_response.status_code != 200:
                raise HTTPException(
                    status_code=create_response.status_code,
                    detail=f"Failed to create spreadsheet: {create_response.text}"
                )
            
            create_data = create_response.json()
            spreadsheet_id = create_data["spreadsheetId"]
            spreadsheet_url = create_data["spreadsheetUrl"]
        else:
            # Check if sheet exists, create if not
            sheets_response = await client.get(
                f"{SHEETS_API_URL}/{spreadsheet_id}",
                params={"fields": "sheets.properties,spreadsheetUrl"},
                headers={
                    "Authorization": f"Bearer {integration.access_token}",
                },
                timeout=30.0
            )
            
            if sheets_response.status_code != 200:
                raise HTTPException(
                    status_code=sheets_response.status_code,
                    detail=f"Spreadsheet not found or not accessible"
                )
            
            sheets_data = sheets_response.json()
            spreadsheet_url = sheets_data["spreadsheetUrl"]
            existing_sheets = [s["properties"]["title"] for s in sheets_data.get("sheets", [])]
            
            if request.sheet_name not in existing_sheets:
                # Add new sheet
                add_sheet_response = await client.post(
                    f"{SHEETS_API_URL}/{spreadsheet_id}:batchUpdate",
                    json={
                        "requests": [{
                            "addSheet": {
                                "properties": {"title": request.sheet_name}
                            }
                        }]
                    },
                    headers={
                        "Authorization": f"Bearer {integration.access_token}",
                        "Content-Type": "application/json",
                    },
                    timeout=30.0
                )
                
                if add_sheet_response.status_code != 200:
                    raise HTTPException(
                        status_code=add_sheet_response.status_code,
                        detail=f"Failed to create sheet: {add_sheet_response.text}"
                    )
        
        # Prepare data for export
        values = []
        
        # Header row
        values.append(request.columns)
        
        # Data rows
        for row in request.data:
            row_values = []
            for col in request.columns:
                value = row.get(col, "")
                # Convert None to empty string
                if value is None:
                    value = ""
                # Convert numbers to proper format
                elif isinstance(value, (int, float)):
                    pass  # Keep as is
                else:
                    value = str(value)
                row_values.append(value)
            values.append(row_values)
        
        # Clear existing data and write new data
        range_name = f"'{request.sheet_name}'!A1"
        
        # Clear the sheet first
        clear_response = await client.post(
            f"{SHEETS_API_URL}/{spreadsheet_id}/values/{request.sheet_name}:clear",
            json={},
            headers={
                "Authorization": f"Bearer {integration.access_token}",
                "Content-Type": "application/json",
            },
            timeout=30.0
        )
        
        # Write data
        update_response = await client.put(
            f"{SHEETS_API_URL}/{spreadsheet_id}/values/{range_name}",
            params={"valueInputOption": "USER_ENTERED"},
            json={"values": values},
            headers={
                "Authorization": f"Bearer {integration.access_token}",
                "Content-Type": "application/json",
            },
            timeout=60.0
        )
        
        if update_response.status_code != 200:
            raise HTTPException(
                status_code=update_response.status_code,
                detail=f"Failed to write data: {update_response.text}"
            )
        
        update_data = update_response.json()
        
        return {
            "spreadsheet_id": spreadsheet_id,
            "spreadsheet_url": spreadsheet_url,
            "sheet_name": request.sheet_name,
            "updated_cells": update_data.get("updatedCells", 0),
            "updated_rows": update_data.get("updatedRows", 0),
        }
