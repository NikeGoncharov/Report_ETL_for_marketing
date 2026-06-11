"""Catalogs of report parameters: Direct fields, Metrika metrics/dimensions.

Единый источник истины для UI: фронтенд строит селекторы из GET /reports/catalog,
а бэкенд использует те же списки для валидации и белых списков полей.
Списки собраны по документации API Яндекс.Директа (Reports API v5,
CAMPAIGN_PERFORMANCE_REPORT) и Яндекс.Метрики (stat/v1/data).
"""
from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.models import User

router = APIRouter()

# ============== Яндекс.Директ: поля CAMPAIGN_PERFORMANCE_REPORT ==============
# kind: dimension — срез (строка результата), metric — показатель (число).
# agg — агрегация по умолчанию для группировки.

DIRECT_FIELDS = [
    # Срезы
    {"id": "Date", "label": "День", "kind": "dimension"},
    {"id": "Week", "label": "Неделя", "kind": "dimension"},
    {"id": "Month", "label": "Месяц", "kind": "dimension"},
    {"id": "CampaignId", "label": "ID кампании", "kind": "dimension"},
    {"id": "CampaignName", "label": "Название кампании", "kind": "dimension"},
    {"id": "CampaignType", "label": "Тип кампании", "kind": "dimension"},
    {"id": "AdNetworkType", "label": "Тип площадки (Поиск/РСЯ)", "kind": "dimension"},
    {"id": "Device", "label": "Тип устройства", "kind": "dimension"},
    {"id": "MobilePlatform", "label": "Мобильная платформа", "kind": "dimension"},
    {"id": "Slot", "label": "Позиция показа", "kind": "dimension"},
    {"id": "ClickType", "label": "Тип клика", "kind": "dimension"},
    {"id": "CriterionType", "label": "Тип условия показа", "kind": "dimension"},
    {"id": "Criterion", "label": "Условие показа", "kind": "dimension"},
    {"id": "MatchType", "label": "Тип соответствия", "kind": "dimension"},
    {"id": "Placement", "label": "Площадка (РСЯ)", "kind": "dimension"},
    {"id": "TargetingLocationId", "label": "ID региона таргетинга", "kind": "dimension"},
    {"id": "TargetingLocationName", "label": "Регион таргетинга", "kind": "dimension"},
    # Показатели
    {"id": "Impressions", "label": "Показы", "kind": "metric", "agg": "sum"},
    {"id": "Clicks", "label": "Клики", "kind": "metric", "agg": "sum"},
    {"id": "Ctr", "label": "CTR, %", "kind": "metric", "agg": "avg"},
    {"id": "Cost", "label": "Расход", "kind": "metric", "agg": "sum"},
    {"id": "AvgCpc", "label": "Ср. цена клика", "kind": "metric", "agg": "avg"},
    {"id": "AvgCpm", "label": "Ср. цена тыс. показов (CPM)", "kind": "metric", "agg": "avg"},
    {"id": "AvgTrafficVolume", "label": "Ср. объём трафика", "kind": "metric", "agg": "avg"},
    {"id": "AvgImpressionPosition", "label": "Ср. позиция показа", "kind": "metric", "agg": "avg"},
    {"id": "AvgClickPosition", "label": "Ср. позиция клика", "kind": "metric", "agg": "avg"},
    {"id": "Conversions", "label": "Конверсии", "kind": "metric", "agg": "sum"},
    {"id": "ConversionRate", "label": "Конверсия, %", "kind": "metric", "agg": "avg"},
    {"id": "CostPerConversion", "label": "Цена цели", "kind": "metric", "agg": "avg"},
    {"id": "Revenue", "label": "Доход", "kind": "metric", "agg": "sum"},
    {"id": "GoalsRoi", "label": "ROI", "kind": "metric", "agg": "avg"},
    {"id": "Sessions", "label": "Визиты (по Метрике)", "kind": "metric", "agg": "sum"},
    {"id": "Bounces", "label": "Отказы (визиты)", "kind": "metric", "agg": "sum"},
    {"id": "BounceRate", "label": "Отказы, %", "kind": "metric", "agg": "avg"},
    {"id": "AvgPageviews", "label": "Глубина просмотра", "kind": "metric", "agg": "avg"},
]

# Поля, которые Reports API принимает в FieldNames (белый список для запросов)
DIRECT_FIELD_IDS = {f["id"] for f in DIRECT_FIELDS}

# Числовые поля Директа: int / float (для приведения типов при разборе TSV)
DIRECT_INT_FIELDS = {"impressions", "clicks", "conversions", "bounces", "sessions"}
DIRECT_FLOAT_FIELDS = {
    "cost", "ctr", "avgcpc", "avgcpm", "avgtrafficvolume",
    "avgimpressionposition", "avgclickposition",
    "conversionrate", "costperconversion", "revenue", "goalsroi",
    "bouncerate", "avgpageviews",
}

# ============== Яндекс.Метрика: метрики и измерения ==============

METRIKA_METRICS = [
    {"id": "ym:s:visits", "label": "Визиты", "agg": "sum"},
    {"id": "ym:s:users", "label": "Посетители", "agg": "sum"},
    {"id": "ym:s:pageviews", "label": "Просмотры страниц", "agg": "sum"},
    {"id": "ym:s:bounceRate", "label": "Отказы, %", "agg": "avg"},
    {"id": "ym:s:pageDepth", "label": "Глубина просмотра", "agg": "avg"},
    {"id": "ym:s:avgVisitDurationSeconds", "label": "Время на сайте, сек", "agg": "avg"},
    {"id": "ym:s:percentNewVisitors", "label": "Доля новых посетителей, %", "agg": "avg"},
    {"id": "ym:s:sumGoalReachesAny", "label": "Достижения любой цели", "agg": "sum"},
    {"id": "ym:s:ecommercePurchases", "label": "Покупки (ecommerce)", "agg": "sum"},
    {"id": "ym:s:ecommerceRevenue", "label": "Доход (ecommerce)", "agg": "sum"},
]

METRIKA_DIMENSIONS = [
    {"id": "ym:s:date", "label": "Дата визита"},
    {"id": "ym:s:UTMSource", "label": "UTM Source"},
    {"id": "ym:s:UTMMedium", "label": "UTM Medium"},
    {"id": "ym:s:UTMCampaign", "label": "UTM Campaign"},
    {"id": "ym:s:UTMContent", "label": "UTM Content"},
    {"id": "ym:s:UTMTerm", "label": "UTM Term"},
    {"id": "ym:s:lastTrafficSource", "label": "Источник трафика"},
    {"id": "ym:s:lastSearchEngine", "label": "Поисковая система"},
    {"id": "ym:s:lastAdvEngine", "label": "Рекламная система"},
    {"id": "ym:s:deviceCategory", "label": "Тип устройства"},
    {"id": "ym:s:regionCity", "label": "Город"},
    {"id": "ym:s:startURL", "label": "Страница входа"},
]

# ============== Периоды ==============
# Пресеты в духе Мастера отчётов Яндекса; считаются на бэкенде в get_date_range.

PERIOD_PRESETS = [
    {"id": "today", "label": "Сегодня"},
    {"id": "yesterday", "label": "Вчера"},
    {"id": "last_7_days", "label": "Последние 7 дней"},
    {"id": "last_14_days", "label": "Последние 14 дней"},
    {"id": "last_15_days", "label": "Последние 15 дней"},
    {"id": "last_30_days", "label": "Последние 30 дней"},
    {"id": "last_90_days", "label": "Последние 90 дней"},
    {"id": "this_month", "label": "Текущий месяц"},
    {"id": "last_month", "label": "Прошлый месяц"},
    {"id": "custom", "label": "Произвольный период"},
]

PERIOD_PRESET_IDS = {p["id"] for p in PERIOD_PRESETS}

# ============== Трансформации ==============

AGGREGATIONS = [
    {"id": "sum", "label": "Сумма"},
    {"id": "avg", "label": "Среднее"},
    {"id": "count", "label": "Количество"},
    {"id": "min", "label": "Минимум"},
    {"id": "max", "label": "Максимум"},
    {"id": "first", "label": "Первое значение"},
    {"id": "last", "label": "Последнее значение"},
]

FILTER_OPERATORS = [
    {"id": "eq", "label": "равно"},
    {"id": "ne", "label": "не равно"},
    {"id": "gt", "label": "больше"},
    {"id": "lt", "label": "меньше"},
    {"id": "gte", "label": "больше или равно"},
    {"id": "lte", "label": "меньше или равно"},
    {"id": "contains", "label": "содержит"},
    {"id": "startswith", "label": "начинается с"},
    {"id": "endswith", "label": "заканчивается на"},
    {"id": "is_null", "label": "пусто"},
    {"id": "not_null", "label": "не пусто"},
]

STEP_TYPES = [
    {"id": "filter", "label": "Фильтр строк"},
    {"id": "extract", "label": "Извлечение (regex)"},
    {"id": "rename", "label": "Переименование колонок"},
    {"id": "calculate", "label": "Вычисляемая колонка"},
    {"id": "group_by", "label": "Группировка"},
    {"id": "sort", "label": "Сортировка"},
]


@router.get("/reports/catalog")
async def get_report_catalog(current_user: User = Depends(get_current_user)):
    """Catalog of selectable report parameters for the UI."""
    return {
        "direct_fields": DIRECT_FIELDS,
        "metrika_metrics": METRIKA_METRICS,
        "metrika_dimensions": METRIKA_DIMENSIONS,
        "periods": PERIOD_PRESETS,
        "aggregations": AGGREGATIONS,
        "filter_operators": FILTER_OPERATORS,
        "step_types": STEP_TYPES,
    }
