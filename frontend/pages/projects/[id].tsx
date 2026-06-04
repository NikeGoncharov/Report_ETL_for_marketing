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
  account_info: Record<string, unknown> | null;
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
    <Layout>
      <div className="breadcrumb">
        <Link href="/dashboard">Аккаунт</Link>
        <span className="breadcrumb-separator">/</span>
        <span>{project.name}</span>
      </div>

      <div className="workspace-grid">
        <section className="card">
          <div className="card-header">
            <h3>Интеграции</h3>
          </div>
          <div className="card-body">
            <div className="list-grid">
              {integrations.map((integration) => (
                <div key={integration.id} className="list-row">
                  <div className="list-row-title">
                    {INTEGRATION_LABELS[integration.type] || integration.type}
                  </div>
                  <div className="list-row-actions">
                    <span className="status-pill">Подключено</span>
                    <Link href={`/projects/${id}/integrations`} className="btn btn-secondary btn-sm">Настроить</Link>
                  </div>
                </div>
              ))}
              <div className="list-row">
                <div className="list-row-title">Новая интеграция</div>
                <div className="list-row-actions">
                  <Link href={`/projects/${id}/integrations`} className="btn btn-primary btn-sm">Добавить</Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Отчёты</h3>
          </div>
          <div className="card-body">
            <div className="list-grid">
              {reports.map((report) => (
                <div key={report.id} className="list-row">
                  <div className="list-row-title">{report.name}</div>
                  <div className="list-row-actions">
                    <Link href={`/projects/${id}/reports/${report.id}/edit`} className="btn btn-secondary btn-sm">
                      Изменить
                    </Link>
                    <Link href={`/projects/${id}/reports/${report.id}`} className="btn btn-primary btn-sm">
                      Открыть
                    </Link>
                  </div>
                </div>
              ))}
              <div className="list-row">
                <div className="list-row-title">Новый отчёт</div>
                <div className="list-row-actions">
                  <Link href={`/projects/${id}/reports/new`} className="btn btn-success btn-sm">Создать</Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
