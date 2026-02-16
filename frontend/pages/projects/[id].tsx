import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import Layout from "../../components/Layout";
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

const INTEGRATION_LABELS: Record<string, string> = {
  yandex_direct: "Яндекс.Директ",
  yandex_metrika: "Яндекс.Метрика",
  google_sheets: "Google Sheets",
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
      
      try {
        const integrationsData = await apiFetch(`/integrations/projects/${id}`);
        setIntegrations(integrationsData);
      } catch {}
      
      try {
        const reportsData = await apiFetch(`/projects/${id}/reports`);
        setReports(reportsData);
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

  if (loading || !project) {
    return (
      <Layout>
        <div className="loading">
          <p>Загрузка...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={project.name}>
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link href="/dashboard">Проекты</Link>
        <span className="breadcrumb-separator">/</span>
        <span>{project.name}</span>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: "var(--success-light)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </div>
          <div className="stat-card-value">{integrations.length}</div>
          <div className="stat-card-label">Интеграций</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: "var(--primary-light)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10,9 9,9 8,9"/>
            </svg>
          </div>
          <div className="stat-card-value">{reports.length}</div>
          <div className="stat-card-label">Отчётов</div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 12, marginBottom: 32 }}>
        <button
          className="btn btn-primary"
          onClick={() => router.push(`/projects/${id}/integrations`)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
          Интеграции
        </button>
        <button
          className="btn btn-success"
          onClick={() => router.push(`/projects/${id}/reports/new`)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Создать отчёт
        </button>
      </div>

      {/* Integrations Section */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3>Подключённые интеграции</h3>
          <Link href={`/projects/${id}/integrations`} className="btn btn-secondary btn-sm">
            Управление
          </Link>
        </div>
        <div className="card-body">
          {integrations.length === 0 ? (
            <div className="empty-state" style={{ padding: 32 }}>
              <p style={{ margin: 0 }}>
                Нет подключённых интеграций.{" "}
                <Link href={`/projects/${id}/integrations`}>Подключить</Link>
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {integrations.map((integration) => (
                <div key={integration.id} className="integration-card connected">
                  <div className="integration-card-header">
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div className="integration-status active" />
                      <h3 style={{ margin: 0 }}>
                        {INTEGRATION_LABELS[integration.type] || integration.type}
                      </h3>
                    </div>
                  </div>
                  {integration.account_info?.name && (
                    <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--gray-600)" }}>
                      Аккаунт: {integration.account_info.name}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Reports Section */}
      <div className="card">
        <div className="card-header">
          <h3>Отчёты</h3>
          <Link href={`/projects/${id}/reports/new`} className="btn btn-success btn-sm">
            + Создать
          </Link>
        </div>
        <div className="card-body">
          {reports.length === 0 ? (
            <div className="empty-state" style={{ padding: 32 }}>
              <p style={{ margin: 0 }}>
                Нет созданных отчётов.{" "}
                <Link href={`/projects/${id}/reports/new`}>Создать первый отчёт</Link>
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {reports.map((report) => (
                <div key={report.id} className="project-card">
                  <div className="project-card-info">
                    <h3>{report.name}</h3>
                    <p className="project-card-date">
                      Создан: {new Date(report.created_at).toLocaleDateString("ru-RU")}
                    </p>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => router.push(`/projects/${id}/reports/${report.id}`)}
                  >
                    Открыть
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
