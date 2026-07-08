import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import Layout from "../../../components/Layout";
import { projectsApi, apiFetch } from "../../../lib/api";
import { connectIntegrationPopup, oauthErrorMessage } from "../../../lib/oauth";

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
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
    ),
  },
  yandex_metrika: {
    label: "Яндекс.Метрика",
    description: "Получение данных о визитах и конверсиях",
    color: "#FC3F1D",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        <path d="M9 12l2 2 4-4"/>
      </svg>
    ),
  },
  google_sheets: {
    label: "Google Sheets",
    description: "Экспорт отчётов в Google Таблицы",
    color: "#34A853",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <line x1="3" y1="9" x2="21" y2="9"/>
        <line x1="9" y1="21" x2="9" y2="9"/>
      </svg>
    ),
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
      await connectIntegrationPopup(projectId, type, ({ error }) => {
        setConnecting(null);
        loadData();
        const msg = oauthErrorMessage(error);
        if (msg) alert(msg);
      });
    } catch (err: any) {
      let message = "Ошибка подключения интеграции";
      if (err?.message) {
        try {
          const parsed = JSON.parse(err.message);
          if (parsed.detail) message = typeof parsed.detail === "string" ? parsed.detail : parsed.detail.join?.(", ") || message;
        } catch {
          if (err.message.length < 200) message = err.message;
        }
      }
      alert(message);
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

  // Если мы открыты в popup после OAuth — сообщаем родительскому окну и закрываемся
  useEffect(() => {
    if (typeof window === "undefined" || !window.opener) return;
    const s = success !== undefined;
    const e = error as string | undefined;
    if (s || e) {
      window.opener.postMessage(
        { type: "oauth-done", success: s, error: e ?? undefined },
        window.location.origin
      );
      window.close();
    }
  }, [success, error]);

  // Обычный редирект (если открывали авторизацию не в popup) — убираем query и показываем алерт при ошибке
  useEffect(() => {
    if (window.opener) return; // в popup уже обработали выше
    if (success) {
      loadData();
      router.replace(`/projects/${id}/integrations`, undefined, { shallow: true });
    }
    if (error) {
      const msg =
        error === "token_exchange_failed"
          ? "Не удалось получить токен от провайдера. Проверьте Redirect URI в настройках приложения (Яндекс OAuth / Google Cloud) и переменные окружения на сервере (YANDEX_REDIRECT_URI / GOOGLE_REDIRECT_URI)."
          : "Ошибка подключения интеграции";
      alert(msg);
      router.replace(`/projects/${id}/integrations`, undefined, { shallow: true });
    }
  }, [success, error]);

  if (loading) {
    return (
      <Layout>
        <div className="loading">
          <p>Загрузка...</p>
        </div>
      </Layout>
    );
  }

  const getIntegration = (type: string) =>
    integrations.find((i) => i.type === type);

  return (
    <Layout title="Интеграции">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link href="/dashboard">Клиенты</Link>
        <span className="breadcrumb-separator">/</span>
        <Link href={`/projects/${id}`}>{project?.name}</Link>
        <span className="breadcrumb-separator">/</span>
        <span>Интеграции</span>
      </div>

      {success && (
        <div className="alert alert-success">
          Интеграция успешно подключена!
        </div>
      )}

      {/* Integration Cards */}
      <div className="integration-pill-grid">
        {Object.entries(INTEGRATION_TYPES).map(([type, info]) => {
          const integration = getIntegration(type);
          const isConnected = !!integration;
          const isConnecting = connecting === type;

          return (
            <div key={type} className={`integration-card ${isConnected ? "connected" : ""}`}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 16 }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: "var(--border-radius)",
                      backgroundColor: `${info.color}20`,
                      color: info.color,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {info.icon}
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <h3 style={{ margin: 0 }}>{info.label}</h3>
                      {isConnected && (
                        <span className="status-pill">Подключено</span>
                      )}
                    </div>
                    <p style={{ margin: 0, color: "var(--gray-600)", fontSize: "0.875rem" }}>
                      {info.description}
                    </p>
                    {integration?.account_info && (
                      <p style={{ margin: "8px 0 0", fontSize: "0.8125rem", color: "var(--gray-500)" }}>
                        Аккаунт:{" "}
                        {integration.account_info.name ||
                          integration.account_info.email ||
                          integration.account_info.login}
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  {isConnected ? (
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => disconnectIntegration(integration.id, type)}
                    >
                      Отключить
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => connectIntegration(type)}
                      disabled={isConnecting}
                      style={{ backgroundColor: info.color, borderColor: info.color }}
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

      {/* Back link */}
      <div style={{ marginTop: 32 }}>
        <Link href={`/projects/${id}`} className="btn btn-secondary">
          ← Вернуться к проекту
        </Link>
      </div>
    </Layout>
  );
}
