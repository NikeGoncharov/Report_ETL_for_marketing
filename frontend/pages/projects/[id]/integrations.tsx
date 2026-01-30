import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import { projectsApi, apiFetch } from "../../../lib/api";

type Project = {
  id: number;
  name: string;
};

type Integration = {
  id: number;
  type: string;
  account_info: Record<string, any> | null;
  created_at: string;
};

const INTEGRATION_TYPES = {
  yandex_direct: {
    label: "Яндекс.Директ",
    description: "Получение данных о рекламных кампаниях",
    color: "#FC3F1D",
  },
  yandex_metrika: {
    label: "Яндекс.Метрика",
    description: "Получение данных о визитах и конверсиях",
    color: "#FC3F1D",
  },
  google_sheets: {
    label: "Google Sheets",
    description: "Экспорт отчётов в Google Таблицы",
    color: "#34A853",
  },
};

export default function IntegrationsPage() {
  const router = useRouter();
  const { id, success, error } = router.query;
  const projectId = Number(id);

  const [project, setProject] = useState<Project | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);

  async function loadData() {
    if (!id) return;

    try {
      const [projectData, integrationsData] = await Promise.all([
        projectsApi.get(projectId),
        apiFetch(`/integrations/projects/${projectId}`),
      ]);
      setProject(projectData);
      setIntegrations(integrationsData);
    } catch {
      router.push("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function connectIntegration(type: string) {
    setConnecting(type);

    try {
      let endpoint: string;
      if (type === "google_sheets") {
        endpoint = `/integrations/google/auth-url?project_id=${projectId}`;
      } else {
        endpoint = `/integrations/yandex/auth-url?project_id=${projectId}&integration_type=${type}`;
      }

      const data = await apiFetch(endpoint);
      window.location.href = data.auth_url;
    } catch (err: any) {
      alert("Ошибка подключения интеграции");
      setConnecting(null);
    }
  }

  async function disconnectIntegration(integrationId: number, type: string) {
    const label = INTEGRATION_TYPES[type as keyof typeof INTEGRATION_TYPES]?.label || type;
    if (!confirm(`Отключить интеграцию "${label}"?`)) return;

    try {
      await apiFetch(`/integrations/${integrationId}`, { method: "DELETE" });
      loadData();
    } catch {
      alert("Ошибка отключения интеграции");
    }
  }

  useEffect(() => {
    loadData();
  }, [id]);

  useEffect(() => {
    // Show success/error messages
    if (success) {
      // Clear query params
      router.replace(`/projects/${id}/integrations`, undefined, { shallow: true });
    }
    if (error) {
      alert("Ошибка подключения интеграции");
      router.replace(`/projects/${id}/integrations`, undefined, { shallow: true });
    }
  }, [success, error]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p>Загрузка...</p>
      </div>
    );
  }

  const getIntegration = (type: string) =>
    integrations.find((i) => i.type === type);

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: 40 }}>
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
        <span>Интеграции</span>
      </div>

      <h1 style={{ marginBottom: 30 }}>Интеграции</h1>

      {success && (
        <div
          style={{
            padding: 15,
            backgroundColor: "#d4edda",
            borderRadius: 8,
            marginBottom: 20,
            color: "#155724",
          }}
        >
          Интеграция успешно подключена!
        </div>
      )}

      {/* Integration Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {Object.entries(INTEGRATION_TYPES).map(([type, info]) => {
          const integration = getIntegration(type);
          const isConnected = !!integration;
          const isConnecting = connecting === type;

          return (
            <div
              key={type}
              style={{
                border: "1px solid #eee",
                borderRadius: 8,
                padding: 20,
                backgroundColor: isConnected ? "#f8fff8" : "#fff",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        backgroundColor: isConnected ? "#28a745" : "#ccc",
                      }}
                    />
                    <h3 style={{ margin: 0, color: info.color }}>
                      {info.label}
                    </h3>
                  </div>
                  <p style={{ margin: "10px 0 0", color: "#666" }}>
                    {info.description}
                  </p>
                  {integration?.account_info && (
                    <p style={{ margin: "5px 0 0", fontSize: 14, color: "#999" }}>
                      Аккаунт:{" "}
                      {integration.account_info.name ||
                        integration.account_info.email ||
                        integration.account_info.login}
                    </p>
                  )}
                </div>
                <div>
                  {isConnected ? (
                    <button
                      onClick={() => disconnectIntegration(integration.id, type)}
                      style={{
                        padding: "8px 16px",
                        backgroundColor: "transparent",
                        color: "#dc3545",
                        border: "1px solid #dc3545",
                        borderRadius: 4,
                        cursor: "pointer",
                      }}
                    >
                      Отключить
                    </button>
                  ) : (
                    <button
                      onClick={() => connectIntegration(type)}
                      disabled={isConnecting}
                      style={{
                        padding: "8px 16px",
                        backgroundColor: info.color,
                        color: "white",
                        border: "none",
                        borderRadius: 4,
                        cursor: isConnecting ? "not-allowed" : "pointer",
                        opacity: isConnecting ? 0.7 : 1,
                      }}
                    >
                      {isConnecting ? "Подключение..." : "Подключить"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Back button */}
      <div style={{ marginTop: 40 }}>
        <Link
          href={`/projects/${id}`}
          style={{
            color: "#0070f3",
            textDecoration: "none",
          }}
        >
          ← Вернуться к проекту
        </Link>
      </div>
    </div>
  );
}
