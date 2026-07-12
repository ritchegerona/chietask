/**
 * ChieTask app controller
 */
(function () {
  if (!API.getToken()) {
    window.location.href = "/login";
    return;
  }

  const PALETTES = ["ocean", "aurora", "slate", "sunset"];
  const PALETTE_LABELS = {
    ocean: "Ocean",
    aurora: "Aurora",
    slate: "Slate",
    sunset: "Sunset",
  };

  const state = {
    user: API.getUser(),
    workspaces: [],
    workspaceId: API.getWorkspaceId(),
    categories: [],
    tasks: [],
    stats: null,
    view: "pending", // pending | completed | all
    filterCategory: "all",
    filterPriority: null,
    searchQuery: "",
    calDate: new Date(),
    /** Set of task ids with timers currently running (multi-timer supported) */
    activeTimers: new Set(),
    timerInterval: null,
    planUsage: null,
    selectedUpgradePlan: null,
    welcomeDismissed: false,
    welcomeLeaving: false,
  };

  function welcomeKey(wsId) {
    return `chie_welcome_dismissed_${wsId || "default"}`;
  }

  function loadWelcomeDismissed() {
    try {
      state.welcomeDismissed = sessionStorage.getItem(welcomeKey(state.workspaceId)) === "1";
    } catch {
      state.welcomeDismissed = false;
    }
  }

  function persistWelcomeDismissed() {
    state.welcomeDismissed = true;
    try {
      sessionStorage.setItem(welcomeKey(state.workspaceId), "1");
    } catch (_) {}
  }

  function applyTheme(palette, mode) {
    const p = PALETTES.includes(palette) ? palette : "ocean";
    const m = mode === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-palette", p);
    document.documentElement.setAttribute("data-mode", m);
    document.body.setAttribute("data-palette", p);
    document.body.setAttribute("data-mode", m);
    // Legacy attr used by older CSS
    if (m === "dark") document.body.setAttribute("data-theme", "dark");
    else document.body.removeAttribute("data-theme");
    localStorage.setItem("chie_palette", p);
    localStorage.setItem("chie_theme", m);
    syncThemePopover();
  }

  function loadTheme() {
    // Migrate old dark-only storage
    let palette = localStorage.getItem("chie_palette") || "ocean";
    let mode = localStorage.getItem("chie_theme") || "light";
    if (mode !== "dark" && mode !== "light") mode = "light";
    if (!PALETTES.includes(palette)) palette = "ocean";
    applyTheme(palette, mode);
  }

  function syncThemePopover() {
    const pop = $("themePopover");
    if (!pop) return;
    const palette = document.documentElement.getAttribute("data-palette") || "ocean";
    const mode = document.documentElement.getAttribute("data-mode") || "light";
    pop.querySelectorAll(".theme-option").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.palette === palette);
    });
    const lightBtn = $("themeModeLight");
    const darkBtn = $("themeModeDark");
    if (lightBtn) lightBtn.classList.toggle("active", mode === "light");
    if (darkBtn) darkBtn.classList.toggle("active", mode === "dark");
  }

  function toggleThemePopover(force) {
    const pop = $("themePopover");
    const btn = $("btnTheme");
    if (!pop) return;
    const open = force !== undefined ? force : !pop.classList.contains("open");
    pop.classList.toggle("open", open);
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) syncThemePopover();
  }

  function cyclePalette() {
    const cur = document.documentElement.getAttribute("data-palette") || "ocean";
    const idx = PALETTES.indexOf(cur);
    const next = PALETTES[(idx + 1) % PALETTES.length];
    const mode = document.documentElement.getAttribute("data-mode") || "light";
    applyTheme(next, mode);
    toast(`🎨 ${PALETTE_LABELS[next] || next}`);
  }

  function focusTaskComposer() {
    const input = $("taskInput");
    const row = $("inputRow");
    if (row) {
      row.classList.remove("pulse-focus");
      // reflow to restart animation
      void row.offsetWidth;
      row.classList.add("pulse-focus");
      setTimeout(() => row.classList.remove("pulse-focus"), 1000);
    }
    if (input) {
      input.focus();
      input.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function dismissWelcomeCard(opts = {}) {
    const { focus = true, animate = true } = opts;
    const card = document.querySelector(".empty-state-onboarding");

    const finish = () => {
      persistWelcomeDismissed();
      state.welcomeLeaving = false;
      render();
      if (focus) focusTaskComposer();
    };

    if (animate && card && !state.welcomeLeaving) {
      state.welcomeLeaving = true;
      card.classList.add("is-leaving");
      setTimeout(finish, 300);
      return;
    }

    persistWelcomeDismissed();
    render();
    if (focus) focusTaskComposer();
  }

  const DEFAULT_PLANS = [
    { id: "free", name: "Free", price: "$0/mo", blurb: "100 tasks · 1 workspace · 1 member" },
    { id: "pro", name: "Pro", price: "$9/mo", blurb: "5,000 tasks · 5 workspaces · 1 member" },
    { id: "team", name: "Team", price: "$29/mo", blurb: "50,000 tasks · 20 workspaces · 25 members" },
  ];

  const $ = (id) => document.getElementById(id);
  const on = (id, event, fn) => {
    const el = $(id);
    if (el) el.addEventListener(event, fn);
    return el;
  };
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  /** Only allow safe CSS color tokens for style attributes */
  function safeColor(c, fallback) {
    const s = String(c || "").trim();
    if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$/.test(s)) return s;
    if (/^var\(--[a-zA-Z0-9-]+\)$/.test(s)) return s;
    if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/.test(s)) return s;
    return fallback || "var(--mint)";
  }

  function toast(msg) {
    const t = $("saveToast");
    if (!t) return;
    t.textContent = msg || "✓ Saved";
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 1400);
  }

  /** Block browser autofill: readonly until user focuses the field */
  function armAntiAutofill(input) {
    if (!input) return;
    input.setAttribute("readonly", "readonly");
    const unlock = () => {
      input.removeAttribute("readonly");
    };
    input.addEventListener("focus", unlock);
    input.addEventListener("pointerdown", unlock);
  }

  function formatTime(sec) {
    sec = sec || 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s}s`;
  }

  function prioColor(p) {
    return (
      { urgent: "var(--urgent)", high: "var(--high)", normal: "var(--normal)", low: "var(--low)" }[p] ||
      "var(--normal)"
    );
  }

  function setHint(el, msg, isError) {
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("error", "success");
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
    el.classList.toggle("success", !isError);
  }

  // ── Init ──────────────────────────────────────────
  async function init() {
    loadTheme();
    try {
      state.user = await API.me();
      localStorage.setItem(API.userKey, JSON.stringify(state.user));
    } catch {
      return;
    }

    renderUser();
    await loadWorkspaces();
    loadWelcomeDismissed();
    await refreshAll();
  }

  function applyAvatarEl(el, user, sizeClass) {
    if (!el || !user) return;
    const initial = (user.name || "?").charAt(0).toUpperCase();
    el.replaceChildren();
    const url = user.avatar_url || "";
    // Only trust same-origin avatar paths we serve
    if (url && typeof url === "string" && url.startsWith("/media/avatars/") && !url.includes("..")) {
      el.classList.add("has-photo");
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.className = "avatar-img" + (sizeClass ? " " + sizeClass : "");
      img.decoding = "async";
      el.appendChild(img);
    } else {
      el.classList.remove("has-photo");
      el.textContent = initial;
    }
  }

  function renderUser() {
    const u = state.user;
    if (!u) return;
    $("userName").textContent = u.name;
    $("userPlan").textContent = (u.plan || "free") + " plan";
    applyAvatarEl($("userAvatar"), u);
  }

  async function loadWorkspaces() {
    state.workspaces = await API.listWorkspaces();
    if (!state.workspaces.length) {
      toast("No workspace found");
      return;
    }
    if (!state.workspaceId || !state.workspaces.find((w) => w.id === state.workspaceId)) {
      state.workspaceId = state.workspaces[0].id;
      API.setWorkspaceId(state.workspaceId);
    }
    const sel = $("workspaceSelect");
    sel.innerHTML = state.workspaces
      .map((w) => `<option value="${w.id}" ${w.id === state.workspaceId ? "selected" : ""}>${esc(w.name)}</option>`)
      .join("");
  }

  function isTaskCompleted(t) {
    if (!t) return false;
    return t.completed === true || t.completed === 1 || t.completed === "1" || t.completed === "true";
  }

  function normalizeTask(t) {
    if (!t || typeof t !== "object") return t;
    return {
      ...t,
      id: Number(t.id),
      workspace_id: Number(t.workspace_id),
      completed: isTaskCompleted(t),
      progress: Number(t.progress) || 0,
      time_spent: Number(t.time_spent) || 0,
      text: t.text || "",
      notes: t.notes || "",
      category: (t.category || "General").trim() || "General",
      priority: t.priority || "normal",
    };
  }

  /** Local YYYY-MM-DD (avoids UTC off-by-one hiding today's completed tasks). */
  function localDateISO(d) {
    const dt = d instanceof Date ? d : new Date(d || Date.now());
    if (Number.isNaN(dt.getTime())) return String(d || "").slice(0, 10);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function setViewTab(view) {
    state.view = view || "pending";
    document.querySelectorAll(".view-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.view === state.view);
    });
    if (state.filterCategory === "all" && !state.filterPriority) {
      const titles = { pending: "Pending tasks", completed: "Completed tasks", all: "All tasks" };
      if ($("pageTitle")) $("pageTitle").textContent = titles[state.view] || "Tasks";
    }
  }

  function getSelectedCategory() {
    const sel = $("catSelect");
    if (sel && sel.value === "__custom__") {
      return ($("catInput").value || "General").trim() || "General";
    }
    if (sel && sel.value) return sel.value;
    return ($("catInput") && $("catInput").value ? $("catInput").value : "General").trim() || "General";
  }

  /** After adding a task, show Pending and clear filters that would hide it. */
  function showTaskListForNewItem(task) {
    state.filterPriority = null;
    state.searchQuery = "";
    if ($("searchInput")) $("searchInput").value = "";
    document.querySelectorAll(".priority-filters .filter-btn").forEach((b) => b.classList.remove("active"));
    // Keep category filter only if it matches the new task; otherwise show all
    if (state.filterCategory !== "all" && task && task.category !== state.filterCategory) {
      state.filterCategory = "all";
    }
    setViewTab("pending"); // sets correct page title last
  }

  function highlightTask(id) {
    requestAnimationFrame(() => {
      const card = document.querySelector(`.task-card[data-id="${id}"]`);
      if (!card) return;
      card.classList.add("task-just-added");
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setTimeout(() => card.classList.remove("task-just-added"), 1600);
    });
  }

  async function refreshAll() {
    if (!state.workspaceId) return;
    try {
      const [cats, tasks, stats] = await Promise.all([
        API.listCategories(state.workspaceId),
        API.listTasks(state.workspaceId),
        API.stats(state.workspaceId),
      ]);
      state.categories = Array.isArray(cats) ? cats : [];
      state.tasks = (Array.isArray(tasks) ? tasks : []).map(normalizeTask);
      state.stats = stats;
      fillCategorySelects();
      renderCategoryFilters();
      render();
    } catch (e) {
      console.error("refreshAll failed", e);
      toast(e.message || "Could not refresh tasks");
      throw e;
    }
  }

  const CAT_PALETTE = ["#4f8cff", "#3dcf9a", "#f97316", "#a78bfa", "#f07178", "#45c4e6", "#f0b45a", "#94a3b8", "#ec4899", "#14b8a6"];
  let catColorCache = new Map();

  function rebuildCatColorCache() {
    catColorCache = new Map((state.categories || []).map((c) => [c.name, c.color]));
  }

  function fillCategorySelects(preferName) {
    rebuildCatColorCache();
    const cats = (state.categories || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    // Also include categories used on tasks but missing from registry
    const known = new Set(cats.map((c) => c.name));
    for (const t of state.tasks || []) {
      const n = (t.category || "").trim();
      if (n && !known.has(n)) {
        cats.push({ id: `tmp-${n}`, name: n, color: "#94a3b8" });
        known.add(n);
      }
    }
    cats.sort((a, b) => a.name.localeCompare(b.name));

    const prev = preferName || getSelectedCategory();
    const sel = $("catSelect");
    if (sel) {
      const options = cats
        .map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`)
        .join("");
      sel.innerHTML =
        options +
        `<option value="__custom__">Custom category…</option>`;
      if (prev && prev !== "__custom__" && known.has(prev)) {
        sel.value = prev;
        if ($("catInput")) {
          $("catInput").hidden = true;
          $("catInput").value = prev;
        }
      } else if (prev && !known.has(prev) && prev !== "General") {
        sel.value = "__custom__";
        if ($("catInput")) {
          $("catInput").hidden = false;
          $("catInput").value = prev;
        }
      } else {
        const preferred = cats.find((c) => c.name === "General") || cats[0];
        if (preferred) {
          sel.value = preferred.name;
          if ($("catInput")) {
            $("catInput").hidden = true;
            $("catInput").value = preferred.name;
          }
        }
      }
    }

    const editSel = $("editCatSelect");
    if (editSel) {
      // Don't wipe open edit modal selection mid-edit
      if (!$("editOverlay")?.classList.contains("open")) {
        editSel.innerHTML =
          cats.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("") +
          `<option value="__custom__">Custom category…</option>`;
      }
    }
  }

  function catColor(name) {
    if (catColorCache.has(name)) return safeColor(catColorCache.get(name));
    const c = state.categories.find((x) => x.name === name);
    return safeColor(c?.color, "var(--mint)");
  }

  function renderCategoryFilters() {
    const box = $("categoryFilters");
    let html = `<button class="filter-btn ${state.filterCategory === "all" && !state.filterPriority ? "active" : ""}" data-cat="all">
      <div class="filter-dot" style="background:var(--mint)"></div>All Tasks</button>`;
    for (const c of state.categories) {
      const col = safeColor(c.color);
      html += `<button class="filter-btn cat-filter ${state.filterCategory === c.name ? "active" : ""}" data-cat="${esc(c.name)}" data-id="${c.id}">
        <div class="filter-dot" style="background:${col}"></div>
        <span class="cat-filter-name">${esc(c.name)}</span>
      </button>`;
    }
    box.innerHTML = html;
    box.querySelectorAll(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filterCategory = btn.dataset.cat;
        state.filterPriority = null;
        document.querySelectorAll(".priority-filters .filter-btn").forEach((b) => b.classList.remove("active"));
        $("pageTitle").textContent = state.filterCategory === "all" ? "All Tasks" : state.filterCategory;
        render();
        renderCategoryFilters();
        closeSidebar();
      });
    });
  }

  // ── Category manager ──────────────────────────────
  function openCatManager() {
    renderCatManagerList();
    $("catOverlay").classList.add("open");
    $("newCatName").value = "";
    $("newCatColor").value = CAT_PALETTE[state.categories.length % CAT_PALETTE.length];
    setTimeout(() => $("newCatName").focus(), 50);
  }

  function closeCatManager() {
    $("catOverlay").classList.remove("open");
  }

  function renderCatManagerList() {
    const box = $("catManagerList");
    if (!state.categories.length) {
      box.innerHTML = '<div class="empty-state" style="padding:20px;">No categories yet — add one above</div>';
      return;
    }
    box.innerHTML = state.categories
      .map((c) => {
        const count = state.tasks.filter((t) => t.category === c.name).length;
        return `
        <div class="cat-manager-item" data-id="${c.id}">
          <input type="color" class="cat-color-input" data-id="${c.id}" value="${esc(safeColor(c.color, "#4f8cff"))}" title="Change color">
          <input type="text" class="form-control cat-name-input" data-id="${c.id}" value="${esc(c.name)}" maxlength="80">
          <span class="cat-count">${count} task${count === 1 ? "" : "s"}</span>
          <button type="button" class="btn btn-ghost btn-sm cat-save-btn" data-id="${c.id}" title="Save">Save</button>
          <button type="button" class="act-btn cat-del-btn" data-id="${c.id}" data-name="${esc(c.name)}" title="Delete">🗑</button>
        </div>`;
      })
      .join("");

    box.querySelectorAll(".cat-save-btn").forEach((btn) => {
      btn.addEventListener("click", () => saveCategoryEdits(parseInt(btn.dataset.id, 10)));
    });
    box.querySelectorAll(".cat-del-btn").forEach((btn) => {
      btn.addEventListener("click", () => deleteCategoryById(parseInt(btn.dataset.id, 10), btn.dataset.name));
    });
    box.querySelectorAll(".cat-name-input").forEach((input) => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          saveCategoryEdits(parseInt(input.dataset.id, 10));
        }
      });
    });
  }

  async function saveCategoryEdits(id) {
    const nameEl = document.querySelector(`.cat-name-input[data-id="${id}"]`);
    const colorEl = document.querySelector(`.cat-color-input[data-id="${id}"]`);
    if (!nameEl) return;
    const name = nameEl.value.trim();
    if (!name) {
      alert("Category name cannot be empty");
      return;
    }
    try {
      await API.updateCategory(state.workspaceId, id, {
        name,
        color: colorEl ? colorEl.value : undefined,
      });
      if (state.filterCategory !== "all") {
        // If we renamed the active filter, update it
        const old = state.categories.find((c) => c.id === id);
        if (old && state.filterCategory === old.name) {
          state.filterCategory = name;
          $("pageTitle").textContent = name;
        }
      }
      toast("✓ Category saved");
      await refreshAll();
      renderCatManagerList();
    } catch (e) {
      alert(e.message);
    }
  }

  async function deleteCategoryById(id, name) {
    const count = state.tasks.filter((t) => t.category === name).length;
    const msg =
      count > 0
        ? `Delete “${name}”? ${count} task(s) will move to “General”.`
        : `Delete category “${name}”?`;
    if (!confirm(msg)) return;
    try {
      await API.deleteCategory(state.workspaceId, id, "General");
      if (state.filterCategory === name) {
        state.filterCategory = "all";
        $("pageTitle").textContent = "All Tasks";
      }
      toast("✓ Category deleted");
      await refreshAll();
      renderCatManagerList();
    } catch (e) {
      alert(e.message);
    }
  }

  async function addNewCategory() {
    const name = $("newCatName").value.trim();
    if (!name) {
      $("newCatName").focus();
      return;
    }
    const color = $("newCatColor").value || "#4f8cff";
    try {
      await API.createCategory(state.workspaceId, name, color);
      $("newCatName").value = "";
      $("newCatColor").value = CAT_PALETTE[state.categories.length % CAT_PALETTE.length];
      toast("✓ Category added");
      await refreshAll();
      renderCatManagerList();
      fillCategorySelects(name);
    } catch (e) {
      alert(e.message);
    }
  }

  async function quickAddCategory() {
    const name = prompt("New category name:");
    if (!name || !name.trim()) return;
    try {
      const color = CAT_PALETTE[state.categories.length % CAT_PALETTE.length];
      const cleaned = name.trim();
      await API.createCategory(state.workspaceId, cleaned, color);
      toast("✓ Category added");
      await refreshAll();
      fillCategorySelects(cleaned);
    } catch (e) {
      alert(e.message);
    }
  }

  // ── Filtering ─────────────────────────────────────
  function getFilteredTasks() {
    let list = state.tasks.slice();
    if (state.view === "pending") list = list.filter((t) => !isTaskCompleted(t));
    else if (state.view === "completed") list = list.filter((t) => isTaskCompleted(t));
    if (state.filterCategory !== "all") list = list.filter((t) => t.category === state.filterCategory);
    if (state.filterPriority) list = list.filter((t) => t.priority === state.filterPriority);
    const q = (state.searchQuery || "").trim().toLowerCase();
    if (q) {
      list = list.filter((t) => {
        const hay = [t.text, t.notes, t.category, t.priority, t.due_date]
          .map((x) => String(x || "").toLowerCase())
          .join(" ");
        return hay.includes(q);
      });
    }
    const order = { urgent: 0, high: 1, normal: 2, low: 3 };
    list.sort((a, b) => {
      const ac = isTaskCompleted(a);
      const bc = isTaskCompleted(b);
      if (ac !== bc) return ac ? 1 : -1;
      if (state.view === "completed") {
        // Newest completions first
        const at = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const bt = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        return bt - at;
      }
      return (order[a.priority] || 2) - (order[b.priority] || 2);
    });
    return list;
  }

  function renderEmptyState(filtered) {
    const hasAnyTasks = state.tasks.length > 0;
    const completedCount = state.tasks.filter(isTaskCompleted).length;
    const hasSearch = !!(state.searchQuery || "").trim();

    // Welcome only for truly empty workspaces that haven't dismissed onboarding
    if (!hasAnyTasks) {
      if (state.welcomeDismissed) {
        return `
          <div class="empty-state empty-compose">
            <div class="empty-icon" style="font-size:28px;margin-bottom:8px;animation:none;">✍️</div>
            <p>Type a task above and press <strong>Enter</strong> — or <kbd>N</kbd> to focus</p>
          </div>`;
      }
      return `
        <div class="empty-state empty-state-onboarding" id="welcomeCard">
          <button type="button" class="empty-dismiss" id="emptyDismiss" title="Dismiss" aria-label="Dismiss welcome">×</button>
          <div class="empty-icon">✨</div>
          <h3>Welcome to ChieTask</h3>
          <p>Your workspace is ready. Capture work, track time, and ship progress.</p>
          <ul class="empty-tips">
            <li><strong>Add a task</strong> in the bar above — press <kbd>N</kbd> anytime</li>
            <li><strong>Timers start automatically</strong> when you add a task</li>
            <li><strong>Invite teammates</strong> from the sidebar when you’re ready</li>
            <li><strong>Upgrade</strong> in Settings for more tasks or workspaces</li>
          </ul>
          <div class="empty-actions">
            <button type="button" class="btn btn-primary" id="emptyAddFocus">Add your first task</button>
            <button type="button" class="btn btn-ghost" id="emptySkip">Skip for now</button>
          </div>
        </div>`;
    }

    if (state.view === "completed" && completedCount === 0 && !hasSearch && state.filterCategory === "all" && !state.filterPriority) {
      return `<div class="empty-state"><div class="empty-icon" style="font-size:28px;animation:none;">✅</div><p>No completed tasks yet — check one off to see it here</p></div>`;
    }

    if (hasSearch) {
      return `<div class="empty-state">No tasks match “${esc(state.searchQuery.trim())}”</div>`;
    }

    if (state.view === "completed") {
      return `<div class="empty-state">No completed tasks match these filters</div>`;
    }

    if (state.filterCategory !== "all" || state.filterPriority) {
      return `<div class="empty-state">No tasks match these filters — try <strong>All Tasks</strong></div>`;
    }

    return `<div class="empty-state">No pending tasks — nice work 🎉</div>`;
  }

  function bindEmptyStateActions() {
    const focusBtn = $("emptyAddFocus");
    if (focusBtn) {
      focusBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dismissWelcomeCard({ focus: true, animate: true });
      });
    }
    const skipBtn = $("emptySkip");
    if (skipBtn) {
      skipBtn.addEventListener("click", (e) => {
        e.preventDefault();
        dismissWelcomeCard({ focus: false, animate: true });
      });
    }
    const dismissBtn = $("emptyDismiss");
    if (dismissBtn) {
      dismissBtn.addEventListener("click", (e) => {
        e.preventDefault();
        dismissWelcomeCard({ focus: false, animate: true });
      });
    }
  }

  // ── Render ────────────────────────────────────────
  function render() {
    const filtered = getFilteredTasks();
    const list = $("taskList");

    if (!filtered.length) {
      list.innerHTML = renderEmptyState(filtered);
      bindEmptyStateActions();
    } else {
      // Build once (faster than string += in a loop for large lists)
      const parts = new Array(filtered.length);
      for (let i = 0; i < filtered.length; i++) {
        const t = filtered[i];
        const done = isTaskCompleted(t);
        const running = isTimerRunning(t.id);
        const color = safeColor(catColor(t.category));
        parts[i] = `
          <div class="task-card priority-${esc(t.priority)} ${done ? "completed" : ""}${running ? " is-timing" : ""}" data-id="${t.id}">
            <div class="task-row">
              <input type="checkbox" class="task-check" ${done ? "checked" : ""} data-id="${t.id}" aria-label="Mark complete">
              <div class="task-info">
                <div class="task-name">${esc(t.text)}</div>
                <div class="task-meta">
                  <span class="tag tag-cat" style="border-color:${color};color:${color}">${esc(t.category)}</span>
                  <span class="tag tag-priority" style="background:${prioColor(t.priority)}">${esc(t.priority)}</span>
                  ${t.due_date ? `<span class="tag tag-due">📅 ${esc(t.due_date)}</span>` : ""}
                  ${running ? `<span class="tag tag-live">● LIVE</span>` : ""}
                </div>
              </div>
              <div class="timer-display${running ? " running" : ""}" id="timer-${t.id}">${formatTime(t.time_spent)}</div>
              ${
                !done
                  ? `<button class="timer-btn ${running ? "running" : ""}" data-action="timer" data-id="${t.id}" title="${running ? "Pause timer" : "Start timer"}">${running ? "⏸" : "▶"}</button>`
                  : `<span class="done-badge" title="Completed">Done</span>`
              }
              <div class="task-actions">
                <button class="edit-btn" data-action="edit" data-id="${t.id}" title="Edit">✏️</button>
                <button class="act-btn" data-action="delete" data-id="${t.id}" title="Delete">🗑</button>
              </div>
            </div>
            <div class="progress-row">
              <div class="progress-bar"><div class="progress-fill" style="width:${t.progress}%;background:${prioColor(t.priority)}"></div></div>
              <span class="progress-label">${t.progress}%</span>
              ${
                !done
                  ? `<button class="timer-btn" data-action="progress" data-id="${t.id}" data-delta="-10" style="padding:2px 6px;font-size:9px;">-</button>
                     <button class="timer-btn" data-action="progress" data-id="${t.id}" data-delta="10" style="padding:2px 6px;font-size:9px;">+</button>`
                  : ""
              }
            </div>
          </div>`;
      }
      list.innerHTML = parts.join("");
    }

    // Stats
    if (state.stats) {
      $("todayHours").textContent = formatTime(state.stats.time_today_seconds);
      $("todayDone").textContent = state.stats.completed_today;
      $("sidebarPending").textContent = state.stats.pending;
    }

    renderWorkLog();
    renderCalendar();
  }

  function renderWorkLog() {
    const today = localDateISO();
    // Completed today + any in-progress tasks with time (so auto-timer appears in Logs)
    const items = state.tasks
      .filter((t) => {
        const secs = t.time_spent || 0;
        const running = isTimerRunning(t.id);
        if (isTaskCompleted(t)) {
          if (!t.completed_at && secs <= 0) return false;
          if (t.completed_at) return localDateISO(t.completed_at) === today;
          return secs > 0;
        }
        return running || secs > 0;
      })
      .sort((a, b) => {
        const ar = isTimerRunning(a.id) ? 1 : 0;
        const br = isTimerRunning(b.id) ? 1 : 0;
        if (ar !== br) return br - ar;
        return (b.time_spent || 0) - (a.time_spent || 0);
      });

    $("workLog").innerHTML = items.length
      ? items
          .map((t) => {
            const running = isTimerRunning(t.id);
            const status = isTaskCompleted(t) ? "done" : running ? "live" : "active";
            return `
        <div class="work-log-item ${status}">
          <span class="wl-text">${running ? "● " : isTaskCompleted(t) ? "✓ " : ""}${esc(t.text)}</span>
          <span class="wl-time" id="wlog-time-${t.id}">${formatTime(t.time_spent || 0)}</span>
        </div>`;
          })
          .join("")
      : '<div style="color:var(--text-light);font-size:12px;font-style:italic;padding:10px 0;">No timed work yet today — add a task to start tracking</div>';
  }

  function renderCalendar() {
    const y = state.calDate.getFullYear();
    const m = state.calDate.getMonth();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    $("calTitle").textContent = `${months[m]} ${y}`;
    const fd = new Date(y, m, 1).getDay();
    const dim = new Date(y, m + 1, 0).getDate();
    const today = new Date();
    let html = ["S", "M", "T", "W", "T", "F", "S"].map((d) => `<div class="cal-hdr">${d}</div>`).join("");
    for (let i = 0; i < fd; i++) html += "<div></div>";
    for (let d = 1; d <= dim; d++) {
      const isT = today.getDate() === d && today.getMonth() === m && today.getFullYear() === y;
      html += `<div class="cal-day${isT ? " today" : ""}">${d}</div>`;
    }
    $("calGrid").innerHTML = html;
  }

  // ── Mobile sidebar ────────────────────────────────
  function openSidebar() {
    document.body.classList.add("sidebar-open");
  }

  function closeSidebar() {
    document.body.classList.remove("sidebar-open");
  }

  function toggleSidebar() {
    document.body.classList.toggle("sidebar-open");
  }

  // ── Settings ──────────────────────────────────────
  function openSettings(tab) {
    const u = state.user;
    if (!u) return;
    $("settingsDisplayName").textContent = u.name || "—";
    $("settingsEmail").textContent = u.email || "—";
    $("settingsPlanBadge").textContent = u.plan || "free";
    applyAvatarEl($("settingsAvatar"), u);
    $("settingsName").value = u.name || "";
    $("settingsEmailReadonly").value = u.email || "";
    $("settingsCurrentPw").value = "";
    $("settingsNewPw").value = "";
    $("settingsConfirmPw").value = "";
    setHint($("settingsProfileMsg"), "");
    setHint($("settingsPasswordMsg"), "");
    setHint($("settingsUpgradeMsg"), "");
    state.selectedUpgradePlan = null;
    switchSettingsTab(tab || "profile");
    $("settingsOverlay").classList.add("open");
    loadPlanUsage();
    renderPlanOptions();
  }

  async function onAvatarSelected(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setHint($("settingsProfileMsg"), "Image must be 2MB or smaller.", true);
      return;
    }
    setHint($("settingsProfileMsg"), "Uploading photo…");
    try {
      const user = await API.uploadAvatar(file);
      state.user = { ...state.user, ...user };
      localStorage.setItem(API.userKey, JSON.stringify(state.user));
      renderUser();
      applyAvatarEl($("settingsAvatar"), state.user);
      setHint($("settingsProfileMsg"), "Profile photo updated.", false);
      toast("✓ Photo updated");
    } catch (e) {
      setHint($("settingsProfileMsg"), e.message || "Upload failed", true);
    }
  }

  function closeSettings() {
    $("settingsOverlay").classList.remove("open");
  }

  function switchSettingsTab(tab) {
    document.querySelectorAll(".settings-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    $("settingsPanelProfile").classList.toggle("active", tab === "profile");
    $("settingsPanelSecurity").classList.toggle("active", tab === "security");
    $("settingsPanelPlan").classList.toggle("active", tab === "plan");
  }

  function usageBar(used, max) {
    const limit = max == null || max < 0 ? null : max;
    const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    const label = limit == null ? `${used} / ∞` : `${used} / ${limit}`;
    const warn = limit && used / limit >= 0.85;
    return `
      <div class="usage-row">
        <div class="usage-meta"><span>${label}</span><span>${limit ? pct + "%" : ""}</span></div>
        <div class="usage-track"><div class="usage-fill${warn ? " warn" : ""}" style="width:${limit ? pct : 8}%"></div></div>
      </div>`;
  }

  async function loadPlanUsage() {
    const card = $("usageCard");
    if (!state.workspaceId) {
      card.innerHTML = '<div class="usage-loading">No workspace selected</div>';
      return;
    }
    card.innerHTML = '<div class="usage-loading">Loading usage…</div>';
    try {
      const data = await API.planUsage(state.workspaceId);
      state.planUsage = data;
      const limits = data.limits || {};
      const usage = data.usage || {};
      card.innerHTML = `
        <div class="usage-header">
          <span>Current plan</span>
          <strong class="settings-plan-badge">${esc(data.plan || state.user?.plan || "free")}</strong>
        </div>
        <div class="usage-metric">
          <div class="usage-label">Tasks</div>
          ${usageBar(usage.tasks ?? 0, limits.max_tasks)}
        </div>
        <div class="usage-metric">
          <div class="usage-label">Workspaces</div>
          ${usageBar(usage.workspaces ?? 0, limits.max_workspaces)}
        </div>
        <div class="usage-metric">
          <div class="usage-label">Members (this workspace)</div>
          ${usageBar(usage.members ?? 0, limits.max_members)}
        </div>`;
      highlightCurrentPlan(data.plan || state.user?.plan);
    } catch (e) {
      card.innerHTML = `<div class="usage-loading error">Could not load usage: ${esc(e.message)}</div>`;
    }
  }

  function highlightCurrentPlan(plan) {
    document.querySelectorAll(".plan-option").forEach((btn) => {
      const isCurrent = btn.dataset.plan === plan;
      btn.classList.toggle("current", isCurrent);
      btn.classList.toggle("selected", btn.dataset.plan === state.selectedUpgradePlan);
    });
    updateUpgradeButton();
  }

  function normalizePlanList(plans) {
    const defaultsById = Object.fromEntries(DEFAULT_PLANS.map((d) => [d.id, d]));
    return (plans || []).map((p) => {
      const id = p.id || p.plan || String(p.name || "").toLowerCase();
      const fallback = defaultsById[id] || {};
      const name = p.name || fallback.name || id;
      const price = p.price || fallback.price || "";
      let blurb = p.blurb || p.description || "";
      if (!blurb && (p.max_tasks != null || p.max_workspaces != null)) {
        blurb = [
          p.max_tasks != null ? `${Number(p.max_tasks).toLocaleString()} tasks` : null,
          p.max_workspaces != null ? `${p.max_workspaces} workspaces` : null,
          p.max_members != null ? `${p.max_members} members` : null,
        ]
          .filter(Boolean)
          .join(" · ");
      }
      if (!blurb) blurb = fallback.blurb || "";
      return { id, name, price, blurb };
    });
  }

  function renderPlanOptions(plans, { fromApi } = {}) {
    const box = $("planOptions");
    const list = plans && plans.length ? normalizePlanList(plans) : DEFAULT_PLANS;
    box.innerHTML = list
      .map(
        (p) => `
          <button type="button" class="plan-option" data-plan="${esc(p.id)}">
            <strong>${esc(p.name)}${p.price ? ` · ${esc(p.price)}` : ""}</strong>
            <span>${esc(p.blurb)}</span>
          </button>`
      )
      .join("");

    box.querySelectorAll(".plan-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedUpgradePlan = btn.dataset.plan;
        document.querySelectorAll(".plan-option").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        updateUpgradeButton();
        setHint($("settingsUpgradeMsg"), "");
      });
    });

    highlightCurrentPlan(state.planUsage?.plan || state.user?.plan);
    if (!fromApi) tryLoadPlansFromApi();
  }

  async function tryLoadPlansFromApi() {
    try {
      const data = await API.listPlans();
      const plans = Array.isArray(data) ? data : data?.plans;
      if (plans && plans.length) {
        if (data?.current_plan && state.user) {
          state.user.plan = data.current_plan;
        }
        renderPlanOptions(plans, { fromApi: true });
      }
    } catch (_) {
      // Keep default plan cards when billing API is not available
    }
  }

  function updateUpgradeButton() {
    const btn = $("settingsUpgradeBtn");
    if (!btn) return;
    const current = (state.planUsage?.plan || state.user?.plan || "free").toLowerCase();
    const selected = state.selectedUpgradePlan;
    btn.disabled = !selected || selected === current;
    if (!selected) btn.textContent = "Continue to payment";
    else if (selected === current) btn.textContent = "Current plan";
    else if (selected === "free") btn.textContent = "Switch to Free";
    else btn.textContent = `Pay for ${selected.charAt(0).toUpperCase() + selected.slice(1)}`;
  }

  async function saveProfile() {
    const name = $("settingsName").value.trim();
    if (!name) {
      setHint($("settingsProfileMsg"), "Display name is required.", true);
      return;
    }
    try {
      const updated = await API.updateProfile({ name });
      state.user = { ...state.user, ...(updated || {}), name };
      localStorage.setItem(API.userKey, JSON.stringify(state.user));
      renderUser();
      $("settingsDisplayName").textContent = state.user.name;
      applyAvatarEl($("settingsAvatar"), state.user);
      setHint($("settingsProfileMsg"), "Name updated.", false);
      toast("✓ Profile saved");
    } catch (e) {
      const msg =
        e.message && e.message.includes("404")
          ? "Profile updates are not available on this server yet."
          : e.message;
      setHint($("settingsProfileMsg"), msg, true);
    }
  }

  async function savePassword() {
    const current_password = $("settingsCurrentPw").value;
    const new_password = $("settingsNewPw").value;
    const confirm = $("settingsConfirmPw").value;
    if (!current_password || !new_password) {
      setHint($("settingsPasswordMsg"), "Enter current and new passwords.", true);
      return;
    }
    if (new_password.length < 6) {
      setHint($("settingsPasswordMsg"), "New password must be at least 6 characters.", true);
      return;
    }
    if (new_password !== confirm) {
      setHint($("settingsPasswordMsg"), "New passwords do not match.", true);
      return;
    }
    try {
      await API.updateProfile({ current_password, new_password });
      $("settingsCurrentPw").value = "";
      $("settingsNewPw").value = "";
      $("settingsConfirmPw").value = "";
      setHint($("settingsPasswordMsg"), "Password updated.", false);
      toast("✓ Password updated");
    } catch (e) {
      const msg =
        e.message && e.message.includes("404")
          ? "Password change is not available on this server yet."
          : e.message;
      setHint($("settingsPasswordMsg"), msg, true);
    }
  }

  async function doUpgrade() {
    const plan = state.selectedUpgradePlan;
    if (!plan) return;
    const btn = $("settingsUpgradeBtn");
    btn.disabled = true;
    setHint($("settingsUpgradeMsg"), "");
    try {
      // Free / same plan: direct update. Paid: payment dashboard.
      if (plan === "free" || plan === state.user?.plan) {
        const result = await API.upgradePlan(plan);
        state.user = { ...state.user, ...(result || {}), plan: result?.plan || plan };
        localStorage.setItem(API.userKey, JSON.stringify(state.user));
        renderUser();
        $("settingsPlanBadge").textContent = state.user.plan || plan;
        setHint($("settingsUpgradeMsg"), `You're on the ${state.user.plan || plan} plan.`, false);
        toast("✓ Plan updated");
        state.selectedUpgradePlan = null;
        await loadPlanUsage();
        highlightCurrentPlan(state.user.plan);
        return;
      }
      setHint($("settingsUpgradeMsg"), "Redirecting to payment…", false);
      const session = await API.createCheckoutSession(plan);
      window.location.href = session.checkout_url || `/checkout?session=${session.session_id}&plan=${plan}`;
    } catch (e) {
      const msg = String(e.message || "");
      // Only auto-open checkout when payment is explicitly required
      if (/payment required|402/i.test(msg)) {
        window.location.href = `/checkout?plan=${encodeURIComponent(plan)}`;
        return;
      }
      setHint($("settingsUpgradeMsg"), msg || "Upgrade failed.", true);
    } finally {
      updateUpgradeButton();
    }
  }

  // ── Actions ───────────────────────────────────────
  async function addTask() {
    const text = $("taskInput").value.trim();
    if (!text) return;
    if (!state.workspaceId) {
      toast("No workspace selected");
      return;
    }
    const category = getSelectedCategory();
    const priority = $("prioInput").value || "normal";
    const due_date = $("dueInput").value || null;
    const btn = $("addBtn");
    if (btn) btn.disabled = true;
    try {
      const created = normalizeTask(
        await API.createTask(state.workspaceId, {
          text,
          category,
          priority,
          due_date,
        })
      );
      $("taskInput").value = "";
      $("dueInput").value = "";
      persistWelcomeDismissed();
      showTaskListForNewItem(created);
      if (created && created.id != null) {
        // Merge without full refresh (preserves running timer seconds)
        state.tasks = [created, ...state.tasks.filter((t) => t.id !== created.id)];
        try {
          state.categories = await API.listCategories(state.workspaceId);
        } catch (_) {}
        fillCategorySelects(category);
        renderCategoryFilters();
        render();
        highlightTask(created.id);
        startTimer(created.id, { silent: true });
        // Soft stats refresh only
        try {
          state.stats = await API.stats(state.workspaceId);
          if (state.stats) {
            $("todayHours").textContent = formatTime(state.stats.time_today_seconds);
            $("todayDone").textContent = state.stats.completed_today;
            $("sidebarPending").textContent = state.stats.pending;
          }
        } catch (_) {}
      }
      toast("✓ Task added · timer running");
    } catch (e) {
      alert(e.message || "Failed to add task");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function toggleTask(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    const makingComplete = !isTaskCompleted(t);
    if (isTimerRunning(id)) await stopTimer(id, true);
    try {
      const updated = normalizeTask(
        await API.updateTask(state.workspaceId, id, { completed: makingComplete })
      );
      // Stay on the current tab — do not jump to Done (avoids dumping the full completed list)
      state.tasks = state.tasks.map((x) => (x.id === id ? { ...x, ...updated } : x));
      if (makingComplete) {
        toast("✓ Completed");
      } else {
        toast("✓ Reopened");
        // If user reopens from Done tab, keep them on Done or switch to Pending if empty filter
        if (state.view === "completed") {
          // leave view as-is; task will disappear from Done list
        }
      }
      // Soft stats update without full list thrash when possible
      try {
        state.stats = await API.stats(state.workspaceId);
      } catch (_) {}
      render();
    } catch (e) {
      alert(e.message);
    }
  }

  async function deleteTask(id) {
    if (!confirm("Delete this task?")) return;
    if (isTimerRunning(id)) await stopTimer(id, true);
    try {
      await API.deleteTask(state.workspaceId, id);
      toast("✓ Deleted");
      await refreshAll();
    } catch (e) {
      alert(e.message);
    }
  }

  async function updateProgress(id, delta) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t || t.completed) return;
    const progress = Math.max(0, Math.min(100, (t.progress || 0) + delta));
    try {
      await API.updateTask(state.workspaceId, id, { progress });
      await refreshAll();
    } catch (e) {
      alert(e.message);
    }
  }

  function openEdit(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    $("editId").value = t.id;
    $("editText").value = t.text;
    fillCategorySelects(t.category || "General");
    const editSel = $("editCatSelect");
    const editCustom = $("editCat");
    const cat = t.category || "General";
    if (editSel) {
      const names = new Set((state.categories || []).map((c) => c.name));
      if (names.has(cat)) {
        editSel.value = cat;
        if (editCustom) {
          editCustom.hidden = true;
          editCustom.value = cat;
        }
      } else {
        editSel.value = "__custom__";
        if (editCustom) {
          editCustom.hidden = false;
          editCustom.value = cat;
        }
      }
    }
    $("editPrio").value = t.priority || "normal";
    $("editDue").value = t.due_date || "";
    $("editProgress").value = t.progress || 0;
    $("editNotes").value = t.notes || "";
    $("editOverlay").classList.add("open");
  }

  function closeEdit() {
    $("editOverlay").classList.remove("open");
  }

  async function saveEdit() {
    const id = parseInt($("editId").value, 10);
    const editSel = $("editCatSelect");
    let category = "General";
    if (editSel && editSel.value === "__custom__") {
      category = ($("editCat").value || "General").trim() || "General";
    } else if (editSel && editSel.value) {
      category = editSel.value;
    } else {
      category = ($("editCat").value || "General").trim() || "General";
    }
    try {
      await API.updateTask(state.workspaceId, id, {
        text: $("editText").value.trim(),
        category,
        priority: $("editPrio").value,
        due_date: $("editDue").value || null,
        progress: Math.max(0, Math.min(100, parseInt($("editProgress").value, 10) || 0)),
        notes: $("editNotes").value,
      });
      closeEdit();
      toast("✓ Saved");
      await refreshAll();
    } catch (e) {
      alert(e.message);
    }
  }

  // ── Timer (multiple tasks can run at once) ─────────
  function isTimerRunning(id) {
    return state.activeTimers.has(Number(id));
  }

  function toggleTimer(id) {
    id = Number(id);
    if (isTimerRunning(id)) stopTimer(id);
    else startTimer(id);
  }

  function ensureTimerLoop() {
    if (state.timerInterval) return;
    // One shared tick drives every running timer
    state.timerInterval = setInterval(() => {
      if (!state.activeTimers.size) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
        return;
      }
      let anyLive = false;
      let tickStats = 0;
      for (const id of [...state.activeTimers]) {
        const t = state.tasks.find((x) => x.id === id);
        if (!t || isTaskCompleted(t)) {
          state.activeTimers.delete(id);
          continue;
        }
        anyLive = true;
        t.time_spent = (t.time_spent || 0) + 1;
        tickStats += 1;
        const el = document.getElementById(`timer-${id}`);
        if (el) el.textContent = formatTime(t.time_spent);
        const wlog = document.getElementById(`wlog-time-${id}`);
        if (wlog) wlog.textContent = formatTime(t.time_spent);
        // Persist each running timer every 15s
        if ((t.time_spent || 0) % 15 === 0) {
          API.addTime(state.workspaceId, id, 15).catch(() => {});
        }
      }
      if (state.stats && tickStats) {
        state.stats.time_today_seconds = (state.stats.time_today_seconds || 0) + tickStats;
        const th = $("todayHours");
        if (th) th.textContent = formatTime(state.stats.time_today_seconds);
      }
      // Occasional work-log refresh while any timer runs
      if (anyLive && Date.now() % 5000 < 1100) renderWorkLog();
      if (!state.activeTimers.size) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
        render();
      }
    }, 1000);
  }

  function startTimer(id, opts = {}) {
    const { silent = false } = opts;
    id = Number(id);
    const t = state.tasks.find((x) => x.id === id);
    if (!t || isTaskCompleted(t)) return;
    if (state.activeTimers.has(id)) return;
    state.activeTimers.add(id);
    ensureTimerLoop();
    if (!silent) {
      const n = state.activeTimers.size;
      toast(n > 1 ? `⏱ ${n} timers running` : "⏱ Timer running");
    }
    render(); // LIVE badges / pause buttons
  }

  /**
   * Stop one timer, or all if id is omitted.
   * stopTimer(id, skipRender) | stopTimer(skipRender) for stop-all (legacy bool)
   */
  async function stopTimer(idOrSkip, maybeSkip) {
    let ids = [];
    let skipRender = false;
    if (typeof idOrSkip === "boolean" || idOrSkip === undefined) {
      // stop all: stopTimer() or stopTimer(true)
      skipRender = !!idOrSkip;
      ids = [...state.activeTimers];
    } else {
      ids = [Number(idOrSkip)];
      skipRender = !!maybeSkip;
    }

    for (const id of ids) {
      if (!state.activeTimers.has(id)) continue;
      state.activeTimers.delete(id);
      const t = state.tasks.find((x) => x.id === id);
      if (t) {
        try {
          await API.updateTask(state.workspaceId, id, { time_spent: t.time_spent || 0 });
        } catch (_) {
          const rem = (t.time_spent || 0) % 15;
          if (rem > 0) {
            try {
              await API.addTime(state.workspaceId, id, rem);
            } catch (__) {}
          }
        }
      }
    }

    if (!state.activeTimers.size && state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }

    if (!skipRender) {
      toast(ids.length > 1 ? "⏱ Timers saved" : "⏱ Timer saved");
      await refreshAll();
    } else {
      renderWorkLog();
      render();
    }
  }

  async function stopAllTimers(skipRender) {
    return stopTimer(!!skipRender);
  }

  // ── Export ────────────────────────────────────────
  function exportCSV() {
    const headers = ["Task", "Category", "Priority", "Status", "Progress", "Time Spent", "Due Date", "Completed", "Created"];
    const rows = state.tasks.map((t) => [
      `"${(t.text || "").replace(/"/g, '""')}"`,
      t.category,
      t.priority,
      t.completed ? "Done" : "Pending",
      t.progress,
      formatTime(t.time_spent || 0),
      t.due_date || "",
      t.completed_at || "",
      t.created_at || "",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chietask_report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Workspace / Invite ────────────────────────────
  async function onWorkspaceChange() {
    if (state.activeTimers.size) await stopAllTimers(true);
    state.workspaceId = parseInt($("workspaceSelect").value, 10);
    API.setWorkspaceId(state.workspaceId);
    state.filterCategory = "all";
    state.filterPriority = null;
    loadWelcomeDismissed();
    await refreshAll();
  }

  async function createWorkspace() {
    const name = prompt("New workspace name:");
    if (!name || !name.trim()) return;
    try {
      if (state.activeTimers.size) await stopAllTimers(true);
      const ws = await API.createWorkspace(name.trim());
      await loadWorkspaces();
      state.workspaceId = ws.id;
      API.setWorkspaceId(ws.id);
      $("workspaceSelect").value = ws.id;
      state.filterCategory = "all";
      state.filterPriority = null;
      loadWelcomeDismissed();
      await refreshAll();
      toast("✓ Workspace created");
    } catch (e) {
      alert(e.message);
    }
  }

  async function inviteMember() {
    const email = prompt("Invite user by email (they must already have an account):");
    if (!email) return;
    try {
      await API.inviteMember(state.workspaceId, email.trim());
      toast("✓ Member invited");
    } catch (e) {
      alert(e.message);
    }
  }

  async function logout() {
    try {
      if (state.activeTimers.size) await stopAllTimers(true);
    } catch (_) {}
    API.clearAuth();
    window.location.href = "/login";
  }

  function flushActiveTimerKeepalive() {
    if (!state.activeTimers.size || !state.workspaceId) return;
    const token = API.getToken();
    if (!token) return;
    for (const id of state.activeTimers) {
      const t = state.tasks.find((x) => x.id === id);
      if (!t) continue;
      const rem = (t.time_spent || 0) % 15;
      if (rem <= 0) continue;
      try {
        fetch(`/api/workspaces/${state.workspaceId}/tasks/${t.id}/time`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ seconds: rem }),
          keepalive: true,
        }).catch(() => {});
      } catch (_) {}
    }
  }

  // ── Event wiring ──────────────────────────────────
  $("taskList").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = parseInt(btn.dataset.id, 10);
    const action = btn.dataset.action;
    if (action === "delete") deleteTask(id);
    else if (action === "edit") openEdit(id);
    else if (action === "timer") toggleTimer(id);
    else if (action === "progress") updateProgress(id, parseInt(btn.dataset.delta, 10));
  });

  $("taskList").addEventListener("change", (e) => {
    if (e.target.matches(".task-check")) {
      toggleTask(parseInt(e.target.dataset.id, 10));
    }
  });

  $("addBtn").addEventListener("click", addTask);
  $("taskInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") addTask();
  });

  // Debounced search (fewer re-renders while typing)
  let searchTimer = null;
  $("searchInput").addEventListener("input", () => {
    state.searchQuery = $("searchInput").value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => render(), 120);
  });

  document.querySelectorAll(".view-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      setViewTab(tab.dataset.view);
      render();
    });
  });

  // Category dropdown: list all categories + custom entry
  if ($("catSelect")) {
    $("catSelect").addEventListener("change", () => {
      const custom = $("catInput");
      if ($("catSelect").value === "__custom__") {
        if (custom) {
          custom.hidden = false;
          custom.value = "";
          custom.focus();
        }
      } else if (custom) {
        custom.hidden = true;
        custom.value = $("catSelect").value;
      }
    });
  }
  if ($("editCatSelect")) {
    $("editCatSelect").addEventListener("change", () => {
      const custom = $("editCat");
      if ($("editCatSelect").value === "__custom__") {
        if (custom) {
          custom.hidden = false;
          custom.focus();
        }
      } else if (custom) {
        custom.hidden = true;
        custom.value = $("editCatSelect").value;
      }
    });
  }

  document.querySelectorAll(".priority-filters .filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filterPriority = btn.dataset.prio;
      state.filterCategory = "all";
      document.querySelectorAll(".priority-filters .filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $("pageTitle").textContent = btn.dataset.prio.charAt(0).toUpperCase() + btn.dataset.prio.slice(1) + " Priority";
      renderCategoryFilters();
      render();
      closeSidebar();
    });
  });

  $("workspaceSelect").addEventListener("change", onWorkspaceChange);
  $("btnNewWs").addEventListener("click", createWorkspace);
  $("btnInvite").addEventListener("click", inviteMember);
  $("btnLogout").addEventListener("click", logout);
  $("btnSettings").addEventListener("click", () => {
    openSettings("profile");
    closeSidebar();
  });
  $("btnTheme").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleThemePopover();
  });
  $("themePopover").addEventListener("click", (e) => e.stopPropagation());
  $("themePopover").querySelectorAll(".theme-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = document.documentElement.getAttribute("data-mode") || "light";
      applyTheme(btn.dataset.palette, mode);
      toast(`🎨 ${PALETTE_LABELS[btn.dataset.palette] || btn.dataset.palette}`);
      toggleThemePopover(false);
    });
  });
  $("themeModeLight").addEventListener("click", () => {
    const p = document.documentElement.getAttribute("data-palette") || "ocean";
    applyTheme(p, "light");
    toast("☀️ Light mode");
  });
  $("themeModeDark").addEventListener("click", () => {
    const p = document.documentElement.getAttribute("data-palette") || "ocean";
    applyTheme(p, "dark");
    toast("🌙 Dark mode");
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest?.(".theme-menu")) return;
    toggleThemePopover(false);
  });
  $("btnFocus").addEventListener("click", () => $("appLayout").classList.toggle("focus-mode"));
  $("btnExport").addEventListener("click", exportCSV);

  // Categories
  $("btnManageCats").addEventListener("click", () => {
    openCatManager();
    closeSidebar();
  });
  $("btnQuickAddCat").addEventListener("click", () => {
    quickAddCategory();
  });
  $("catClose").addEventListener("click", closeCatManager);
  $("catOverlay").addEventListener("click", (e) => {
    if (e.target === $("catOverlay")) closeCatManager();
  });
  $("newCatAdd").addEventListener("click", addNewCategory);
  $("newCatName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addNewCategory();
    }
  });
  $("calPrev").addEventListener("click", () => {
    state.calDate.setMonth(state.calDate.getMonth() - 1);
    renderCalendar();
  });
  $("calNext").addEventListener("click", () => {
    state.calDate.setMonth(state.calDate.getMonth() + 1);
    renderCalendar();
  });
  $("editCancel").addEventListener("click", closeEdit);
  $("editSave").addEventListener("click", saveEdit);
  $("editOverlay").addEventListener("click", (e) => {
    if (e.target === $("editOverlay")) closeEdit();
  });

  // Settings events
  $("settingsClose").addEventListener("click", closeSettings);
  $("settingsOverlay").addEventListener("click", (e) => {
    if (e.target === $("settingsOverlay")) closeSettings();
  });
  document.querySelectorAll(".settings-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchSettingsTab(btn.dataset.tab));
  });
  $("settingsSaveProfile").addEventListener("click", saveProfile);
  $("settingsSavePassword").addEventListener("click", savePassword);
  $("settingsUpgradeBtn").addEventListener("click", doUpgrade);
  if ($("avatarFile")) {
    $("avatarFile").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      onAvatarSelected(file);
      e.target.value = "";
    });
  }
  if ($("settingsRemoveAvatar")) {
    $("settingsRemoveAvatar").addEventListener("click", async () => {
      try {
        const user = await API.removeAvatar();
        state.user = { ...state.user, ...user, avatar_url: null };
        localStorage.setItem(API.userKey, JSON.stringify(state.user));
        renderUser();
        applyAvatarEl($("settingsAvatar"), state.user);
        setHint($("settingsProfileMsg"), "Photo removed.", false);
        toast("✓ Photo removed");
      } catch (e) {
        setHint($("settingsProfileMsg"), e.message || "Could not remove photo", true);
      }
    });
  }

  // Mobile nav
  $("btnMenu").addEventListener("click", toggleSidebar);
  $("btnSidebarClose").addEventListener("click", closeSidebar);
  $("sidebarBackdrop").addEventListener("click", closeSidebar);
  window.addEventListener("resize", () => {
    if (window.innerWidth > 800) closeSidebar();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if ($("themePopover")?.classList.contains("open")) toggleThemePopover(false);
      else if ($("catOverlay")?.classList.contains("open")) closeCatManager();
      else if ($("settingsOverlay").classList.contains("open")) closeSettings();
      else if ($("editOverlay").classList.contains("open")) closeEdit();
      else if (document.body.classList.contains("sidebar-open")) closeSidebar();
      else if (!state.welcomeDismissed && document.querySelector(".empty-state-onboarding")) {
        dismissWelcomeCard({ focus: false, animate: true });
      }
      return;
    }
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      if (!state.welcomeDismissed && document.querySelector(".empty-state-onboarding")) {
        dismissWelcomeCard({ focus: true, animate: true });
      } else {
        focusTaskComposer();
      }
    }
    if (e.key === "f" || e.key === "F") $("appLayout").classList.toggle("focus-mode");
    if (e.key === "e" || e.key === "E") exportCSV();
    if (e.key === "t" || e.key === "T") {
      e.preventDefault();
      // Shift+T cycles palette; T toggles dark/light
      if (e.shiftKey) cyclePalette();
      else {
        const p = document.documentElement.getAttribute("data-palette") || "ocean";
        const m = document.documentElement.getAttribute("data-mode") === "dark" ? "light" : "dark";
        applyTheme(p, m);
        toast(m === "dark" ? "🌙 Dark mode" : "☀️ Light mode");
      }
    }
    if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      $("searchInput").focus();
    }
  });

  // Persist timer on leave / background (authenticated keepalive — not sendBeacon)
  window.addEventListener("beforeunload", flushActiveTimerKeepalive);
  window.addEventListener("pagehide", flushActiveTimerKeepalive);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushActiveTimerKeepalive();
  });

  // ── Interactive dashboard background ──────────────
  function initDashboardBackground() {
    const bg = $("dashBg");
    const canvas = $("dashParticles");
    if (!bg || !canvas) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let mx = 0.5;
    let my = 0.5;

    window.addEventListener(
      "pointermove",
      (e) => {
        mx = e.clientX / window.innerWidth;
        my = e.clientY / window.innerHeight;
        bg.style.setProperty("--mx", (mx * 100).toFixed(2) + "%");
        bg.style.setProperty("--my", (my * 100).toFixed(2) + "%");
        bg.style.setProperty("--parallax-x", ((mx - 0.5) * 24).toFixed(2) + "px");
        bg.style.setProperty("--parallax-y", ((my - 0.5) * 18).toFixed(2) + "px");
      },
      { passive: true }
    );

    if (reduceMotion) return;

    const ctx = canvas.getContext("2d");
    let w = 0;
    let h = 0;
    let particles = [];
    let raf = 0;

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      const count = Math.min(28, Math.floor((w * h) / 42000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 1 + Math.random() * 2.2,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        a: 0.15 + Math.random() * 0.35,
      }));
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      const accent = getComputedStyle(document.body).getPropertyValue("--mint").trim() || "#4f8cff";
      for (const p of particles) {
        p.x += p.vx + (mx - 0.5) * 0.15;
        p.y += p.vy + (my - 0.5) * 0.12;
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.globalAlpha = p.a;
        ctx.fill();
      }
      // soft links
      ctx.globalAlpha = 0.08;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < 110) {
            ctx.globalAlpha = 0.08 * (1 - d / 110);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    }

    window.addEventListener("resize", resize);
    resize();
    draw();

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else raf = requestAnimationFrame(draw);
    });
  }

  // Anti-autofill on composer + edit fields
  armAntiAutofill($("taskInput"));
  armAntiAutofill($("catInput"));
  armAntiAutofill($("editText"));
  armAntiAutofill($("editNotes"));
  armAntiAutofill($("editCat"));
  armAntiAutofill($("newCatName"));

  initDashboardBackground();
  init();
})();
