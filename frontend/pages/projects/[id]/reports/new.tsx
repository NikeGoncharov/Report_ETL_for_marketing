import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import Layout from "../../../../components/Layout";
import { projectsApi, apiFetch } from "../../../../lib/api";

type Project = {
  id: number;
  name: string;
};

type Integration = {
  id: number;
  type: string;
  account_info: Record<string, any> | null;
};

type Campaign = {
  id: number;
  name: string;
};

type Counter = {
  id: number;
  name: string;
  site: string;
};

type Source = {
  id: string;
  type: "direct" | "metrika";
  campaign_ids?: number[];
  counter_id?: number;
  goals?: number[];
  direct_fields?: string[];
  direct_group_by?: string;
  metrics?: string[];
  dimensions?: string[];
  source_transformations?: Transformation[];
};

type Transformation = {
  type: string;
  source?: string;
  left?: string;
  right?: string;
  column?: string;
  columns?: string[];
  pattern?: string;
  output_column?: string;
  aggregations?: Record<string, string>;
  on?: string;
  how?: string;
  mapping?: Record<string, string>;
  operator?: string;
  value?: string | number;
  formula?: string;
};

const DIRECT_GROUP_BY_OPTIONS = [
  { value: "campaign", label: "По кампании" },
  { value: "day", label: "По дням" },
];

const DIRECT_FIELD_OPTIONS = [
  { value: "CampaignId", label: "ID кампании" },
  { value: "CampaignName", label: "Название кампании" },
  { value: "Date", label: "Дата" },
  { value: "Impressions", label: "Показы" },
  { value: "Clicks", label: "Клики" },
  { value: "Cost", label: "Расход" },
  { value: "Ctr", label: "CTR" },
  { value: "AvgCpc", label: "Ср. цена клика" },
  { value: "Conversions", label: "Конверсии" },
  { value: "ConversionRate", label: "Конверсия %" },
  { value: "CostPerConversion", label: "Цена конверсии" },
];

const METRIKA_METRIC_OPTIONS = [
  { value: "ym:s:visits", label: "Визиты" },
  { value: "ym:s:users", label: "Пользователи" },
  { value: "ym:s:bounceRate", label: "Показатель отказов" },
  { value: "ym:s:pageDepth", label: "Глубина просмотра" },
  { value: "ym:s:avgVisitDurationSeconds", label: "Ср. время на сайте (сек)" },
];

const METRIKA_DIMENSION_OPTIONS = [
  { value: "ym:s:UTMSource", label: "UTM Source" },
  { value: "ym:s:UTMCampaign", label: "UTM Campaign" },
  { value: "ym:s:UTMMedium", label: "UTM Medium" },
  { value: "ym:s:UTMContent", label: "UTM Content" },
  { value: "ym:s:UTMTerm", label: "UTM Term" },
  { value: "ym:s:trafficSource", label: "Источник трафика" },
];

const PERIOD_OPTIONS = [
  { value: "last_7_days", label: "Последние 7 дней" },
  { value: "last_14_days", label: "Последние 14 дней" },
  { value: "last_30_days", label: "Последние 30 дней" },
  { value: "last_90_days", label: "Последние 90 дней" },
  { value: "this_month", label: "Этот месяц" },
  { value: "last_month", label: "Прошлый месяц" },
  { value: "custom", label: "Произвольный период" },
];

function getDefaultCustomDateRange() {
  const today = new Date();
  const to = new Date(today);
  to.setDate(to.getDate() - 1);
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
  };
}

const TRANSFORMATION_TYPES = [
  { value: "extract", label: "Извлечь (regex)", description: "Извлечь часть строки" },
  { value: "group_by", label: "Группировка", description: "Сгруппировать и агрегировать" },
  { value: "join", label: "Объединить", description: "Объединить источники" },
  { value: "rename", label: "Переименовать", description: "Переименовать колонки" },
  { value: "filter", label: "Фильтр", description: "Отфильтровать строки" },
  { value: "calculate", label: "Вычислить", description: "Добавить вычисляемую колонку" },
  { value: "sort", label: "Сортировка", description: "Отсортировать данные" },
];

export default function NewReportPage() {
  const router = useRouter();
  const { id } = router.query;
  const projectId = Number(id);

  const [project, setProject] = useState<Project | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // Report config
  const [name, setName] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [period, setPeriod] = useState("last_7_days");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exportCreateNew, setExportCreateNew] = useState(false);
  const [exportSpreadsheetUrlOrId, setExportSpreadsheetUrlOrId] = useState("");
  const [exportSheetName, setExportSheetName] = useState("Report");
  const [transformations, setTransformations] = useState<Transformation[]>([]);
  const [previewData, setPreviewData] = useState<any>(null);

  function buildPeriodConfig() {
    if (period === "custom") {
      const def = getDefaultCustomDateRange();
      return {
        type: "custom",
        date_from: dateFrom || def.dateFrom,
        date_to: dateTo || def.dateTo,
      };
    }
    return { type: period };
  }

  /** Extract spreadsheet ID from Google Sheets URL or return as-is if already an ID. */
  function parseSpreadsheetId(urlOrId: string): string {
    const s = (urlOrId || "").trim();
    const match = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : s;
  }

  function buildExportConfig() {
    const spreadsheet_id = exportCreateNew ? undefined : parseSpreadsheetId(exportSpreadsheetUrlOrId) || undefined;
    return {
      type: "google_sheets" as const,
      spreadsheet_id: spreadsheet_id ?? null,
      sheet_name: exportSheetName || "Report",
      create_new: exportCreateNew,
    };
  }

  async function loadData() {
    if (!id) return;

    try {
      const [projectData, integrationsData] = await Promise.all([
        projectsApi.get(projectId),
        apiFetch(`/integrations/projects/${projectId}`),
      ]);
      setProject(projectData);
      setIntegrations(integrationsData);

      const directIntegration = integrationsData.find((i: Integration) => i.type === "yandex_direct");
      if (directIntegration) {
        try {
          const campaignsData = await apiFetch(`/direct/campaigns?project_id=${projectId}`);
          setCampaigns(campaignsData);
        } catch (e) {
          console.error("Failed to load campaigns", e);
        }
      }

      const metrikaIntegration = integrationsData.find((i: Integration) => i.type === "yandex_metrika");
      if (metrikaIntegration) {
        try {
          const countersData = await apiFetch(`/metrika/counters?project_id=${projectId}`);
          setCounters(countersData);
        } catch (e) {
          console.error("Failed to load counters", e);
        }
      }
    } catch {
      router.push("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function handlePreview() {
    setPreviewing(true);
    setPreviewData(null);

    try {
      const config = {
        sources,
        period: buildPeriodConfig(),
        transformations,
        export: buildExportConfig(),
      };

      const result = await apiFetch(`/projects/${projectId}/reports/preview`, {
        method: "POST",
        body: JSON.stringify({ config }),
      });

      setPreviewData(result);
    } catch (err: any) {
      alert("Ошибка при генерации превью: " + (err.message || "Unknown error"));
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      alert("Введите название отчёта");
      return;
    }

    if (sources.length === 0) {
      alert("Добавьте хотя бы один источник данных");
      return;
    }

    setSaving(true);

    try {
      const config = {
        sources,
        period: buildPeriodConfig(),
        transformations,
        export: buildExportConfig(),
      };

      await apiFetch(`/projects/${projectId}/reports`, {
        method: "POST",
        body: JSON.stringify({ name, config }),
      });

      router.push(`/projects/${projectId}`);
    } catch (err: any) {
      alert("Ошибка сохранения: " + (err.message || "Unknown error"));
    } finally {
      setSaving(false);
    }
  }

  function addSource(type: "direct" | "metrika") {
    const newSource: Source = {
      id: `${type}_${Date.now()}`,
      type,
    };

    if (type === "direct") {
      newSource.campaign_ids = [];
    } else {
      newSource.counter_id = counters[0]?.id;
      newSource.goals = [];
    }

    setSources([...sources, newSource]);
  }

  function updateSource(index: number, updates: Partial<Source>) {
    const newSources = [...sources];
    newSources[index] = { ...newSources[index], ...updates };
    setSources(newSources);
  }

  function removeSource(index: number) {
    setSources(sources.filter((_, i) => i !== index));
  }

  function addTransformation(type: string) {
    const newTransform: Transformation = { type };

    if (type === "extract") {
      newTransform.source = sources[0]?.id;
      newTransform.column = "";
      newTransform.pattern = "^([^_]+)";
      newTransform.output_column = "";
    } else if (type === "group_by") {
      newTransform.source = sources[0]?.id;
      newTransform.columns = [];
      newTransform.aggregations = {};
    } else if (type === "join") {
      newTransform.left = sources[0]?.id;
      newTransform.right = sources[1]?.id;
      newTransform.on = "";
      newTransform.how = "left";
    } else if (type === "rename") {
      newTransform.source = sources[0]?.id;
      newTransform.mapping = {};
    }

    setTransformations([...transformations, newTransform]);
  }

  function updateTransformation(index: number, updates: Partial<Transformation>) {
    const newTransforms = [...transformations];
    newTransforms[index] = { ...newTransforms[index], ...updates };
    setTransformations(newTransforms);
  }

  function removeTransformation(index: number) {
    setTransformations(transformations.filter((_, i) => i !== index));
  }

  const SOURCE_TRANSFORMATION_TYPES = TRANSFORMATION_TYPES.filter((t) => t.value !== "join");

  function addSourceTransformation(sourceIndex: number, type: string) {
    const src = sources[sourceIndex];
    if (!src) return;
    const list = src.source_transformations ?? [];
    const newT: Transformation = { type, source: src.id };
    if (type === "extract") {
      newT.column = "";
      newT.pattern = "^([^_]+)";
      newT.output_column = "";
    } else if (type === "group_by") {
      newT.columns = [];
      newT.aggregations = {};
    } else if (type === "rename") {
      newT.mapping = {};
    } else if (type === "filter") {
      newT.column = "";
      newT.operator = "eq";
      newT.value = "";
    }
    updateSource(sourceIndex, { source_transformations: [...list, newT] });
  }

  function updateSourceTransformation(sourceIndex: number, transformIndex: number, updates: Partial<Transformation>) {
    const src = sources[sourceIndex];
    const list = [...(src?.source_transformations ?? [])];
    if (transformIndex < 0 || transformIndex >= list.length) return;
    list[transformIndex] = { ...list[transformIndex], ...updates };
    updateSource(sourceIndex, { source_transformations: list });
  }

  function removeSourceTransformation(sourceIndex: number, transformIndex: number) {
    const src = sources[sourceIndex];
    const list = (src?.source_transformations ?? []).filter((_, i) => i !== transformIndex);
    updateSource(sourceIndex, { source_transformations: list });
  }

  useEffect(() => {
    loadData();
  }, [id]);

  if (loading) {
    return (
      <Layout>
        <div className="loading">
          <p>Загрузка...</p>
        </div>
      </Layout>
    );
  }

  const hasDirectIntegration = integrations.some((i) => i.type === "yandex_direct");
  const hasMetrikaIntegration = integrations.some((i) => i.type === "yandex_metrika");

  return (
    <Layout title="Новый отчёт">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link href="/dashboard">Проекты</Link>
        <span className="breadcrumb-separator">/</span>
        <Link href={`/projects/${id}`}>{project?.name}</Link>
        <span className="breadcrumb-separator">/</span>
        <span>Новый отчёт</span>
      </div>

      {/* Step 1: Basic Info */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>1. Основные данные</h3>
        </div>
        <div className="card-body">
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Название отчёта</label>
            <input
              type="text"
              className="input"
              placeholder="Например: Отчёт по рекламе за месяц"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Step 2: Sources */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>2. Источники данных</h3>
        </div>
        <div className="card-body">
          {!hasDirectIntegration && !hasMetrikaIntegration && (
            <div className="alert alert-warning" style={{ marginBottom: 16 }}>
              Нет подключённых интеграций.{" "}
              <Link href={`/projects/${id}/integrations`}>Подключить</Link>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {hasDirectIntegration && (
              <button
                className="btn btn-sm"
                style={{ backgroundColor: "#FC3F1D", color: "white", border: "none" }}
                onClick={() => addSource("direct")}
              >
                + Яндекс.Директ
              </button>
            )}
            {hasMetrikaIntegration && (
              <button
                className="btn btn-sm"
                style={{ backgroundColor: "#FC3F1D", color: "white", border: "none" }}
                onClick={() => addSource("metrika")}
              >
                + Яндекс.Метрика
              </button>
            )}
          </div>

          {sources.map((source, index) => (
            <div
              key={source.id}
              className="card"
              style={{ marginBottom: 12, backgroundColor: "var(--gray-50)" }}
            >
              <div className="card-body" style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <strong>{source.type === "direct" ? "Яндекс.Директ" : "Яндекс.Метрика"}</strong>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => removeSource(index)}
                  >
                    Удалить
                  </button>
                </div>

                {source.type === "direct" && (
                  <>
                    <div className="input-group" style={{ marginBottom: 12 }}>
                      <label className="input-label">Кампании</label>
                      <select
                        multiple
                        className="input"
                        value={source.campaign_ids?.map(String) || []}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions, (o) => Number(o.value));
                          updateSource(index, { campaign_ids: selected });
                        }}
                        style={{ minHeight: 100 }}
                      >
                        {campaigns.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <small style={{ color: "var(--gray-500)", marginTop: 4, display: "block" }}>
                        Оставьте пустым для всех кампаний
                      </small>
                    </div>
                    <div className="input-group" style={{ marginBottom: 12 }}>
                      <label className="input-label">Группировка</label>
                      <select
                        className="input"
                        value={source.direct_group_by ?? "campaign"}
                        onChange={(e) => updateSource(index, { direct_group_by: e.target.value })}
                      >
                        {DIRECT_GROUP_BY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="input-group" style={{ marginBottom: 0 }}>
                      <label className="input-label">Поля отчёта (оставьте пустым — все по умолчанию)</label>
                      <select
                        multiple
                        className="input"
                        value={source.direct_fields ?? []}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                          updateSource(index, { direct_fields: selected });
                        }}
                        style={{ minHeight: 80 }}
                      >
                        {DIRECT_FIELD_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {source.type === "metrika" && (
                  <>
                    <div className="input-group" style={{ marginBottom: 12 }}>
                      <label className="input-label">Счётчик</label>
                      <select
                        className="input"
                        value={source.counter_id || ""}
                        onChange={(e) => updateSource(index, { counter_id: Number(e.target.value) })}
                      >
                        {counters.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.site})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="input-group" style={{ marginBottom: 12 }}>
                      <label className="input-label">Метрики</label>
                      <select
                        multiple
                        className="input"
                        value={source.metrics ?? ["ym:s:visits", "ym:s:users", "ym:s:bounceRate"]}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                          updateSource(index, { metrics: selected });
                        }}
                        style={{ minHeight: 80 }}
                      >
                        {METRIKA_METRIC_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="input-group" style={{ marginBottom: 0 }}>
                      <label className="input-label">Измерения (dimensions)</label>
                      <select
                        multiple
                        className="input"
                        value={source.dimensions ?? ["ym:s:UTMSource", "ym:s:UTMCampaign"]}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                          updateSource(index, { dimensions: selected });
                        }}
                        style={{ minHeight: 80 }}
                      >
                        {METRIKA_DIMENSION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--gray-200)" }}>
                  <label className="input-label" style={{ marginBottom: 8 }}>Трансформации для этого источника</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                    {SOURCE_TRANSFORMATION_TYPES.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => addSourceTransformation(index, t.value)}
                        title={t.description}
                      >
                        + {t.label}
                      </button>
                    ))}
                  </div>
                  {(source.source_transformations ?? []).map((st, stIndex) => (
                    <div
                      key={stIndex}
                      className="card"
                      style={{ marginBottom: 8, backgroundColor: "var(--white)", padding: 12 }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <strong>
                          {SOURCE_TRANSFORMATION_TYPES.find((t) => t.value === st.type)?.label ?? st.type}
                        </strong>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => removeSourceTransformation(index, stIndex)}
                        >
                          Удалить
                        </button>
                      </div>
                      {st.type === "extract" && (
                        <div style={{ display: "grid", gap: 8 }}>
                          <input
                            className="input"
                            placeholder="Колонка"
                            value={st.column ?? ""}
                            onChange={(e) => updateSourceTransformation(index, stIndex, { column: e.target.value })}
                          />
                          <input
                            className="input"
                            placeholder="Regex"
                            value={st.pattern ?? ""}
                            onChange={(e) => updateSourceTransformation(index, stIndex, { pattern: e.target.value })}
                          />
                          <input
                            className="input"
                            placeholder="Новая колонка"
                            value={st.output_column ?? ""}
                            onChange={(e) => updateSourceTransformation(index, stIndex, { output_column: e.target.value })}
                          />
                        </div>
                      )}
                      {st.type === "filter" && (
                        <div style={{ display: "grid", gap: 8 }}>
                          <input
                            className="input"
                            placeholder="Колонка"
                            value={st.column ?? ""}
                            onChange={(e) => updateSourceTransformation(index, stIndex, { column: e.target.value })}
                          />
                          <select
                            className="input"
                            value={st.operator ?? "eq"}
                            onChange={(e) => updateSourceTransformation(index, stIndex, { operator: e.target.value })}
                          >
                            <option value="eq">равно</option>
                            <option value="ne">не равно</option>
                            <option value="gt">больше</option>
                            <option value="lt">меньше</option>
                            <option value="contains">содержит</option>
                            <option value="is_null">пусто</option>
                            <option value="not_null">не пусто</option>
                          </select>
                          {st.operator !== "is_null" && st.operator !== "not_null" && (
                            <input
                              className="input"
                              placeholder="Значение"
                              value={String(st.value ?? "")}
                              onChange={(e) => updateSourceTransformation(index, stIndex, { value: e.target.value })}
                            />
                          )}
                        </div>
                      )}
                      {st.type === "rename" && (
                        <small style={{ color: "var(--gray-500)" }}>
                          Укажите маппинг в конфиге (ключ → новое имя)
                        </small>
                      )}
                      {(st.type === "group_by" || st.type === "calculate" || st.type === "sort") && (
                        <small style={{ color: "var(--gray-500)" }}>
                          Параметры: columns / formula / column
                        </small>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Step 3: Period (global for all sources) */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>3. Период</h3>
        </div>
        <div className="card-body">
          <p style={{ color: "var(--gray-600)", marginBottom: 12, fontSize: 14 }}>
            Один период применяется ко всем источникам в отчёте.
          </p>
          <select
            className="input"
            value={period}
            onChange={(e) => {
              const v = e.target.value;
              setPeriod(v);
              if (v === "custom") {
                const def = getDefaultCustomDateRange();
                setDateFrom(def.dateFrom);
                setDateTo(def.dateTo);
              }
            }}
            style={{ marginBottom: period === "custom" ? 12 : 0 }}
          >
            {PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {period === "custom" && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Дата с</label>
                <input
                  type="date"
                  className="input"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Дата по</label>
                <input
                  type="date"
                  className="input"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Export: Google Sheets */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>Выгрузка в Google Таблицы</h3>
        </div>
        <div className="card-body">
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={exportCreateNew}
              onChange={(e) => setExportCreateNew(e.target.checked)}
            />
            <span>Создать новую таблицу при каждом запуске</span>
          </label>
          {!exportCreateNew && (
            <div className="input-group" style={{ marginBottom: 12 }}>
              <label className="input-label">Ссылка на таблицу или ID</label>
              <input
                type="text"
                className="input"
                placeholder="https://docs.google.com/spreadsheets/d/... или ID таблицы"
                value={exportSpreadsheetUrlOrId}
                onChange={(e) => setExportSpreadsheetUrlOrId(e.target.value)}
              />
            </div>
          )}
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Название листа</label>
            <input
              type="text"
              className="input"
              placeholder="Report"
              value={exportSheetName}
              onChange={(e) => setExportSheetName(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Step 4: Transformations */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>4. Трансформации (опционально)</h3>
        </div>
        <div className="card-body">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {TRANSFORMATION_TYPES.map((t) => (
              <button
                key={t.value}
                className="btn btn-secondary btn-sm"
                onClick={() => addTransformation(t.value)}
                title={t.description}
              >
                + {t.label}
              </button>
            ))}
          </div>

          {transformations.map((transform, index) => (
            <div
              key={index}
              className="card"
              style={{ marginBottom: 12, backgroundColor: "var(--gray-50)" }}
            >
              <div className="card-body" style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <strong>
                    {TRANSFORMATION_TYPES.find((t) => t.value === transform.type)?.label || transform.type}
                  </strong>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => removeTransformation(index)}
                  >
                    Удалить
                  </button>
                </div>

                {transform.type === "extract" && (
                  <div style={{ display: "grid", gap: 12 }}>
                    <input
                      className="input"
                      placeholder="Колонка (например: utm_content)"
                      value={transform.column || ""}
                      onChange={(e) => updateTransformation(index, { column: e.target.value })}
                    />
                    <input
                      className="input"
                      placeholder="Regex паттерн (например: ^([^_]+))"
                      value={transform.pattern || ""}
                      onChange={(e) => updateTransformation(index, { pattern: e.target.value })}
                    />
                    <input
                      className="input"
                      placeholder="Новая колонка (например: channel)"
                      value={transform.output_column || ""}
                      onChange={(e) => updateTransformation(index, { output_column: e.target.value })}
                    />
                  </div>
                )}

                {transform.type === "join" && (
                  <div style={{ display: "grid", gap: 12 }}>
                    <div style={{ display: "flex", gap: 12 }}>
                      <select
                        className="input"
                        value={transform.left || ""}
                        onChange={(e) => updateTransformation(index, { left: e.target.value })}
                      >
                        <option value="">Левый источник</option>
                        {sources.map((s) => (
                          <option key={s.id} value={s.id}>{s.id}</option>
                        ))}
                      </select>
                      <select
                        className="input"
                        value={transform.right || ""}
                        onChange={(e) => updateTransformation(index, { right: e.target.value })}
                      >
                        <option value="">Правый источник</option>
                        {sources.map((s) => (
                          <option key={s.id} value={s.id}>{s.id}</option>
                        ))}
                      </select>
                    </div>
                    <input
                      className="input"
                      placeholder="Колонка для объединения (например: utm_source)"
                      value={transform.on || ""}
                      onChange={(e) => updateTransformation(index, { on: e.target.value })}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Step 5: Preview */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>5. Превью</h3>
        </div>
        <div className="card-body">
          <button
            className="btn btn-success"
            onClick={handlePreview}
            disabled={previewing || sources.length === 0}
            style={{ marginBottom: 16 }}
          >
            {previewing ? "Загрузка..." : "Показать превью"}
          </button>

          {previewData && (
            <div style={{ overflowX: "auto" }}>
              <p style={{ color: "var(--gray-600)", marginBottom: 12 }}>
                Строк: {previewData.row_count}
              </p>
              <table>
                <thead>
                  <tr>
                    {previewData.columns.map((col: string) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.data.slice(0, 10).map((row: any, i: number) => (
                    <tr key={i}>
                      {previewData.columns.map((col: string) => (
                        <td key={col}>{row[col] ?? "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewData.row_count > 10 && (
                <p style={{ color: "var(--gray-500)", marginTop: 12 }}>
                  Показано первые 10 из {previewData.row_count} строк
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 12 }}>
        <button
          className="btn btn-primary btn-lg"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Сохранение..." : "Сохранить отчёт"}
        </button>
        <Link href={`/projects/${id}`} className="btn btn-secondary btn-lg">
          Отмена
        </Link>
      </div>
    </Layout>
  );
}
