import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Layout from "../components/Layout";
import { projectsApi } from "../lib/api";

type Project = {
  id: number;
  name: string;
  created_at: string;
};

export default function Dashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function loadProjects() {
    try {
      const data = await projectsApi.list();
      setProjects(data);
    } catch {
      // Error handled by Layout
    } finally {
      setLoading(false);
    }
  }

  async function createProject() {
    if (!name.trim()) return;
    setCreating(true);

    try {
      await projectsApi.create(name);
      setName("");
      loadProjects();
    } catch (err) {
      alert("Ошибка создания проекта");
    } finally {
      setCreating(false);
    }
  }

  async function deleteProject(id: number, projectName: string) {
    if (!confirm(`Удалить проект "${projectName}"?`)) return;

    try {
      await projectsApi.delete(id);
      loadProjects();
    } catch (err) {
      alert("Ошибка удаления проекта");
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  return (
    <Layout title="Проекты">
      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: "var(--primary-light)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            </svg>
          </div>
          <div className="stat-card-value">{projects.length}</div>
          <div className="stat-card-label">Всего проектов</div>
        </div>
      </div>

      {/* Create Project */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-body">
          <div style={{ display: "flex", gap: 12 }}>
            <input
              className="input"
              placeholder="Название нового проекта"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createProject()}
              style={{ flex: 1 }}
            />
            <button
              className="btn btn-primary"
              onClick={createProject}
              disabled={creating || !name.trim()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              {creating ? "Создание..." : "Создать проект"}
            </button>
          </div>
        </div>
      </div>

      {/* Projects List */}
      {loading ? (
        <div className="loading">
          <p>Загрузка проектов...</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            </svg>
          </div>
          <h3>Нет проектов</h3>
          <p>Создайте первый проект, чтобы начать работу с данными</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {projects.map((project) => (
            <div key={project.id} className="project-card">
              <div className="project-card-info">
                <h3>{project.name}</h3>
                <p className="project-card-date">
                  Создан: {new Date(project.created_at).toLocaleDateString("ru-RU")}
                </p>
              </div>
              <div className="project-card-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => router.push(`/projects/${project.id}`)}
                >
                  Открыть
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => deleteProject(project.id, project.name)}
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
