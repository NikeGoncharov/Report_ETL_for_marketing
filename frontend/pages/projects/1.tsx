import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

type ProjectData = {
  id: number;
  name: string;
};

type Report = {
  id: number;
  name: string;
};

export default function ProjectPage() {
  const router = useRouter();
  const { id } = router.query;

  const [project, setProject] = useState<ProjectData | null>(null);
  const [reports, setReports] = useState<Report[]>([]);

  async function loadProject() {
    if (!id) return;
    try {
      const data = await apiFetch(`/projects/${id}`);
      setProject(data);
    } catch {
      alert("Ошибка загрузки проекта");
      router.push("/dashboard");
    }
  }

  async function createReport() {
    if (!project) return;
    // пока просто добавляем фиктивный отчёт
    const newReport = { id: reports.length + 1, name: `Отчёт ${reports.length + 1}` };
    setReports([...reports, newReport]);
  }

  useEffect(() => {
    loadProject();
  }, [id]);

  return (
    <div style={{ padding: 40 }}>
      {project ? (
        <>
          <h1>Проект: {project.name}</h1>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <button onClick={createReport} style={{ marginRight: 10 }}>
              Создать отчёт
            </button>
            <button onClick={() => router.push(`/projects/${id}/integrations`)}>
              Интеграции
            </button>
          </div>

          <h3>Список отчётов:</h3>
          <ul>
            {reports.map((r) => (
              <li key={r.id}>{r.name}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>Загрузка проекта...</p>
      )}
    </div>
  );
}
