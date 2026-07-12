/**
 * ChieTask API client
 */
const API = {
  tokenKey: "chie_token",
  userKey: "chie_user",
  workspaceKey: "chie_workspace",

  getToken() {
    return localStorage.getItem(this.tokenKey);
  },

  setAuth(token, user) {
    localStorage.setItem(this.tokenKey, token);
    localStorage.setItem(this.userKey, JSON.stringify(user));
  },

  clearAuth() {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
    localStorage.removeItem(this.workspaceKey);
  },

  getUser() {
    try {
      return JSON.parse(localStorage.getItem(this.userKey) || "null");
    } catch {
      return null;
    }
  },

  getWorkspaceId() {
    const id = localStorage.getItem(this.workspaceKey);
    return id ? parseInt(id, 10) : null;
  },

  setWorkspaceId(id) {
    localStorage.setItem(this.workspaceKey, String(id));
  },

  async request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    const token = this.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(path, { ...options, headers });
    if (res.status === 401) {
      this.clearAuth();
      if (!window.location.pathname.startsWith("/login") && !window.location.pathname.startsWith("/register")) {
        window.location.href = "/login";
      }
      throw new Error("Not authenticated");
    }

    if (res.status === 204) return null;

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.detail;
      const msg = typeof detail === "string" ? detail : Array.isArray(detail)
        ? detail.map((d) => d.msg || JSON.stringify(d)).join(", ")
        : data.message || `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  },

  // Auth
  register(body) {
    return this.request("/api/auth/register", { method: "POST", body: JSON.stringify(body) });
  },
  login(body) {
    return this.request("/api/auth/login", { method: "POST", body: JSON.stringify(body) });
  },
  me() {
    return this.request("/api/auth/me");
  },
  updateProfile(body) {
    return this.request("/api/auth/me", { method: "PATCH", body: JSON.stringify(body) });
  },
  listPlans() {
    return this.request("/api/billing/plans");
  },
  async upgradePlan(plan) {
    return this.request("/api/billing/upgrade", {
      method: "POST",
      body: JSON.stringify({ plan }),
    });
  },
  createCheckoutSession(plan) {
    return this.request("/api/billing/checkout/session", {
      method: "POST",
      body: JSON.stringify({ plan }),
    });
  },
  getCheckoutSession(sessionId) {
    return this.request(`/api/billing/checkout/session/${sessionId}`);
  },
  confirmCheckout(body) {
    return this.request("/api/billing/checkout/confirm", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  async uploadAvatar(file) {
    const headers = {};
    const token = this.getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/auth/me/avatar", { method: "POST", headers, body: fd });
    if (res.status === 401) {
      this.clearAuth();
      window.location.href = "/login";
      throw new Error("Not authenticated");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.detail;
      throw new Error(
        typeof detail === "string"
          ? detail
          : data.message || `Upload failed (${res.status})`
      );
    }
    return data;
  },
  removeAvatar() {
    return this.request("/api/auth/me/avatar", { method: "DELETE" });
  },

  // Workspaces
  listWorkspaces() {
    return this.request("/api/workspaces");
  },
  createWorkspace(name) {
    return this.request("/api/workspaces", { method: "POST", body: JSON.stringify({ name }) });
  },
  listCategories(wsId) {
    return this.request(`/api/workspaces/${wsId}/categories`);
  },
  createCategory(wsId, name, color) {
    return this.request(`/api/workspaces/${wsId}/categories`, {
      method: "POST",
      body: JSON.stringify({ name, color: color || "#4f8cff" }),
    });
  },
  updateCategory(wsId, categoryId, body) {
    return this.request(`/api/workspaces/${wsId}/categories/${categoryId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },
  deleteCategory(wsId, categoryId, reassignTo) {
    const q = reassignTo ? `?reassign_to=${encodeURIComponent(reassignTo)}` : "";
    return this.request(`/api/workspaces/${wsId}/categories/${categoryId}${q}`, {
      method: "DELETE",
    });
  },
  listMembers(wsId) {
    return this.request(`/api/workspaces/${wsId}/members`);
  },
  inviteMember(wsId, email, role = "member") {
    return this.request(`/api/workspaces/${wsId}/invite`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    });
  },
  planUsage(wsId) {
    return this.request(`/api/workspaces/${wsId}/plan`);
  },

  // Tasks
  listTasks(wsId, params = {}) {
    const q = new URLSearchParams();
    if (params.completed !== undefined && params.completed !== null) q.set("completed", params.completed);
    if (params.category) q.set("category", params.category);
    if (params.priority) q.set("priority", params.priority);
    if (params.q) q.set("q", params.q);
    const qs = q.toString();
    return this.request(`/api/workspaces/${wsId}/tasks${qs ? "?" + qs : ""}`);
  },
  createTask(wsId, body) {
    return this.request(`/api/workspaces/${wsId}/tasks`, { method: "POST", body: JSON.stringify(body) });
  },
  updateTask(wsId, taskId, body) {
    return this.request(`/api/workspaces/${wsId}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },
  deleteTask(wsId, taskId) {
    return this.request(`/api/workspaces/${wsId}/tasks/${taskId}`, { method: "DELETE" });
  },
  addTime(wsId, taskId, seconds) {
    return this.request(`/api/workspaces/${wsId}/tasks/${taskId}/time`, {
      method: "POST",
      body: JSON.stringify({ seconds }),
    });
  },
  stats(wsId) {
    return this.request(`/api/workspaces/${wsId}/tasks/stats`);
  },
};
