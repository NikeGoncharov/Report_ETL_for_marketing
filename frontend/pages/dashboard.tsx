import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Layout from "../components/Layout";
import { projectsApi } from "../lib/api";
import { connectIntegrationPopup, oauthErrorMessage } from "../lib/oauth";
import { INTEGRATION_META } from "../lib/integrations";

type ProjectIntegration = {
  type: string;
};

type Project = {
  id: number;
  name: string;
  created_at: string;
  integrations?: ProjectIntegration[];
};

export default function Dashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Форма добавления клиента: имя + интеграции в одном месте
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  // Клиент создаётся при первом действии (интеграция или «Готово») и дальше редактируется
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    loadProjects();
  }, []);

  function openForm() {
    setFormOpen(true);
    setName("");
    setCreatedId(null);
    setTimeout(() => nameRef.current?.focus(), 0);
  }

  function closeForm() {
    setFormOpen(false);
    setName("");
    setCreatedId(null);
    setConnecting(null);
  }

  // Создаёт клиента, если ещё не создан; возвращает его id
  async function ensureProject(): Promise<number | null> {
    if (createdId !== null) return createdId;
    if (!name.trim()) {
      nameRef.current?.focus();
      return null;
    }
    setCreating(true);
    try {
      const project = await projectsApi.create(name.trim());
      setCreatedId(project.id);
      await loadProjects();
      return project.id;
    } catch {
      alert("Ошибка создания клиента");
      return null;
    } finally {
      setCreating(false);
    }
  }

  async function connectFromForm(type: string) {
    const projectId = await ensureProject();
    if (projectId === null) return;
    setConnecting(type);
    try {
      await connectIntegrationPopup(projectId, type, ({ error }) => {
        setConnecting(null);
        loadProjects();
        const msg = oauthErrorMessage(error);
        if (msg) alert(msg);
      });
    } catch {
      alert("Ошибка подключения интеграции");
      setConnecting(null);
    }
  }

  // «Готово»: создать при необходимости, подхватить правку имени, закрыть форму
  async function submitForm() {
    if (createdId === null) {
      const projectId = await ensureProject();
      if (projectId === null) return;
    } else {
      const created = projects.find((p) => p.id === createdId);
      const trimmed = name.trim();
      if (trimmed && created && created.name !== trimmed) {
        try {
          await projectsApi.update(createdId, trimmed);
          await loadProjects();
        } catch {
          alert("Ошибка сохранения названия");
          return;
        }
      }
    }
    closeForm();
  }

  async function deleteProject(id: number, projectName: string) {
    if (!confirm(`Удалить клиента "${projectName}"?`)) return;

    try {
      await projectsApi.delete(id);
      if (id === createdId) closeForm();
      loadProjects();
    } catch (err) {
      alert("Ошибка удаления клиента");
    }
  }

  const createdProject = createdId !== null ? projects.find((p) => p.id === createdId) : null;
  const connectedTypes = new Set((createdProject?.integrations || []).map((i) => i.type));

  return (
    <Layout title="Клиенты">
      {/* Добавление клиента: имя и интеграции в одной форме */}
      <div style={{ marginBottom: 24 }}>
        {!formOpen ? (
          <button className="btn btn-primary" onClick={openForm}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Добавить клиента
          </button>
        ) : (
          <div className="card client-add-card">
            <div className="card-body">
              <input
                ref={nameRef}
                className="input"
                placeholder="Название клиента"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitForm()}
              />
              <div className="client-add-ints">
                <span className="client-add-label">Интеграции:</span>
                {Object.entries(INTEGRATION_META).map(([type, meta]) => {
                  const isConnected = connectedTypes.has(type);
                  const isConnecting = connecting === type;
                  return (
                    <button
                      key={type}
                      className={`client-int-btn ${isConnected ? "connected" : ""}`}
                      style={{ "--int-color": meta.color } as React.CSSProperties}
                      onClick={() => connectFromForm(type)}
                      disabled={isConnected || isConnecting || creating}
                      title={isConnected ? "Подключено" : `Подключить ${meta.label}`}
                    >
                      <span className="client-int-dot" />
                      {meta.label}
                      {isConnecting ? "…" : isConnected ? " ✓" : ""}
                    </button>
                  );
                })}
              </div>
              <div className="client-add-actions">
                <button className="btn btn-secondary btn-sm" onClick={closeForm}>
                  {createdId === null ? "Отмена" : "Закрыть"}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={submitForm}
                  disabled={creating || (createdId === null && !name.trim())}
                >
                  {creating ? "Создание..." : createdId === null ? "Создать клиента" : "Готово"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Clients List */}
      {loading ? (
        <div className="loading">
          <p>Загрузка клиентов...</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            </svg>
          </div>
          <h3>Нет клиентов</h3>
          <p>Добавьте первого клиента, чтобы начать работу с данными</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {projects.map((project) => {
            const ints = project.integrations || [];
            return (
              <div key={project.id} className="project-card">
                <div className="project-card-info">
                  <h3>{project.name}</h3>
                  <p className="project-card-date">
                    Создан: {new Date(project.created_at).toLocaleDateString("ru-RU")}
                  </p>
                  <div className="client-ints">
                    {ints.length === 0 && <span className="client-int client-int-empty">Нет интеграций</span>}
                    {ints.map((integration) => {
                      const meta = INTEGRATION_META[integration.type];
                      return (
                        <span
                          key={integration.type}
                          className="client-int"
                          style={{ "--int-color": meta?.color || "var(--gray-400)" } as React.CSSProperties}
                        >
                          <span className="client-int-dot" />
                          {meta?.short || integration.type}
                        </span>
                      );
                    })}
                    <Link href={`/projects/${project.id}/integrations`} className="client-int-manage">
                      Настроить
                    </Link>
                  </div>
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
            );
          })}
        </div>
      )}
    </Layout>
  );
}
