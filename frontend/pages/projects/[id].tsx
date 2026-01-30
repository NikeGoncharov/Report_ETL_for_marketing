import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import { projectsApi, apiFetch } from "../../lib/api";

type Project = {
  id: number;
  name: string;
  created_at: string;
};

type Integration = {
  id: number;
  type: string;
  account_info: Record<string, any> | null;
  created_at: string;
};

type Report = {
  id: number;
  name: string;
  created_at: string;
};

export default function ProjectPage() {
  const router = useRouter();
  const { id } = router.query;

  const [project, setProject] = useState<Project | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadProject() {
    if (!id) return;
    
    try {
      const projectData = await projectsApi.get(Number(id));
      setProject(projectData);
      
      // Load integrations and reports (will be implemented in later phases)
      try {
        const integrationsData = await apiFetch(`/projects/${id}/integrations`);
        setIntegrations(integrationsData);
      } catch {
        // Integrations API not yet implemented
      }
      
      try {
        const reportsData = await apiFetch(`/projects/${id}/reports`);
        setReports(reportsData);
      } catch {
        // Reports API not yet implemented
      }
    } catch {
      router.push("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProject();
  }, [id]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p>Загрузка...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p>Проект не найден</p>
        <Link href="/dashboard">Вернуться к списку проектов</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: 40 }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 20 }}>
        <Link href="/dashboard" style={{ color: "#0070f3" }}>
          ← Все проекты
        </Link>
      </div>

      {/* Header */}
      <h1 style={{ marginBottom: 10 }}>{project.name}</h1>
      <p style={{ color: "#666", marginBottom: 30 }}>
        Создан: {new Date(project.created_at).toLocaleDateString("ru-RU")}
      </p>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, marginBottom: 40 }}>
        <button
          onClick={() => router.push(`/projects/${id}/integrations`)}
          style={{
            padding: "12px 24px",
            fontSize: 16,
            backgroundColor: "#0070f3",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Интеграции
        </button>
        <button
          onClick={() => router.push(`/projects/${id}/reports/new`)}
          style={{
            padding: "12px 24px",
            fontSize: 16,
            backgroundColor: "#28a745",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Создать отчёт
        </button>
      </div>

      {/* Integrations Section */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ marginBottom: 15 }}>Подключённые интеграции</h2>
        {integrations.length === 0 ? (
          <div style={{ padding: 20, backgroundColor: "#f5f5f5", borderRadius: 8 }}>
            <p style={{ margin: 0, color: "#666" }}>
              Нет подключённых интеграций.{" "}
              <Link href={`/projects/${id}/integrations`} style={{ color: "#0070f3" }}>
                Подключить
              </Link>
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {integrations.map((integration) => (
              <div
                key={integration.id}
                style={{
                  padding: 15,
                  border: "1px solid #eee",
                  borderRadius: 8,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <strong>{getIntegrationLabel(integration.type)}</strong>
                  {integration.account_info?.name && (
                    <span style={{ color: "#666", marginLeft: 10 }}>
                      ({integration.account_info.name})
                    </span>
                  )}
                </div>
                <span style={{ color: "#28a745" }}>✓ Подключено</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Reports Section */}
      <section>
        <h2 style={{ marginBottom: 15 }}>Отчёты</h2>
        {reports.length === 0 ? (
          <div style={{ padding: 20, backgroundColor: "#f5f5f5", borderRadius: 8 }}>
            <p style={{ margin: 0, color: "#666" }}>
              Нет созданных отчётов.{" "}
              <Link href={`/projects/${id}/reports/new`} style={{ color: "#0070f3" }}>
                Создать первый отчёт
              </Link>
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {reports.map((report) => (
              <div
                key={report.id}
                style={{
                  padding: 15,
                  border: "1px solid #eee",
                  borderRadius: 8,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <strong>{report.name}</strong>
                  <p style={{ margin: "5px 0 0", fontSize: 12, color: "#999" }}>
                    Создан: {new Date(report.created_at).toLocaleDateString("ru-RU")}
                  </p>
                </div>
                <button
                  onClick={() => router.push(`/projects/${id}/reports/${report.id}`)}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#0070f3",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  Открыть
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function getIntegrationLabel(type: string): string {
  const labels: Record<string, string> = {
    yandex_direct: "Яндекс.Директ",
    yandex_metrika: "Яндекс.Метрика",
    google_sheets: "Google Sheets",
  };
  return labels[type] || type;
}
