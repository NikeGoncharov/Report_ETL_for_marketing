import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import Layout from "../../components/Layout";
import RunReportModal, { RunRange } from "../../components/report/RunReportModal";
import { projectsApi, reportsApi, integrationsApi, apiFetch } from "../../lib/api";
import { connectIntegrationPopup, oauthErrorMessage } from "../../lib/oauth";
import { INTEGRATION_META, INTEGRATION_TYPES, INTEGRATION_HINTS } from "../../lib/integrations";
import { PeriodConfig } from "../../types/report";

type Project = {
  id: number;
  name: string;
  created_at: string;
};

type Integration = {
  id: number;
  type: string;
  account_info: Record<string, unknown> | null;
  created_at: string;
};

type ReportRunInfo = {
  id: number;
  status: string;
  started_at: string;
  completed_at?: string | null;
  error_message?: string | null;
  result_url?: string | null;
  period_from?: string | null;
  period_to?: string | null;
};

type ReportItem = {
  id: number;
  name: string;
  config: { version?: number; period?: PeriodConfig } & Record<string, unknown>;
  created_at: string;
  last_run?: ReportRunInfo | null;
};

function accountLabel(info: Record<string, unknown> | null): string | null {
  if (!info) return null;
  const value = info.name || info.email || info.login;
  return typeof value === "string" && value ? value : null;
}

// 2026-06-01 -> 01.06.2026
function fmtISODate(iso?: string | null): string {
  if (!iso) return "…";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ru-RU");
}

export default function ProjectPage() {
  const router = useRouter();
  const { id } = router.query;
  const projectId = Number(id);

  const [project, setProject] = useState<Project | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  // отчёт, для которого открыт попап «Обновить выгрузку»
  const [runModalId, setRunModalId] = useState<number | null>(null);

  async function loadProject() {
    if (!id) return;

    try {
      const projectData = await projectsApi.get(projectId);
      setProject(projectData);

      try {
        setIntegrations(await integrationsApi.list(projectId));
      } catch {}

      try {
        setReports(await apiFetch(`/projects/${id}/reports`));
      } catch {}
    } catch {
      router.push("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProject();
  }, [id]);

  function connect(type: string) {
    setConnecting(type);
    connectIntegrationPopup(projectId, type, ({ error }) => {
      setConnecting(null);
      loadProject();
      const msg = oauthErrorMessage(error);
      if (msg) alert(msg);
    }).catch(() => {
      alert("Ошибка подключения интеграции");
      setConnecting(null);
    });
  }

  async function disconnect(integration: Integration) {
    const label = INTEGRATION_META[integration.type]?.label || integration.type;
    if (!confirm(`Отключить интеграцию "${label}"?`)) return;
    try {
      await integrationsApi.delete(integration.id);
      loadProject();
    } catch {
      alert("Ошибка отключения интеграции");
    }
  }

  // Подтверждение из попапа: сохранить новые даты (если меняли) и выгрузить
  async function confirmRun(report: ReportItem, range: RunRange | null) {
    setRunModalId(null);
    if (range) {
      const period: PeriodConfig = { type: "custom", date_from: range.from, date_to: range.to };
      const newConfig = { ...report.config, period };
      setReports((rs) => rs.map((r) => (r.id === report.id ? { ...r, config: newConfig } : r)));
      try {
        await reportsApi.update(projectId, report.id, { config: newConfig });
      } catch {
        alert("Не удалось сохранить даты");
        loadProject();
        return;
      }
    }
    await runReport(report);
  }

  async function runReport(report: ReportItem) {
    setRunningId(report.id);
    try {
      const run = await reportsApi.run(projectId, report.id);
      setReports((rs) => rs.map((r) => (r.id === report.id ? { ...r, last_run: run } : r)));
    } catch {
      // сеть/непредвиденная ошибка — история подтянет failed-запуск
      loadProject();
    } finally {
      setRunningId(null);
    }
  }

  function runLine(report: ReportItem) {
    if (runningId === report.id) {
      return <span className="report-run-note">Выгружается — это может занять до минуты…</span>;
    }
    const run = report.last_run;
    if (!run) {
      return <span className="report-run-note">Ещё не выгружался</span>;
    }
    const when = fmtDateTime(run.completed_at || run.started_at);
    const period =
      run.period_from && run.period_to ? (
        <>
          {" "}за период <b>{fmtISODate(run.period_from)} – {fmtISODate(run.period_to)}</b>
        </>
      ) : null;
    if (run.status === "failed") {
      return (
        <span className="report-run-err" title={run.error_message || ""}>
          Запуск {when} завершился ошибкой: {run.error_message || "неизвестная ошибка"}
        </span>
      );
    }
    return (
      <span className="report-run-note">
        Предыдущая выгрузка: <b>{when}</b>
        {period}
        {run.result_url && (
          <>
            {" "}·{" "}
            <a href={run.result_url} target="_blank" rel="noreferrer">
              Открыть таблицу ↗
            </a>
          </>
        )}
      </span>
    );
  }

  if (loading || !project) {
    return (
      <Layout>
        <div className="loading">
          <p>Загрузка...</p>
        </div>
      </Layout>
    );
  }

  const connectedTypes = new Set(integrations.map((i) => i.type));
  const missing = INTEGRATION_TYPES.filter((t) => !connectedTypes.has(t));
  const runModalReport = runModalId !== null ? reports.find((r) => r.id === runModalId) || null : null;

  return (
    <Layout>
      <h1 className="page-crumb">
        <Link href="/dashboard">Клиенты</Link>
        <span className="page-crumb-sep">/</span>
        <span>{project.name}</span>
      </h1>

      <section className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <h3>Интеграции</h3>
        </div>
        <div className="card-body">
          <div className="pint-grid">
            {integrations.map((integration) => {
              const meta = INTEGRATION_META[integration.type];
              const account = accountLabel(integration.account_info);
              return (
                <div key={integration.id} className="pint-card">
                  <div className="pint-head">
                    <span
                      className="pint-title"
                      style={{ "--int-color": meta?.color || "var(--gray-400)" } as React.CSSProperties}
                    >
                      <span className="client-int-dot" />
                      {meta?.label || integration.type}
                    </span>
                    <span className="status-pill">Подключено</span>
                  </div>
                  <div className="pint-details">
                    {account ? (
                      <>
                        Аккаунт: <b>{account}</b>
                      </>
                    ) : (
                      "Аккаунт подключён"
                    )}
                  </div>
                  <div className="pint-hint">{INTEGRATION_HINTS[integration.type]}</div>
                  <div className="pint-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => connect(integration.type)}
                      disabled={connecting === integration.type}
                    >
                      {connecting === integration.type ? "Подключение…" : "Переподключить"}
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => disconnect(integration)}>
                      Отключить
                    </button>
                  </div>
                </div>
              );
            })}
            {missing.length > 0 && (
              <div className="pint-card pint-add">
                <div className="pint-add-label">Добавить интеграцию</div>
                <div className="pint-add-btns">
                  {missing.map((type) => {
                    const meta = INTEGRATION_META[type];
                    return (
                      <button
                        key={type}
                        className="client-int-btn"
                        style={{ "--int-color": meta.color } as React.CSSProperties}
                        onClick={() => connect(type)}
                        disabled={connecting === type}
                      >
                        <span className="client-int-dot" />
                        {meta.label}
                        {connecting === type ? "…" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h3>Отчёты</h3>
        </div>
        <div className="card-body">
          {reports.length === 0 ? (
            <p className="report-none">
              Пока нет отчётов. Отчёт — это сохранённые правила выгрузки: настройте один раз, а дальше
              просто меняйте период и обновляйте данные.
            </p>
          ) : (
            <div className="report-rows">
              {reports.map((report) => {
                const isV2 = report.config?.version === 2;
                return (
                  <div key={report.id} className="report-row">
                    <div className="report-row-info">
                      <div className="report-row-name">{report.name}</div>
                      <div className="report-row-sub">{runLine(report)}</div>
                    </div>
                    <div className="report-row-controls">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setRunModalId(report.id)}
                        disabled={runningId !== null || !isV2}
                        title={isV2 ? "Задать даты и повторить выгрузку" : "Отчёт в устаревшем формате — откройте настройки"}
                      >
                        {runningId === report.id ? "Выгружаем…" : "Обновить выгрузку"}
                      </button>
                      <Link href={`/projects/${id}/reports/${report.id}`} className="btn btn-secondary btn-sm">
                        Настройки
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <Link href={`/projects/${id}/reports/new`} className="btn btn-primary">
              + Добавить отчёт
            </Link>
          </div>
        </div>
      </section>

      {runModalReport && (
        <RunReportModal
          reportName={runModalReport.name}
          period={runModalReport.config?.period}
          lastRunFrom={runModalReport.last_run?.period_from}
          lastRunTo={runModalReport.last_run?.period_to}
          onConfirm={(range) => confirmRun(runModalReport, range)}
          onClose={() => setRunModalId(null)}
        />
      )}
    </Layout>
  );
}
