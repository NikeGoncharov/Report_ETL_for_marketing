import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import Layout from "../../../../components/Layout";
import { projectsApi, apiFetch } from "../../../../lib/api";

type Project = {
  id: number;
  name: string;
};

type Report = {
  id: number;
  name: string;
  config: any;
  created_at: string;
  updated_at: string;
};

type ReportRun = {
  id: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  result_url: string | null;
};

export default function ReportPage() {
  const router = useRouter();
  const { id, reportId } = router.query;
  const projectId = Number(id);
  const reportIdNum = Number(reportId);

  const [project, setProject] = useState<Project | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);

  async function loadData() {
    if (!id || !reportId) return;

    try {
      const [projectData, reportData, runsData] = await Promise.all([
        projectsApi.get(projectId),
        apiFetch(`/projects/${projectId}/reports/${reportIdNum}`),
        apiFetch(`/projects/${projectId}/reports/${reportIdNum}/runs`),
      ]);
      setProject(projectData);
      setReport(reportData);
      setRuns(runsData);
    } catch {
      router.push(`/projects/${id}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleRun() {
    setRunning(true);

    try {
      await apiFetch(`/projects/${projectId}/reports/${reportIdNum}/run`, {
        method: "POST",
      });
      const runsData = await apiFetch(`/projects/${projectId}/reports/${reportIdNum}/runs`);
      setRuns(runsData);
    } catch (err: any) {
      alert("Ошибка запуска: " + (err.message || "Unknown error"));
    } finally {
      setRunning(false);
    }
  }

  async function handlePreview() {
    if (!report) return;
    setPreviewing(true);

    try {
      const result = await apiFetch(`/projects/${projectId}/reports/preview`, {
        method: "POST",
        body: JSON.stringify({ config: report.config }),
      });
      setPreviewData(result);
    } catch (err: any) {
      alert("Ошибка превью: " + (err.message || "Unknown error"));
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
    } catch (err: any) {
      alert("Ошибка удаления: " + (err.message || "Unknown error"));
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
    <Layout title={report.name}>
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link href="/dashboard">Проекты</Link>
        <span className="breadcrumb-separator">/</span>
        <Link href={`/projects/${id}`}>{project?.name}</Link>
        <span className="breadcrumb-separator">/</span>
        <span>{report.name}</span>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 12, marginBottom: 32 }}>
        <button
          className="btn btn-success"
          onClick={handleRun}
          disabled={running}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21"/>
          </svg>
          {running ? "Запуск..." : "Запустить"}
        </button>
        <button className="btn btn-danger" onClick={handleDelete}>
          Удалить
        </button>
      </div>

      {/* Config summary */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>Конфигурация</h3>
        </div>
        <div className="card-body">
          <div style={{ display: "grid", gap: 8 }}>
            <p>
              <strong>Источники:</strong>{" "}
              {report.config.sources?.map((s: any) => s.type === "direct" ? "Яндекс.Директ" : "Яндекс.Метрика").join(", ") || "—"}
            </p>
            <p>
              <strong>Период:</strong>{" "}
              {report.config.period?.type || "—"}
            </p>
            <p>
              <strong>Трансформации:</strong>{" "}
              {report.config.transformations?.length || 0}
            </p>
            <p style={{ margin: 0 }}>
              <strong>Создан:</strong>{" "}
              {new Date(report.created_at).toLocaleString("ru-RU")}
            </p>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>Превью данных</h3>
        </div>
        <div className="card-body">
          <button
            className="btn btn-primary"
            onClick={handlePreview}
            disabled={previewing}
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
            </div>
          )}
        </div>
      </div>

      {/* Run history */}
      <div className="card">
        <div className="card-header">
          <h3>История запусков</h3>
        </div>
        <div className="card-body">
          {runs.length === 0 ? (
            <div className="empty-state" style={{ padding: 32 }}>
              <p style={{ margin: 0 }}>Отчёт ещё не запускался</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="project-card"
                >
                  <div className="project-card-info">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          backgroundColor:
                            run.status === "completed"
                              ? "var(--success)"
                              : run.status === "failed"
                              ? "var(--danger)"
                              : "var(--warning)",
                        }}
                      />
                      <span style={{ fontWeight: 500 }}>
                        {run.status === "completed"
                          ? "Завершён"
                          : run.status === "failed"
                          ? "Ошибка"
                          : run.status === "running"
                          ? "Выполняется"
                          : "В очереди"}
                      </span>
                    </div>
                    <p className="project-card-date">
                      {new Date(run.started_at).toLocaleString("ru-RU")}
                    </p>
                    {run.error_message && (
                      <p style={{ fontSize: "0.8125rem", color: "var(--danger)", marginTop: 4 }}>
                        {run.error_message}
                      </p>
                    )}
                  </div>
                  {run.result_url && (
                    <a
                      href={run.result_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-success btn-sm"
                    >
                      Открыть в Sheets
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
