import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import Layout from "../../../../components/Layout";
import { projectsApi, apiFetch } from "../../../../lib/api";

type Project = {
  id: number;
  name: string;
};

type ReportSourceConfig = {
  type: "direct" | "metrika";
  campaign_ids?: number[];
  direct_fields?: string[];
  metrics?: string[];
  dimensions?: string[];
};

type ReportConfig = {
  sources?: ReportSourceConfig[];
  period?: {
    type?: string;
    date_from?: string;
    date_to?: string;
  };
};

type Report = {
  id: number;
  name: string;
  config: ReportConfig;
  created_at: string;
  updated_at: string;
};

type PreviewResult = {
  columns: string[];
  data: Record<string, unknown>[];
  row_count: number;
};

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default function ReportPage() {
  const router = useRouter();
  const { id, reportId } = router.query;
  const projectId = Number(id);
  const reportIdNum = Number(reportId);

  const [project, setProject] = useState<Project | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [activeConfig, setActiveConfig] = useState<"dates" | "slices" | "metrics">("dates");

  async function loadData() {
    if (!id || !reportId) return;

    try {
      const [projectData, reportData] = await Promise.all([
        projectsApi.get(projectId),
        apiFetch(`/projects/${projectId}/reports/${reportIdNum}`),
      ]);
      setProject(projectData);
      setReport(reportData);
    } catch {
      router.push(`/projects/${id}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleRun() {
    setRunning(true);

    try {
      const run = await apiFetch<{ status: string; error_message?: string; result_url?: string }>(
        `/projects/${projectId}/reports/${reportIdNum}/run`,
        { method: "POST" },
      );
      if (run.status === "failed" && run.error_message) {
        alert("Запуск завершился с ошибкой: " + run.error_message);
      } else if (run.status === "completed" && run.result_url) {
        window.open(run.result_url, "_blank");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      alert("Ошибка запуска: " + message);
    } finally {
      setRunning(false);
    }
  }

  async function handlePreview() {
    if (!report) return;
    setPreviewing(true);

    try {
      const result = await apiFetch<PreviewResult>(`/projects/${projectId}/reports/preview`, {
        method: "POST",
        body: JSON.stringify({ config: report.config }),
      });
      setPreviewData(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      alert("Ошибка превью: " + message);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Удалить этот отчёт?")) return;

    try {
      await apiFetch(`/projects/${projectId}/reports/${reportIdNum}`, {
        method: "DELETE",
      });
      router.push(`/projects/${id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      alert("Ошибка удаления: " + message);
    }
  }

  function handleDownloadCsv() {
    if (!previewData) {
      return;
    }
    const headers = previewData.columns.map((col) => csvEscape(col)).join(",");
    const rows = previewData.data.map((row) =>
      previewData.columns
        .map((col) => csvEscape(row[col]))
        .join(","),
    );
    const content = [headers, ...rows].join("\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${report?.name || "report"}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleDownloadExcelLike() {
    if (!previewData) {
      return;
    }
    const header = `<tr>${previewData.columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}</tr>`;
    const body = previewData.data
      .map((row) => `<tr>${previewData.columns.map((col) => `<td>${escapeHtml(row[col])}</td>`).join("")}</tr>`)
      .join("");
    const html = `<table>${header}${body}</table>`;
    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${report?.name || "report"}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function getPeriodLabel() {
    if (!report?.config?.period?.type) {
      return "Не задан";
    }
    const p = report.config.period.type;
    const map: Record<string, string> = {
      last_7_days: "Последние 7 дней",
      last_14_days: "Последние 14 дней",
      last_30_days: "Последние 30 дней",
      last_90_days: "Последние 90 дней",
      this_month: "Этот месяц",
      last_month: "Прошлый месяц",
      custom: `${report.config.period.date_from || "—"} - ${report.config.period.date_to || "—"}`,
    };
    return map[p] || p;
  }

  function getSlicesSummary() {
    const sources = report?.config?.sources || [];
    if (!sources.length) {
      return "Нет срезов";
    }
    const chunks: string[] = [];
    sources.forEach((source) => {
      if (source.type === "direct") {
        chunks.push("Кампании Директа");
      }
      if (source.type === "metrika") {
        chunks.push(...(source.dimensions || []));
      }
    });
    return chunks.length ? chunks.join(", ") : "Срезы по умолчанию";
  }

  function getMetricsSummary() {
    const sources = report?.config?.sources || [];
    const metrics = sources.flatMap((source) =>
      source.type === "direct" ? (source.direct_fields || []) : (source.metrics || []),
    );
    return metrics.length ? metrics.join(", ") : "Метрики по умолчанию";
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

  if (!report) {
    return (
      <Layout>
        <div className="empty-state">
          <h3>Отчёт не найден</h3>
          <Link href={`/projects/${id}`} className="btn btn-primary">
            Вернуться к проекту
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="breadcrumb">
        <Link href="/dashboard">Аккаунт</Link>
        <span className="breadcrumb-separator">/</span>
        <span>{report.name}</span>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <Link href={`/projects/${id}/reports/${reportId}/edit`} className="btn btn-secondary">
          Изменить
        </Link>
        <button className="btn btn-danger" onClick={handleDelete}>
          Удалить
        </button>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <h3>Конфигурация</h3>
        </div>
        <div className="card-body">
          <div className="config-switches">
            <button
              className={`config-switch ${activeConfig === "dates" ? "active" : ""}`}
              onClick={() => setActiveConfig("dates")}
            >
              Даты
            </button>
            <button
              className={`config-switch ${activeConfig === "slices" ? "active" : ""}`}
              onClick={() => setActiveConfig("slices")}
            >
              Срезы
            </button>
            <button
              className={`config-switch ${activeConfig === "metrics" ? "active" : ""}`}
              onClick={() => setActiveConfig("metrics")}
            >
              Метрики
            </button>
          </div>
          <div className="config-content">
            {activeConfig === "dates" && <p>{getPeriodLabel()}</p>}
            {activeConfig === "slices" && <p>{getSlicesSummary()}</p>}
            {activeConfig === "metrics" && <p>{getMetricsSummary()}</p>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Превью и трансформации</h3>
          <div className="actions-row">
            <button className="btn btn-secondary btn-sm" onClick={() => alert("Окно трансформаций будет добавлено на следующем этапе.")}>
              Трансформировать
            </button>
            <button className="btn btn-success btn-sm" onClick={handleRun} disabled={running}>
              {running ? "Выгрузка..." : "Выгрузить в Sheets"}
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleDownloadExcelLike} disabled={!previewData}>
              Скачать Excel
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleDownloadCsv} disabled={!previewData}>
              Скачать CSV
            </button>
          </div>
        </div>
        <div className="card-body">
          <button className="btn btn-primary" onClick={handlePreview} disabled={previewing} style={{ marginBottom: 16 }}>
            {previewing ? "Загрузка..." : "Выгрузить превью"}
          </button>

          {previewData && (
            <div style={{ overflowX: "auto" }}>
              <p style={{ color: "var(--gray-600)", marginBottom: 12 }}>
                Строк: {previewData.row_count}
              </p>
              <table>
                <thead>
                  <tr>
                    {previewData.columns.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.data.slice(0, 10).map((row, i) => (
                    <tr key={i}>
                      {previewData.columns.map((col) => (
                        <td key={col}>{String(row[col] ?? "—")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
