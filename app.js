/* AI Platform Frontend (Telegram Mini App + Web)
   - Guest mode works (chat demo + local projects)
   - Auth-required pages gated
   - Extra utilities: export/import, theme toggle, diagnostics, shortcuts, chat settings, local caching, search
*/

const tg = window.Telegram?.WebApp || null;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const el = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));

// ---------- Storage helpers ----------
const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      if (v === null || v === undefined || v === "") return fallback;
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch { }
  },
  getStr(key, fallback = "") {
    try {
      const v = localStorage.getItem(key);
      return v === null || v === undefined ? fallback : String(v);
    } catch {
      return fallback;
    }
  },
  setStr(key, value) {
    try {
      localStorage.setItem(key, String(value ?? ""));
    } catch { }
  },
  del(key) {
    try { localStorage.removeItem(key); } catch { }
  },
};

// ---------- API ----------
const API = {
  base: store.getStr("apibase", "/api/v1"),
  token: store.getStr("token", ""),
  setBase(url) {
    this.base = (url || "/api/v1").trim().replace(/\/+$/, "");
    store.setStr("apibase", this.base);
  },
  setToken(t) {
    this.token = t || "";
    store.setStr("token", this.token);
  },
  async req(path, { method = "GET", body = null, headers = {}, timeoutMs = 30000 } = {}) {
    const h = { "Content-Type": "application/json", ...headers };
    if (this.token) h.Authorization = `Bearer ${this.token}`;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(this.base + path, {
        method,
        headers: h,
        body: body ? JSON.stringify(body) : null,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }

    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }

    if (res.status === 401) {
      // Token invalid/expired
      if (API.token) {
        API.setToken("");
        state.me = null;
      }
    }

    if (!res.ok) throw new Error(data?.detail || data?.error || txt || `HTTP ${res.status}`);
    return data;
  },
};

// ---------- App state ----------
const state = {
  me: null,
  page: store.getStr("page", "chat"),
  chat: store.get("chat_history", []),
  chatDraft: store.getStr("chat_draft", ""),
  providers: [],
  models: {},
  notifications: [],
  reminders: [],
  events: [],
  guestProjects: store.get("guest_projects", []),
  ui: {
    theme: store.getStr("theme", "auto"), // auto | light | dark
    reduceMotion: !!store.get("reduce_motion", false),
  },
  chatSettings: store.get("chat_settings", {
    system: "",
    temperature: 0.7,
    max_tokens: 2048,
    json_mode: false,
    markdown: true,
    typewriter: true,
    auto_scroll: true,
  }),
};

// ---------- UX helpers ----------
function haptic(type = "impact", style = "light") {
  if (!tg) return;
  const s = state.me?.settings || {};
  if (s.haptics === false) return;
  try {
    if (type === "impact") tg.HapticFeedback.impactOccurred(style);
    if (type === "notify") tg.HapticFeedback.notificationOccurred(style);
    if (type === "select") tg.HapticFeedback.selectionChanged();
  } catch { }
}

function popup(title, message) {
  if (tg?.showPopup) tg.showPopup({ title, message: String(message), buttons: [{ type: "ok" }] });
  else alert(`${title}: ${message}`);
}

function toast(msg, ok = true) {
  popup(ok ? "Готово" : "Ошибка", msg);
}

function fmtTime(ts) {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toLocaleString();
  } catch {
    return String(ts);
  }
}

function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Minimal markdown renderer (safe-ish): code blocks + inline code + newlines.
function renderMarkdownToHTML(text) {
  const safe = esc(text);
  // code fences ```
  const fenced = safe.replace(/```([\s\S]*?)```/g, (m, p1) => {
    return `<pre class="code"><code>${p1}</code></pre>`;
  });
  const inline = fenced.replace(/`([^`]+)`/g, (m, p1) => `<code class="icode">${p1}</code>`);
  const withBreaks = inline.replace(/\n/g, "<br/>");
  return withBreaks;
}

// ---------- Telegram integration ----------
let tgBackBound = false;
function bindTelegramBackOnce() {
  if (!tg || tgBackBound) return;
  tgBackBound = true;
  try {
    tg.BackButton.onClick(() => {
      // simple navigation stack: back to chat, otherwise close
      if (state.page !== "chat") setPage("chat");
      else tg.close();
    });
  } catch { }
}

function updateTelegramBackButton() {
  if (!tg) return;
  try {
    if (state.page !== "chat") tg.BackButton.show();
    else tg.BackButton.hide();
  } catch { }
}

function applyTheme() {
  const mode = state.ui.theme;
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const tgScheme = tg?.colorScheme;

  let finalMode = mode;
  if (mode === "auto") {
    finalMode = tgScheme || (prefersDark ? "dark" : "light");
  }

  document.documentElement.dataset.theme = finalMode;
  store.setStr("theme", mode);
}

async function telegramAutoLogin() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
  } catch { }

  bindTelegramBackOnce();
  applyTheme();

  if (API.token) return;
  try {
    if (!tg.initData) return;
    const tok = await API.req("/auth/telegram", { method: "POST", body: { init_data: tg.initData } });
    API.setToken(tok.access_token);
    haptic("notify", "success");
  } catch (e) {
    console.warn("TG login failed:", e.message);
  }
}

// ---------- Navigation ----------
function setPage(p) {
  state.page = p;
  store.setStr("page", p);
  haptic("select");
  render();
}

function openDrawer() {
  $(".backdrop")?.classList.add("show");
  $(".sidebar.drawer")?.classList.add("open");
}

function closeDrawer() {
  $(".backdrop")?.classList.remove("show");
  $(".sidebar.drawer")?.classList.remove("open");
}

function titleOf(p) {
  return (
    {
      chat: "Чат",
      projects: "Проекты",
      keys: "Ключи",
      reminders: "Напоминания",
      calendar: "Календарь",
      notifications: "Уведомления",
      settings: "Настройки",
      diagnostics: "Диагностика",
      shortcuts: "Горячие клавиши",
      admin: "Админ",
      login: "Вход",
    }[p] || "AI Platform"
  );
}

function navItems() {
  const items = [
    ["chat", "Чат", "⌘1"],
    ["projects", "Проекты", "⌘2"],
    ["keys", "Ключи", "⌘3"],
    ["reminders", "Напоминания", "⌘4"],
    ["calendar", "Календарь", "⌘5"],
    ["notifications", "Уведомления", "⌘6"],
    ["settings", "Настройки", "⌘7"],
    ["diagnostics", "Диагностика", "⌘8"],
    ["shortcuts", "Клавиши", "?"],
  ];
  if (state.me?.is_admin) items.push(["admin", "Админ", "⌘9"]);
  return items;
}

function sidebar(isDrawer) {
  const sb = el("div", isDrawer ? "sidebar drawer" : "sidebar");
  const head = el("div", "card");
  head.innerHTML = `<div class="h2">AI Platform</div><div class="muted small">TG Mini App + Web</div>`;
  sb.appendChild(head);

  const nav = el("div", "");
  navItems().forEach(([id, label, k]) => {
    const b = el("button", "navbtn" + (state.page === id ? " active" : ""));
    b.innerHTML = `<span>${label}</span><span class="k">${k}</span>`;
    b.onclick = () => {
      setPage(id);
      if (isDrawer) closeDrawer();
    };
    nav.appendChild(b);
  });
  sb.appendChild(nav);

  const quick = el("div", "card");
  quick.innerHTML = `
    <div class="h2">Быстро</div>
    <div class="hr"></div>
    <div class="row">
      <button class="btn primary" id="qNew">Новый чат</button>
      <button class="btn" id="qReload">Обновить</button>
    </div>
  `;
  sb.appendChild(quick);

  setTimeout(() => {
    $("#qNew", sb)?.addEventListener("click", () => {
      state.chat = [];
      store.set("chat_history", state.chat);
      setPage("chat");
      if (isDrawer) closeDrawer();
    });
    $("#qReload", sb)?.addEventListener("click", () => {
      boot();
      if (isDrawer) closeDrawer();
    });
  }, 0);

  return sb;
}

function bottomNav() {
  const bn = el("div", "bottom-nav");
  const short = [
    ["chat", "Чат"],
    ["projects", "Проекты"],
    ["settings", "Настройки"],
    ["diagnostics", "Диагн."],
  ];
  const items = state.me?.is_admin ? short.concat([["admin", "Админ"]]) : short;
  items.forEach(([id, label]) => {
    const b = el("button", state.page === id ? "active" : "");
    b.textContent = label;
    b.onclick = () => setPage(id);
    bn.appendChild(b);
  });
  return bn;
}

function topbar() {
  const t = el("div", "topbar");
  const left = el("div", "row");
  const burger = el("button", "btn");
  burger.textContent = "☰";
  burger.onclick = () => openDrawer();
  left.appendChild(burger);
  const h = el("div", "h1");
  h.textContent = titleOf(state.page);
  left.appendChild(h);

  const right = el("div", "row");
  const role = el("span", "pill");
  role.textContent = state.me?.is_admin ? "ADMIN" : state.me ? "USER" : "GUEST";
  right.appendChild(role);

  const authBtn = el("button", "btn");
  authBtn.textContent = API.token ? "Выйти" : "Войти";
  authBtn.onclick = () => (API.token ? logout() : setPage("login"));
  right.appendChild(authBtn);

  t.appendChild(left);
  t.appendChild(right);
  return t;
}

function requireLoginCard(featureName = "Эта функция") {
  const w = el("div", "card");
  w.innerHTML = `
    <div class="h2">Нужен вход</div>
    <div class="muted small">${esc(featureName)} доступна только после входа.</div>
    <div class="hr"></div>
    <div class="row">
      <button class="btn primary" id="goLogin">Войти</button>
      <button class="btn" id="goChat">В чат</button>
    </div>
  `;
  setTimeout(() => {
    $("#goLogin", w).onclick = () => setPage("login");
    $("#goChat", w).onclick = () => setPage("chat");
  }, 0);
  return w;
}

function view() {
  // Public pages always allowed
  const publicPages = new Set(["chat", "projects", "settings", "diagnostics", "shortcuts", "login"]);
  if (!API.token && !publicPages.has(state.page)) return requireLoginCard(titleOf(state.page));

  if (state.page === "login") return loginView();
  if (state.page === "chat") return chatView();
  if (state.page === "projects") return projectsView();
  if (state.page === "keys") return keysView();
  if (state.page === "reminders") return remindersView();
  if (state.page === "calendar") return calendarView();
  if (state.page === "notifications") return notificationsView();
  if (state.page === "settings") return settingsView();
  if (state.page === "diagnostics") return diagnosticsView();
  if (state.page === "shortcuts") return shortcutsView();
  if (state.page === "admin") return adminView();
  return el("div", "card");
}

function render() {
  const root = $("#app");
  root.innerHTML = "";

  const backdrop = el("div", "backdrop");
  backdrop.onclick = closeDrawer;
  root.appendChild(backdrop);

  root.appendChild(sidebar(true));

  const shell = el("div", "shell");
  shell.appendChild(sidebar(false));

  const main = el("div", "main");
  main.appendChild(topbar());
  main.appendChild(view());
  shell.appendChild(main);

  root.appendChild(shell);
  root.appendChild(bottomNav());

  updateTelegramBackButton();
}

// ---------- Auth ----------
function loginView() {
  const w = el("div", "card");
  w.innerHTML = `
    <div class="h1">Вход</div>
    <div class="muted small">В Telegram обычно вход автоматический (initData). Если нет — войди по email.</div>
    <div class="hr"></div>
    <label class="small muted">Email</label>
    <input class="input" id="email" placeholder="you@mail.com" autocomplete="username"/>
    <div style="height:8px"></div>
    <label class="small muted">Пароль</label>
    <input class="input" id="pass" type="password" placeholder="••••••••" autocomplete="current-password"/>
    <div class="hr"></div>
    <div class="row">
      <button class="btn primary" id="btnLogin">Войти</button>
      <button class="btn" id="btnReg">Регистрация</button>
      <button class="btn" id="btnGuest">Продолжить как гость</button>
    </div>
    <div class="muted small" style="margin-top:10px">Админ создаётся автоматически из ADMIN_EMAIL/ADMIN_PASSWORD (бэкенд)</div>
  `;

  setTimeout(() => {
    $("#btnGuest", w).onclick = () => setPage("chat");

    $("#btnLogin", w).onclick = async () => {
      try {
        const email = $("#email", w).value.trim();
        const password = $("#pass", w).value;
        const tok = await API.req("/auth/login_json", { method: "POST", body: { email, password } });
        API.setToken(tok.access_token);
        await boot();
        setPage("chat");
      } catch (e) {
        toast(e.message, false);
      }
    };

    $("#btnReg", w).onclick = async () => {
      try {
        const email = $("#email", w).value.trim();
        const password = $("#pass", w).value;
        const tok = await API.req("/auth/register", { method: "POST", body: { email, password, full_name: "" } });
        API.setToken(tok.access_token);
        await boot();
        setPage("chat");
      } catch (e) {
        toast(e.message, false);
      }
    };
  }, 0);

  return w;
}

function logout() {
  API.setToken("");
  state.me = null;
  // keep local chat/projects for guest
  setPage("chat");
  toast("Вы вышли. Гостевой режим активен.");
}

// ---------- Chat ----------
function chatView() {
  const w = el("div", "card");
  const provOpts = (state.providers || []).map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");

  w.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div class="h2">AI чат</div>
      <div class="row" style="gap:8px">
        <span class="pill">${navigator.onLine ? "online" : "offline"}</span>
        <span class="pill">${API.token ? "API" : "DEMO"}</span>
      </div>
    </div>

    <div class="hr"></div>

    <div class="row" style="flex-wrap:wrap; gap:8px">
      <select id="provider" class="input" style="max-width:230px">
        <option value="auto">auto</option>${provOpts}
      </select>
      <select id="model" class="input" style="max-width:260px">
        <option value="">model (auto)</option>
      </select>
      <input id="search" class="input" placeholder="Поиск по чату" style="max-width:260px"/>
    </div>

    <details id="adv" style="margin-top:10px">
      <summary class="muted small">Настройки запроса</summary>
      <div style="height:10px"></div>
      <label class="small muted">System prompt</label>
      <textarea id="system" class="input" rows="2" placeholder="Например: отвечай кратко..."></textarea>
      <div style="height:8px"></div>
      <div class="row" style="flex-wrap:wrap; gap:8px">
        <div style="min-width:190px">
          <label class="small muted">Temperature: <span id="tval"></span></label>
          <input id="temp" class="input" type="range" min="0" max="1" step="0.05" />
        </div>
        <div style="min-width:190px">
          <label class="small muted">Max tokens</label>
          <input id="maxt" class="input" type="number" min="16" max="8192" step="16" />
        </div>
        <div style="min-width:190px">
          <label class="small muted">Опции</label>
          <div class="row" style="gap:10px; flex-wrap:wrap">
            <label class="row small"><input type="checkbox" id="json"/> JSON</label>
            <label class="row small"><input type="checkbox" id="md"/> Markdown</label>
            <label class="row small"><input type="checkbox" id="tw"/> Typewriter</label>
            <label class="row small"><input type="checkbox" id="as"/> Auto-scroll</label>
          </div>
        </div>
      </div>
    </details>

    <div style="height:10px"></div>

    <div class="chatlog" id="chatlog"></div>

    <div class="hr"></div>

    <textarea id="prompt" class="input" rows="3" placeholder="Напиши запрос..."></textarea>

    <div style="height:10px"></div>

    <div class="row" style="flex-wrap:wrap; gap:8px">
      <button class="btn primary" id="send">Отправить</button>
      <button class="btn" id="clear">Очистить</button>
      <button class="btn" id="export">Экспорт</button>
      <button class="btn" id="import">Импорт</button>
      <button class="btn" id="copyLast">Копировать ответ</button>
      <button class="btn" id="editLast">Изменить последний запрос</button>
    </div>

    <div class="muted small" style="margin-top:8px">Ctrl/⌘+Enter — отправить • / — поиск • ? — подсказка</div>
  `;

  setTimeout(() => {
    const chatlog = $("#chatlog", w);
    const provider = $("#provider", w);
    const model = $("#model", w);
    const prompt = $("#prompt", w);
    const search = $("#search", w);

    const system = $("#system", w);
    const temp = $("#temp", w);
    const tval = $("#tval", w);
    const maxt = $("#maxt", w);
    const json = $("#json", w);
    const md = $("#md", w);
    const tw = $("#tw", w);
    const as = $("#as", w);

    // init settings
    system.value = state.chatSettings.system || "";
    temp.value = String(state.chatSettings.temperature ?? 0.7);
    tval.textContent = String(state.chatSettings.temperature ?? 0.7);
    maxt.value = String(state.chatSettings.max_tokens ?? 2048);
    json.checked = !!state.chatSettings.json_mode;
    md.checked = state.chatSettings.markdown !== false;
    tw.checked = state.chatSettings.typewriter !== false;
    as.checked = state.chatSettings.auto_scroll !== false;

    prompt.value = state.chatDraft || "";

    function persistChatSettings() {
      state.chatSettings = {
        system: system.value,
        temperature: Number(temp.value),
        max_tokens: Math.max(16, Number(maxt.value) || 2048),
        json_mode: !!json.checked,
        markdown: !!md.checked,
        typewriter: !!tw.checked,
        auto_scroll: !!as.checked,
      };
      store.set("chat_settings", state.chatSettings);
    }

    const saveDraft = debounce(() => {
      state.chatDraft = prompt.value || "";
      store.setStr("chat_draft", state.chatDraft);
    }, 200);

    function fillModels() {
      const p = provider.value;
      const arr = p === "auto" ? [] : state.models[p] || [];
      model.innerHTML = `<option value="">model (auto)</option>` + arr.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join("");
    }

    function renderChat() {
      const q = (search.value || "").trim().toLowerCase();
      chatlog.innerHTML = "";

      state.chat.forEach((m, idx) => {
        const b = el("div", "msg " + (m.role === "user" ? "user" : "ai"));
        b.dataset.idx = String(idx);

        if (m.role !== "user") {
          // AI message
          if (state.chatSettings.markdown) {
            b.innerHTML = renderMarkdownToHTML(m.text);
          } else {
            b.textContent = m.text;
          }
        } else {
          b.textContent = m.text;
        }

        if (q && (m.text || "").toLowerCase().includes(q)) {
          b.classList.add("hit");
        }

        // context menu: delete message
        b.oncontextmenu = (ev) => {
          ev.preventDefault();
          const ok = confirm("Удалить это сообщение?");
          if (!ok) return;
          state.chat.splice(idx, 1);
          store.set("chat_history", state.chat);
          renderChat();
        };

        chatlog.appendChild(b);
      });

      if (state.chatSettings.auto_scroll) chatlog.scrollTop = chatlog.scrollHeight;
    }

    function typewriterAppend(text, onDone) {
      const b = el("div", "msg ai");
      chatlog.appendChild(b);
      let i = 0;
      const step = () => {
        i += Math.max(1, Math.floor(text.length / 120));
        const slice = text.slice(0, i);
        if (state.chatSettings.markdown) b.innerHTML = renderMarkdownToHTML(slice);
        else b.textContent = slice;
        if (state.chatSettings.auto_scroll) chatlog.scrollTop = chatlog.scrollHeight;
        if (i < text.length) {
          if (!state.ui.reduceMotion && state.chatSettings.typewriter) requestAnimationFrame(step);
          else {
            // if reduced motion, jump
            i = text.length;
            step();
          }
        } else {
          onDone?.();
        }
      };
      step();
    }

    provider.onchange = () => { fillModels(); haptic("select"); };
    fillModels();

    // Search highlighting
    search.addEventListener("input", renderChat);

    // Chat settings events
    const onSetting = () => { tval.textContent = temp.value; persistChatSettings(); };
    [system, temp, maxt, json, md, tw, as].forEach((n) => n.addEventListener("input", onSetting));

    // Draft persistence
    prompt.addEventListener("input", saveDraft);

    renderChat();

    async function send() {
      const text = (prompt.value || "").trim();
      if (!text) return;

      state.chat.push({ role: "user", text, ts: Date.now() });
      store.set("chat_history", state.chat);
      prompt.value = "";
      saveDraft();
      renderChat();
      haptic("impact", "light");

      // Guest/demo mode
      if (!API.token) {
        const reply = demoAnswer(text);
        if (state.chatSettings.typewriter && !state.ui.reduceMotion) {
          typewriterAppend(reply, () => {
            state.chat.push({ role: "ai", text: reply, ts: Date.now() });
            store.set("chat_history", state.chat);
            renderChat();
          });
        } else {
          state.chat.push({ role: "ai", text: reply, ts: Date.now() });
          store.set("chat_history", state.chat);
          renderChat();
        }
        return;
      }

      try {
        const resp = await API.req("/ai/generate", {
          method: "POST",
          body: {
            prompt: text,
            system_prompt: state.chatSettings.system || null,
            provider: provider.value === "auto" ? null : provider.value,
            model: model.value || null,
            temperature: Number(state.chatSettings.temperature ?? 0.7),
            max_tokens: Number(state.chatSettings.max_tokens ?? 2048),
            json_mode: !!state.chatSettings.json_mode,
          },
        });

        const answer = resp?.response ?? "";

        if (state.chatSettings.typewriter && !state.ui.reduceMotion) {
          typewriterAppend(answer, () => {
            state.chat.push({ role: "ai", text: answer, ts: Date.now() });
            store.set("chat_history", state.chat);
            renderChat();
            haptic("notify", "success");
          });
        } else {
          state.chat.push({ role: "ai", text: answer, ts: Date.now() });
          store.set("chat_history", state.chat);
          renderChat();
          haptic("notify", "success");
        }
      } catch (e) {
        const err = "Ошибка: " + e.message;
        state.chat.push({ role: "ai", text: err, ts: Date.now() });
        store.set("chat_history", state.chat);
        renderChat();
        haptic("notify", "error");
      }
    }

    $("#send", w).onclick = send;

    $("#clear", w).onclick = () => {
      if (!confirm("Очистить чат?")) return;
      state.chat = [];
      store.set("chat_history", state.chat);
      renderChat();
      haptic("select");
    };

    $("#copyLast", w).onclick = async () => {
      const last = [...state.chat].reverse().find((m) => m.role === "ai");
      if (!last) return toast("Нет ответа для копирования", false);
      try {
        await navigator.clipboard.writeText(last.text);
        toast("Скопировано");
      } catch {
        // fallback
        const ta = el("textarea");
        ta.value = last.text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        toast("Скопировано");
      }
    };

    $("#editLast", w).onclick = () => {
      const lastUserIdx = (() => {
        for (let i = state.chat.length - 1; i >= 0; i--) if (state.chat[i].role === "user") return i;
        return -1;
      })();
      if (lastUserIdx < 0) return toast("Нет последнего запроса", false);
      prompt.value = state.chat[lastUserIdx].text;
      prompt.focus();
      toast("Можно отредактировать и отправить");
    };

    // Export chat history
    $("#export", w).onclick = () => {
      const payload = {
        exported_at: new Date().toISOString(),
        settings: state.chatSettings,
        chat: state.chat,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const a = el("a");
      a.href = URL.createObjectURL(blob);
      a.download = `chat_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    // Import chat history
    $("#import", w).onclick = () => {
      const inp = el("input");
      inp.type = "file";
      inp.accept = "application/json";
      inp.onchange = async () => {
        const f = inp.files?.[0];
        if (!f) return;
        try {
          const txt = await f.text();
          const data = JSON.parse(txt);
          if (!Array.isArray(data.chat)) throw new Error("Неверный формат: нет chat[]");
          state.chat = data.chat;
          store.set("chat_history", state.chat);
          if (data.settings) {
            state.chatSettings = { ...state.chatSettings, ...data.settings };
            store.set("chat_settings", state.chatSettings);
          }
          render();
          toast("Импортировано");
        } catch (e) {
          toast(e.message, false);
        }
      };
      inp.click();
    };

    prompt.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        send();
      }
      if (!ev.ctrlKey && !ev.metaKey && ev.key === "/") {
        // focus search when user types '/'
        // do not steal if textarea has content selection; keep simple
      }
    });

    // Keyboard shortcuts inside chat
    window.addEventListener(
      "keydown",
      (ev) => {
        if (state.page !== "chat") return;
        if (ev.key === "/" && document.activeElement !== prompt) {
          ev.preventDefault();
          search.focus();
        }
      },
      { passive: false }
    );

  }, 0);

  return w;
}

function demoAnswer(text) {
  const t = text.trim();
  const lower = t.toLowerCase();

  // tiny helpful demo behaviors
  if (lower.startsWith("/help") || lower === "help") {
    return [
      "DEMO режим (гость). Доступно:",
      "- Напишите задачу обычным текстом",
      "- /sum <текст> — краткое резюме",
      "- /todo <текст> — чеклист",
      "- /idea <тема> — 10 идей",
      "\nЧтобы включить настоящий AI — войдите и настройте ключи/провайдера в бэкенде.",
    ].join("\n");
  }

  if (lower.startsWith("/sum ")) {
    const x = t.slice(5);
    const s = x.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ");
    return `Кратко: ${s || x.slice(0, 200)}${x.length > 200 ? "…" : ""}`;
  }

  if (lower.startsWith("/todo ")) {
    const x = t.slice(6);
    const parts = x.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
    const items = (parts.length ? parts : [x]).slice(0, 10);
    return items.map((it) => `- [ ] ${it}`).join("\n");
  }

  if (lower.startsWith("/idea ")) {
    const x = t.slice(6).trim() || "тема";
    const ideas = Array.from({ length: 10 }, (_, i) => `- Идея ${i + 1} по теме «${x}»`);
    return ["Вот 10 идей:", ...ideas].join("\n");
  }

  // default demo response
  return [
    "DEMO ответ (гостевой режим).",
    "Я не подключён к бэкенду/провайдерам, но UI работает.",
    "Вы написали:",
    "```",
    t,
    "```",
    "Подсказка: /help",
  ].join("\n");
}

// ---------- Projects ----------
function projectsView() {
  const w = el("div", "card");
  w.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div>
        <div class="h2">Проекты</div>
        <div class="muted small">${API.token ? "Список из API" : "Локальные проекты (гость)"}</div>
      </div>
      <span class="pill">${API.token ? "API" : "LOCAL"}</span>
    </div>

    <div class="hr"></div>

    <div class="row" style="flex-wrap:wrap; gap:8px">
      <input id="name" class="input" placeholder="Название проекта" style="min-width:220px"/>
      <input id="desc" class="input" placeholder="Описание" style="min-width:260px"/>
      <select id="type" class="input" style="max-width:160px">
        <option value="api">api</option>
        <option value="frontend">frontend</option>
        <option value="backend">backend</option>
        <option value="bot">bot</option>
        <option value="other">other</option>
      </select>
      <button id="create" class="btn primary">Создать</button>
      <button id="exportP" class="btn">Экспорт</button>
      <button id="importP" class="btn">Импорт</button>
    </div>

    <div class="hr"></div>

    <div class="row" style="flex-wrap:wrap; gap:8px">
      <input id="filter" class="input" placeholder="Фильтр" style="max-width:260px"/>
      <select id="sort" class="input" style="max-width:200px">
        <option value="new">Сначала новые</option>
        <option value="old">Сначала старые</option>
        <option value="name">По имени</option>
      </select>
      <button id="refresh" class="btn">Обновить</button>
    </div>

    <div class="hr"></div>

    <div id="list" class="list muted">Загрузка...</div>
  `;

  setTimeout(async () => {
    const list = $("#list", w);
    const filter = $("#filter", w);
    const sort = $("#sort", w);

    function localSave() {
      store.set("guest_projects", state.guestProjects);
    }

    function projectCard(p, isLocal = false) {
      const c = el("div", "card");
      const id = esc(p.id ?? "");
      const name = esc(p.name ?? "(без названия)");
      const desc = esc(p.description ?? "");
      const type = esc(p.type ?? "");
      const created = p.created_at ? fmtTime(p.created_at) : (p.ts ? fmtTime(p.ts) : "");

      c.innerHTML = `
        <div class="row" style="justify-content:space-between; gap:10px">
          <div style="min-width:0">
            <div class="h2">${name}</div>
            <div class="muted small">${desc}</div>
            <div class="muted small">${esc(type)} ${created ? "• " + esc(created) : ""}</div>
          </div>
          <div class="row" style="gap:8px; flex-wrap:wrap; justify-content:flex-end">
            <button class="btn" data-act="edit">Редакт.</button>
            <button class="btn danger" data-act="del">Удалить</button>
          </div>
        </div>
      `;

      const editBtn = c.querySelector('[data-act="edit"]');
      const delBtn = c.querySelector('[data-act="del"]');

      editBtn.onclick = async () => {
        const newName = prompt("Название", p.name ?? "");
        if (newName === null) return;
        const newDesc = prompt("Описание", p.description ?? "");
        if (newDesc === null) return;
        const newType = prompt("Тип (api/frontend/backend/bot/other)", p.type ?? "api");
        if (newType === null) return;

        try {
          if (API.token && !isLocal) {
            // If backend supports PATCH/PUT - try PATCH, fallback PUT
            try {
              await API.req(`/projects/${encodeURIComponent(p.id)}`, { method: "PATCH", body: { name: newName, description: newDesc, type: newType } });
            } catch {
              await API.req(`/projects/${encodeURIComponent(p.id)}`, { method: "PUT", body: { name: newName, description: newDesc, type: newType } });
            }
            await load();
          } else {
            p.name = newName;
            p.description = newDesc;
            p.type = newType;
            localSave();
            await load();
          }
          toast("Сохранено");
        } catch (e) {
          toast(e.message, false);
        }
      };

      delBtn.onclick = async () => {
        if (!confirm("Удалить проект?")) return;
        try {
          if (API.token && !isLocal) {
            await API.req(`/projects/${encodeURIComponent(p.id)}`, { method: "DELETE" });
            await load();
          } else {
            state.guestProjects = state.guestProjects.filter((x) => x.id !== p.id);
            localSave();
            await load();
          }
          toast("Удалено");
        } catch (e) {
          toast(e.message, false);
        }
      };

      return c;
    }

    async function load() {
      const q = (filter.value || "").trim().toLowerCase();
      const s = sort.value;

      list.innerHTML = "";

      if (API.token) {
        try {
          const items = await API.req("/projects");
          let arr = Array.isArray(items) ? items : items?.projects || [];
          if (q) arr = arr.filter((p) => (p.name || "").toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q));
          if (s === "name") arr.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
          if (s === "new") arr.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
          if (s === "old") arr.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

          if (!arr.length) {
            list.textContent = "Пока проектов нет";
            return;
          }
          arr.forEach((p) => list.appendChild(projectCard(p, false)));
        } catch (e) {
          list.textContent = "Ошибка: " + e.message;
        }
      } else {
        let arr = state.guestProjects || [];
        if (q) arr = arr.filter((p) => (p.name || "").toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q));
        if (s === "name") arr = [...arr].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        if (s === "new") arr = [...arr].sort((a, b) => (b.ts || 0) - (a.ts || 0));
        if (s === "old") arr = [...arr].sort((a, b) => (a.ts || 0) - (b.ts || 0));

        if (!arr.length) {
          list.textContent = "Локальных проектов нет";
          return;
        }
        arr.forEach((p) => list.appendChild(projectCard(p, true)));
      }
    }

    $("#create", w).onclick = async () => {
      const name = $("#name", w).value.trim() || "New Project";
      const description = $("#desc", w).value.trim() || "";
      const type = $("#type", w).value;

      try {
        if (API.token) {
          await API.req("/projects", { method: "POST", body: { name, description, type, features: [] } });
        } else {
          state.guestProjects.unshift({ id: `g_${Math.random().toString(16).slice(2)}`, name, description, type, ts: Date.now() });
          store.set("guest_projects", state.guestProjects);
        }
        $("#name", w).value = "";
        $("#desc", w).value = "";
        await load();
        haptic("notify", "success");
      } catch (e) {
        toast(e.message, false);
      }
    };

    $("#refresh", w).onclick = load;

    filter.addEventListener("input", debounce(load, 150));
    sort.addEventListener("change", load);

    // Export/import projects
    $("#exportP", w).onclick = () => {
      const payload = {
        exported_at: new Date().toISOString(),
        mode: API.token ? "api" : "local",
        projects: API.token ? [] : state.guestProjects,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const a = el("a");
      a.href = URL.createObjectURL(blob);
      a.download = `projects_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    $("#importP", w).onclick = () => {
      const inp = el("input");
      inp.type = "file";
      inp.accept = "application/json";
      inp.onchange = async () => {
        const f = inp.files?.[0];
        if (!f) return;
        try {
          const txt = await f.text();
          const data = JSON.parse(txt);
          if (!Array.isArray(data.projects)) throw new Error("Неверный формат: нет projects[]");
          // import only to local store
          state.guestProjects = data.projects.map((p) => ({
            id: p.id || `g_${Math.random().toString(16).slice(2)}`,
            name: p.name || "New Project",
            description: p.description || "",
            type: p.type || "other",
            ts: p.ts || Date.now(),
          }));
          store.set("guest_projects", state.guestProjects);
          await load();
          toast("Импортировано в локальные проекты");
        } catch (e) {
          toast(e.message, false);
        }
      };
      inp.click();
    };

    await load();
  }, 0);

  return w;
}

// ---------- Keys / Reminders / Calendar / Notifications / Admin ----------
// These pages require login; in guest mode they are gated by view().

function keysView() {
  const w = el("div", "card");
  w.innerHTML = `
    <div class="h2">Ключи провайдеров</div>
    <div class="muted small">Ключи сохраняются в БД пользователя (шифруются). Без них провайдеры недоступны.</div>
    <div class="hr"></div>

    <label class="small muted">Provider</label>
    <select id="prov" class="input">
      <option value="openai">openai</option>
      <option value="groq">groq</option>
      <option value="together">together</option>
      <option value="mistral">mistral</option>
      <option value="openrouter">openrouter</option>
      <option value="deepseek">deepseek</option>
      <option value="perplexity">perplexity</option>
      <option value="fireworks">fireworks</option>
      <option value="xai">xai</option>
      <option value="custom">custom</option>
    </select>

    <div style="height:8px"></div>
    <label class="small muted">API key</label>
    <input id="key" class="input" placeholder="sk-..." />

    <div class="hr"></div>
    <div class="row" style="flex-wrap:wrap; gap:8px">
      <button id="save" class="btn primary">Сохранить</button>
      <button id="refresh" class="btn">Обновить</button>
      <button id="providers" class="btn">Провайдеры/модели</button>
    </div>

    <div class="hr"></div>
    <div id="list" class="list muted">Загрузка...</div>
  `;

  setTimeout(async () => {
    const list = $("#list", w);

    async function load() {
      try {
        const items = await API.req("/ai/keys");
        list.innerHTML = "";
        (items || []).forEach((it) => {
          const r = el("div", "row");
          r.style.justifyContent = "space-between";
          r.innerHTML = `<span class="pill">${esc(it.provider)}</span>
                         <button class="btn danger" data-p="${esc(it.provider)}">Удалить</button>`;
          list.appendChild(r);
        });

        if (!items?.length) list.textContent = "Ключей нет";

        $$("button[data-p]", list).forEach((b) => {
          b.onclick = async () => {
            try {
              const p = b.getAttribute("data-p");
              await API.req(`/ai/keys/${encodeURIComponent(p)}`, { method: "DELETE" });
              await boot();
              await load();
              haptic("notify", "success");
            } catch (e) {
              toast(e.message, false);
            }
          };
        });
      } catch (e) {
        list.textContent = "Ошибка: " + e.message;
      }
    }

    $("#save", w).onclick = async () => {
      try {
        const provider = $("#prov", w).value;
        const api_key = $("#key", w).value.trim();
        if (!api_key) return toast("Пустой ключ", false);
        await API.req("/ai/keys", { method: "POST", body: { provider, api_key } });
        $("#key", w).value = "";
        await boot();
        await load();
        haptic("notify", "success");
      } catch (e) {
        toast(e.message, false);
      }
    };

    $("#refresh", w).onclick = async () => {
      await boot();
      await load();
    };

    $("#providers", w).onclick = async () => {
      try {
        await boot();
        toast("Список провайдеров/моделей обновлён");
      } catch (e) {
        toast(e.message, false);
      }
    };

    await load();
  }, 0);

  return w;
}

function remindersView() {
  const w = el("div", "card");
  w.innerHTML = `
    <div class="h2">Напоминания</div>
    <div class="muted small">Создай напоминание (ISO дата). Пример: 2026-02-17T15:00:00</div>
    <div class="hr"></div>

    <input id="title" class="input" placeholder="Текст напоминания" />
    <div style="height:8px"></div>
    <input id="at" class="input" placeholder="remind_at (ISO)" />

    <div class="hr"></div>
    <div class="row" style="flex-wrap:wrap; gap:8px">
      <button id="add" class="btn primary">Добавить</button>
      <button id="refresh" class="btn">Обновить</button>
      <button id="fillNow" class="btn">Сейчас+1ч</button>
    </div>

    <div class="hr"></div>
    <div id="list" class="list muted">Загрузка...</div>
  `;

  setTimeout(async () => {
    const list = $("#list", w);

    async function load() {
      try {
        const data = await API.req("/reminders");
        state.reminders = data.reminders || [];
        list.innerHTML = "";
        state.reminders.forEach((r) => {
          const c = el("div", "card");
          c.innerHTML = `
            <div class="row" style="justify-content:space-between; gap:10px">
              <div>
                <div class="h2">${esc(r.title)}</div>
                <div class="muted small">${esc(r.remind_at || "")}</div>
              </div>
              <button class="btn danger" data-id="${esc(r.id)}">Удалить</button>
            </div>
          `;
          list.appendChild(c);
        });

        if (!state.reminders.length) list.textContent = "Нет напоминаний";

        $$("button[data-id]", list).forEach((b) => {
          b.onclick = async () => {
            try {
              await API.req(`/reminders/${encodeURIComponent(b.getAttribute("data-id"))}`, { method: "DELETE" });
              await load();
              haptic("notify", "success");
            } catch (e) {
              toast(e.message, false);
            }
          };
        });
      } catch (e) {
        list.textContent = "Ошибка: " + e.message;
      }
    }

    $("#add", w).onclick = async () => {
      try {
        const title = $("#title", w).value.trim();
        const remind_at = $("#at", w).value.trim();
        await API.req(`/reminders?title=${encodeURIComponent(title)}&remind_at=${encodeURIComponent(remind_at)}`, { method: "POST" });
        $("#title", w).value = "";
        $("#at", w).value = "";
        await load();
        haptic("notify", "success");
      } catch (e) {
        toast(e.message, false);
      }
    };

    $("#refresh", w).onclick = load;

    $("#fillNow", w).onclick = () => {
      const d = new Date(Date.now() + 60 * 60 * 1000);
      $("#at", w).value = d.toISOString().slice(0, 19);
    };

    await load();
  }, 0);

  return w;
}

function calendarView() {
  const w = el("div", "card");
  w.innerHTML = `
    <div class="h2">Календарь</div>
    <div class="muted small">События пользователя (интеграция с Google Calendar через бэкенд)</div>
    <div class="hr"></div>
    <div class="row" style="flex-wrap:wrap; gap:8px">
      <input id="from" class="input" placeholder="from (YYYY-MM-DD)" style="max-width:200px"/>
      <input id="to" class="input" placeholder="to (YYYY-MM-DD)" style="max-width:200px"/>
      <button id="load" class="btn primary">Загрузить</button>
    </div>
    <div class="hr"></div>
    <div id="list" class="list muted">Выбери диапазон и нажми «Загрузить»</div>
  `;

  setTimeout(() => {
    const list = $("#list", w);
    $("#load", w).onclick = async () => {
      try {
        const from = $("#from", w).value.trim();
        const to = $("#to", w).value.trim();
        const data = await API.req(`/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        state.events = data.events || [];
        list.innerHTML = "";
        if (!state.events.length) {
          list.textContent = "Событий нет";
          return;
        }
        state.events.forEach((ev) => {
          const c = el("div", "card");
          c.innerHTML = `<div class="h2">${esc(ev.summary || ev.title || "Событие")}</div>
                         <div class="muted small">${esc(ev.start || "")} → ${esc(ev.end || "")}</div>
                         <div class="muted small">${esc(ev.location || "")}</div>`;
          list.appendChild(c);
        });
      } catch (e) {
        list.textContent = "Ошибка: " + e.message;
      }
    };
  }, 0);

  return w;
}

function notificationsView() {
  const w = el("div", "card");
  w.innerHTML = `
    <div class="h2">Уведомления</div>
    <div class="muted small">Требует бэкенд (push/email/telegram)</div>
    <div class="hr"></div>
    <div class="row" style="flex-wrap:wrap; gap:8px">
      <button id="load" class="btn primary">Загрузить</button>
      <button id="test" class="btn">Тестовое уведомление</button>
    </div>
    <div class="hr"></div>
    <div id="list" class="list muted">Нажми «Загрузить»</div>
  `;

  setTimeout(() => {
    const list = $("#list", w);
    $("#load", w).onclick = async () => {
      try {
        const data = await API.req("/notifications");
        state.notifications = data.notifications || [];
        list.innerHTML = "";
        if (!state.notifications.length) {
          list.textContent = "Уведомлений нет";
          return;
        }
        state.notifications.forEach((n) => {
          const c = el("div", "card");
          c.innerHTML = `<div class="h2">${esc(n.title || "Notification")}</div>
                         <div class="muted small">${esc(n.body || "")}</div>
                         <div class="muted small">${esc(n.created_at || "")}</div>`;
          list.appendChild(c);
        });
      } catch (e) {
        list.textContent = "Ошибка: " + e.message;
      }
    };

    $("#test", w).onclick = async () => {
      try {
        await API.req("/notifications/test", { method: "POST", body: {} });
        toast("Отправлено (если бэкенд поддерживает)");
      } catch (e) {
        toast(e.message, false);
      }
    };
  }, 0);

  return w;
}

function adminView() {
  const w = el("div", "card");
  w.innerHTML = `
    <div class="h2">Админ</div>
    <div class="muted small">Инструменты администратора (зависит от API)</div>
    <div class="hr"></div>
    <div class="row" style="flex-wrap:wrap; gap:8px">
      <button id="health" class="btn primary">Health</button>
      <button id="stats" class="btn">Stats</button>
    </div>
    <div class="hr"></div>
    <pre class="code" id="out">—</pre>
  `;

  setTimeout(() => {
    const out = $("#out", w);
    $("#health", w).onclick = async () => {
      try {
        const data = await API.req("/health");
        out.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        out.textContent = "Ошибка: " + e.message;
      }
    };
    $("#stats", w).onclick = async () => {
      try {
        const data = await API.req("/admin/stats");
        out.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        out.textContent = "Ошибка: " + e.message;
      }
    };
  }, 0);

  return w;
}

// ---------- Settings ----------
function settingsView() {
  const w = el("div", "card");

  w.innerHTML = `
    <div class="h2">Настройки</div>
    <div class="muted small">Локальные настройки фронтенда (часть настроек пользователя хранится на бэкенде)</div>

    <div class="hr"></div>

    <label class="small muted">API base</label>
    <input id="apibase" class="input" placeholder="/api/v1 или https://domain/api/v1" />
    <div class="muted small" style="margin-top:6px">Для GitHub Pages поставь полный URL до бэкенда.</div>

    <div class="hr"></div>

    <div class="row" style="flex-wrap:wrap; gap:10px">
      <div style="min-width:220px">
        <label class="small muted">Тема</label>
        <select id="theme" class="input">
          <option value="auto">auto</option>
          <option value="light">light</option>
          <option value="dark">dark</option>
        </select>
      </div>
      <div style="min-width:220px">
        <label class="small muted">Уменьшить анимации</label>
        <select id="motion" class="input">
          <option value="0">нет</option>
          <option value="1">да</option>
        </select>
      </div>
    </div>

    <div class="hr"></div>

    <div class="row" style="flex-wrap:wrap; gap:8px">
      <button class="btn primary" id="save">Сохранить</button>
      <button class="btn" id="clearLocal">Сбросить локальные данные</button>
      <button class="btn" id="ping">Проверить API</button>
    </div>

    <div class="hr"></div>

    <pre class="code" id="out">—</pre>
  `;

  setTimeout(() => {
    const apibase = $("#apibase", w);
    const theme = $("#theme", w);
    const motion = $("#motion", w);
    const out = $("#out", w);

    apibase.value = API.base;
    theme.value = state.ui.theme || "auto";
    motion.value = state.ui.reduceMotion ? "1" : "0";

    $("#save", w).onclick = () => {
      API.setBase(apibase.value);
      state.ui.theme = theme.value;
      state.ui.reduceMotion = motion.value === "1";
      store.setStr("theme", state.ui.theme);
      store.set("reduce_motion", state.ui.reduceMotion);
      applyTheme();
      toast("Сохранено");
      render();
    };

    $("#clearLocal", w).onclick = () => {
      if (!confirm("Сбросить локальные данные? (чат/проекты/настройки)")) return;
      store.del("chat_history");
      store.del("chat_draft");
      store.del("guest_projects");
      store.del("chat_settings");
      store.del("theme");
      store.del("reduce_motion");
      state.chat = [];
      state.chatDraft = "";
      state.guestProjects = [];
      state.chatSettings = { system: "", temperature: 0.7, max_tokens: 2048, json_mode: false, markdown: true, typewriter: true, auto_scroll: true };
      state.ui.theme = "auto";
      state.ui.reduceMotion = false;
      applyTheme();
      toast("Сброшено");
      render();
    };

    $("#ping", w).onclick = async () => {
      out.textContent = "Проверяю...";
      try {
        const data = await API.req("/health", { timeoutMs: 8000 });
        out.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        out.textContent = "Ошибка: " + e.message;
      }
    };

  }, 0);

  return w;
}

// ---------- Diagnostics ----------
function diagnosticsView() {
  const w = el("div", "card");
  const ua = navigator.userAgent;
  const online = navigator.onLine;
  const now = new Date();

  w.innerHTML = `
    <div class="h2">Диагностика</div>
    <div class="muted small">Быстро понять, почему что-то не работает</div>

    <div class="hr"></div>

    <div class="row" style="flex-wrap:wrap; gap:8px">
      <span class="pill">${online ? "online" : "offline"}</span>
      <span class="pill">API: ${esc(API.base)}</span>
      <span class="pill">Token: ${API.token ? "yes" : "no"}</span>
      <span class="pill">TG: ${tg ? "yes" : "no"}</span>
    </div>

    <div class="hr"></div>

    <div class="row" style="flex-wrap:wrap; gap:8px">
      <button class="btn primary" id="boot">Перезагрузить boot()</button>
      <button class="btn" id="health">/health</button>
      <button class="btn" id="whoami">/users/me</button>
      <button class="btn" id="copy">Копировать отчёт</button>
    </div>

    <div class="hr"></div>

    <pre class="code" id="out">—</pre>

    <div class="hr"></div>
    <div class="muted small">User-Agent</div>
    <pre class="code">${esc(ua)}</pre>
    <div class="muted small">Local time</div>
    <pre class="code">${esc(now.toString())}</pre>
  `;

  setTimeout(() => {
    const out = $("#out", w);

    const report = async () => {
      const rep = {
        online: navigator.onLine,
        api_base: API.base,
        token: !!API.token,
        tg: !!tg,
        tg_initData_len: tg?.initData ? tg.initData.length : 0,
        theme: state.ui.theme,
        reduce_motion: state.ui.reduceMotion,
        page: state.page,
        chat_len: state.chat.length,
        guest_projects_len: state.guestProjects.length,
        me: state.me ? { email: state.me.email, is_admin: !!state.me.is_admin } : null,
        ts: new Date().toISOString(),
      };
      out.textContent = JSON.stringify(rep, null, 2);
      return rep;
    };

    $("#boot", w).onclick = async () => {
      out.textContent = "boot()...";
      try {
        await boot();
        await report();
      } catch (e) {
        out.textContent = "Ошибка: " + e.message;
      }
    };

    $("#health", w).onclick = async () => {
      out.textContent = "GET /health ...";
      try {
        const data = await API.req("/health", { timeoutMs: 8000 });
        out.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        out.textContent = "Ошибка: " + e.message;
      }
    };

    $("#whoami", w).onclick = async () => {
      out.textContent = "GET /users/me ...";
      try {
        const data = await API.req("/users/me", { timeoutMs: 8000 });
        out.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        out.textContent = "Ошибка: " + e.message;
      }
    };

    $("#copy", w).onclick = async () => {
      try {
        const rep = await report();
        await navigator.clipboard.writeText(JSON.stringify(rep, null, 2));
        toast("Скопировано");
      } catch (e) {
        toast(e.message, false);
      }
    };

    report();
  }, 0);

  return w;
}

// ---------- Shortcuts ----------
function shortcutsView() {
  const w = el("div", "card");
  w.innerHTML = `
    <div class="h2">Горячие клавиши</div>
    <div class="muted small">Работают в браузере и частично в Telegram WebView</div>
    <div class="hr"></div>
    <div class="list">
      <div class="row" style="justify-content:space-between"><span>⌘/Ctrl+1</span><span class="muted">Чат</span></div>
      <div class="row" style="justify-content:space-between"><span>⌘/Ctrl+2</span><span class="muted">Проекты</span></div>
      <div class="row" style="justify-content:space-between"><span>⌘/Ctrl+7</span><span class="muted">Настройки</span></div>
      <div class="row" style="justify-content:space-between"><span>⌘/Ctrl+8</span><span class="muted">Диагностика</span></div>
      <div class="row" style="justify-content:space-between"><span>?</span><span class="muted">Эта страница</span></div>
      <div class="row" style="justify-content:space-between"><span>/</span><span class="muted">Поиск в чате</span></div>
      <div class="row" style="justify-content:space-between"><span>Ctrl/⌘+Enter</span><span class="muted">Отправить сообщение</span></div>
      <div class="row" style="justify-content:space-between"><span>Right click</span><span class="muted">Удалить сообщение в чате</span></div>
    </div>
    <div class="hr"></div>
    <div class="muted small">Подсказка: в DEMO чате есть команды /help /sum /todo /idea</div>
  `;
  return w;
}

// ---------- Boot ----------
async function boot() {
  applyTheme();

  if (!API.token) {
    state.me = null;
    state.providers = [];
    state.models = {};
    render();
    return;
  }

  try {
    state.me = await API.req("/users/me", { timeoutMs: 12000 });
  } catch (e) {
    console.warn("/users/me failed:", e.message);
    state.me = null;
  }

  try {
    const data = await API.req("/ai/providers", { timeoutMs: 12000 });
    state.providers = data.providers || data || [];
    state.models = data.models || {};
  } catch (e) {
    console.warn("/ai/providers failed:", e.message);
    state.providers = [];
    state.models = {};
  }

  render();
}

// ---------- Global shortcuts ----------
function bindGlobalShortcuts() {
  window.addEventListener(
    "keydown",
    (ev) => {
      const cmd = ev.ctrlKey || ev.metaKey;
      if (cmd) {
        const k = ev.key;
        if (k === "1") return ev.preventDefault(), setPage("chat");
        if (k === "2") return ev.preventDefault(), setPage("projects");
        if (k === "3") return ev.preventDefault(), API.token ? setPage("keys") : toast("Нужен вход", false);
        if (k === "4") return ev.preventDefault(), API.token ? setPage("reminders") : toast("Нужен вход", false);
        if (k === "5") return ev.preventDefault(), API.token ? setPage("calendar") : toast("Нужен вход", false);
        if (k === "6") return ev.preventDefault(), API.token ? setPage("notifications") : toast("Нужен вход", false);
        if (k === "7") return ev.preventDefault(), setPage("settings");
        if (k === "8") return ev.preventDefault(), setPage("diagnostics");
        if (k === "9") return ev.preventDefault(), state.me?.is_admin ? setPage("admin") : toast("Только админ", false);
      }
      if (ev.key === "?") {
        ev.preventDefault();
        setPage("shortcuts");
      }
    },
    { passive: false }
  );
}

// ---------- Init ----------
window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled rejection:", e.reason);
});
window.addEventListener("error", (e) => {
  console.error("Error:", e.error || e.message);
});

(async function init() {
  bindGlobalShortcuts();
  bindTelegramBackOnce();
  await telegramAutoLogin();
  await boot();
})();
