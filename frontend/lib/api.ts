// In production with nginx proxy, use empty string (same origin)
// In development, use localhost:8000
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 
  (typeof window !== "undefined" && window.location.hostname !== "localhost" ? "" : "http://localhost:8000");

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
    
    // Refresh failed, redirect to login
    if (typeof window !== "undefined") {
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
