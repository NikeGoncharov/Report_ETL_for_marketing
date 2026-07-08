// Типы конфига отчёта. Единые для всех страниц и компонентов конструктора.
// Должны соответствовать backend/app/schemas.py (ReportConfigV2 и связанные).

export type StepType =
  | "extract" | "filter" | "rename" | "calculate" | "sort" | "group_by"
  | "find_replace" | "merge_rows" | "columns";

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
  // find_replace: маска поиска (* = любые символы) и строка замены
  find?: string;
  replace?: string;
  // merge_rows: значение среза для объединённой строки
  group_name?: string;
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

// Конфиг из БД должен быть версии 2; всё прочее — пустой конфиг
// (старые форматы больше не поддерживаются).
export function ensureConfigV2(raw: Record<string, unknown>): ReportConfigV2 {
  if (raw && (raw as { version?: number }).version === 2) {
    return raw as unknown as ReportConfigV2;
  }
  return defaultConfig();
}

// Достаёт ID таблицы из URL Google Sheets (или возвращает строку как есть)
export function parseSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmed;
}
