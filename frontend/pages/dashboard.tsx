import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { apiFetch } from "../lib/api";

type Project = {
  id: number;
  name: string;
};

export default function Dashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");

  async function loadProjects() {
    try {
      const data = await apiFetch("/projects");
      setProjects(data);
    } catch {
      router.push("/login");
    }
  }

  async function createProject() {
    if (!name) return;

    await apiFetch("/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    });

    setName("");
    loadProjects();
  }

  useEffect(() => {
    loadProjects();
  }, []);

  return (
    <div style={{ maxWidth: 600, margin: "40px auto" }}>
      <h1>RePort Analytics</h1>

      <div style={{ marginBottom: 20 }}>
        <input
          placeholder="Название проекта"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button onClick={createProject} style={{ marginLeft: 10 }}>
          Создать проект
        </button>
      </div>

      <ul>
        {projects.map((p) => (
          <li key={p.id} style={{ marginBottom: 10 }}>
            <span style={{ marginRight: 10 }}>{p.name}</span>
            <button onClick={() => router.push(`/projects/${p.id}`)}>
              Открыть
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
