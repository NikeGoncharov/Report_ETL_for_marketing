import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
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

  // Current step
  const [step, setStep] = useState(1);

  async function loadData() {
    if (!id) return;

    try {
      const [projectData, integrationsData] = await Promise.all([
        projectsApi.get(projectId),
        apiFetch(`/integrations/projects/${projectId}`),
      ]);
      setProject(projectData);
      setIntegrations(integrationsData);

      // Load campaigns if Direct is connected
      const directIntegration = integrationsData.find((i: Integration) => i.type === "yandex_direct");
      if (directIntegration) {
        try {
          const campaignsData = await apiFetch(`/direct/campaigns?project_id=${projectId}`);
          setCampaigns(campaignsData);
        } catch (e) {
          console.error("Failed to load campaigns", e);
        }
      }

      // Load counters if Metrika is connected
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
      <div style={{ padding: 40, textAlign: "center" }}>
        <p>Загрузка...</p>
      </div>
    );
  }

  const hasDirectIntegration = integrations.some((i) => i.type === "yandex_direct");
  const hasMetrikaIntegration = integrations.some((i) => i.type === "yandex_metrika");

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 40 }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 20 }}>
        <Link href="/dashboard" style={{ color: "#0070f3" }}>
          Проекты
        </Link>
        {" / "}
        <Link href={`/projects/${id}`} style={{ color: "#0070f3" }}>
          {project?.name}
        </Link>
        {" / "}
        <span>Новый отчёт</span>
      </div>

      <h1 style={{ marginBottom: 30 }}>Создание отчёта</h1>

      {/* Step 1: Basic Info */}
      <section style={{ marginBottom: 30 }}>
        <h2 style={{ marginBottom: 15 }}>1. Основные данные</h2>
        <input
          type="text"
          placeholder="Название отчёта"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            width: "100%",
            padding: 12,
            fontSize: 16,
            border: "1px solid #ccc",
            borderRadius: 4,
            boxSizing: "border-box",
          }}
        />
      </section>

      {/* Step 2: Sources */}
      <section style={{ marginBottom: 30 }}>
        <h2 style={{ marginBottom: 15 }}>2. Источники данных</h2>

        {!hasDirectIntegration && !hasMetrikaIntegration && (
          <div style={{ padding: 20, backgroundColor: "#fff3cd", borderRadius: 8, marginBottom: 15 }}>
            <p style={{ margin: 0 }}>
              Нет подключённых интеграций.{" "}
              <Link href={`/projects/${id}/integrations`} style={{ color: "#0070f3" }}>
                Подключить
              </Link>
            </p>
          </div>
        )}

        {/* Add source buttons */}
        <div style={{ display: "flex", gap: 10, marginBottom: 15 }}>
          {hasDirectIntegration && (
            <button
              onClick={() => addSource("direct")}
              style={{
                padding: "8px 16px",
                backgroundColor: "#FC3F1D",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              + Яндекс.Директ
            </button>
          )}
          {hasMetrikaIntegration && (
            <button
              onClick={() => addSource("metrika")}
              style={{
                padding: "8px 16px",
                backgroundColor: "#FC3F1D",
                color: "white",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              + Яндекс.Метрика
            </button>
          )}
        </div>

        {/* Source list */}
        {sources.map((source, index) => (
          <div
            key={source.id}
            style={{
              border: "1px solid #eee",
              borderRadius: 8,
              padding: 15,
              marginBottom: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <strong>
                {source.type === "direct" ? "Яндекс.Директ" : "Яндекс.Метрика"}
              </strong>
              <button
                onClick={() => removeSource(index)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#ff4444",
                  cursor: "pointer",
                }}
              >
                Удалить
              </button>
            </div>

            {source.type === "direct" && (
              <div>
                <label style={{ display: "block", marginBottom: 5 }}>Кампании:</label>
                <select
                  multiple
                  value={source.campaign_ids?.map(String) || []}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions, (o) => Number(o.value));
                    updateSource(index, { campaign_ids: selected });
                  }}
                  style={{ width: "100%", minHeight: 100 }}
                >
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <small style={{ color: "#666" }}>
                  Оставьте пустым для всех кампаний
                </small>
              </div>
            )}

            {source.type === "metrika" && (
              <div>
                <label style={{ display: "block", marginBottom: 5 }}>Счётчик:</label>
                <select
                  value={source.counter_id || ""}
                  onChange={(e) => updateSource(index, { counter_id: Number(e.target.value) })}
                  style={{ width: "100%", padding: 8, marginBottom: 10 }}
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
        ))}
      </section>

      {/* Step 3: Period */}
      <section style={{ marginBottom: 30 }}>
        <h2 style={{ marginBottom: 15 }}>3. Период</h2>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          style={{ width: "100%", padding: 12, fontSize: 16, borderRadius: 4, border: "1px solid #ccc" }}
        >
          {PERIOD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </section>

      {/* Step 4: Transformations */}
      <section style={{ marginBottom: 30 }}>
        <h2 style={{ marginBottom: 15 }}>4. Трансформации (опционально)</h2>

        {/* Add transformation buttons */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 15 }}>
          {TRANSFORMATION_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => addTransformation(t.value)}
              title={t.description}
              style={{
                padding: "6px 12px",
                backgroundColor: "#f5f5f5",
                border: "1px solid #ddd",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              + {t.label}
            </button>
          ))}
        </div>

        {/* Transformation list */}
        {transformations.map((transform, index) => (
          <div
            key={index}
            style={{
              border: "1px solid #e0e0e0",
              borderRadius: 8,
              padding: 15,
              marginBottom: 10,
              backgroundColor: "#fafafa",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <strong>
                {TRANSFORMATION_TYPES.find((t) => t.value === transform.type)?.label || transform.type}
              </strong>
              <button
                onClick={() => removeTransformation(index)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#ff4444",
                  cursor: "pointer",
                }}
              >
                Удалить
              </button>
            </div>

            {/* Different inputs based on transformation type */}
            {transform.type === "extract" && (
              <div style={{ display: "grid", gap: 10 }}>
                <input
                  placeholder="Колонка (например: utm_content)"
                  value={transform.column || ""}
                  onChange={(e) => updateTransformation(index, { column: e.target.value })}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
                />
                <input
                  placeholder="Regex паттерн (например: ^([^_]+))"
                  value={transform.pattern || ""}
                  onChange={(e) => updateTransformation(index, { pattern: e.target.value })}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
                />
                <input
                  placeholder="Новая колонка (например: channel)"
                  value={transform.output_column || ""}
                  onChange={(e) => updateTransformation(index, { output_column: e.target.value })}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
                />
              </div>
            )}

            {transform.type === "join" && (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <select
                    value={transform.left || ""}
                    onChange={(e) => updateTransformation(index, { left: e.target.value })}
                    style={{ flex: 1, padding: 8 }}
                  >
                    <option value="">Левый источник</option>
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>{s.id}</option>
                    ))}
                  </select>
                  <select
                    value={transform.right || ""}
                    onChange={(e) => updateTransformation(index, { right: e.target.value })}
                    style={{ flex: 1, padding: 8 }}
                  >
                    <option value="">Правый источник</option>
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>{s.id}</option>
                    ))}
                  </select>
                </div>
                <input
                  placeholder="Колонка для объединения (например: utm_source)"
                  value={transform.on || ""}
                  onChange={(e) => updateTransformation(index, { on: e.target.value })}
                  style={{ padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
                />
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Preview */}
      <section style={{ marginBottom: 30 }}>
        <h2 style={{ marginBottom: 15 }}>5. Превью</h2>
        <button
          onClick={handlePreview}
          disabled={previewing || sources.length === 0}
          style={{
            padding: "12px 24px",
            backgroundColor: "#28a745",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: previewing || sources.length === 0 ? "not-allowed" : "pointer",
            opacity: previewing || sources.length === 0 ? 0.7 : 1,
            marginBottom: 15,
          }}
        >
          {previewing ? "Загрузка..." : "Показать превью"}
        </button>

        {previewData && (
          <div style={{ overflowX: "auto" }}>
            <p style={{ color: "#666", marginBottom: 10 }}>
              Строк: {previewData.row_count}
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {previewData.columns.map((col: string) => (
                    <th
                      key={col}
                      style={{
                        textAlign: "left",
                        padding: 8,
                        borderBottom: "2px solid #ddd",
                        backgroundColor: "#f5f5f5",
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewData.data.slice(0, 10).map((row: any, i: number) => (
                  <tr key={i}>
                    {previewData.columns.map((col: string) => (
                      <td
                        key={col}
                        style={{
                          padding: 8,
                          borderBottom: "1px solid #eee",
                        }}
                      >
                        {row[col] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {previewData.row_count > 10 && (
              <p style={{ color: "#666", marginTop: 10 }}>
                Показано первые 10 из {previewData.row_count} строк
              </p>
            )}
          </div>
        )}
      </section>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: "12px 24px",
            backgroundColor: "#0070f3",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "Сохранение..." : "Сохранить отчёт"}
        </button>
        <Link
          href={`/projects/${id}`}
          style={{
            padding: "12px 24px",
            backgroundColor: "transparent",
            color: "#666",
            border: "1px solid #ccc",
            borderRadius: 4,
            textDecoration: "none",
            display: "inline-block",
          }}
        >
          Отмена
        </Link>
      </div>
    </div>
  );
}
