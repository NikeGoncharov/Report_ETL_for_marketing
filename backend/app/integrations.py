from datetime import datetime, timedelta
from typing import List, Optional
import hashlib
import hmac
import logging
import time
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from app.database import get_db
from app.models import User, Project, Integration
from app.schemas import IntegrationResponse
from app.auth import get_current_user
from app.config import (
    YANDEX_CLIENT_ID, YANDEX_CLIENT_SECRET, YANDEX_REDIRECT_URI,
    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
    FRONTEND_URL, SECRET_KEY
)

router = APIRouter(prefix="/integrations")
logger = logging.getLogger(__name__)

# Yandex OAuth URLs
YANDEX_AUTH_URL = "https://oauth.yandex.ru/authorize"
YANDEX_TOKEN_URL = "https://oauth.yandex.ru/token"
YANDEX_USERINFO_URL = "https://login.yandex.ru/info"

# Google OAuth URLs
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


# ============== Helper Functions ==============


async def upsert_integration(
    db: AsyncSession,
    project_id: int,
    integration_type: str,
    access_token: str,
    refresh_token: Optional[str],
    expires_in: int,
    account_info: dict,
    keep_refresh_if_missing: bool = False,
) -> None:
    """Идемпотентно сохранить интеграцию (project_id, type).

    UniqueConstraint(project_id, type) + ловля IntegrityError делают конкурентный
    check-then-insert безопасным: проигравшая гонку вставка откатывается и
    обновляет уже созданную строку, вместо дублей и последующего 500.

    keep_refresh_if_missing=True (Google): не затирать refresh_token, если провайдер
    его не прислал (Google отдаёт refresh_token только при первой авторизации).
    """
    expires_at = datetime.utcnow() + timedelta(seconds=expires_in)

    def _apply(existing: Integration) -> None:
        existing.access_token = access_token
        if not (keep_refresh_if_missing and not refresh_token):
            existing.refresh_token = refresh_token
        existing.expires_at = expires_at
        existing.account_info = account_info

    result = await db.execute(
        select(Integration).where(
            Integration.project_id == project_id,
            Integration.type == integration_type,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        _apply(existing)
        await db.commit()
        return

    db.add(Integration(
        project_id=project_id,
        type=integration_type,
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
        account_info=account_info,
    ))
    try:
        await db.commit()
    except IntegrityError:
        # IntegrityError здесь двух видов: (1) проигранная гонка uniqueness —
        # параллельный callback уже вставил строку; (2) FK-ошибка — проект удалён
        # во время OAuth (foreign_keys=ON). Отличаем по повторному select: строка
        # есть -> гонка, обновляем; строки нет -> FK, отдаём чистый 404, а не 500.
        await db.rollback()
        result = await db.execute(
            select(Integration).where(
                Integration.project_id == project_id,
                Integration.type == integration_type,
            )
        )
        existing = result.scalar_one_or_none()
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Проект не найден — возможно, он был удалён во время авторизации.",
            )
        _apply(existing)
        await db.commit()

# OAuth callbacks have no user session: the provider redirects the browser
# straight to the backend. The signed state is the only proof that the
# request originates from an auth-url issued by us for this project —
# without it, anyone could bind their integration to a foreign project_id.
OAUTH_STATE_TTL_SECONDS = 600


def sign_oauth_state(payload: str) -> str:
    expires = str(int(time.time()) + OAUTH_STATE_TTL_SECONDS)
    data = f"{payload}|{expires}"
    signature = hmac.new(SECRET_KEY.encode(), data.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{data}|{signature}"


def verify_oauth_state(state: str) -> str:
    """Return the state payload if the signature is valid and not expired."""
    try:
        payload, expires, signature = state.rsplit("|", 2)
        data = f"{payload}|{expires}"
        expected = hmac.new(SECRET_KEY.encode(), data.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(signature, expected):
            raise ValueError("bad signature")
        if int(expires) < time.time():
            raise ValueError("state expired")
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid state parameter"
        )
    return payload


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
    state = sign_oauth_state(f"{project_id}:{integration_type}")

    # Different scopes for Direct and Metrika
    if integration_type == "yandex_direct":
        scope = "direct:api"
    else:
        scope = "metrika:read"

    params = {
        "response_type": "code",
        "client_id": YANDEX_CLIENT_ID,
        "redirect_uri": YANDEX_REDIRECT_URI,
        "scope": scope,
        "state": state,
        "force_confirm": "yes",
    }
    auth_url = f"{YANDEX_AUTH_URL}?{urlencode(params)}"

    return {"auth_url": auth_url}


@router.get("/yandex/callback")
async def yandex_callback(
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db)
):
    """Handle Yandex OAuth callback."""
    payload = verify_oauth_state(state)
    try:
        project_id, integration_type = payload.split(":")
        project_id = int(project_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid state parameter"
        )
    if integration_type not in ("yandex_direct", "yandex_metrika"):
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
                "redirect_uri": YANDEX_REDIRECT_URI,
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
    
    await upsert_integration(
        db, project_id, integration_type,
        access_token, refresh_token, expires_in, account_info,
    )

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
    
    state = sign_oauth_state(str(project_id))
    scope = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file"

    params = {
        "response_type": "code",
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "scope": scope,
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }
    auth_url = f"{GOOGLE_AUTH_URL}?{urlencode(params)}"

    return {"auth_url": auth_url}


@router.get("/google/callback")
async def google_callback(
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db)
):
    """Handle Google OAuth callback."""
    payload = verify_oauth_state(state)
    try:
        project_id = int(payload)
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
    
    await upsert_integration(
        db, project_id, "google_sheets",
        access_token, refresh_token, expires_in, account_info,
        keep_refresh_if_missing=True,  # Google отдаёт refresh_token только при первой авторизации
    )

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
        # Backward compatibility: older rows may not have refresh token/expires_at.
        return integration.access_token
    
    if integration.access_token and not integration.expires_at:
        # Keep existing token when expiry timestamp was not stored.
        return integration.access_token
    
    if integration.expires_at is None and not integration.access_token:
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
            logger.warning(
                "Token refresh failed for integration_id=%s type=%s status=%s",
                integration.id,
                integration.type,
                response.status_code,
            )
            # Fall back to current access token if we still have one.
            return integration.access_token
        
        token_data = response.json()
        integration.access_token = token_data.get("access_token")
        if token_data.get("refresh_token"):
            integration.refresh_token = token_data["refresh_token"]
        integration.expires_at = datetime.utcnow() + timedelta(
            seconds=token_data.get("expires_in", 3600)
        )
        
        await db.commit()
        
        return integration.access_token
