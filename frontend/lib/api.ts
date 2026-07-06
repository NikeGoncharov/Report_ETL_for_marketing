// In production with nginx proxy, use /api prefix (nginx rewrites to backend)
// In development, use localhost:8000 directly
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 
  (typeof window !== "undefined" && window.location.hostname !== "localhost" ? "/api" : "http://localhost:8000");

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  // Handle 401 - try to refresh token
  if (res.status === 401 && path !== "/login" && path !== "/refresh" && path !== "/register") {
    const refreshed = await refreshToken();
    if (refreshed) {
      // Retry the original request
      const retryRes = await fetch(`${API_URL}${path}`, {
        ...options,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });
      
      if (!retryRes.ok) {
        throw new ApiError(retryRes.status, await retryRes.text());
      }
      
      return retryRes.json();
    }
    
    // Refresh failed. Уводим на /login только со внутренних страниц:
    // на публичных (лендинг, вход, регистрация, privacy) 401 — штатная ситуация,
    // и жёсткий редирект не давал лендингу отрисоваться.
    const PUBLIC_PATHS = ["/", "/login", "/register", "/privacy"];
    if (typeof window !== "undefined" && !PUBLIC_PATHS.includes(window.location.pathname)) {
      window.location.href = "/login";
    }
    throw new ApiError(401, "Session expired");
  }

  if (!res.ok) {
    const errorText = await res.text();
    throw new ApiError(res.status, errorText);
  }

  // Handle empty responses
  const text = await res.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text);
}

async function refreshToken(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/refresh`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Helper to get full API path (for external use if needed)
export const getApiUrl = () => API_URL;

// Auth API
export const authApi = {
  register: (email: string, password: string) =>
    apiFetch("/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    apiFetch("/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  logout: () =>
    apiFetch("/logout", {
      method: "POST",
    }),

  me: () => apiFetch("/me"),
};

// Projects API
export const projectsApi = {
  list: () => apiFetch("/projects"),
  
  get: (id: number) => apiFetch(`/projects/${id}`),
  
  create: (name: string) =>
    apiFetch("/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  
  update: (id: number, name: string) =>
    apiFetch(`/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    }),
  
  delete: (id: number) =>
    apiFetch(`/projects/${id}`, {
      method: "DELETE",
    }),
};

export const reportsApi = {
  list: (projectId: number) => apiFetch(`/projects/${projectId}/reports`),
  get: (projectId: number, reportId: number) =>
    apiFetch(`/projects/${projectId}/reports/${reportId}`),
  create: (projectId: number, payload: { name: string; config: Record<string, unknown> }) =>
    apiFetch(`/projects/${projectId}/reports`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update: (
    projectId: number,
    reportId: number,
    payload: { name?: string; config?: Record<string, unknown> },
  ) =>
    apiFetch(`/projects/${projectId}/reports/${reportId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  delete: (projectId: number, reportId: number) =>
    apiFetch(`/projects/${projectId}/reports/${reportId}`, {
      method: "DELETE",
    }),
  // Превью пайплайна: stage = fetched | transformed | merged | final;
  // dataset_id — для стадий одного датасета; refresh = игнорировать кэш
  preview: (
    projectId: number,
    config: Record<string, unknown>,
    options: { stage?: string; dataset_id?: string; refresh?: boolean } = {},
  ) =>
    apiFetch(`/projects/${projectId}/reports/preview`, {
      method: "POST",
      body: JSON.stringify({ config, ...options }),
    }),
  run: (projectId: number, reportId: number) =>
    apiFetch(`/projects/${projectId}/reports/${reportId}/run`, {
      method: "POST",
    }),
  runs: (projectId: number, reportId: number) =>
    apiFetch(`/projects/${projectId}/reports/${reportId}/runs`),
};

export const catalogApi = {
  get: () => apiFetch("/reports/catalog"),
};

export const integrationsApi = {
  list: (projectId: number) => apiFetch(`/integrations/projects/${projectId}`),
  delete: (integrationId: number) =>
    apiFetch(`/integrations/${integrationId}`, { method: "DELETE" }),
  yandexAuthUrl: (projectId: number, integrationType: string) =>
    apiFetch(
      `/integrations/yandex/auth-url?project_id=${projectId}&integration_type=${integrationType}`,
    ),
  googleAuthUrl: (projectId: number) =>
    apiFetch(`/integrations/google/auth-url?project_id=${projectId}`),
};

export const directApi = {
  campaigns: (projectId: number) =>
    apiFetch(`/direct/campaigns?project_id=${projectId}`),
};

export const metrikaApi = {
  counters: (projectId: number) =>
    apiFetch(`/metrika/counters?project_id=${projectId}`),
  goals: (projectId: number, counterId: number) =>
    apiFetch(`/metrika/goals?project_id=${projectId}&counter_id=${counterId}`),
};
