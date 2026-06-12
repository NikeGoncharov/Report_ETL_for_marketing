// Типы конфига отчёта. Единые для всех страниц и компонентов конструктора.
// Должны соответствовать backend/app/schemas.py (ReportConfigV2 и связанные).

export type StepType = "extract" | "filter" | "rename" | "calculate" | "sort" | "group_by";

export type StepConfig = {
  type: StepType;
  column?: string;
  columns?: string[];
  pattern?: string;
  output_column?: string;
  aggregations?: Record<string, string>;
  mapping?: Record<string, string>;
  operator?: string;
  value?: string | number;
  formula?: string;
  descending?: boolean;
};

export type DatasetType = "direct" | "metrika";

export type DatasetConfig = {
  id: string;
  type: DatasetType;
  label?: string;
  // Директ
  campaign_ids?: number[];
  fields?: string[];
  group_by?: "campaign" | "day";
  include_vat?: boolean;
  // Метрика
  counter_id?: number;
  metrics?: string[];
  dimensions?: string[];
  goals?: number[];
  // Состояние 2
  steps: StepConfig[];
};

export type MergeConfig = {
  enabled: boolean;
  left?: string;
  right?: string;
  left_key?: string;
  right_key?: string;
  how: "inner" | "left" | "right" | "outer";
};

export type GroupingConfig = {
  enabled: boolean;
  columns: string[];
  aggregations: Record<string, string>;
};

export type PeriodConfig = {
  type: string;
  date_from?: string | null;
  date_to?: string | null;
};

export type ExportConfig = {
  type: "google_sheets";
  spreadsheet_id?: string | null;
  sheet_name?: string | null;
  create_new: boolean;
};

export type ReportConfigV2 = {
  version: 2;
  datasets: DatasetConfig[];
  period: PeriodConfig;
  merge: MergeConfig;
  grouping: GroupingConfig;
  result_dataset?: string | null;
  export: ExportConfig;
};

export type PipelineStage = "fetched" | "transformed" | "merged" | "final";

export type PreviewResult = {
  columns: string[];
  data: Record<string, unknown>[];
  row_count: number;
};

export type ReportRun = {
  id: number;
  report_id: number;
  status: "pending" | "running" | "completed" | "failed";
  started_at: string;
  completed_at?: string | null;
  error_message?: string | null;
  result_url?: string | null;
};

export type Report = {
  id: number;
  project_id: number;
  name: string;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

// ============== Каталог параметров (GET /reports/catalog) ==============

export type CatalogField = {
  id: string;
  label: string;
  kind?: "dimension" | "metric";
  agg?: string;
};

export type Catalog = {
  direct_fields: CatalogField[];
  metrika_metrics: CatalogField[];
  metrika_dimensions: CatalogField[];
  periods: { id: string; label: string }[];
  aggregations: { id: string; label: string }[];
  filter_operators: { id: string; label: string }[];
  step_types: { id: string; label: string }[];
};

// ============== Справочники источников ==============

export type DirectCampaign = {
  id: number;
  name: string;
  status?: string;
  state?: string;
  type?: string;
};

export type MetrikaCounter = {
  id: number;
  name: string;
  site?: string;
};

export type MetrikaGoal = {
  id: number;
  name: string;
  type?: string;
};

// ============== Хелперы ==============

export function defaultDataset(type: DatasetType, existingIds: string[]): DatasetConfig {
  const base = type === "direct" ? "direct" : "metrika";
  let id = base;
  let n = 2;
  while (existingIds.includes(id)) {
    id = `${base}_${n++}`;
  }
  if (type === "direct") {
    return {
      id,
      type,
      label: "Яндекс.Директ",
      campaign_ids: [],
      fields: ["CampaignName", "AdNetworkType", "Impressions", "Clicks", "Cost"],
      group_by: "campaign",
      include_vat: true,
      steps: [],
    };
  }
  return {
    id,
    type,
    label: "Яндекс.Метрика",
    counter_id: undefined,
    metrics: ["ym:s:visits", "ym:s:users", "ym:s:bounceRate"],
    dimensions: ["ym:s:UTMCampaign"],
    goals: [],
    steps: [],
  };
}

export function defaultConfig(): ReportConfigV2 {
  return {
    version: 2,
    datasets: [],
    period: { type: "last_30_days" },
    merge: { enabled: false, how: "left" },
    grouping: { enabled: false, columns: [], aggregations: {} },
    export: { type: "google_sheets", create_new: true },
  };
}

// Поля, которые знает StepConfig на бэкенде (schemas.py, extra=forbid).
// Легаси-шаги несут лишние ключи (source/left/right/on/how/output, часто
// как null после model_dump) — всё вне белого списка отбрасываем, иначе
// сохранение сконвертированного отчёта упадёт с 422.
const STEP_KEYS = [
  "type", "column", "columns", "pattern", "output_column",
  "aggregations", "mapping", "operator", "value", "formula", "descending",
] as const;

function toStep(raw: Record<string, any>): StepConfig {
  const step: Record<string, any> = {};
  for (const key of STEP_KEYS) {
    if (raw[key] !== undefined && raw[key] !== null) {
      step[key] = raw[key];
    }
  }
  return step as StepConfig;
}

// Конверсия легаси-конфига (v1: sources/transformations) в v2.
// Используется при открытии старых отчётов в конструкторе; сохранение
// перезапишет конфиг уже в формате v2.
export function upgradeConfig(raw: Record<string, any>): ReportConfigV2 {
  if (raw && raw.version === 2) {
    return raw as ReportConfigV2;
  }

  const config = defaultConfig();
  const sources: any[] = Array.isArray(raw?.sources) ? raw.sources : [];
  const stepTypes = ["extract", "filter", "rename", "calculate", "sort", "group_by"];

  config.datasets = sources.map((s) => {
    const ds: DatasetConfig = {
      id: s.id || s.type,
      type: s.type === "metrika" ? "metrika" : "direct",
      campaign_ids: s.campaign_ids ?? [],
      fields: s.direct_fields ?? undefined,
      group_by: s.direct_group_by === "day" ? "day" : "campaign",
      include_vat: true,
      counter_id: s.counter_id ?? undefined,
      metrics: s.metrics ?? undefined,
      dimensions: s.dimensions ?? undefined,
      goals: s.goals ?? [],
      steps: [],
    };
    ds.steps = (s.source_transformations || [])
      .filter((t: any) => stepTypes.includes(t.type))
      .map(toStep);
    return ds;
  });

  config.period = raw?.period?.type
    ? { type: raw.period.type, date_from: raw.period.date_from ?? null, date_to: raw.period.date_to ?? null }
    : { type: "last_30_days" };

  // Глобальные трансформации: join -> merge, group_by -> grouping,
  // остальные раскладываем по датасетам как шаги.
  const globals: any[] = Array.isArray(raw?.transformations) ? raw.transformations : [];
  for (const t of globals) {
    if (t.type === "join" && !config.merge.enabled) {
      config.merge = {
        enabled: true,
        left: t.left,
        right: t.right,
        left_key: t.left_on || t.on,
        right_key: t.right_on || t.on,
        how: t.how || "left",
      };
    } else if (t.type === "group_by" && !config.grouping.enabled) {
      config.grouping = {
        enabled: true,
        columns: t.columns || [],
        aggregations: t.aggregations || {},
      };
    } else if (t.source && stepTypes.includes(t.type)) {
      const ds = config.datasets.find((d) => d.id === t.source);
      if (ds) {
        ds.steps.push(toStep(t));
      }
    }
  }

  if (raw?.export) {
    config.export = {
      type: "google_sheets",
      spreadsheet_id: raw.export.spreadsheet_id ?? null,
      sheet_name: raw.export.sheet_name ?? null,
      create_new: Boolean(raw.export.create_new) || !raw.export.spreadsheet_id,
    };
  }

  return config;
}

// Достаёт ID таблицы из URL Google Sheets (или возвращает строку как есть)
export function parseSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmed;
}
