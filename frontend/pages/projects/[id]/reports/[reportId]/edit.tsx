import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import Layout from "../../../../../components/Layout";
import { apiFetch, projectsApi, reportsApi } from "../../../../../lib/api";

type Project = {
  id: number;
  name: string;
};

type Integration = {
  id: number;
  type: string;
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
  metrics?: string[];
  dimensions?: string[];
};

const PERIOD_OPTIONS = [
  { value: "last_7_days", label: "Последние 7 дней" },
  { value: "last_14_days", label: "Последние 14 дней" },
  { value: "last_30_days", label: "Последние 30 дней" },
  { value: "last_90_days", label: "Последние 90 дней" },
  { value: "this_month", label: "Этот месяц" },
  { value: "last_month", label: "Прошлый месяц" },
  { value: "custom", label: "Произвольный период" },
];

export default function EditReportPage() {
  const router = useRouter();
  const { id, reportId } = router.query;
  const projectId = Number(id);
  const reportIdNum = Number(reportId);

  const [project, setProject] = useState<Project | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [period, setPeriod] = useState("last_7_days");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [baseConfig, setBaseConfig] = useState<Record<string, unknown> | null>(null);

  function buildPeriodConfig() {
    if (period !== "custom") {
      return { type: period };
    }
    return {
      type: "custom",
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    };
  }

  function updateSource(index: number, updates: Partial<Source>) {
    const copy = [...sources];
    copy[index] = { ...copy[index], ...updates };
    setSources(copy);
  }

  function removeSource(index: number) {
    setSources((prev) => prev.filter((_, i) => i !== index));
  }

  function addSource(type: "direct" | "metrika") {
    setSources((prev) => [
      ...prev,
      {
        id: `${type}_${Date.now()}`,
        type,
        campaign_ids: type === "direct" ? [] : undefined,
        counter_id: type === "metrika" ? counters[0]?.id : undefined,
      },
    ]);
  }

  async function loadData() {
    if (!id || !reportId) {
      return;
    }
    try {
      const [projectData, reportData, integrationsData] = await Promise.all([
        projectsApi.get(projectId),
        reportsApi.get(projectId, reportIdNum),
        apiFetch(`/integrations/projects/${projectId}`),
      ]);
      setProject(projectData);
      setIntegrations(integrationsData);
      setName(reportData.name);
      setBaseConfig(reportData.config || {});
      setSources((reportData.config?.sources || []) as Source[]);

      const periodConfig = reportData.config?.period || {};
      setPeriod(periodConfig.type || "last_7_days");
      setDateFrom(periodConfig.date_from || "");
      setDateTo(periodConfig.date_to || "");

      if (integrationsData.some((i: Integration) => i.type === "yandex_direct")) {
        const campaignsData = await apiFetch(`/direct/campaigns?project_id=${projectId}`);
        setCampaigns(campaignsData);
      }
      if (integrationsData.some((i: Integration) => i.type === "yandex_metrika")) {
        const countersData = await apiFetch(`/metrika/counters?project_id=${projectId}`);
        setCounters(countersData);
      }
    } catch {
      router.push(`/projects/${id}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      alert("Введите название отчёта");
      return;
    }
    if (!sources.length) {
      alert("Добавьте хотя бы один источник");
      return;
    }
    setSaving(true);
    try {
      const config = {
        ...baseConfig,
        sources,
        period: buildPeriodConfig(),
      };
      await reportsApi.update(projectId, reportIdNum, { name, config });
      router.push(`/projects/${id}/reports/${reportId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      alert("Ошибка сохранения: " + message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [id, reportId]);

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
    <Layout title="Редактирование отчёта">
      <div className="breadcrumb">
        <Link href="/dashboard">Проекты</Link>
        <span className="breadcrumb-separator">/</span>
        <Link href={`/projects/${id}`}>{project?.name}</Link>
        <span className="breadcrumb-separator">/</span>
        <Link href={`/projects/${id}/reports/${reportId}`}>{name || "Отчёт"}</Link>
        <span className="breadcrumb-separator">/</span>
        <span>Редактирование</span>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3>Основные параметры</h3>
        </div>
        <div className="card-body">
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Название отчёта</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3>Срезы источников</h3>
          <div style={{ display: "flex", gap: 8 }}>
            {hasDirectIntegration && (
              <button className="btn btn-sm btn-secondary" onClick={() => addSource("direct")}>
                + Директ
              </button>
            )}
            {hasMetrikaIntegration && (
              <button className="btn btn-sm btn-secondary" onClick={() => addSource("metrika")}>
                + Метрика
              </button>
            )}
          </div>
        </div>
        <div className="card-body">
          <div style={{ display: "grid", gap: 12 }}>
            {sources.map((source, index) => (
              <div key={source.id} className="compact-card">
                <div className="compact-card-header">
                  <strong>{source.type === "direct" ? "Яндекс.Директ" : "Яндекс.Метрика"}</strong>
                  <button className="btn btn-danger btn-sm" onClick={() => removeSource(index)}>
                    Удалить
                  </button>
                </div>

                {source.type === "direct" ? (
                  <div className="compact-grid-2">
                    <div className="input-group" style={{ marginBottom: 0 }}>
                      <label className="input-label">Кампании</label>
                      <select
                        multiple
                        className="input"
                        style={{ minHeight: 92 }}
                        value={(source.campaign_ids || []).map(String)}
                        onChange={(e) =>
                          updateSource(
                            index,
                            { campaign_ids: Array.from(e.target.selectedOptions, (o) => Number(o.value)) },
                          )}
                      >
                        {campaigns.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="compact-grid-2">
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

                    <div className="input-group" style={{ marginBottom: 0 }}>
                      <label className="input-label">Метрики (через запятую)</label>
                      <input
                        className="input"
                        value={(source.metrics || []).join(",")}
                        onChange={(e) =>
                          updateSource(index, {
                            metrics: e.target.value.split(",").map((v) => v.trim()).filter(Boolean),
                          })}
                      />
                    </div>
                    <div className="input-group" style={{ marginBottom: 0 }}>
                      <label className="input-label">Измерения (через запятую)</label>
                      <input
                        className="input"
                        value={(source.dimensions || []).join(",")}
                        onChange={(e) =>
                          updateSource(index, {
                            dimensions: e.target.value.split(",").map((v) => v.trim()).filter(Boolean),
                          })}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h3>Период</h3>
        </div>
        <div className="card-body">
          <div className="compact-grid-2">
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Тип периода</label>
              <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
                {PERIOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            {period === "custom" && (
              <>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Дата с</label>
                  <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Дата по</label>
                  <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
          {saving ? "Сохранение..." : "Сохранить изменения"}
        </button>
        <Link href={`/projects/${id}/reports/${reportId}`} className="btn btn-secondary btn-lg">
          Отмена
        </Link>
      </div>
    </Layout>
  );
}
