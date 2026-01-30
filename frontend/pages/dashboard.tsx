import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { projectsApi, authApi } from "../lib/api";

type Project = {
  id: number;
  name: string;
  created_at: string;
};

type User = {
  id: number;
  email: string;
};

export default function Dashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function loadData() {
    try {
      const [userData, projectsData] = await Promise.all([
        authApi.me(),
        projectsApi.list(),
      ]);
      setUser(userData);
      setProjects(projectsData);
    } catch {
      router.push("/login");
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
      loadData();
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
      loadData();
    } catch (err) {
      alert("Ошибка удаления проекта");
    }
  }

  async function handleLogout() {
    try {
      await authApi.logout();
    } finally {
      router.push("/login");
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p>Загрузка...</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: 40 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 40 }}>
        <div>
          <h1 style={{ margin: 0 }}>RePort</h1>
          <p style={{ margin: "5px 0 0", color: "#666" }}>
            {user?.email}
          </p>
        </div>
        <button
          onClick={handleLogout}
          style={{
            padding: "8px 16px",
            backgroundColor: "transparent",
            border: "1px solid #ccc",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Выйти
        </button>
      </div>

      {/* Create Project */}
      <div style={{ marginBottom: 30, display: "flex", gap: 10 }}>
        <input
          placeholder="Название проекта"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createProject()}
          style={{
            flex: 1,
            padding: "10px",
            fontSize: 16,
            border: "1px solid #ccc",
            borderRadius: 4,
          }}
        />
        <button
          onClick={createProject}
          disabled={creating || !name.trim()}
          style={{
            padding: "10px 20px",
            fontSize: 16,
            backgroundColor: "#0070f3",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: creating || !name.trim() ? "not-allowed" : "pointer",
            opacity: creating || !name.trim() ? 0.7 : 1,
          }}
        >
          {creating ? "..." : "Создать проект"}
        </button>
      </div>

      {/* Projects List */}
      <h2 style={{ marginBottom: 20 }}>Проекты</h2>
      
      {projects.length === 0 ? (
        <p style={{ color: "#666" }}>
          У вас пока нет проектов. Создайте первый!
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {projects.map((project) => (
            <div
              key={project.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: 15,
                border: "1px solid #eee",
                borderRadius: 8,
                backgroundColor: "#fafafa",
              }}
            >
              <div>
                <h3 style={{ margin: 0 }}>{project.name}</h3>
                <p style={{ margin: "5px 0 0", fontSize: 12, color: "#999" }}>
                  Создан: {new Date(project.created_at).toLocaleDateString("ru-RU")}
                </p>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => router.push(`/projects/${project.id}`)}
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
                <button
                  onClick={() => deleteProject(project.id, project.name)}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "transparent",
                    color: "#ff4444",
                    border: "1px solid #ff4444",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
