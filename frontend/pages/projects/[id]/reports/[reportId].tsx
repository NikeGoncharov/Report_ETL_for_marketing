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
        router.push(`/projects/${id}`);
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

      <ReportWorkspace projectId={projectId} report={report} />
    </Layout>
  );
}
