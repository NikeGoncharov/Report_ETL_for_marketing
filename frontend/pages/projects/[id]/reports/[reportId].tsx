import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
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
      // Reload runs
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
      <div style={{ padding: 40, textAlign: "center" }}>
        <p>Загрузка...</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p>Отчёт не найден</p>
      </div>
    );
  }

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
        <span>{report.name}</span>
      </div>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 30 }}>
        <h1 style={{ margin: 0 }}>{report.name}</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={handleRun}
            disabled={running}
            style={{
              padding: "10px 20px",
              backgroundColor: "#28a745",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: running ? "not-allowed" : "pointer",
              opacity: running ? 0.7 : 1,
            }}
          >
            {running ? "Запуск..." : "Запустить"}
          </button>
          <button
            onClick={handleDelete}
            style={{
              padding: "10px 20px",
              backgroundColor: "transparent",
              color: "#dc3545",
              border: "1px solid #dc3545",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Удалить
          </button>
        </div>
      </div>

      {/* Config summary */}
      <section style={{ marginBottom: 30 }}>
        <h2 style={{ marginBottom: 15 }}>Конфигурация</h2>
        <div style={{ backgroundColor: "#f5f5f5", padding: 15, borderRadius: 8 }}>
          <p><strong>Источники:</strong> {report.config.sources?.map((s: any) => s.type).join(", ") || "—"}</p>
          <p><strong>Период:</strong> {report.config.period?.type || "—"}</p>
          <p><strong>Трансформации:</strong> {report.config.transformations?.length || 0}</p>
          <p style={{ margin: 0 }}>
            <strong>Создан:</strong> {new Date(report.created_at).toLocaleString("ru-RU")}
          </p>
        </div>
      </section>

      {/* Preview */}
      <section style={{ marginBottom: 30 }}>
        <h2 style={{ marginBottom: 15 }}>Превью данных</h2>
        <button
          onClick={handlePreview}
          disabled={previewing}
          style={{
            padding: "10px 20px",
            backgroundColor: "#0070f3",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: previewing ? "not-allowed" : "pointer",
            opacity: previewing ? 0.7 : 1,
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
          </div>
        )}
      </section>

      {/* Run history */}
      <section>
        <h2 style={{ marginBottom: 15 }}>История запусков</h2>
        {runs.length === 0 ? (
          <p style={{ color: "#666" }}>Отчёт ещё не запускался</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {runs.map((run) => (
              <div
                key={run.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: 15,
                  border: "1px solid #eee",
                  borderRadius: 8,
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        backgroundColor:
                          run.status === "completed"
                            ? "#28a745"
                            : run.status === "failed"
                            ? "#dc3545"
                            : "#ffc107",
                      }}
                    />
                    <span>
                      {run.status === "completed"
                        ? "Завершён"
                        : run.status === "failed"
                        ? "Ошибка"
                        : run.status === "running"
                        ? "Выполняется"
                        : "В очереди"}
                    </span>
                  </div>
                  <p style={{ margin: "5px 0 0", fontSize: 12, color: "#666" }}>
                    {new Date(run.started_at).toLocaleString("ru-RU")}
                  </p>
                  {run.error_message && (
                    <p style={{ margin: "5px 0 0", fontSize: 12, color: "#dc3545" }}>
                      {run.error_message}
                    </p>
                  )}
                </div>
                {run.result_url && (
                  <a
                    href={run.result_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#34A853",
                      color: "white",
                      border: "none",
                      borderRadius: 4,
                      textDecoration: "none",
                    }}
                  >
                    Открыть в Sheets
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
