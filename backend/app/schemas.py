from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional, List, Any


# ============== User Schemas ==============

class UserCreate(BaseModel):
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    created_at: datetime

    class Config:
        from_attributes = True


# ============== Token Schemas ==============

class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenRefresh(BaseModel):
    refresh_token: str


# ============== Project Schemas ==============

class ProjectCreate(BaseModel):
    name: str


class ProjectUpdate(BaseModel):
    name: Optional[str] = None


class ProjectResponse(BaseModel):
    id: int
    name: str
    user_id: int
    created_at: datetime

    class Config:
        from_attributes = True


# ============== Integration Schemas ==============

class IntegrationResponse(BaseModel):
    id: int
    project_id: int
    type: str
    account_info: Optional[dict] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ============== Report Schemas ==============

class ReportSourceConfig(BaseModel):
    id: str
    type: str  # 'direct' or 'metrika'
    campaign_ids: Optional[List[int]] = None
    counter_id: Optional[int] = None
    goals: Optional[List[int]] = None


class TransformationConfig(BaseModel):
    type: str  # 'extract', 'group_by', 'join', 'rename'
    source: Optional[str] = None
    left: Optional[str] = None
    right: Optional[str] = None
    column: Optional[str] = None
    columns: Optional[List[str]] = None
    pattern: Optional[str] = None
    output_column: Optional[str] = None
    aggregations: Optional[dict] = None
    on: Optional[str] = None
    how: Optional[str] = None
    mapping: Optional[dict] = None  # for rename


class ExportConfig(BaseModel):
    type: str = "google_sheets"
    spreadsheet_id: Optional[str] = None
    sheet_name: Optional[str] = None
    create_new: bool = False


class PeriodConfig(BaseModel):
    type: str  # 'last_7_days', 'last_30_days', 'custom'
    date_from: Optional[str] = None
    date_to: Optional[str] = None


class ReportConfig(BaseModel):
    sources: List[ReportSourceConfig]
    period: PeriodConfig
    transformations: List[TransformationConfig] = []
    export: ExportConfig


class ReportCreate(BaseModel):
    name: str
    config: ReportConfig


class ReportUpdate(BaseModel):
    name: Optional[str] = None
    config: Optional[ReportConfig] = None


class ReportResponse(BaseModel):
    id: int
    project_id: int
    name: str
    config: dict
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ============== Report Run Schemas ==============

class ReportRunResponse(BaseModel):
    id: int
    report_id: int
    status: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    result_url: Optional[str] = None

    class Config:
        from_attributes = True


# ============== Preview Schemas ==============

class PreviewRequest(BaseModel):
    config: ReportConfig


class PreviewResponse(BaseModel):
    columns: List[str]
    data: List[dict]
    row_count: int
