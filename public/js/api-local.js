/**
 * ChieTask MSR Web Edition — localStorage API (same interface as api.js)
 * Exact SaaS frontend experience; data stays on this browser/device only.
 * Free for all MSR workmates (unlimited plan limits).
 */
const API = {
  tokenKey: "chie_msr_token",
  userKey: "chie_msr_user",
  workspaceKey: "chie_msr_workspace",
  dbKey: "chie_msr_saas_db_v1",

  // Unlimited free for MSR
  MSR_LIMITS: {
    free: { max_tasks: 999999, max_workspaces: 999, max_members: 999 },
    pro: { max_tasks: 999999, max_workspaces: 999, max_members: 999 },
    team: { max_tasks: 999999, max_workspaces: 999, max_members: 999 },
  },

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

  _db() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.dbKey) || "null");
      if (raw && raw.users) return raw;
    } catch (_) {}
    const db = {
      users: [],
      workspaces: [],
      members: [],
      categories: [],
      tasks: [],
      seq: { user: 1, workspace: 1, category: 1, task: 1, member: 1 },
    };
    this._save(db);
    return db;
  },

  _save(db) {
    localStorage.setItem(this.dbKey, JSON.stringify(db));
  },

  _next(db, kind) {
    const n = db.seq[kind] || 1;
    db.seq[kind] = n + 1;
    return n;
  },

  _requireUser() {
    const token = this.getToken();
    if (!token || !token.startsWith("msr_")) throw Object.assign(new Error("Not authenticated"), { status: 401 });
    const userId = parseInt(token.slice(4), 10);
    const db = this._db();
    const user = db.users.find((u) => u.id === userId && u.is_active !== false);
    if (!user) {
      this.clearAuth();
      throw Object.assign(new Error("Not authenticated"), { status: 401 });
    }
    return { db, user };
  },

  _userOut(u) {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      plan: u.plan || "team",
      created_at: u.created_at,
      avatar_url: u.avatar_url || null,
    };
  },

  _defaultCategories(wsId, db) {
    const defaults = [
      ["Meetings", "#89c4e8"],
      ["Reports", "#f4d4a7"],
      ["Emails", "#b9d8e8"],
      ["Admin", "#c0c0c0"],
      ["Client", "#e895a8"],
      ["Follow-up", "#d4a7f4"],
      ["Candidates", "#a7d8f4"],
      ["Recruitment", "#f4a7d8"],
      ["Documentation", "#d8f4a7"],
      ["Dataflow", "#a7f4d8"],
      ["IT", "#b9b9e8"],
      ["General", "#7bcba3"],
    ];
    for (const [name, color] of defaults) {
      db.categories.push({
        id: this._next(db, "category"),
        workspace_id: wsId,
        name,
        color,
      });
    }
  },

  _hash(pw) {
    // Lightweight client hash (not crypto-grade; local-only MSR edition)
    let h = 2166136261;
    const s = String(pw || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return "local_" + (h >>> 0).toString(16);
  },

  async register(body) {
    const db = this._db();
    const email = String(body.email || "").toLowerCase().trim();
    const name = String(body.name || "").trim();
    const password = String(body.password || "");
    if (!email || !name || password.length < 6) throw new Error("Name, email, and password (6+ chars) required");
    if (db.users.some((u) => u.email === email)) throw new Error("Email already registered");

    const user = {
      id: this._next(db, "user"),
      email,
      name,
      hashed_password: this._hash(password),
      plan: "team", // MSR free = full access
      is_active: true,
      avatar_url: null,
      created_at: new Date().toISOString(),
    };
    db.users.push(user);

    const ws = {
      id: this._next(db, "workspace"),
      name: `${name}'s Workspace`,
      slug: "ws-" + user.id,
      owner_id: user.id,
      created_at: new Date().toISOString(),
    };
    db.workspaces.push(ws);
    db.members.push({
      id: this._next(db, "member"),
      workspace_id: ws.id,
      user_id: user.id,
      role: "owner",
    });
    this._defaultCategories(ws.id, db);
    this._save(db);

    const token = "msr_" + user.id;
    const userOut = this._userOut(user);
    this.setAuth(token, userOut);
    this.setWorkspaceId(ws.id);
    return { access_token: token, token_type: "bearer", user: userOut };
  },

  async login(body) {
    const db = this._db();
    const email = String(body.email || "").toLowerCase().trim();
    const password = String(body.password || "");
    const user = db.users.find((u) => u.email === email);
    if (!user || user.hashed_password !== this._hash(password)) {
      throw new Error("Invalid email or password");
    }
    const token = "msr_" + user.id;
    const userOut = this._userOut(user);
    this.setAuth(token, userOut);
    const memberships = db.members.filter((m) => m.user_id === user.id);
    if (memberships.length && !this.getWorkspaceId()) {
      this.setWorkspaceId(memberships[0].workspace_id);
    }
    return { access_token: token, token_type: "bearer", user: userOut };
  },

  async me() {
    const { user } = this._requireUser();
    return this._userOut(user);
  },

  async updateProfile(body) {
    const { db, user } = this._requireUser();
    if (body.name) user.name = String(body.name).trim();
    if (body.new_password) {
      if (user.hashed_password !== this._hash(body.current_password || "")) {
        throw new Error("Current password is incorrect");
      }
      if (String(body.new_password).length < 6) throw new Error("New password must be at least 6 characters");
      user.hashed_password = this._hash(body.new_password);
    }
    this._save(db);
    const out = this._userOut(user);
    localStorage.setItem(this.userKey, JSON.stringify(out));
    return out;
  },

  async listPlans() {
    const { user } = this._requireUser();
    return {
      current_plan: user.plan || "team",
      plans: [
        { id: "free", name: "MSR Free", max_tasks: 999999, max_workspaces: 999, max_members: 999, price_cents: 0, price_label: "Free for MSR" },
        { id: "pro", name: "Pro (MSR free)", max_tasks: 999999, max_workspaces: 999, max_members: 999, price_cents: 0, price_label: "Free for MSR" },
        { id: "team", name: "Team (MSR free)", max_tasks: 999999, max_workspaces: 999, max_members: 999, price_cents: 0, price_label: "Free for MSR" },
      ],
    };
  },

  async upgradePlan(plan) {
    const { db, user } = this._requireUser();
    const p = String(plan || "team").toLowerCase();
    if (!["free", "pro", "team"].includes(p)) throw new Error("Invalid plan");
    user.plan = p;
    this._save(db);
    const out = this._userOut(user);
    localStorage.setItem(this.userKey, JSON.stringify(out));
    return out;
  },

  async createCheckoutSession() {
    // No payment on MSR free edition
    throw new Error("MSR edition is free for all workmates — no payment needed.");
  },
  async getCheckoutSession() {
    throw new Error("MSR edition is free for all workmates — no payment needed.");
  },
  async confirmCheckout() {
    throw new Error("MSR edition is free for all workmates — no payment needed.");
  },

  async uploadAvatar(file) {
    const { db, user } = this._requireUser();
    if (!file) throw new Error("No file");
    if (file.size > 2 * 1024 * 1024) throw new Error("Image must be 2MB or smaller");
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("Could not read file"));
      r.readAsDataURL(file);
    });
    user.avatar_url = dataUrl;
    this._save(db);
    const out = this._userOut(user);
    localStorage.setItem(this.userKey, JSON.stringify(out));
    return out;
  },

  async removeAvatar() {
    const { db, user } = this._requireUser();
    user.avatar_url = null;
    this._save(db);
    const out = this._userOut(user);
    localStorage.setItem(this.userKey, JSON.stringify(out));
    return out;
  },

  async listWorkspaces() {
    const { db, user } = this._requireUser();
    const mids = db.members.filter((m) => m.user_id === user.id);
    return mids.map((m) => {
      const ws = db.workspaces.find((w) => w.id === m.workspace_id);
      if (!ws) return null;
      return {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        owner_id: ws.owner_id,
        role: m.role,
        created_at: ws.created_at,
      };
    }).filter(Boolean);
  },

  async createWorkspace(name) {
    const { db, user } = this._requireUser();
    const n = String(name || "").trim();
    if (!n) throw new Error("Workspace name is required");
    const ws = {
      id: this._next(db, "workspace"),
      name: n,
      slug: "ws-" + Date.now().toString(36),
      owner_id: user.id,
      created_at: new Date().toISOString(),
    };
    db.workspaces.push(ws);
    db.members.push({
      id: this._next(db, "member"),
      workspace_id: ws.id,
      user_id: user.id,
      role: "owner",
    });
    this._defaultCategories(ws.id, db);
    this._save(db);
    return {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      owner_id: ws.owner_id,
      role: "owner",
      created_at: ws.created_at,
    };
  },

  _assertMember(db, wsId, userId) {
    const m = db.members.find((x) => x.workspace_id === wsId && x.user_id === userId);
    if (!m) throw new Error("Not a member of this workspace");
    return m;
  },

  async listCategories(wsId) {
    const { db, user } = this._requireUser();
    this._assertMember(db, wsId, user.id);
    return db.categories
      .filter((c) => c.workspace_id === wsId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ id: c.id, name: c.name, color: c.color }));
  },

  async createCategory(wsId, name, color) {
    const { db, user } = this._requireUser();
    this._assertMember(db, wsId, user.id);
    const n = String(name || "").trim();
    if (!n) throw new Error("Category name is required");
    if (db.categories.some((c) => c.workspace_id === wsId && c.name === n)) {
      throw new Error("Category already exists");
    }
    const cat = {
      id: this._next(db, "category"),
      workspace_id: wsId,
      name: n,
      color: color || "#4f8cff",
    };
    db.categories.push(cat);
    this._save(db);
    return { id: cat.id, name: cat.name, color: cat.color };
  },

  async updateCategory(wsId, categoryId, body) {
    const { db, user } = this._requireUser();
    this._assertMember(db, wsId, user.id);
    const cat = db.categories.find((c) => c.id === categoryId && c.workspace_id === wsId);
    if (!cat) throw new Error("Category not found");
    const old = cat.name;
    if (body.name) {
      const n = String(body.name).trim();
      if (db.categories.some((c) => c.workspace_id === wsId && c.name === n && c.id !== categoryId)) {
        throw new Error("Another category already has that name");
      }
      cat.name = n;
      db.tasks.forEach((t) => {
        if (t.workspace_id === wsId && t.category === old) t.category = n;
      });
    }
    if (body.color) cat.color = body.color;
    this._save(db);
    return { id: cat.id, name: cat.name, color: cat.color };
  },

  async deleteCategory(wsId, categoryId, reassignTo) {
    const { db, user } = this._requireUser();
    this._assertMember(db, wsId, user.id);
    const cat = db.categories.find((c) => c.id === categoryId && c.workspace_id === wsId);
    if (!cat) throw new Error("Category not found");
    const re = reassignTo || "General";
    db.tasks.forEach((t) => {
      if (t.workspace_id === wsId && t.category === cat.name) t.category = re;
    });
    db.categories = db.categories.filter((c) => c.id !== categoryId);
    this._save(db);
    return null;
  },

  async listMembers(wsId) {
    const { db, user } = this._requireUser();
    this._assertMember(db, wsId, user.id);
    return db.members
      .filter((m) => m.workspace_id === wsId)
      .map((m) => {
        const u = db.users.find((x) => x.id === m.user_id);
        if (!u) return null;
        return { id: m.id, user_id: u.id, email: u.email, name: u.name, role: m.role };
      })
      .filter(Boolean);
  },

  async inviteMember(wsId, email) {
    const { db, user } = this._requireUser();
    this._assertMember(db, wsId, user.id);
    const invitee = db.users.find((u) => u.email === String(email).toLowerCase().trim());
    if (!invitee) throw new Error("User not found. They must register first on this browser profile.");
    if (db.members.some((m) => m.workspace_id === wsId && m.user_id === invitee.id)) {
      throw new Error("User already a member");
    }
    db.members.push({
      id: this._next(db, "member"),
      workspace_id: wsId,
      user_id: invitee.id,
      role: "member",
    });
    this._save(db);
    return {
      id: invitee.id,
      user_id: invitee.id,
      email: invitee.email,
      name: invitee.name,
      role: "member",
    };
  },

  async planUsage(wsId) {
    const { db, user } = this._requireUser();
    this._assertMember(db, wsId, user.id);
    const plan = user.plan || "team";
    const limits = this.MSR_LIMITS[plan] || this.MSR_LIMITS.team;
    return {
      plan,
      limits,
      usage: {
        tasks: db.tasks.filter((t) => t.workspace_id === wsId).length,
        workspaces: db.members.filter((m) => m.user_id === user.id).length,
        members: db.members.filter((m) => m.workspace_id === wsId).length,
      },
    };
  },

  async listTasks(wsId) {
    const { db, user } = this._requireUser();
    this._assertMember(db, wsId, user.id);
    return db.tasks
      .filter((t) => t.workspace_id === wsId)
      .slice()
      .sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(b.created_at) - new Date(a.created_at);
      });
  },

  async createTask(wsId, body) {
    const { db, user } = this._requireUser();
    this._assertMember(db, wsId, user.id);
    const text = String(body.text || "").trim();
    if (!text) throw new Error("Task text is required");
    const category = (body.category || "General").trim() || "General";
    if (!db.categories.some((c) => c.workspace_id === wsId && c.name === category)) {
      db.categories.push({
        id: this._next(db, "category"),
        workspace_id: wsId,
        name: category,
        color: "#4f8cff",
      });
    }
    const task = {
      id: this._next(db, "task"),
      workspace_id: wsId,
      created_by: user.id,
      text,
      notes: body.notes || "",
      completed: false,
      progress: body.progress || 0,
      category,
      priority: body.priority || "normal",
      due_date: body.due_date || null,
      time_spent: 0,
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.tasks.push(task);
    this._save(db);
    return { ...task };
  },

  async updateTask(wsId, taskId, body) {
    const { db, user } = this._requireUser();
    this._assertMember(db, wsId, user.id);
    const task = db.tasks.find((t) => t.id === taskId && t.workspace_id === wsId);
    if (!task) throw new Error("Task not found");
    const fields = ["text", "notes", "category", "priority", "due_date", "progress", "completed", "time_spent"];
    for (const f of fields) {
      if (body[f] !== undefined) task[f] = body[f];
    }
    if (body.category) {
      const cat = String(body.category).trim();
      task.category = cat;
      if (!db.categories.some((c) => c.workspace_id === wsId && c.name === cat)) {
        db.categories.push({
          id: this._next(db, "category"),
          workspace_id: wsId,
          name: cat,
          color: "#4f8cff",
        });
      }
    }
    if (task.completed) {
      task.progress = 100;
      task.completed_at = task.completed_at || new Date().toISOString();
    } else if (body.completed === false) {
      task.completed_at = null;
    }
    if (task.progress === 100 && !task.completed) {
      task.completed = true;
      task.completed_at = task.completed_at || new Date().toISOString();
    }
    task.updated_at = new Date().toISOString();
    this._save(db);
    return { ...task };
  },

  async deleteTask(wsId, taskId) {
    const { db, user } = this._requireUser();
    this._assertMember(db, wsId, user.id);
    db.tasks = db.tasks.filter((t) => !(t.id === taskId && t.workspace_id === wsId));
    this._save(db);
    return null;
  },

  async addTime(wsId, taskId, seconds) {
    const { db, user } = this._requireUser();
    this._assertMember(db, wsId, user.id);
    const task = db.tasks.find((t) => t.id === taskId && t.workspace_id === wsId);
    if (!task) throw new Error("Task not found");
    const add = Math.max(0, Math.min(3600, Number(seconds) || 0));
    task.time_spent = (task.time_spent || 0) + add;
    task.updated_at = new Date().toISOString();
    this._save(db);
    return { ...task };
  },

  async stats(wsId) {
    const { db, user } = this._requireUser();
    this._assertMember(db, wsId, user.id);
    const tasks = db.tasks.filter((t) => t.workspace_id === wsId);
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    const todayStr = `${y}-${m}-${d}`;
    let completed_today = 0;
    let time_today = 0;
    const by_priority = {};
    const by_category = {};
    for (const t of tasks) {
      by_priority[t.priority] = (by_priority[t.priority] || 0) + 1;
      by_category[t.category] = (by_category[t.category] || 0) + 1;
      if (t.completed && t.completed_at && String(t.completed_at).slice(0, 10) === todayStr) {
        completed_today += 1;
        time_today += t.time_spent || 0;
      } else if (!t.completed) {
        time_today += t.time_spent || 0;
      }
    }
    return {
      total: tasks.length,
      pending: tasks.filter((t) => !t.completed).length,
      completed: tasks.filter((t) => t.completed).length,
      completed_today,
      time_today_seconds: time_today,
      by_priority,
      by_category,
    };
  },
};
