from pydantic import BaseModel, ConfigDict, EmailStr
from datetime import datetime
from typing import Optional, List, Dict, Any, Literal, Union


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
    # Direct: optional field selection and grouping
    direct_fields: Optional[List[str]] = None
    direct_group_by: Optional[str] = None  # 'day' | 'campaign'
    # Metrika: optional metrics and dimensions (API names, e.g. ym:s:visits)
    metrics: Optional[List[str]] = None
    dimensions: Optional[List[str]] = None
    # Per-source transformations (applied before global merge)
    source_transformations: Optional[List["TransformationConfig"]] = None


class TransformationConfig(BaseModel):
    type: str  # 'extract', 'group_by', 'join', 'rename', 'filter', 'calculate', 'sort'
    source: Optional[str] = None
    left: Optional[str] = None
    right: Optional[str] = None
    column: Optional[str] = None
    columns: Optional[List[str]] = None
    pattern: Optional[str] = None
    output_column: Optional[str] = None
    aggregations: Optional[dict] = None
    on: Optional[str] = None
    left_on: Optional[str] = None  # join: ключ слева (если имена ключей различаются)
    right_on: Optional[str] = None  # join: ключ справа
    how: Optional[str] = None
    output: Optional[str] = None  # join: куда писать результат
    mapping: Optional[dict] = None  # for rename
    operator: Optional[str] = None  # for filter
    value: Optional[Any] = None  # for filter
    formula: Optional[str] = None  # for calculate
    descending: Optional[bool] = None  # for sort


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


# ============== Report Config v2 (staged pipeline) ==============
# Пайплайн отчёта: датасеты (состояние 1) -> шаги датасета (состояние 2)
# -> сшивка + группировка (состояние 3) -> экспорт.
# extra="forbid": неизвестное поле — это ошибка 422, а не молчаливая потеря.

PERIOD_TYPES = Literal[
    "today", "yesterday",
    "last_7_days", "last_14_days", "last_15_days", "last_30_days", "last_90_days",
    "this_month", "last_month", "custom",
]


class PeriodConfigV2(BaseModel):
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


class ExportConfigV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["google_sheets"] = "google_sheets"
    spreadsheet_id: Optional[str] = None
    sheet_name: Optional[str] = None
    create_new: bool = False  # true = новая таблица при каждом запуске


class ReportConfigV2(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[2]
    datasets: List[DatasetConfig]
    period: PeriodConfigV2
    merge: MergeConfig = MergeConfig()
    grouping: GroupingConfig = GroupingConfig()
    # Какой датасет считать результатом, если сшивка выключена (по умолчанию первый)
    result_dataset: Optional[str] = None
    export: ExportConfigV2 = ExportConfigV2()


# Union: сначала пробуем v2 (требует version=2), затем легаси-схему
AnyReportConfig = Union[ReportConfigV2, ReportConfig]


class ReportCreate(BaseModel):
    name: str
    config: AnyReportConfig


class ReportUpdate(BaseModel):
    name: Optional[str] = None
    config: Optional[AnyReportConfig] = None


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
    config: dict  # ReportConfig-like; use .get() in pipeline to preserve direct_fields, direct_group_by, etc.
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
