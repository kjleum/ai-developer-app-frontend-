/* AI Platform Frontend (static, Telegram Mini App + Web)
   - Guest mode: Chat (DEMO) + Local Projects + Local Settings + Media tools
   - Auth mode: uses /api/v1 backend when token exists
*/

// --- helpers
const tg = window.Telegram?.WebApp || null;
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// --- persistent local config
const LS = {
  get(k, d=null){ try{ const v = localStorage.getItem(k); return v==null? d : JSON.parse(v);}catch{return d;} },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)); },
  del(k){ localStorage.removeItem(k); }
};

// --- API
const API = {
  base: LS.get("apiBase", "/api/v1"),
  token: localStorage.getItem("token") || "",
  setBase(b){ this.base = (b||"/api/v1").trim().replace(/\/$/,""); LS.set("apiBase", this.base); },
  setToken(t){ this.token = t||""; localStorage.setItem("token", this.token); },
  async req(path, { method="GET", body=null, headers={}, timeoutMs=30000 } = {}){
    const h = { ...headers };
    if (!(body instanceof FormData)) h["Content-Type"] = "application/json";
    if (this.token) h.Authorization = `Bearer ${this.token}`;

    const ctrl = new AbortController();
    const to = setTimeout(()=>ctrl.abort(), timeoutMs);
    try{
      const res = await fetch(this.base + path, {
        method,
        headers: h,
        body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : null,
        signal: ctrl.signal
      });
      const txt = await res.text();
      let data = null;
      try{ data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }
      if(!res.ok) throw new Error(data?.detail || data?.error || txt || `HTTP ${res.status}`);
      return data;
    } finally {
      clearTimeout(to);
    }
  }
};

// --- app state
const state = {
  me: null,
  page: LS.get("page", "chat"),
  chat: LS.get("chat", []),
  chatDraft: LS.get("chatDraft", ""),
  attachments: [], // current message attachments
  providers: [],
  models: {},
  localProjects: LS.get("localProjects", []),
  localSettings: LS.get("localSettings", {
    theme: "auto",
    reduceMotion: false,
    fontSize: 15,
    haptics: true,
    chatAutoscroll: true,
    chatMarkdown: true,
    chatTypewriter: false,
    chatCompact: false,
    chatSound: false,
    maxAttachmentMB: 10,
  }),
  media: {
    image: { file: null, url: "", filter: { brightness: 100, contrast: 100, saturate: 100 }, rotate: 0 },
    video: { file: null, url: "", start: 0, end: 0 }
  }
};

function isAuthed(){ return !!API.token; }
function isAdmin(){ return !!state.me?.is_admin; }

function saveLocal(){
  LS.set("page", state.page);
  LS.set("chat", state.chat);
  LS.set("chatDraft", state.chatDraft);
  LS.set("localProjects", state.localProjects);
  LS.set("localSettings", state.localSettings);
}

// --- UI feedback
function haptic(type="impact", style="light"){
  if(!tg) return;
  const s = currentSettings();
  if (s.haptics === false) return;
  try{
    if(type==="impact") tg.HapticFeedback.impactOccurred(style);
    if(type==="notify") tg.HapticFeedback.notificationOccurred(style);
    if(type==="select") tg.HapticFeedback.selectionChanged();
  }catch{}
}
function toast(msg, ok=true){
  if(tg?.showPopup) tg.showPopup({ title: ok?"Готово":"Ошибка", message: String(msg), buttons:[{type:"ok"}] });
  else alert((ok?"OK: ":"ERR: ") + msg);
}

// --- theme
function applyTheme(){
  const s = currentSettings();
  const mode = s.theme || "auto";
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = mode==="dark" || (mode==="auto" && prefersDark);
  document.documentElement.classList.toggle("theme-dark", dark);
  document.documentElement.style.setProperty("--fs", String(clamp(Number(s.fontSize)||15, 12, 20)) + "px");
  document.documentElement.classList.toggle("reduce-motion", !!s.reduceMotion);
}

function currentSettings(){
  const remote = state.me?.settings || {};
  return { ...state.localSettings, ...remote };
}

// --- Telegram
let tgBackBound = false;
async function telegramAutoLogin(){
  if(!tg) return;
  try{ tg.ready(); tg.expand(); }catch{}

  if(!tgBackBound){
    tgBackBound = true;
    tg.BackButton.onClick(()=>{
      if(state.page !== "chat") setPage("chat");
      else { try{ tg.close(); }catch{} }
    });
  }

  if(API.token) return;
  try{
    if(!tg.initData) return;
    const tok = await API.req("/auth/telegram", { method:"POST", body:{ init_data: tg.initData } });
    API.setToken(tok.access_token);
    haptic("notify","success");
  }catch(e){
    console.warn("TG login failed:", e.message);
  }
}

// --- navigation
function setPage(p){
  state.page = p;
  saveLocal();
  haptic("select");
  render();
}
function openDrawer(){ $(".backdrop")?.classList.add("show"); $(".sidebar.drawer")?.classList.add("open"); }
function closeDrawer(){ $(".backdrop")?.classList.remove("show"); $(".sidebar.drawer")?.classList.remove("open"); }

function navItems(){
  const items = [
    ["chat","Чат","⌘1"],
    ["projects","Проекты","⌘2"],
    ["media","Медиа","⌘3"],
    ["keys","Ключи","⌘4"],
    ["reminders","Напоминания","⌘5"],
    ["calendar","Календарь","⌘6"],
    ["notifications","Уведомления","⌘7"],
    ["settings","Настройки","⌘8"],
  ];
  if(isAdmin()) items.push(["admin","Админ","⌘9"]);
  return items;
}
function titleOf(p){
  return ({
    chat:"Чат", projects:"Проекты", media:"Медиа", keys:"Ключи", reminders:"Напоминания",
    calendar:"Календарь", notifications:"Уведомления", settings:"Настройки",
    admin:"Админ", login:"Вход"
  })[p] || "AI Platform";
}

function sidebar(isDrawer){
  const sb = el("div", isDrawer ? "sidebar drawer" : "sidebar");
  const head = el("div","card");
  head.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center">
      <div>
        <div class="h2">AI Platform</div>
        <div class="muted small">frontend</div>
      </div>
      <button class="iconbtn" id="sbClose" title="Закрыть">✕</button>
    </div>
  `;
  sb.appendChild(head);

  const nav = el("div","");
  navItems().forEach(([id,label,k])=>{
    const b = el("button","navbtn" + (state.page===id?" active":""));
    b.innerHTML = `<span>${label}</span><span class="k">${k}</span>`;
    b.onclick = ()=>{ setPage(id); if(isDrawer) closeDrawer(); };
    nav.appendChild(b);
  });
  sb.appendChild(nav);

  const quick = el("div","card");
  quick.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center">
      <div class="h2">Быстро</div>
      <span class="muted small">${isAuthed()? (esc(state.me?.email||"")) : "гость"}</span>
    </div>
    <div class="hr"></div>
    <div class="row">
      <button class="btn primary" id="qNew">Новый чат</button>
      <button class="btn" id="qClear">Очистить</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button class="btn" id="qDiag">Диагностика</button>
      <button class="btn" id="qPing">Ping API</button>
    </div>
  `;
  sb.appendChild(quick);

  setTimeout(()=>{
    $("#sbClose", sb)?.addEventListener("click", ()=>{ if(isDrawer) closeDrawer(); });
    $("#qNew", sb)?.addEventListener("click", ()=>{ state.chat=[]; state.chatDraft=""; saveLocal(); setPage("chat"); if(isDrawer) closeDrawer(); });
    $("#qClear", sb)?.addEventListener("click", ()=>{ if(confirm("Очистить локальные данные?")) resetLocalData(); if(isDrawer) closeDrawer(); });
    $("#qDiag", sb)?.addEventListener("click", ()=>{ showDiagnostics(); if(isDrawer) closeDrawer(); });
    $("#qPing", sb)?.addEventListener("click", async()=>{ await pingApi(); if(isDrawer) closeDrawer(); });
  },0);

  return sb;
}

function bottomNav(){
  const bn = el("div","bottom-nav");
  const short = [["chat","Чат"],["projects","Проекты"],["media","Медиа"],["settings","Настройки"]];
  short.forEach(([id,label])=>{
    const b = el("button", state.page===id?"active":"");
    b.textContent = label;
    b.onclick = ()=> setPage(id);
    bn.appendChild(b);
  });
  return bn;
}

function topbar(){
  const t = el("div","topbar");
  const left = el("div","row");
  const burger = el("button","iconbtn");
  burger.textContent = "☰";
  burger.title = "Меню";
  burger.onclick = ()=> openDrawer();
  left.appendChild(burger);
  const h = el("div","h1"); h.textContent = titleOf(state.page);
  left.appendChild(h);

  const right = el("div","row");
  const role = el("button","pillbtn");
  role.textContent = isAdmin()?"ADMIN":(isAuthed()?"USER":"GUEST");
  role.title = "Меню профиля";
  role.onclick = ()=> openUserMenu(role);
  right.appendChild(role);

  const authBtn = el("button","btn");
  authBtn.textContent = isAuthed()?"Выйти":"Войти";
  authBtn.onclick = ()=> isAuthed()? logout() : setPage("login");
  right.appendChild(authBtn);

  t.appendChild(left); t.appendChild(right);
  return t;
}

function render(){
  applyTheme();
  const root = $("#app");
  root.innerHTML = "";

  const backdrop = el("div","backdrop");
  backdrop.onclick = closeDrawer;
  root.appendChild(backdrop);

  root.appendChild(sidebar(true));

  const shell = el("div","shell");
  shell.appendChild(sidebar(false));
  const main = el("div","main");
  main.appendChild(topbar());
  main.appendChild(view());
  shell.appendChild(main);
  root.appendChild(shell);
  root.appendChild(bottomNav());

  if(tg){
    try{ (state.page!=="chat") ? tg.BackButton.show() : tg.BackButton.hide(); }catch{}
  }
}

function gate(label){
  const w = el("div","card");
  w.innerHTML = `
    <div class="h2">Нужен вход</div>
    <div class="muted">${esc(label)}</div>
    <div class="hr"></div>
    <button class="btn primary" id="go">Войти</button>
  `;
  setTimeout(()=>{ $("#go",w).onclick = ()=> setPage("login"); },0);
  return w;
}

function view(){
  const guestOk = new Set(["chat","projects","media","settings","login"]);
  if(!isAuthed() && !guestOk.has(state.page)) return gate("Этот раздел доступен только пользователю.");

  if(state.page==="login") return loginView();
  if(state.page==="chat") return chatView();
  if(state.page==="projects") return projectsView();
  if(state.page==="media") return mediaView();
  if(state.page==="keys") return keysView();
  if(state.page==="reminders") return remindersView();
  if(state.page==="calendar") return calendarView();
  if(state.page==="notifications") return notificationsView();
  if(state.page==="settings") return settingsView();
  if(state.page==="admin") return adminView();
  return el("div","card");
}

// --- user menu (GUEST pill)
function openUserMenu(anchorEl){
  const existing = $(".pop");
  if(existing) existing.remove();

  const pop = el("div","pop");
  const s = currentSettings();
  pop.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center">
      <div>
        <div class="h2">${isAuthed()? esc(state.me?.email||"Пользователь") : "Гостевой режим"}</div>
        <div class="muted small">API: ${esc(API.base)}</div>
      </div>
      <button class="iconbtn" id="x">✕</button>
    </div>
    <div class="hr"></div>
    <div class="row" style="flex-wrap:wrap">
      <button class="btn" id="goSettings">Настройки</button>
      <button class="btn" id="export">Экспорт</button>
      <button class="btn" id="import">Импорт</button>
      <button class="btn" id="reset">Сброс</button>
    </div>
    <div class="hr"></div>
    <div class="row" style="justify-content:space-between;align-items:center">
      <div class="muted small">Тема</div>
      <select id="theme" class="input" style="width:140px">
        <option value="auto">auto</option>
        <option value="light">light</option>
        <option value="dark">dark</option>
      </select>
    </div>
    <div class="row" style="justify-content:space-between;align-items:center">
      <div class="muted small">Размер шрифта</div>
      <input id="fs" type="range" min="12" max="20" value="${esc(s.fontSize)}" />
    </div>
    <div class="row" style="justify-content:space-between;align-items:center">
      <div class="muted small">Reduce motion</div>
      <input id="rm" type="checkbox" ${s.reduceMotion?"checked":""} />
    </div>
  `;
  document.body.appendChild(pop);

  const r = anchorEl.getBoundingClientRect();
  pop.style.top = (r.bottom + 8) + "px";
  pop.style.right = "12px";

  const close = ()=> pop.remove();
  $("#x",pop).onclick = close;
  $("#goSettings",pop).onclick = ()=>{ close(); setPage("settings"); };
  $("#export",pop).onclick = ()=>{ exportAll(); close(); };
  $("#import",pop).onclick = ()=>{ importAll(); close(); };
  $("#reset",pop).onclick = ()=>{ if(confirm("Сбросить локальные данные?")) resetLocalData(); close(); };

  $("#theme",pop).value = s.theme || "auto";
  $("#theme",pop).onchange = ()=>{ state.localSettings.theme = $("#theme",pop).value; saveLocal(); applyTheme(); };
  $("#fs",pop).oninput = ()=>{ state.localSettings.fontSize = Number($("#fs",pop).value); saveLocal(); applyTheme(); };
  $("#rm",pop).onchange = ()=>{ state.localSettings.reduceMotion = $("#rm",pop).checked; saveLocal(); applyTheme(); };

  setTimeout(()=>{
    const off = (ev)=>{ if(!pop.contains(ev.target) && ev.target!==anchorEl){ document.removeEventListener("mousedown", off); close(); } };
    document.addEventListener("mousedown", off);
  },0);
}

// --- auth
function loginView(){
  const w = el("div","card");
  w.innerHTML = `
    <div class="h2">Вход</div>
    <div class="muted">Telegram: обычно авто. Web: email+password.</div>
    <div class="hr"></div>
    <input id="email" class="input" placeholder="email" />
    <input id="pass" class="input" type="password" placeholder="password" style="margin-top:8px" />
    <div class="row" style="margin-top:10px">
      <button id="login" class="btn primary">Войти</button>
      <button id="guest" class="btn">Продолжить как гость</button>
    </div>
    <div class="hr"></div>
    <div class="muted small">API base можно поменять в Настройках → Сеть.</div>
  `;
  setTimeout(()=>{
    $("#guest",w).onclick = ()=> setPage("chat");
    $("#login",w).onclick = async ()=>{
      try{
        const email = $("#email",w).value.trim();
        const password = $("#pass",w).value;
        const tok = await API.req("/auth/login", { method:"POST", body:{ email, password } });
        API.setToken(tok.access_token);
        await boot();
        setPage("chat");
      }catch(e){ toast(e.message,false); }
    };
  },0);
  return w;
}

async function logout(){
  API.setToken("");
  state.me=null; state.providers=[]; state.models={};
  toast("Вы вышли", true);
  setPage("chat");
}

// --- chat
function chatView(){
  const s = currentSettings();
  const w = el("div", "card");
  const banner = !isAuthed() ? `<div class="pill warn">Гостевой DEMO: ответы генерируются локально</div>` : ``;
  w.innerHTML = `
    ${banner}
    <div class="chat ${s.chatCompact?"compact":""}" id="chat"></div>
    <div class="hr"></div>
    <div class="row" style="align-items:flex-end">
      <button class="iconbtn" id="attach" title="Прикрепить">📎</button>
      <div style="flex:1">
        <textarea id="prompt" class="input" rows="3" placeholder="Напишите сообщение..."></textarea>
        <div id="attList" class="att-list"></div>
      </div>
      <button class="btn primary" id="send">Отправить</button>
    </div>
    <div class="row" style="margin-top:8px;justify-content:space-between">
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="btn" id="copyLast">Копировать ответ</button>
        <button class="btn" id="exportChat">Экспорт чата</button>
        <button class="btn" id="importChat">Импорт</button>
      </div>
      <div class="row" style="gap:8px">
        <button class="btn" id="clearChat">Очистить</button>
      </div>
    </div>
    <input id="filePick" type="file" multiple style="display:none" />
  `;

  function renderChat(){
    const box = $("#chat", w);
    box.innerHTML = "";
    state.chat.forEach(m=>{
      const item = el("div", "msg " + (m.role==="user"?"u":"a"));
      const body = el("div","bubble");
      body.innerHTML = s.chatMarkdown ? renderMarkdown(m.content||"") : `<pre class="plain">${esc(m.content||"")}</pre>`;
      item.appendChild(body);
      if(m.attachments?.length){
        const at = el("div","att");
        m.attachments.forEach(a=>{
          const c = el("div","att-item");
          if(a.type?.startsWith("image/") && a.dataUrl){ c.innerHTML = `<img src="${a.dataUrl}" alt="" /><div>${esc(a.name)}</div>`; }
          else if(a.type?.startsWith("video/") && a.dataUrl){ c.innerHTML = `<video src="${a.dataUrl}" controls></video><div>${esc(a.name)}</div>`; }
          else { c.innerHTML = `<div class="pill">${esc(a.type||"file")}</div><div>${esc(a.name)}</div>`; }
          at.appendChild(c);
        });
        item.appendChild(at);
      }
      box.appendChild(item);
    });
    if(s.chatAutoscroll){ box.scrollTop = box.scrollHeight; }
  }

  function renderAttList(){
    const a = $("#attList", w);
    a.innerHTML = "";
    if(!state.attachments.length) return;
    state.attachments.forEach((f, idx)=>{
      const chip = el("div","chip");
      chip.innerHTML = `<span>${esc(f.name)}</span><button class="iconbtn" title="Удалить">✕</button>`;
      chip.querySelector("button").onclick = ()=>{ state.attachments.splice(idx,1); renderAttList(); };
      a.appendChild(chip);
    });
  }

  async function pickFiles(files){
    const maxMB = Number(s.maxAttachmentMB)||10;
    for(const file of files){
      if(file.size > maxMB*1024*1024){ toast(`Файл слишком большой: ${file.name} (лимит ${maxMB}MB)`, false); continue; }
      const att = await fileToAttachment(file);
      state.attachments.push(att);
    }
    renderAttList();
  }

  async function send(){
    const prompt = $("#prompt", w).value.trim();
    if(!prompt && !state.attachments.length) return;
    const userMsg = { role:"user", content: prompt, ts: Date.now(), attachments: state.attachments.splice(0) };
    state.chat.push(userMsg);
    $("#prompt", w).value = "";
    state.chatDraft = "";
    saveLocal();
    renderAttList();
    renderChat();

    try{
      if(!isAuthed()){
        const demo = await demoAnswer(prompt, userMsg.attachments);
        await appendAssistant(demo, s.chatTypewriter);
        return;
      }
      const payload = {
        messages: state.chat.slice(-40).map(m=>({ role:m.role, content:m.content, attachments:m.attachments||[] }))
      };
      let data;
      try{ data = await API.req("/ai/chat", { method:"POST", body: payload }); }
      catch{ data = await API.req("/ai/ask", { method:"POST", body: payload }); }
      const text = data?.answer || data?.message || data?.content || JSON.stringify(data);
      await appendAssistant(text, s.chatTypewriter);
    }catch(e){
      await appendAssistant("Ошибка: " + e.message, false);
    }
  }

  async function appendAssistant(text, typewriter){
    const msg = { role:"assistant", content: String(text||""), ts: Date.now() };
    state.chat.push(msg);
    saveLocal();
    if(!typewriter){ renderChat(); return; }
    const full = msg.content;
    msg.content = "";
    renderChat();
    for(let i=0;i<full.length;i++){
      msg.content += full[i];
      if(i%3===0){ renderChat(); await sleep(10); }
    }
    msg.content = full;
    renderChat();
  }

  setTimeout(()=>{
    renderChat();
    const prompt = $("#prompt", w);
    prompt.value = state.chatDraft || "";
    prompt.addEventListener("input", ()=>{ state.chatDraft = prompt.value; saveLocal(); });
    prompt.addEventListener("keydown", (ev)=>{
      if((ev.ctrlKey||ev.metaKey) && ev.key==="Enter"){ ev.preventDefault(); send(); }
      if(ev.key==="Escape"){ state.attachments=[]; renderAttList(); }
    });

    $("#send", w).onclick = send;
    $("#attach", w).onclick = ()=> $("#filePick", w).click();
    $("#filePick", w).onchange = (e)=> pickFiles(e.target.files||[]);

    $("#clearChat", w).onclick = ()=>{ if(confirm("Очистить чат?")){ state.chat=[]; saveLocal(); renderChat(); } };
    $("#copyLast", w).onclick = ()=>{
      const last = [...state.chat].reverse().find(m=>m.role==="assistant");
      if(!last) return toast("Нет ответа", false);
      navigator.clipboard?.writeText(last.content||"").then(()=>toast("Скопировано", true)).catch(()=>toast("Clipboard недоступен", false));
    };
    $("#exportChat", w).onclick = ()=> exportJson("chat.json", state.chat);
    $("#importChat", w).onclick = ()=> importJsonFile(async (data)=>{
      if(Array.isArray(data)){ state.chat = data; saveLocal(); renderChat(); toast("Импортировано", true); }
      else toast("Неверный файл", false);
    });

    renderAttList();
  },0);
  return w;
}

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function fileToAttachment(file){
  const base = { name: file.name, type: file.type, size: file.size };
  if(file.type.startsWith("text/") && file.size < 200_000){
    const t = await file.text();
    return { ...base, text: t.slice(0, 200_000) };
  }
  if((file.type.startsWith("image/") || file.type.startsWith("video/")) && file.size < 5*1024*1024){
    const dataUrl = await new Promise((res, rej)=>{
      const fr = new FileReader();
      fr.onload = ()=>res(String(fr.result));
      fr.onerror = ()=>rej(new Error("read failed"));
      fr.readAsDataURL(file);
    });
    return { ...base, dataUrl };
  }
  return base;
}

async function demoAnswer(prompt, attachments){
  const files = attachments?.map(a=>a.name).filter(Boolean) || [];
  const hint = files.length ? `\n\nВложения: ${files.join(", ")}` : "";
  const text = (prompt||"").trim();
  const bullets = [
    "Я в гостевом режиме: это локальный DEMO-ответ.",
    "Для реальных ответов подключи бэкенд и войди.",
    "Локально работают: история, экспорт/импорт, вложения, проекты, медиа-инструменты."
  ];
  return `${bullets.join("\n")}${text?`\n\nТы написал: ${text}`:""}${hint}`;
}

function renderMarkdown(md){
  const safe = esc(md);
  let out = safe.replace(/```([\s\S]*?)```/g, (m, c)=>`<pre class="code">${c}</pre>`);
  out = out.replace(/`([^`]+)`/g, (m,c)=>`<code>${c}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, (m,c)=>`<b>${c}</b>`);
  out = out.replace(/\n\n+/g, "<br><br>");
  out = out.replace(/\n-\s+/g, "<br>• ");
  out = out.replace(/(https?:\/\/[^\s<]+)/g, (m)=>`<a href="${m}" target="_blank" rel="noopener">${m}</a>`);
  return `<div class="md">${out}</div>`;
}

// --- projects
function projectsView(){
  const w = el("div","card");
  const authed = isAuthed();
  w.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center">
      <div class="h2">Проекты</div>
      <span class="pill">${authed?"backend":"local"}</span>
    </div>
    <div class="hr"></div>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <input id="q" class="input" placeholder="Поиск..." style="flex:1;min-width:180px" />
      <select id="sort" class="input" style="width:160px">
        <option value="updated">Сначала новые</option>
        <option value="name">По имени</option>
      </select>
      <button id="new" class="btn primary">Создать</button>
    </div>
    <div id="list" class="list" style="margin-top:10px"></div>
  `;

  async function load(){
    if(authed){
      try{
        const data = await API.req("/projects?limit=200");
        state.localProjects = (data.projects||[]).map(p=>({
          id: p.id, name: p.name, desc: p.description||"", updated: Date.parse(p.updated_at||p.created_at||Date.now()) || Date.now(), backend:true
        }));
      }catch(e){
        toast("Не удалось загрузить проекты с backend: " + e.message + " (показываю локальные)", false);
      }
    }
    saveLocal();
    renderList();
  }

  function renderList(){
    const q = $("#q",w).value.trim().toLowerCase();
    const sort = $("#sort",w).value;
    let list = [...state.localProjects];
    if(q) list = list.filter(p=> (p.name||"").toLowerCase().includes(q) || (p.desc||"").toLowerCase().includes(q));
    if(sort==="name") list.sort((a,b)=>(a.name||"").localeCompare(b.name||""));
    else list.sort((a,b)=>(b.updated||0)-(a.updated||0));

    const out = $("#list",w);
    out.innerHTML = "";
    if(!list.length){ out.innerHTML = `<div class="muted">Пусто</div>`; return; }
    list.forEach(p=>{
      const c = el("div","card");
      c.innerHTML = `
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div style="min-width:0">
            <div class="h2" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name||"(без названия)")}</div>
            <div class="muted small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.desc||"")}</div>
          </div>
          <div class="row" style="gap:8px;flex-wrap:wrap;justify-content:flex-end">
            <button class="btn" data-act="open" data-id="${esc(p.id)}">Открыть</button>
            <button class="btn" data-act="edit" data-id="${esc(p.id)}">Редакт</button>
            <button class="btn danger" data-act="del" data-id="${esc(p.id)}">Удалить</button>
          </div>
        </div>
      `;
      out.appendChild(c);
    });
    out.querySelectorAll("button[data-act]").forEach(b=>{
      b.onclick = ()=>{
        const id = b.getAttribute("data-id");
        const act = b.getAttribute("data-act");
        const p = state.localProjects.find(x=>String(x.id)===String(id));
        if(!p) return;
        if(act==="open") openProject(p);
        if(act==="edit") editProject(p);
        if(act==="del") deleteProject(p);
      };
    });
  }

  function openProject(p){
    const msg = { role:"assistant", content:`Проект: **${p.name}**\n${p.desc||""}`.trim(), ts: Date.now() };
    state.chat.push(msg);
    saveLocal();
    toast("Проект отправлен в чат", true);
    setPage("chat");
  }
  function editProject(p){
    const name = prompt("Название", p.name||"") ?? null;
    if(name===null) return;
    const desc = prompt("Описание", p.desc||"") ?? null;
    if(desc===null) return;
    p.name = name.trim();
    p.desc = desc.trim();
    p.updated = Date.now();
    saveLocal();
    renderList();
  }
  function deleteProject(p){
    if(!confirm(`Удалить проект "${p.name}"?`)) return;
    state.localProjects = state.localProjects.filter(x=>x!==p);
    saveLocal();
    renderList();
  }

  setTimeout(()=>{
    $("#q",w).oninput = renderList;
    $("#sort",w).onchange = renderList;
    $("#new",w).onclick = ()=>{
      const name = prompt("Название проекта", "Новый проект");
      if(!name) return;
      state.localProjects.unshift({ id: "local_"+Math.random().toString(16).slice(2), name: name.trim(), desc: "", updated: Date.now(), backend:false });
      saveLocal();
      renderList();
    };
    load();
  },0);
  return w;
}

// --- Media
function mediaView(){
  const w = el("div","card");
  w.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center">
      <div class="h2">Медиа</div>
      <div class="row" style="gap:8px">
        <button class="btn" id="tabImg">Фото</button>
        <button class="btn" id="tabVid">Видео</button>
      </div>
    </div>
    <div class="hr"></div>
    <div id="pane"></div>
  `;
  const pane = $("#pane",w);
  const show = (tab)=>{
    if(tab==="img") pane.replaceChildren(imageEditor());
    else pane.replaceChildren(videoTools());
  };
  setTimeout(()=>{
    $("#tabImg",w).onclick = ()=> show("img");
    $("#tabVid",w).onclick = ()=> show("vid");
    show("img");
  },0);
  return w;
}

function imageEditor(){
  const wrap = el("div","");
  wrap.innerHTML = `
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <input id="pick" type="file" accept="image/*" class="input" style="padding:10px" />
      <button class="btn" id="paste">Вставить из буфера</button>
      <button class="btn" id="toChat">В чат</button>
      <button class="btn" id="savePng">Скачать PNG</button>
    </div>
    <div class="hr"></div>
    <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:2;min-width:260px">
        <canvas id="cv" class="canvas"></canvas>
      </div>
      <div style="flex:1;min-width:240px" class="card">
        <div class="h2">Инструменты</div>
        <div class="hr"></div>
        <div class="row" style="justify-content:space-between"><div class="muted small">Поворот</div><div class="row" style="gap:6px"><button class="btn" id="rotL">⟲</button><button class="btn" id="rotR">⟳</button></div></div>
        <div class="hr"></div>
        <label class="muted small">Brightness</label><input id="br" type="range" min="50" max="150" value="100" />
        <label class="muted small">Contrast</label><input id="ct" type="range" min="50" max="150" value="100" />
        <label class="muted small">Saturate</label><input id="st" type="range" min="0" max="200" value="100" />
        <div class="hr"></div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn" id="reset">Сброс</button>
          <button class="btn" id="fit">Подогнать</button>
        </div>
        <div class="hr"></div>
        <div class="muted small">Можно перетащить файл на canvas.</div>
      </div>
    </div>
  `;

  const cv = $("#cv", wrap);
  const ctx = cv.getContext("2d");
  let img = new Image();
  let loaded = false;

  function setCanvasSize(w,h){ cv.width = w; cv.height = h; }
  function draw(){
    if(!loaded) { ctx.clearRect(0,0,cv.width,cv.height); return; }
    const f = state.media.image.filter;
    ctx.save();
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.filter = `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%)`;
    const rot = ((state.media.image.rotate%360)+360)%360;
    const cw = cv.width, ch = cv.height;
    ctx.translate(cw/2, ch/2);
    ctx.rotate(rot * Math.PI/180);
    const iw = img.width, ih = img.height;
    const scale = Math.min(cw/iw, ch/ih);
    ctx.drawImage(img, -iw*scale/2, -ih*scale/2, iw*scale, ih*scale);
    ctx.restore();
  }
  function loadImageFromFile(file){
    const url = URL.createObjectURL(file);
    state.media.image.file = file;
    state.media.image.url = url;
    img = new Image();
    img.onload = ()=>{
      loaded = true;
      setCanvasSize(Math.min(900, img.width), Math.min(650, img.height));
      draw();
    };
    img.src = url;
  }
  function exportPngDataUrl(){ return cv.toDataURL("image/png"); }

  setTimeout(()=>{
    $("#pick", wrap).onchange = (e)=>{ const f = e.target.files?.[0]; if(f) loadImageFromFile(f); };
    $("#rotL", wrap).onclick = ()=>{ state.media.image.rotate -= 90; draw(); };
    $("#rotR", wrap).onclick = ()=>{ state.media.image.rotate += 90; draw(); };
    $("#br", wrap).oninput = (e)=>{ state.media.image.filter.brightness = Number(e.target.value); draw(); };
    $("#ct", wrap).oninput = (e)=>{ state.media.image.filter.contrast = Number(e.target.value); draw(); };
    $("#st", wrap).oninput = (e)=>{ state.media.image.filter.saturate = Number(e.target.value); draw(); };
    $("#reset", wrap).onclick = ()=>{
      state.media.image.filter = { brightness:100, contrast:100, saturate:100 };
      state.media.image.rotate = 0;
      $("#br",wrap).value=100; $("#ct",wrap).value=100; $("#st",wrap).value=100;
      draw();
    };
    $("#fit", wrap).onclick = ()=>{ if(loaded){ setCanvasSize(Math.min(900, img.width), Math.min(650, img.height)); draw(); } };
    $("#savePng", wrap).onclick = ()=>{ if(!loaded) return toast("Сначала выбери фото", false); downloadDataUrl("image.png", exportPngDataUrl()); };
    $("#toChat", wrap).onclick = async ()=>{
      if(!loaded) return toast("Сначала выбери фото", false);
      const dataUrl = exportPngDataUrl();
      const att = { name:"edited.png", type:"image/png", size: dataUrl.length, dataUrl };
      state.attachments.push(att);
      toast("Добавлено во вложения чата", true);
      setPage("chat");
    };
    $("#paste", wrap).onclick = async ()=>{
      try{
        const items = await navigator.clipboard.read();
        for(const it of items){
          for(const t of it.types){
            if(t.startsWith("image/")){
              const blob = await it.getType(t);
              loadImageFromFile(new File([blob], "pasted.png", { type: t }));
              return;
            }
          }
        }
        toast("В буфере нет изображения", false);
      }catch{ toast("Clipboard API недоступен", false); }
    };

    cv.addEventListener("dragover", (e)=>{ e.preventDefault(); cv.classList.add("drag"); });
    cv.addEventListener("dragleave", ()=> cv.classList.remove("drag"));
    cv.addEventListener("drop", (e)=>{
      e.preventDefault(); cv.classList.remove("drag");
      const f = e.dataTransfer?.files?.[0];
      if(f && f.type.startsWith("image/")) loadImageFromFile(f);
    });
  },0);
  return wrap;
}

function videoTools(){
  const wrap = el("div","");
  wrap.innerHTML = `
    <div class="muted">Базовый трим видео через FFmpeg.wasm (загрузка из CDN при первом запуске).</div>
    <div class="hr"></div>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <input id="pick" type="file" accept="video/*" class="input" style="padding:10px" />
      <button class="btn" id="trim">Trim</button>
      <button class="btn" id="toChat">В чат</button>
    </div>
    <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-start;margin-top:10px">
      <div style="flex:2;min-width:260px">
        <video id="v" controls class="video"></video>
      </div>
      <div style="flex:1;min-width:240px" class="card">
        <div class="h2">Обрезка</div>
        <div class="hr"></div>
        <label class="muted small">Start (sec)</label>
        <input id="start" class="input" type="number" min="0" step="0.1" value="0" />
        <label class="muted small" style="margin-top:8px">End (sec)</label>
        <input id="end" class="input" type="number" min="0" step="0.1" value="0" />
        <div class="hr"></div>
        <div id="log" class="muted small">Выбери файл…</div>
      </div>
    </div>
  `;

  const video = $("#v", wrap);
  let lastOut = null;

  function setLog(t){ $("#log",wrap).textContent = t; }

  async function loadVideo(file){
    const url = URL.createObjectURL(file);
    state.media.video.file = file;
    state.media.video.url = url;
    video.src = url;
    await new Promise(res=> video.onloadedmetadata = ()=>res());
    const dur = video.duration || 0;
    $("#start",wrap).value = 0;
    $("#end",wrap).value = dur ? dur.toFixed(1) : 0;
    setLog(`Длительность: ${dur.toFixed(1)}s`);
  }

  async function ensureFFmpeg(){
    if(window.__ffmpegReady) return window.__ffmpeg;
    setLog("Загрузка FFmpeg…");
    await loadScript("https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js");
    const { createFFmpeg, fetchFile } = window.FFmpeg;
    const ffmpeg = createFFmpeg({ log: false });
    await ffmpeg.load();
    window.__ffmpegReady = true;
    window.__ffmpeg = { ffmpeg, fetchFile };
    setLog("FFmpeg готов");
    return window.__ffmpeg;
  }

  async function trim(){
    const file = state.media.video.file;
    if(!file) return toast("Сначала выбери видео", false);
    const start = Math.max(0, Number($("#start",wrap).value)||0);
    const end = Math.max(0, Number($("#end",wrap).value)||0);
    if(end && end <= start) return toast("End должен быть больше Start", false);

    try{
      const { ffmpeg, fetchFile } = await ensureFFmpeg();
      setLog("Обрезка…");
      ffmpeg.FS('writeFile', 'in.mp4', await fetchFile(file));
      const args = end ? ['-ss', String(start), '-to', String(end), '-i', 'in.mp4', '-c', 'copy', 'out.mp4']
                       : ['-ss', String(start), '-i', 'in.mp4', '-c', 'copy', 'out.mp4'];
      await ffmpeg.run(...args);
      const data = ffmpeg.FS('readFile', 'out.mp4');
      lastOut = new Blob([data.buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(lastOut);
      video.src = url;
      setLog("Готово: out.mp4");
      toast("Trim готов", true);
    }catch(e){
      setLog("Ошибка: " + e.message);
      toast(e.message, false);
    }
  }

  setTimeout(()=>{
    $("#pick",wrap).onchange = (e)=>{ const f = e.target.files?.[0]; if(f) loadVideo(f); };
    $("#trim",wrap).onclick = trim;
    $("#toChat",wrap).onclick = async ()=>{
      if(!video.src) return toast("Нет видео", false);
      let att;
      if(lastOut && lastOut.size < 5*1024*1024){
        const dataUrl = await blobToDataUrl(lastOut);
        att = { name:"trimmed.mp4", type:"video/mp4", size:lastOut.size, dataUrl };
      }else{
        att = { name: lastOut?"trimmed.mp4":(state.media.video.file?.name||"video"), type:"video/mp4", size: lastOut?.size||0 };
      }
      state.attachments.push(att);
      toast("Добавлено во вложения чата", true);
      setPage("chat");
    };
  },0);
  return wrap;
}

function loadScript(src){
  return new Promise((res, rej)=>{
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = ()=>res();
    s.onerror = ()=>rej(new Error('script load failed'));
    document.head.appendChild(s);
  });
}
function blobToDataUrl(blob){
  return new Promise((res, rej)=>{
    const fr = new FileReader();
    fr.onload = ()=>res(String(fr.result));
    fr.onerror = ()=>rej(new Error('read failed'));
    fr.readAsDataURL(blob);
  });
}
function downloadDataUrl(filename, dataUrl){
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// --- gated pages stubs
function keysView(){ const w = el("div","card"); w.innerHTML = `<div class="h2">Ключи</div><div class="muted">Требуется backend.</div>`; return w; }
function remindersView(){ const w = el("div","card"); w.innerHTML = `<div class="h2">Напоминания</div><div class="muted">Требуется backend.</div>`; return w; }
function calendarView(){ const w = el("div","card"); w.innerHTML = `<div class="h2">Календарь</div><div class="muted">Требуется backend.</div>`; return w; }
function notificationsView(){ const w = el("div","card"); w.innerHTML = `<div class="h2">Уведомления</div><div class="muted">Требуется backend.</div>`; return w; }

// --- settings
function settingsView(){
  const authed = isAuthed();
  const s = currentSettings();
  const w = el("div","card");
  w.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center">
      <div class="h2">Настройки</div>
      <span class="pill">${authed?"sync":"local"}</span>
    </div>
    <div class="hr"></div>

    <div class="h2">Интерфейс</div>
    <label class="muted small">Тема</label>
    <select id="theme" class="input">
      <option value="auto">auto</option>
      <option value="light">light</option>
      <option value="dark">dark</option>
    </select>
    <label class="muted small" style="margin-top:8px">Размер шрифта</label>
    <input id="fs" type="range" min="12" max="20" value="${esc(s.fontSize)}" />
    <div class="row" style="justify-content:space-between;align-items:center;margin-top:6px">
      <div>Reduce motion</div><input id="rm" type="checkbox" ${s.reduceMotion?"checked":""} />
    </div>

    <div class="hr"></div>
    <div class="h2">Чат</div>
    <div class="row" style="justify-content:space-between;align-items:center"><div>Автоскролл</div><input id="as" type="checkbox" ${s.chatAutoscroll?"checked":""} /></div>
    <div class="row" style="justify-content:space-between;align-items:center"><div>Markdown</div><input id="md" type="checkbox" ${s.chatMarkdown?"checked":""} /></div>
    <div class="row" style="justify-content:space-between;align-items:center"><div>Typewriter</div><input id="tw" type="checkbox" ${s.chatTypewriter?"checked":""} /></div>
    <div class="row" style="justify-content:space-between;align-items:center"><div>Compact</div><input id="cp" type="checkbox" ${s.chatCompact?"checked":""} /></div>
    <div class="row" style="justify-content:space-between;align-items:center"><div>Haptics (TG)</div><input id="hp" type="checkbox" ${s.haptics?"checked":""} /></div>
    <label class="muted small" style="margin-top:8px">Лимит вложений (MB)</label>
    <input id="mb" class="input" type="number" min="1" max="50" value="${esc(s.maxAttachmentMB||10)}" />

    <div class="hr"></div>
    <div class="h2">Сеть</div>
    <label class="muted small">API base</label>
    <input id="api" class="input" placeholder="/api/v1 или https://domain/api/v1" value="${esc(API.base)}" />
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
      <button class="btn" id="ping">Ping</button>
      <button class="btn" id="copyApi">Копировать</button>
    </div>

    <div class="hr"></div>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button class="btn primary" id="save">Сохранить</button>
      <button class="btn" id="export">Экспорт</button>
      <button class="btn" id="import">Импорт</button>
      <button class="btn danger" id="reset">Сброс локальных</button>
    </div>
    <div class="muted small" style="margin-top:8px">Hotkeys: Ctrl/⌘ + 1..9, отправка: Ctrl/⌘+Enter</div>
  `;

  setTimeout(()=>{
    $("#theme",w).value = s.theme || "auto";
    $("#theme",w).onchange = ()=>{ state.localSettings.theme = $("#theme",w).value; saveLocal(); applyTheme(); };
    $("#fs",w).oninput = ()=>{ state.localSettings.fontSize = Number($("#fs",w).value); saveLocal(); applyTheme(); };
    $("#rm",w).onchange = ()=>{ state.localSettings.reduceMotion = $("#rm",w).checked; saveLocal(); applyTheme(); };

    const bind = (id, key)=>{ $(id,w).onchange = ()=>{ state.localSettings[key] = $(id,w).checked; saveLocal(); }; };
    bind("#as","chatAutoscroll");
    bind("#md","chatMarkdown");
    bind("#tw","chatTypewriter");
    bind("#cp","chatCompact");
    bind("#hp","haptics");

    $("#mb",w).oninput = ()=>{ state.localSettings.maxAttachmentMB = clamp(Number($("#mb",w).value)||10,1,50); saveLocal(); };
    $("#api",w).onchange = ()=>{ API.setBase($("#api",w).value); toast("API base сохранён", true); };
    $("#ping",w).onclick = pingApi;
    $("#copyApi",w).onclick = ()=> navigator.clipboard?.writeText(API.base).then(()=>toast("Скопировано", true)).catch(()=>toast("Clipboard недоступен", false));
    $("#export",w).onclick = exportAll;
    $("#import",w).onclick = importAll;
    $("#reset",w).onclick = ()=>{ if(confirm("Сбросить локальные данные?")) resetLocalData(); };

    $("#save",w).onclick = async ()=>{
      saveLocal();
      applyTheme();
      if(!authed){ toast("Сохранено локально", true); return; }
      try{
        const patch = {
          theme: state.localSettings.theme,
          haptics: state.localSettings.haptics,
          auto_scroll_chat: state.localSettings.chatAutoscroll,
        };
        await API.req("/users/me/settings", { method:"PUT", body: patch });
        await boot();
        toast("Синхронизировано", true);
      }catch(e){ toast("Backend sync error: " + e.message, false); }
    };
  },0);

  return w;
}

function adminView(){
  if(!isAdmin()) return gate("Доступ только администратору.");
  const w = el("div","card");
  w.innerHTML = `<div class="h2">Админ</div><div class="muted">UI-заготовка. Требуется backend endpoints.</div>`;
  return w;
}

// --- diagnostics / utils
async function pingApi(){
  try{
    const t0 = performance.now();
    let ok = null;
    try{ ok = await API.req("/health"); }
    catch{ ok = await API.req("/users/me"); }
    const ms = Math.round(performance.now()-t0);
    toast(`OK (${ms}ms)`, true);
    return ok;
  }catch(e){ toast("Ping failed: " + e.message, false); return null; }
}

function showDiagnostics(){
  const info = {
    authed: isAuthed(),
    apiBase: API.base,
    hasTG: !!tg,
    tgInitData: !!tg?.initData,
    ua: navigator.userAgent,
    time: new Date().toISOString(),
    localChatMessages: state.chat.length,
    localProjects: state.localProjects.length
  };
  exportJson("diagnostics.json", info);
  toast("diagnostics.json скачан", true);
}

function resetLocalData(){
  const keep = { token: localStorage.getItem("token") || "" };
  localStorage.clear();
  if(keep.token) localStorage.setItem("token", keep.token);
  state.chat = []; state.chatDraft=""; state.attachments=[];
  state.localProjects = []; state.localSettings = {
    theme:"auto", reduceMotion:false, fontSize:15, haptics:true,
    chatAutoscroll:true, chatMarkdown:true, chatTypewriter:false, chatCompact:false, chatSound:false, maxAttachmentMB:10
  };
  API.setBase("/api/v1");
  applyTheme();
  saveLocal();
  render();
}

function exportJson(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importJsonFile(onData){
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = async ()=>{
    const f = input.files?.[0];
    if(!f) return;
    try{
      const txt = await f.text();
      const data = JSON.parse(txt);
      await onData(data);
    }catch(e){ toast("Импорт не удался: " + e.message, false); }
  };
  input.click();
}

function exportAll(){
  exportJson("ai-platform-export.json", {
    version: 1,
    apiBase: API.base,
    localSettings: state.localSettings,
    chat: state.chat,
    localProjects: state.localProjects
  });
}

function importAll(){
  importJsonFile(async (data)=>{
    if(!data || typeof data !== "object") return toast("Неверный формат", false);
    if(data.apiBase) API.setBase(String(data.apiBase));
    if(data.localSettings) state.localSettings = { ...state.localSettings, ...data.localSettings };
    if(Array.isArray(data.chat)) state.chat = data.chat;
    if(Array.isArray(data.localProjects)) state.localProjects = data.localProjects;
    saveLocal();
    applyTheme();
    toast("Импортировано", true);
    render();
  });
}

// --- boot
async function boot(){
  applyTheme();
  if(!isAuthed()){
    state.me=null; state.providers=[]; state.models={};
    render();
    return;
  }
  try{
    state.me = await API.req("/users/me");
  }catch(e){
    API.setToken("");
    state.me=null;
    render();
    return;
  }
  try{
    const m = await API.req("/ai/models");
    state.providers = m.providers || [];
    state.models = m.models || {};
  }catch{ state.providers=[]; state.models={}; }
  render();
}

// --- hotkeys
window.addEventListener("keydown", (e)=>{
  if((e.ctrlKey||e.metaKey) && !e.shiftKey){
    const map = {"1":"chat","2":"projects","3":"media","4":"keys","5":"reminders","6":"calendar","7":"notifications","8":"settings","9":"admin"};
    const p = map[e.key];
    if(!p) return;
    if(p==="admin" && !isAdmin()) return;
    e.preventDefault();
    setPage(p);
  }
});
window.addEventListener("resize", ()=> closeDrawer());

// --- init
(async function init(){
  await telegramAutoLogin();
  await boot();
  if(!state.page) state.page = "chat";
  render();
})();
