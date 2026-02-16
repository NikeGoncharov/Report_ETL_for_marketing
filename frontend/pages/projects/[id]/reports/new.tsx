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
};

const PERIOD_OPTIONS = [
  { value: "last_7_days", label: "Последние 7 дней" },
  { value: "last_14_days", label: "Последние 14 дней" },
  { value: "last_30_days", label: "Последние 30 дней" },
  { value: "last_90_days", label: "Последние 90 дней" },
  { value: "this_month", label: "Этот месяц" },
  { value: "last_month", label: "Прошлый месяц" },
];

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
  const [transformations, setTransformations] = useState<Transformation[]>([]);
  const [previewData, setPreviewData] = useState<any>(null);

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
        period: { type: period },
        transformations,
        export: { type: "google_sheets" },
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
        period: { type: period },
        transformations,
        export: { type: "google_sheets" },
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
                  <div className="input-group" style={{ marginBottom: 0 }}>
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
                )}

                {source.type === "metrika" && (
                  <div className="input-group" style={{ marginBottom: 0 }}>
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
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Step 3: Period */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>3. Период</h3>
        </div>
        <div className="card-body">
          <select
            className="input"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
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
