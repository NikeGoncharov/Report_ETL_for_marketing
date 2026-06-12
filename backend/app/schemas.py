from pydantic import BaseModel, ConfigDict, EmailStr
from datetime import datetime
from typing import Optional, List, Dict, Any, Literal


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


# ============== Report Config (staged pipeline) ==============
# Пайплайн отчёта: датасеты (состояние 1) -> шаги датасета (состояние 2)
# -> сшивка + группировка (состояние 3) -> экспорт.
# extra="forbid": неизвестное поле — это ошибка 422, а не молчаливая потеря.

PERIOD_TYPES = Literal[
    "today", "yesterday",
    "last_7_days", "last_14_days", "last_15_days", "last_30_days", "last_90_days",
    "this_month", "last_month", "custom",
]


class PeriodConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: PERIOD_TYPES = "last_30_days"
    date_from: Optional[str] = None  # YYYY-MM-DD, только для custom
    date_to: Optional[str] = None


class StepConfig(BaseModel):
    """Шаг трансформации внутри датасета. Поле source проставляет движок."""
    model_config = ConfigDict(extra="forbid")

    type: Literal["extract", "filter", "rename", "calculate", "sort", "group_by"]
    column: Optional[str] = None
    columns: Optional[List[str]] = None
    pattern: Optional[str] = None
    output_column: Optional[str] = None
    aggregations: Optional[Dict[str, str]] = None
    mapping: Optional[Dict[str, str]] = None
    operator: Optional[str] = None
    value: Optional[Any] = None
    formula: Optional[str] = None
    descending: Optional[bool] = None


class DatasetConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: Literal["direct", "metrika"]
    label: Optional[str] = None
    # Директ
    campaign_ids: Optional[List[int]] = None  # пусто/None = все кампании
    fields: Optional[List[str]] = None  # из catalog.DIRECT_FIELDS
    group_by: Optional[Literal["campaign", "day"]] = None
    include_vat: bool = True  # расход с НДС / без НДС
    # Метрика
    counter_id: Optional[int] = None
    metrics: Optional[List[str]] = None
    dimensions: Optional[List[str]] = None
    goals: Optional[List[int]] = None
    # Состояние 2: шаги трансформации датасета
    steps: List[StepConfig] = []


class MergeConfig(BaseModel):
    """Состояние 3а: сшивка двух датасетов (кампании <-> UTM)."""
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    left: Optional[str] = None  # id датасета
    right: Optional[str] = None
    left_key: Optional[str] = None  # имя колонки слева (например campaignname)
    right_key: Optional[str] = None  # имя колонки справа (например UTMCampaign)
    how: Literal["inner", "left", "right", "outer"] = "left"


class GroupingConfig(BaseModel):
    """Состояние 3б: группировка результата (например, по типу площадки)."""
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    columns: List[str] = []
    aggregations: Dict[str, str] = {}


class ExportConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["google_sheets"] = "google_sheets"
    spreadsheet_id: Optional[str] = None
    sheet_name: Optional[str] = None
    create_new: bool = False  # true = новая таблица при каждом запуске


class ReportConfigV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[2]
    datasets: List[DatasetConfig]
    period: PeriodConfig
    merge: MergeConfig = MergeConfig()
    grouping: GroupingConfig = GroupingConfig()
    # Какой датасет считать результатом, если сшивка выключена (по умолчанию первый)
    result_dataset: Optional[str] = None
    export: ExportConfig = ExportConfig()


class ReportCreate(BaseModel):
    name: str
    config: ReportConfigV2


class ReportUpdate(BaseModel):
    name: Optional[str] = None
    config: Optional[ReportConfigV2] = None


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
    """Preview accepts full config as dict so frontend field selection is not stripped."""
    config: dict  # конфиг v2 как dict — черновик из конструктора, валидируется при выполнении
    # Состояние пайплайна, до которого выполнить превью (только для конфигов v2):
    # fetched | transformed | merged | final
    stage: Literal["fetched", "transformed", "merged", "final"] = "final"
    # Для fetched/transformed: какой датасет показать (по умолчанию первый)
    dataset_id: Optional[str] = None
    # true = игнорировать серверный кэш выгрузки и заново сходить во внешние API
    refresh: bool = False


class PreviewResponse(BaseModel):
    columns: List[str]
    data: List[dict]
    row_count: int
