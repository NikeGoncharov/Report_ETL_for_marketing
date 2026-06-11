import { ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { apiFetch, authApi, projectsApi } from "../lib/api";

type User = {
  id: number;
  email: string;
};

type LayoutProps = {
  children: ReactNode;
  title?: string;
};

type ReportNavItem = {
  id: number;
  name: string;
};

export default function Layout({ children, title }: LayoutProps) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [reports, setReports] = useState<ReportNavItem[]>([]);
  const [projectName, setProjectName] = useState("");

  const projectId = useMemo(() => {
    const raw = router.query.id;
    if (!raw) {
      return null;
    }
    const value = Number(Array.isArray(raw) ? raw[0] : raw);
    return Number.isFinite(value) ? value : null;
  }, [router.query.id]);

  useEffect(() => {
    let isActive = true;
    authApi.me()
      .then((data) => {
        if (isActive) {
          setUser(data);
        }
      })
      .catch(() => {
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
      })
      .finally(() => {
        if (isActive) {
          setLoading(false);
        }
      });
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const raw = window.localStorage.getItem("report.sidebar.width");
    if (!raw) {
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return;
    }
    setSidebarWidth(Math.max(220, Math.min(420, parsed)));
  }, []);

  useEffect(() => {
    async function loadProjectNavigation() {
      if (!projectId) {
        setReports([]);
        setProjectName("");
        return;
      }
      try {
        const [projectData, reportsData] = await Promise.all([
          projectsApi.get(projectId),
          apiFetch<ReportNavItem[]>(`/projects/${projectId}/reports`),
        ]);
        setProjectName(projectData?.name || "");
        setReports(reportsData || []);
      } catch {
        setProjectName("");
        setReports([]);
      }
    }
    loadProjectNavigation();
  }, [projectId]);

  async function handleLogout() {
    try {
      await authApi.logout();
    } finally {
      router.push("/login");
    }
  }

  if (loading) {
    return (
      <div className="loading" style={{ height: "100vh" }}>
        <p>Загрузка...</p>
      </div>
    );
  }

  const currentPath = router.pathname;
  const isActive = (prefix: string) => {
    if (prefix === "/dashboard") {
      return currentPath === "/dashboard";
    }
    return currentPath.startsWith(prefix);
  };

  function startSidebarResize(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMove = (moveEvent: MouseEvent) => {
      const next = Math.max(220, Math.min(420, startWidth + (moveEvent.clientX - startX)));
      setSidebarWidth(next);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("report.sidebar.width", String(next));
      }
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const currentReportId = Number(router.query.reportId);

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar" style={{ width: sidebarWidth }}>
        <Link href="/dashboard" className="sidebar-header">
          <img src="/logo-white.png" alt="RePort" className="sidebar-logo" />
        </Link>

        <nav className="sidebar-nav">
          <Link
            href="/dashboard"
            className={`sidebar-nav-item ${isActive("/dashboard") ? "active" : ""}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 10.5L12 3l9 7.5" />
              <path d="M5 9.5V21h14V9.5" />
              <path d="M10 21v-6h4v6" />
            </svg>
            Аккаунт
          </Link>

          {projectId && (
            <>
              <Link
                href={`/projects/${projectId}`}
                className={`sidebar-nav-item ${currentPath === "/projects/[id]" ? "active" : ""}`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 5h16" />
                  <path d="M4 12h16" />
                  <path d="M4 19h16" />
                </svg>
                {projectName || "Название проекта"}
              </Link>

              <div className="sidebar-subnav">
                {reports.map((report) => (
                  <Link
                    key={report.id}
                    href={`/projects/${projectId}/reports/${report.id}`}
                    className={`sidebar-subnav-item ${currentReportId === report.id ? "active" : ""}`}
                  >
                    {report.name}
                  </Link>
                ))}
                <Link
                  href={`/projects/${projectId}/reports/new`}
                  className={`sidebar-subnav-item ${currentPath.includes("/reports/new") ? "active" : ""}`}
                >
                  + Новый отчёт
                </Link>
              </div>

              <div className="sidebar-nav-item sidebar-nav-item-disabled" title="Скоро: сборщик ядра">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                  <line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
                Core Builder
                <span className="sidebar-nav-soon">скоро</span>
              </div>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleLogout} className="sidebar-nav-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
              <polyline points="16,17 21,12 16,7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Выйти
          </button>
        </div>

        <div className="sidebar-resizer" onMouseDown={startSidebarResize} />
      </aside>

      {/* Main Content */}
      <main className="main-content" style={{ marginLeft: sidebarWidth }}>
        {title && (
          <header className="main-header">
            <h1>{title}</h1>
          </header>
        )}
        <div className="main-body">
          {children}
        </div>
      </main>
    </div>
  );
}
