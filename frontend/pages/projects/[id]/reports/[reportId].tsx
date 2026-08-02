// Страница отчёта = рабочее пространство пайплайна (просмотр и редактирование).
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import Layout from "../../../../components/Layout";
import ReportWorkspace from "../../../../components/report/ReportWorkspace";
import { projectsApi, reportsApi } from "../../../../lib/api";
import { Report } from "../../../../types/report";

type Project = {
  id: number;
  name: string;
};

export default function ReportPage() {
  const router = useRouter();
  const { id, reportId } = router.query;
  const projectId = Number(id);

  const [project, setProject] = useState<Project | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !reportId) return;
    let active = true;
    // При переходе между отчётами показываем загрузку, а не данные предыдущего
    setLoading(true);
    setReport(null);
    setProject(null);

    Promise.all([
      projectsApi.get(projectId),
      reportsApi.get(projectId, Number(reportId)),
    ])
      .then(([projectData, reportData]) => {
        if (!active) return;
        setProject(projectData);
        setReport(reportData);
      })
      .catch(() => {
        // Поздний reject уже неактуального запроса не должен уводить со страницы,
        // которую пользователь тем временем открыл
        if (active) router.push(`/projects/${id}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id, reportId]);

  if (loading || !report) {
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
        <Link href={`/projects/${id}`}>{project?.name}</Link>
        <span className="breadcrumb-separator">/</span>
        <span>{report.name}</span>
      </div>

      {/* key обязателен: без него переход между отчётами переиспользует
          смонтированный ReportWorkspace, и сохранение уносит конфиг
          предыдущего отчёта в текущий (безвозвратно). */}
      <ReportWorkspace key={report.id} projectId={projectId} report={report} />
    </Layout>
  );
}
