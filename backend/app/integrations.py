from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from app.database import get_db
from app.models import User, Project, Integration
from app.schemas import IntegrationResponse
from app.auth import get_current_user
from app.config import (
    YANDEX_CLIENT_ID, YANDEX_CLIENT_SECRET, YANDEX_REDIRECT_URI,
    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
    FRONTEND_URL
)

router = APIRouter(prefix="/integrations")

# Yandex OAuth URLs
YANDEX_AUTH_URL = "https://oauth.yandex.ru/authorize"
YANDEX_TOKEN_URL = "https://oauth.yandex.ru/token"
YANDEX_USERINFO_URL = "https://login.yandex.ru/info"

# Google OAuth URLs
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


# ============== Helper Functions ==============

async def verify_project_access(
    project_id: int,
    current_user: User,
    db: AsyncSession
) -> Project:
    """Verify user has access to the project."""
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id, Project.user_id == current_user.id)
    )
    project = result.scalar_one_or_none()
    
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found"
        )
    
    return project


# ============== Yandex OAuth ==============

@router.get("/yandex/auth-url")
async def get_yandex_auth_url(
    project_id: int,
    integration_type: str = Query(..., pattern="^(yandex_direct|yandex_metrika)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get Yandex OAuth authorization URL."""
    # Verify project access
    await verify_project_access(project_id, current_user, db)
    
    if not YANDEX_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Yandex OAuth not configured"
        )
    
    # State contains project_id and integration_type for callback
    state = f"{project_id}:{integration_type}"
    
    # Different scopes for Direct and Metrika
    if integration_type == "yandex_direct":
        scope = "direct:api"
    else:
        scope = "metrika:read"
    
    auth_url = (
        f"{YANDEX_AUTH_URL}"
        f"?response_type=code"
        f"&client_id={YANDEX_CLIENT_ID}"
        f"&redirect_uri={YANDEX_REDIRECT_URI}"
        f"&scope={scope}"
        f"&state={state}"
    )
    
    return {"auth_url": auth_url}


@router.get("/yandex/callback")
async def yandex_callback(
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db)
):
    """Handle Yandex OAuth callback."""
    try:
        project_id, integration_type = state.split(":")
        project_id = int(project_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid state parameter"
        )
    
    # Exchange code for tokens
    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            YANDEX_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": YANDEX_CLIENT_ID,
                "client_secret": YANDEX_CLIENT_SECRET,
            }
        )
        
        if token_response.status_code != 200:
            return RedirectResponse(
                url=f"{FRONTEND_URL}/projects/{project_id}/integrations?error=token_exchange_failed"
            )
        
        token_data = token_response.json()
        access_token = token_data.get("access_token")
        refresh_token = token_data.get("refresh_token")
        expires_in = token_data.get("expires_in", 3600)
        
        # Get user info
        userinfo_response = await client.get(
            YANDEX_USERINFO_URL,
            headers={"Authorization": f"OAuth {access_token}"}
        )
        
        account_info = {}
        if userinfo_response.status_code == 200:
            user_data = userinfo_response.json()
            account_info = {
                "login": user_data.get("login"),
                "name": user_data.get("real_name") or user_data.get("login"),
            }
    
    # Check if integration already exists
    result = await db.execute(
        select(Integration)
        .where(Integration.project_id == project_id, Integration.type == integration_type)
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        # Update existing integration
        existing.access_token = access_token
        existing.refresh_token = refresh_token
        existing.expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
        existing.account_info = account_info
    else:
        # Create new integration
        integration = Integration(
            project_id=project_id,
            type=integration_type,
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=datetime.utcnow() + timedelta(seconds=expires_in),
            account_info=account_info,
        )
        db.add(integration)
    
    await db.commit()
    
    return RedirectResponse(
        url=f"{FRONTEND_URL}/projects/{project_id}/integrations?success=1"
    )


# ============== Google OAuth ==============

@router.get("/google/auth-url")
async def get_google_auth_url(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get Google OAuth authorization URL."""
    # Verify project access
    await verify_project_access(project_id, current_user, db)
    
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth not configured"
        )
    
    state = str(project_id)
    scope = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file"
    
    auth_url = (
        f"{GOOGLE_AUTH_URL}"
        f"?response_type=code"
        f"&client_id={GOOGLE_CLIENT_ID}"
        f"&redirect_uri={GOOGLE_REDIRECT_URI}"
        f"&scope={scope}"
        f"&state={state}"
        f"&access_type=offline"
        f"&prompt=consent"
    )
    
    return {"auth_url": auth_url}


@router.get("/google/callback")
async def google_callback(
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db)
):
    """Handle Google OAuth callback."""
    try:
        project_id = int(state)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid state parameter"
        )
    
    # Exchange code for tokens
    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": GOOGLE_REDIRECT_URI,
            }
        )
        
        if token_response.status_code != 200:
            return RedirectResponse(
                url=f"{FRONTEND_URL}/projects/{project_id}/integrations?error=token_exchange_failed"
            )
        
        token_data = token_response.json()
        access_token = token_data.get("access_token")
        refresh_token = token_data.get("refresh_token")
        expires_in = token_data.get("expires_in", 3600)
        
        # Get user info
        userinfo_response = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"}
        )
        
        account_info = {}
        if userinfo_response.status_code == 200:
            user_data = userinfo_response.json()
            account_info = {
                "email": user_data.get("email"),
                "name": user_data.get("name"),
            }
    
    # Check if integration already exists
    result = await db.execute(
        select(Integration)
        .where(Integration.project_id == project_id, Integration.type == "google_sheets")
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        # Update existing integration
        existing.access_token = access_token
        if refresh_token:  # Google only returns refresh_token on first auth
            existing.refresh_token = refresh_token
        existing.expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
        existing.account_info = account_info
    else:
        # Create new integration
        integration = Integration(
            project_id=project_id,
            type="google_sheets",
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=datetime.utcnow() + timedelta(seconds=expires_in),
            account_info=account_info,
        )
        db.add(integration)
    
    await db.commit()
    
    return RedirectResponse(
        url=f"{FRONTEND_URL}/projects/{project_id}/integrations?success=1"
    )


# ============== Project Integrations Management ==============

@router.get("/projects/{project_id}", response_model=List[IntegrationResponse])
async def get_project_integrations(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get all integrations for a project."""
    # Verify project access
    await verify_project_access(project_id, current_user, db)
    
    result = await db.execute(
        select(Integration)
        .where(Integration.project_id == project_id)
        .order_by(Integration.created_at)
    )
    integrations = result.scalars().all()
    
    return integrations


@router.delete("/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_integration(
    integration_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Delete an integration."""
    # Get integration
    result = await db.execute(
        select(Integration)
        .where(Integration.id == integration_id)
    )
    integration = result.scalar_one_or_none()
    
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integration not found"
        )
    
    # Verify project access
    await verify_project_access(integration.project_id, current_user, db)
    
    await db.delete(integration)
    await db.commit()


# ============== Token Refresh Helper ==============

async def refresh_integration_token(
    integration: Integration,
    db: AsyncSession
) -> Optional[str]:
    """Refresh an integration's access token if expired."""
    if not integration.refresh_token:
        return None
    
    # Check if token is expired or about to expire (within 5 minutes)
    if integration.expires_at and integration.expires_at > datetime.utcnow() + timedelta(minutes=5):
        return integration.access_token
    
    async with httpx.AsyncClient() as client:
        if integration.type in ("yandex_direct", "yandex_metrika"):
            # Yandex token refresh
            response = await client.post(
                YANDEX_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": integration.refresh_token,
                    "client_id": YANDEX_CLIENT_ID,
                    "client_secret": YANDEX_CLIENT_SECRET,
                }
            )
        elif integration.type == "google_sheets":
            # Google token refresh
            response = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": integration.refresh_token,
                    "client_id": GOOGLE_CLIENT_ID,
                    "client_secret": GOOGLE_CLIENT_SECRET,
                }
            )
        else:
            return None
        
        if response.status_code != 200:
            return None
        
        token_data = response.json()
        integration.access_token = token_data.get("access_token")
        if token_data.get("refresh_token"):
            integration.refresh_token = token_data["refresh_token"]
        integration.expires_at = datetime.utcnow() + timedelta(
            seconds=token_data.get("expires_in", 3600)
        )
        
        await db.commit()
        
        return integration.access_token
