/* AI Platform — Telegram Mini App first (no frameworks, SPA) */
const tg = window.Telegram?.WebApp || null;

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const el = (tag, cls) => { const n=document.createElement(tag); if(cls) n.className=cls; return n; };
const esc = (s)=> String(s??"").replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const uid = ()=> Math.random().toString(36).slice(2,10)+Date.now().toString(36);
const clamp = (n,min,max)=> Math.max(min, Math.min(max, n));

/* ----------------------- Storage helpers ----------------------- */
const LS = {
  get(k, d=null){ try{ const v=localStorage.getItem(k); return v? JSON.parse(v):d; }catch{return d;} },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)); },
  del(k){ localStorage.removeItem(k); }
};

const CLOUD = {
  async available(){
    try{ return !!tg?.CloudStorage; }catch{ return false; }
  },
  async get(key){
    if(!(await this.available())) return null;
    return new Promise((resolve)=> {
      tg.CloudStorage.getItem(key, (err, v)=> resolve(err? null : v));
    });
  },
  async set(key, value){
    if(!(await this.available())) return false;
    return new Promise((resolve)=> {
      tg.CloudStorage.setItem(key, String(value), (err)=> resolve(!err));
    });
  }
};


/* ----------------------- IndexedDB (attachments storage) ----------------------- */
/**
 * localStorage is too small for real files; we store small blobs in IndexedDB.
 * We persist only when file size <= max_inline_mb and file type is previewable.
 */
const IDB = {
  _db:null,
  async open(){
    if(this._db) return this._db;
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open("aiplatform", 1);
      req.onupgradeneeded = ()=> {
        const db = req.result;
        if(!db.objectStoreNames.contains("blobs")){
          db.createObjectStore("blobs");
        }
      };
      req.onsuccess = ()=> { this._db = req.result; resolve(this._db); };
      req.onerror = ()=> reject(req.error);
    });
  },
  async set(key, blob){
    const db = await this.open();
    return new Promise((resolve,reject)=>{
      const tx = db.transaction("blobs","readwrite");
      tx.objectStore("blobs").put(blob, key);
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=> reject(tx.error);
    });
  },
  async get(key){
    const db = await this.open();
    return new Promise((resolve,reject)=>{
      const tx = db.transaction("blobs","readonly");
      const req = tx.objectStore("blobs").get(key);
      req.onsuccess = ()=> resolve(req.result || null);
      req.onerror = ()=> reject(req.error);
    });
  },
  async del(key){
    const db = await this.open();
    return new Promise((resolve,reject)=>{
      const tx = db.transaction("blobs","readwrite");
      tx.objectStore("blobs").delete(key);
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=> reject(tx.error);
    });
  },
  async clear(){
    const db = await this.open();
    return new Promise((resolve,reject)=>{
      const tx = db.transaction("blobs","readwrite");
      tx.objectStore("blobs").clear();
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=> reject(tx.error);
    });
  }
};


/* ----------------------- App state ----------------------- */
const state = {
  ready:false,

  // tma
  tgUser: null,
  tgTheme: null,

  // auth/API (optional)
  apiBase: LS.get("apiBase", "/api/v1"),
  token: LS.get("token", ""),

  // routing
  route: { name:"chat", params:{} }, // chat|projects|media|settings|diagnostics|project|chat
  drawerOpen:false,

  // data
  projects: LS.get("projects", []),
  activeProjectId: LS.get("activeProjectId", null),
  chats: LS.get("chats", {}), // projectId -> [{id,title,messages:[...]}]
  activeChatId: LS.get("activeChatId", null),

  // ui
  composing:"",
  attachments: [], // pending attachments for current send
  searchQuery:"",
  model: LS.get("model","DEMO"),
  models: ["DEMO","GPT-4","Claude","Llama","Custom"],

  settings: LS.get("settings", {
    theme: "telegram", // telegram|dark|light
    reduce_motion: false,
    haptics: true,
    enter_to_send: true,
    markdown: true,
    streaming: true,
    compact: false,
    max_inline_mb: 4,
    save_to_cloud: true
  }),
};

/* ----------------------- Telegram integration ----------------------- */
function applyTelegramTheme(){
  if(!tg) return;
  const p = tg.themeParams || {};
  state.tgTheme = p;

  // Telegram can provide hex colors; fall back to defaults
  const css = document.documentElement.style;

  // helper: accept Telegram format like "#fff" or "rgb()"
  const set = (varName, val)=> { if(val) css.setProperty(varName, val); };

  // main colors
  set("--bg", p.bg_color);
  set("--text", p.text_color);
  set("--muted", p.hint_color);
  set("--accent", p.button_color);
  set("--line", p.hint_color ? `${p.hint_color}33` : null); // 20% alpha

  // derive panel/card if Telegram provides section_bg_color
  if(p.secondary_bg_color) set("--panel", p.secondary_bg_color);
  if(p.section_bg_color) set("--card", p.section_bg_color);

  // safe areas: Telegram viewport is already safe-ish, but iOS notch still applies via env()
}

function applyThemeOverride(){
  // user override theme (telegram/dark/light)
  const t = state.settings.theme;
  if(t === "telegram") return; // keep tg theme / defaults

  const css = document.documentElement.style;
  if(t === "light"){
    css.setProperty("--bg", "#f8fafc");
    css.setProperty("--text", "#0b1220");
    css.setProperty("--muted", "#64748b");
    css.setProperty("--line", "#e2e8f0");
    css.setProperty("--card", "rgba(0,0,0,.03)");
  }else if(t === "dark"){
    css.setProperty("--bg", "#0b0f17");
    css.setProperty("--text", "#e5e7eb");
    css.setProperty("--muted", "#94a3b8");
    css.setProperty("--line", "rgba(148,163,184,.18)");
    css.setProperty("--card", "rgba(255,255,255,.04)");
  }
}

function haptic(kind="impact", style="light"){
  if(!tg) return;
  if(state.settings.haptics === false) return;
  try{
    if(kind==="impact") tg.HapticFeedback.impactOccurred(style);
    if(kind==="notify") tg.HapticFeedback.notificationOccurred(style);
    if(kind==="select") tg.HapticFeedback.selectionChanged();
  }catch{}
}

function tgToast(title, message){
  if(tg?.showPopup){
    tg.showPopup({title, message: String(message), buttons:[{type:"ok"}]});
  }else{
    toast(`${title}: ${message}`, false);
  }
}

/* ----------------------- Toasts ----------------------- */
let toastTimer = null;
function toast(message, ok=true, ms=2200){
  const wrap = $(".toast-wrap");
  if(!wrap) return;
  wrap.innerHTML = "";
  const t = el("div","toast");
  t.innerHTML = `<div class="${ok?'':'muted'}">${esc(message)}</div>`;
  wrap.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> { wrap.innerHTML=""; }, ms);
}

/* ----------------------- Router ----------------------- */
function parseHash(){
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query=""] = raw.split("?");
  const parts = (path || "chat").split("/").filter(Boolean);
  const name = parts[0] || "chat";
  const params = {};
  if(name === "project") params.id = parts[1] || null;
  if(name === "chat") params.id = parts[1] || null;
  if(query){
    query.split("&").forEach(kv=>{
      const [k,v=""] = kv.split("=");
      params[decodeURIComponent(k)] = decodeURIComponent(v);
    });
  }
  return {name, params};
}
function go(hash){
  if(hash.startsWith("#")) location.hash = hash;
  else location.hash = "#/"+hash.replace(/^\/?/,"");
}
function setRoute(r){
  state.route = r;
  render();
  syncTgButtons();
}

/* ----------------------- Data model ----------------------- */
function ensureProject(){
  if(state.projects.length===0){
    const p = {id: uid(), name:"Первый проект", color:"#60a5fa", archived:false, created_at: Date.now(), template:"empty"};
    state.projects.unshift(p);
    state.activeProjectId = p.id;
    state.chats[p.id] = [{id: uid(), title:"Новый чат", created_at: Date.now(), messages: []}];
    state.activeChatId = state.chats[p.id][0].id;
    persistAll();
  }
  if(!state.activeProjectId || !state.projects.some(p=>p.id===state.activeProjectId)){
    state.activeProjectId = state.projects[0].id;
  }
  state.chats[state.activeProjectId] ??= [{id: uid(), title:"Новый чат", created_at: Date.now(), messages: []}];
  if(!state.activeChatId || !state.chats[state.activeProjectId].some(c=>c.id===state.activeChatId)){
    state.activeChatId = state.chats[state.activeProjectId][0]?.id || null;
  }
}

function persistAll(){
  LS.set("projects", state.projects);
  LS.set("activeProjectId", state.activeProjectId);
  LS.set("chats", state.chats);
  LS.set("activeChatId", state.activeChatId);
  LS.set("settings", state.settings);
  LS.set("model", state.model);
  LS.set("apiBase", state.apiBase);
  LS.set("token", state.token);
}

function currentProject(){
  return state.projects.find(p=>p.id===state.activeProjectId) || null;
}
function currentChat(){
  const arr = state.chats[state.activeProjectId] || [];
  return arr.find(c=>c.id===state.activeChatId) || null;
}

/* ----------------------- API (optional backend) ----------------------- */
const API = {
  async req(path, {method="GET", body=null, headers={}} = {}){
    const ctrl = new AbortController();
    const timer = setTimeout(()=> ctrl.abort(), 30000);
    try{
      const h = {"Content-Type":"application/json", ...headers};
      if(state.token) h.Authorization = `Bearer ${state.token}`;
      const res = await fetch(state.apiBase + path, {method, headers:h, body: body?JSON.stringify(body):null, signal: ctrl.signal});
      const txt = await res.text();
      let data=null; try{ data = txt?JSON.parse(txt):null; }catch{ data={raw:txt}; }
      if(!res.ok) throw new Error(data?.detail || data?.error || txt || "Request failed");
      return data;
    }finally{
      clearTimeout(timer);
    }
  },
  async ping(){
    const t0 = performance.now();
    await this.req("/health", {method:"GET"}); // if exists
    return Math.round(performance.now()-t0);
  }
};

async function telegramAutoInit(){
  if(!tg) return;
  try{
    tg.ready();
    tg.expand();
    applyTelegramTheme();
    applyThemeOverride();

    // store user
    state.tgUser = tg.initDataUnsafe?.user || null;

    // react to theme changes
    tg.onEvent?.("themeChanged", ()=>{
      applyTelegramTheme();
      applyThemeOverride();
      render();
    });

    tg.onEvent?.("viewportChanged", ()=>{
      // could save draft on minimize / resize, etc.
      persistAll();
    });
  }catch{}
}

/* ----------------------- UI pieces ----------------------- */
function navItems(){
  // Keep minimal for now; advanced sections can be added later
  return [
    ["chat","Чат"],
    ["projects","Проекты"],
    ["media","Медиа"],
    ["settings","Настройки"],
    ["diagnostics","Диагностика"],
  ];
}

function topbarTitle(){
  const r = state.route.name;
  if(r==="chat") return "Чат";
  if(r==="projects") return "Проекты";
  if(r==="project") return "Проект";
  if(r==="media") return "Медиа";
  if(r==="settings") return "Настройки";
  if(r==="diagnostics") return "Диагностика";
  return "AI Platform";
}

function userLabel(){
  if(state.tgUser){
    const n = [state.tgUser.first_name, state.tgUser.last_name].filter(Boolean).join(" ");
    return n || "User";
  }
  return "Guest";
}

function userMenuButton(){
  const btn = el("button","btn");
  btn.innerHTML = `<span class="pill" style="border:none;background:transparent;padding:0">${esc(userLabel())}</span>`;
  btn.onclick = ()=> { haptic("select"); openUserMenu(); };
  return btn;
}

function openDrawer(){ state.drawerOpen=true; render(); }
function closeDrawer(){ state.drawerOpen=false; render(); }

function sidebar(isDrawer){
  const sb = el("div", isDrawer ? "sidebar drawer" : "sidebar");
  const head = el("div","card");
  const p = currentProject();
  head.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div>
        <div class="h2">AI Platform</div>
        <div class="muted small">${tg ? "Telegram Mini App" : "Web"}</div>
      </div>
      <div class="pill" title="Модель">${esc(state.model)}</div>
    </div>
    <div class="hr"></div>
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div style="min-width:0">
        <div class="muted small">Проект</div>
        <div style="font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p?.name || "—")}</div>
      </div>
      <button class="btn icon" id="${isDrawer?'sb':'ds'}_proj">▾</button>
    </div>
  `;
  sb.appendChild(head);

  const nav = el("div","");
  navItems().forEach(([id,label])=>{
    const b = el("button","navbtn"+(state.route.name===id?" active":""));
    b.innerHTML = `<span>${label}</span>`;
    b.onclick = ()=>{ haptic("select"); go(id); if(isDrawer) closeDrawer(); };
    nav.appendChild(b);
  });
  sb.appendChild(nav);

  const quick = el("div","card");
  quick.innerHTML = `
    <div class="h2">Быстро</div>
    <div class="hr"></div>
    <div class="row" style="flex-wrap:wrap">
      <button class="btn primary" id="${isDrawer?'sb':'ds'}_newchat">Новый чат</button>
      <button class="btn" id="${isDrawer?'sb':'ds'}_export">Экспорт</button>
      <button class="btn" id="${isDrawer?'sb':'ds'}_import">Импорт</button>
    </div>
  `;
  sb.appendChild(quick);

  setTimeout(()=>{
    $(`#${isDrawer?'sb':'ds'}_newchat`, sb)?.addEventListener("click", ()=>{
      createChat();
      go("chat/"+state.activeChatId);
      if(isDrawer) closeDrawer();
    });
    $(`#${isDrawer?'sb':'ds'}_export`, sb)?.addEventListener("click", ()=>{ openExportModal(); if(isDrawer) closeDrawer(); });
    $(`#${isDrawer?'sb':'ds'}_import`, sb)?.addEventListener("click", ()=>{ openImportModal(); if(isDrawer) closeDrawer(); });
    $(`#${isDrawer?'sb':'ds'}_proj`, sb)?.addEventListener("click", ()=>{ openProjectPicker(); if(isDrawer) closeDrawer(); });
  },0);

  return sb;
}

function bottomNav(){
  const bn = el("div","bottom-nav");
  const short = [["chat","Чат"],["projects","Проекты"],["media","Медиа"],["settings","Настройки"]];
  short.forEach(([id,label])=>{
    const b = el("button", state.route.name===id ? "active":"");
    b.textContent = label;
    b.onclick = ()=>{ haptic("select"); go(id); };
    bn.appendChild(b);
  });
  return bn;
}

function topbar(){
  const wrap = el("div","topbar");
  const bar = el("div","bar");

  const left = el("div","row");
  const burger = el("button","btn icon");
  burger.textContent = "☰";
  burger.onclick = ()=>{ haptic("select"); openDrawer(); };
  left.appendChild(burger);

  const title = el("div","title");
  title.textContent = topbarTitle();
  left.appendChild(title);

  const mid = el("div","row");
  mid.style.flex="1";
  mid.style.justifyContent="center";
  const search = el("input","input");
  search.placeholder = "Поиск…";
  search.value = state.searchQuery || "";
  search.style.maxWidth="420px";
  search.oninput = (e)=> { state.searchQuery = e.target.value; render(); };
  mid.appendChild(search);

  const right = el("div","row");
  right.appendChild(userMenuButton());

  bar.appendChild(left);
  bar.appendChild(mid);
  bar.appendChild(right);

  wrap.appendChild(bar);
  return wrap;
}

/* ----------------------- Modals ----------------------- */
function showModal(title, contentNode, {onClose=null} = {}){
  const back = el("div","modal-back");
  const modal = el("div","modal");
  modal.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div class="h1">${esc(title)}</div>
      <button class="btn icon" id="m_close">✕</button>
    </div>
    <div class="hr"></div>
  `;
  modal.appendChild(contentNode);
  back.appendChild(modal);
  document.body.appendChild(back);

  const close = ()=>{
    back.remove();
    onClose && onClose();
  };
  $("#m_close", modal).onclick = close;
  back.addEventListener("click",(e)=>{ if(e.target===back) close(); });
  return {close, back, modal};
}

function openUserMenu(){
  const c = el("div","col");

  const row1 = el("div","row");
  row1.style.justifyContent="space-between";
  row1.innerHTML = `<div class="pill">${esc(tg? "TMA" : "Web")}</div><div class="pill">Model: ${esc(state.model)}</div>`;
  c.appendChild(row1);

  const modelSel = el("select","input");
  modelSel.innerHTML = state.models.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join("");
  modelSel.value = state.model;
  modelSel.onchange = ()=>{ state.model = modelSel.value; persistAll(); toast("Модель сохранена"); render(); };
  c.appendChild(labelWrap("Модель", modelSel));

  const btns = el("div","row");
  btns.style.flexWrap="wrap";
  const b1 = el("button","btn"); b1.textContent="Экспорт данных";
  b1.onclick = ()=>{ haptic("select"); openExportModal(); };
  const b2 = el("button","btn"); b2.textContent="Импорт данных";
  b2.onclick = ()=>{ haptic("select"); openImportModal(); };
  const b3 = el("button","btn danger"); b3.textContent="Сброс локальных данных";
  b3.onclick = ()=>{ haptic("impact","medium"); resetLocalData(); };
  btns.appendChild(b1); btns.appendChild(b2); btns.appendChild(b3);
  c.appendChild(btns);

  if(tg){
    const b = el("button","btn primary");
    b.textContent = "Отправить текущий чат в бота";
    b.onclick = ()=>{ haptic("impact","light"); sendCurrentChatToBot(); };
    c.appendChild(b);
  }

  showModal("Профиль", c);
}

function labelWrap(label, node){
  const w = el("div","col");
  const l = el("div","small muted");
  l.textContent = label;
  w.appendChild(l);
  w.appendChild(node);
  return w;
}

function openProjectPicker(){
  const c = el("div","col");
  const list = el("div","col");
  list.style.gap="8px";

  state.projects.filter(p=>!p.archived).forEach(p=>{
    const b = el("button","btn");
    b.style.display="flex";
    b.style.justifyContent="space-between";
    b.innerHTML = `<span style="display:flex;gap:10px;align-items:center;min-width:0">
      <span style="width:10px;height:10px;border-radius:999px;background:${esc(p.color||'#60a5fa')}"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span>
    </span>
    <span class="pill">${(state.chats[p.id]||[]).length} чатов</span>`;
    b.onclick = ()=>{
      state.activeProjectId = p.id;
      ensureProject();
      persistAll();
      toast("Проект выбран");
      go("chat/"+state.activeChatId);
    };
    list.appendChild(b);
  });

  const add = el("button","btn primary");
  add.textContent = "Новый проект";
  add.onclick = ()=> openCreateProjectModal();

  c.appendChild(list);
  c.appendChild(add);
  showModal("Выбор проекта", c);
}

function openCreateProjectModal(){
  const c = el("div","col");
  const name = el("input","input"); name.placeholder="Название проекта";
  const color = el("input","input"); color.type="color"; color.value="#60a5fa";
  const tmpl = el("select","input");
  tmpl.innerHTML = `
    <option value="empty">Пустой</option>
    <option value="data">Анализ данных</option>
    <option value="text">Генерация текста</option>
    <option value="image">Работа с изображениями</option>
  `;
  const create = el("button","btn primary");
  create.textContent="Создать";
  create.onclick = ()=>{
    const p = {id:uid(), name:(name.value.trim()||"Новый проект"), color:color.value, archived:false, created_at:Date.now(), template:tmpl.value};
    state.projects.unshift(p);
    state.activeProjectId = p.id;
    state.chats[p.id] = [seedChatForTemplate(tmpl.value)];
    state.activeChatId = state.chats[p.id][0].id;
    persistAll();
    toast("Проект создан");
    go("chat/"+state.activeChatId);
  };

  c.appendChild(labelWrap("Название", name));
  c.appendChild(labelWrap("Цвет", color));
  c.appendChild(labelWrap("Шаблон", tmpl));
  c.appendChild(create);

  showModal("Новый проект", c);
}

function seedChatForTemplate(t){
  const base = {id:uid(), title:"Новый чат", created_at:Date.now(), messages:[]};
  const sys = (text)=> ({id:uid(), role:"system", text, created_at:Date.now(), attachments:[]});
  if(t==="data"){
    base.title="Анализ данных";
    base.messages.push(sys("Ты помощник по анализу данных. Проси таблицы, CSV, формулы, делай выводы и отчёты."));
  }else if(t==="text"){
    base.title="Генерация текста";
    base.messages.push(sys("Ты помощник по текстам: структуры, переписывание, тон, SEO, сценарии."));
  }else if(t==="image"){
    base.title="Изображения";
    base.messages.push(sys("Ты помощник по изображениям: описания, идеи, промпты, обработка/анализ (если доступно)."));
  }
  return base;
}

function openExportModal(){
  const c = el("div","col");
  const hint = el("div","muted small");
  hint.textContent = "Экспортирует проекты, чаты, настройки (локально).";
  c.appendChild(hint);

  const btn = el("button","btn primary");
  btn.textContent="Скачать экспорт (.json)";
  btn.onclick = ()=>{
    const payload = {
      version: "tma-1",
      exported_at: new Date().toISOString(),
      user: state.tgUser ? {id:state.tgUser.id, name:userLabel()} : null,
      projects: state.projects,
      activeProjectId: state.activeProjectId,
      chats: state.chats,
      activeChatId: state.activeChatId,
      settings: state.settings,
      model: state.model,
      apiBase: state.apiBase,
    };
    downloadBlob(new Blob([JSON.stringify(payload,null,2)], {type:"application/json"}), "aiplatform-export.json");
    toast("Экспорт скачан");
  };
  c.appendChild(btn);

  showModal("Экспорт", c);
}

function openImportModal(){
  const c = el("div","col");
  const inp = el("input","input");
  inp.type="file";
  inp.accept="application/json,.json";
  const btn = el("button","btn primary");
  btn.textContent="Импортировать";
  btn.disabled=true;

  let file=null;
  inp.onchange = ()=>{ file = inp.files?.[0]||null; btn.disabled=!file; };

  btn.onclick = async ()=>{
    try{
      const txt = await file.text();
      const data = JSON.parse(txt);
      if(!data || !data.projects || !data.chats) throw new Error("Неверный формат экспорта");
      state.projects = data.projects || [];
      state.chats = data.chats || {};
      state.activeProjectId = data.activeProjectId || state.projects[0]?.id || null;
      state.activeChatId = data.activeChatId || (state.chats[state.activeProjectId]?.[0]?.id) || null;
      state.settings = {...state.settings, ...(data.settings||{})};
      state.model = data.model || state.model;
      state.apiBase = data.apiBase || state.apiBase;
      persistAll();
      ensureProject();
      toast("Импорт выполнен");
      go("chat/"+state.activeChatId);
    }catch(e){
      toast("Ошибка импорта: "+e.message, false, 3500);
    }
  };

  c.appendChild(inp);
  c.appendChild(btn);
  showModal("Импорт", c);
}

async function resetLocalData(){
  const keys = ["projects","activeProjectId","chats","activeChatId","settings","model","apiBase","token"];
  keys.forEach(k=> LS.del(k));
  try{ await IDB.clear(); }catch{}
  location.reload();
}


/* ----------------------- Utilities ----------------------- */
function downloadBlob(blob, filename){
  const a=document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 50);
}

function copyText(text){
  navigator.clipboard?.writeText(text).then(()=> toast("Скопировано")).catch(()=> toast("Не удалось скопировать", false));
}

/* ----------------------- Chat logic

async function openAttachmentModal(att){
  try{
    const blob = await IDB.get(att.storageKey || att.id);
    if(!blob){
      toast("Файл не найден локально. Для полного медиа нужно хранение/бэкенд.", false, 3200);
      return;
    }
    const kind = att.previewKind || isPreviewableFile(blob) || (att.type?.startsWith("image/")?"image":(att.type==="application/pdf"?"pdf":null));
    const url = URL.createObjectURL(blob);

    const c = el("div","col");
    if(kind==="image"){
      const img = new Image();
      img.src = url;
      img.style.width="100%";
      img.style.borderRadius="14px";
      img.style.border="1px solid var(--line)";
      c.appendChild(img);
    }else if(kind==="pdf"){
      const frame = el("iframe","");
      frame.src = url;
      frame.style.width="100%";
      frame.style.height="72vh";
      frame.style.border="1px solid var(--line)";
      frame.style.borderRadius="14px";
      c.appendChild(frame);
    }else{
      const txt = await blob.text().catch(()=> "");
      const pre = el("pre","");
      pre.style.whiteSpace="pre-wrap";
      pre.style.margin="0";
      pre.style.fontSize="12px";
      pre.textContent = txt.slice(0, 200_000);
      c.appendChild(pre);
    }

    const row = el("div","row");
    row.style.flexWrap="wrap";
    const dl = el("button","btn primary"); dl.textContent="Скачать";
    dl.onclick = ()=> downloadBlob(blob, att.name || "file");
    const toChat = el("button","btn"); toChat.textContent="В вложения";
    toChat.onclick = ()=>{
      // Recreate File and attach to current composer (kept in memory)
      const f = new File([blob], att.name || "file", {type: att.type || blob.type || "application/octet-stream"});
      state.attachments.push(fileToAttachment(f));
      toast("Добавлено в вложения");
      go("chat/"+state.activeChatId);
      setTimeout(()=> renderPendingAttachments(), 60);
    };
    row.appendChild(dl);
    row.appendChild(toChat);
    c.appendChild(el("div","hr"));
    c.appendChild(row);

    const {close} = showModal(att.name || "Файл", c, {onClose: ()=>{ try{ URL.revokeObjectURL(url); }catch{} }});
  }catch(e){
    toast("Не удалось открыть файл: "+e.message, false, 3200);
  }
}

 ----------------------- */
function createChat(){
  ensureProject();
  const arr = state.chats[state.activeProjectId];
  const c = {id:uid(), title:"Новый чат", created_at:Date.now(), messages:[]};
  arr.unshift(c);
  state.activeChatId = c.id;
  persistAll();
}

function pushMessage(role, text, {attachments=[]} = {}){
  const chat = currentChat();
  if(!chat) return;
  chat.messages.push({
    id: uid(),
    role,
    text,
    created_at: Date.now(),
    attachments
  });
  persistAll();
}

function renderMarkdownBasic(text){
  // minimal, safe-ish markdown (no HTML). headers, code blocks, inline code, bold/italic, links.
  // Note: keep it simple for MVP.
  let s = esc(text);
  // code blocks ```
  s = s.replace(/```([\s\S]*?)```/g, (m,code)=> `<pre style="white-space:pre-wrap;margin:10px 0;padding:10px;border:1px solid var(--line);border-radius:14px;background:rgba(0,0,0,.18)"><code>${code}</code></pre>`);
  // inline code
  s = s.replace(/`([^`]+)`/g, (m,c)=> `<code style="padding:2px 6px;border:1px solid var(--line);border-radius:10px;background:rgba(0,0,0,.12)">${c}</code>`);
  // bold / italic
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/\*([^*]+)\*/g, "<i>$1</i>");
  // links [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, `<a href="$2" target="_blank" rel="noopener">$1</a>`);
  // line breaks
  s = s.replace(/\n/g, "<br/>");
  return s;
}

async function simulateAIResponse(promptText){
  const chat = currentChat();
  if(!chat) return;
  const id = uid();
  chat.messages.push({id, role:"ai", text:"", created_at:Date.now(), attachments:[]});
  persistAll();
  render(); // show bubble immediately

  const full = `DEMO: я получил твоё сообщение:\n\n${promptText}\n\n— Можем подключить бэкенд для реального AI, стриминга, OCR, генерации изображений и т.д.`;
  const streaming = state.settings.streaming !== false;

  if(!streaming){
    chat.messages.find(m=>m.id===id).text = full;
    persistAll();
    render();
    return;
  }

  let i=0;
  const step = ()=>{
    i += clamp(Math.floor(Math.random()*8)+6, 6, 14);
    chat.messages.find(m=>m.id===id).text = full.slice(0, i);
    persistAll();
    renderChatLogScrollToBottom();
    if(i < full.length) setTimeout(step, state.settings.reduce_motion? 0 : 24);
    else haptic("notify","success");
  };
  step();
}

async function tryBackendAI(promptText){
  // If token exists and endpoint is available, use it; else fallback to demo.
  // Keep it tolerant: if backend fails, show error then demo.
  try{
    if(!state.token) throw new Error("no-token");
    const resp = await API.req("/ai/generate", {method:"POST", body:{
      prompt: promptText,
      provider: null,
      model: state.model==="DEMO"? null : state.model,
      temperature: 0.7,
      max_tokens: 2000,
      json_mode: false
    }});
    pushMessage("ai", resp?.response ?? "—");
    haptic("notify","success");
  }catch(e){
    if(e.message!=="no-token"){
      pushMessage("ai", "Ошибка API: "+e.message);
      haptic("notify","error");
    }
    await simulateAIResponse(promptText);
  }
}

function sendCurrentChatToBot(){
  try{
    const chat = currentChat();
    if(!tg || !chat) return;
    const payload = {
      project: currentProject()?.name,
      chat: chat.title,
      messages: chat.messages.slice(-30) // last messages
    };
    tg.sendData(JSON.stringify(payload));
    toast("Отправлено в бота");
  }catch(e){
    toast("Не удалось отправить: "+e.message, false);
  }
}

/* ----------------------- Attachments & Media ----------------------- */

function isPreviewableFile(file){
  const t = file.type || "";
  if(t.startsWith("image/")) return "image";
  if(t === "application/pdf") return "pdf";
  if(t.startsWith("text/") || t === "application/json" || t === "application/xml") return "text";
  return null;
}
async function maybePersistAttachmentBlob(att){
  // Persist to IDB only if previewable and small enough
  try{
    const f = att._file;
    if(!f) return false;
    const kind = isPreviewableFile(f);
    if(!kind) return false;

    const maxInline = (state.settings.max_inline_mb || 4) * 1024 * 1024;
    if(f.size > maxInline) return false;

    await IDB.set(att.storageKey, f);
    att.previewKind = kind;
    return true;
  }catch{
    return false;
  }
}

function fileToAttachment(file){
  const id = uid();
  return {
    id,
    storageKey: id, // key for IndexedDB blob store
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    lastModified: file.lastModified,
    previewKind: null, // image|pdf|text if stored in IDB
    // We keep File object in memory only for the pending send; for saved messages we store meta + storageKey
    _file: file,
    // session preview (not persisted)
    _url: URL.createObjectURL(file)
  };
}

function normalizeSavedAttachment(att){
  // Persist only metadata + storageKey (blob lives in IndexedDB, if saved)
  const out = {...att};
  delete out._file;
  delete out._url; // object URLs are session-scoped
  return out;
}

function collectAllMedia(){
  const items = [];
  Object.values(state.chats).forEach(arr=>{
    (arr||[]).forEach(c=>{
      (c.messages||[]).forEach(m=>{
        (m.attachments||[]).forEach(a=>{
          items.push({...a, _projectId: findProjectIdByChat(c.id), _chatId: c.id, _messageId: m.id});
        });
      });
    });
  });
  return items;
}

function findProjectIdByChat(chatId){
  for(const [pid, arr] of Object.entries(state.chats)){
    if((arr||[]).some(c=>c.id===chatId)) return pid;
  }
  return null;
}

function findAttachmentById(attId){
  for(const arr of Object.values(state.chats)){
    for(const c of (arr||[])){
      for(const m of (c.messages||[])){
        for(const a of (m.attachments||[])){
          if(a.id === attId) return a;
        }
      }
    }
  }
  return null;
}


/* ----------------------- Views ----------------------- */
function view(){
  const r = state.route;
  if(r.name==="chat") return chatView(r.params.id);
  if(r.name==="projects") return projectsView();
  if(r.name==="media") return mediaView();
  if(r.name==="settings") return settingsView();
  if(r.name==="diagnostics") return diagnosticsView();
  if(r.name==="project") return projectDetailView(r.params.id);
  return chatView();
}

function emptyState(title, desc, buttonText, onClick){
  const w = el("div","card");
  w.innerHTML = `<div class="h1">${esc(title)}</div><div class="muted" style="margin-top:6px">${esc(desc)}</div><div class="hr"></div>`;
  const b = el("button","btn primary");
  b.textContent = buttonText;
  b.onclick = onClick;
  w.appendChild(b);
  return w;
}

function chatView(chatId=null){
  ensureProject();
  if(chatId){
    const arr = state.chats[state.activeProjectId] || [];
    if(arr.some(c=>c.id===chatId)){
      state.activeChatId = chatId;
      persistAll();
    }
  }

  const chat = currentChat();
  if(!chat){
    return emptyState("Нет чата", "Создай новый чат, чтобы начать.", "Новый чат", ()=>{ createChat(); go("chat/"+state.activeChatId); });
  }

  const w = el("div","card");
  const proj = currentProject();
  const header = el("div","row");
  header.style.justifyContent="space-between";
  header.innerHTML = `
    <div style="min-width:0">
      <div class="h2" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(chat.title)}</div>
      <div class="muted small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${esc(proj?.name || "—")}
      </div>
    </div>
    <div class="row">
      <button class="btn" id="chat_rename">Переименовать</button>
      <button class="btn" id="chat_share">Поделиться</button>
    </div>
  `;
  w.appendChild(header);

  const chatlog = el("div","chatlog");
  chatlog.id="chatlog";
  w.appendChild(el("div","hr"));

  // render messages
  const messages = (chat.messages || []);
  if(messages.length===0){
    chatlog.appendChild(emptyState("Пустой чат", "Напиши сообщение или прикрепи файл. История сохраняется локально.", "Написать привет", ()=>{
      state.composing="Привет! Помоги мне с проектом.";
      render();
      $("#prompt")?.focus();
    }));
  }else{
    const q = (state.searchQuery||"").trim().toLowerCase();
    messages.forEach(m=>{
      if(q && !(m.text||"").toLowerCase().includes(q) && !m.attachments?.some(a=>a.name?.toLowerCase().includes(q))) return;

      const bubble = el("div","msg "+(m.role==="user"?"user":"ai"));
      const meta = el("div","meta");
      meta.innerHTML = `<span class="tag">${esc(m.role.toUpperCase())}</span><span class="tag">${new Date(m.created_at).toLocaleString()}</span>`;
      bubble.appendChild(meta);

      const body = el("div","");
      const txt = (m.text||"");
      if(m.role==="ai" && !txt.trim()){
        // skeleton while streaming/empty
        const s1 = el("div","skel"); s1.style.height="12px"; s1.style.width="72%";
        const s2 = el("div","skel"); s2.style.height="12px"; s2.style.width="88%"; s2.style.marginTop="10px";
        const s3 = el("div","skel"); s3.style.height="12px"; s3.style.width="64%"; s3.style.marginTop="10px";
        body.appendChild(s1); body.appendChild(s2); body.appendChild(s3);
      }else if(state.settings.markdown && m.role!=="user" && m.role!=="system"){
        body.innerHTML = renderMarkdownBasic(txt);
      }else{
        body.textContent = txt;
      }
      bubble.appendChild(body);

      if(m.attachments?.length){
        const ar = el("div","attach-row");
        m.attachments.forEach(a=>{
          const it = el("div","attach");
          it.innerHTML = `<div style="display:flex;flex-direction:column;min-width:0">
            <div class="name" title="${esc(a.name)}">${esc(a.name)}</div>
            <div class="muted small">${esc(a.type||"file")} · ${formatBytes(a.size||0)}</div>
          </div>
          <button class="btn" data-open="${esc(a.id)}">Открыть</button>`;
          ar.appendChild(it);
        });
        bubble.appendChild(ar);
      }

      if(m.role==="ai" && (m.text||"").trim()){
        const actions = el("div","actions");
        const b1 = el("button","btn"); b1.textContent="Копировать";
        b1.onclick = ()=> copyText(m.text||"");
        const b2 = el("button","btn"); b2.textContent="👍";
        b2.onclick = ()=> { toast("Спасибо!"); haptic("select"); };
        const b3 = el("button","btn"); b3.textContent="👎";
        b3.onclick = ()=> { toast("Принято"); haptic("select"); };
        actions.appendChild(b1); actions.appendChild(b2); actions.appendChild(b3);
        bubble.appendChild(actions);
      }

      chatlog.appendChild(bubble);
    });
  }

  w.appendChild(chatlog);

  // attachments composer
  const dz = el("div","dropzone");
  dz.id="dropzone";
  dz.innerHTML = `Перетащи файлы сюда или нажми «📎». Поддержка: изображения, видео, PDF, txt/csv.`;
  w.appendChild(el("div","hr"));
  w.appendChild(dz);

  const attRow = el("div","attach-row");
  attRow.id="pendingAtt";
  w.appendChild(attRow);

  const ta = el("textarea","input");
  ta.id="prompt";
  ta.rows = state.settings.compact ? 2 : 3;
  ta.placeholder = "Сообщение…";
  ta.value = state.composing || "";
  w.appendChild(el("div","hr"));
  w.appendChild(ta);

  const controls = el("div","row");
  controls.style.flexWrap="wrap";

  const fileBtn = el("button","btn icon");
  fileBtn.textContent="📎";
  fileBtn.title="Прикрепить файл";
  fileBtn.onclick = ()=> $("#filePick")?.click();

  const micBtn = el("button","btn icon");
  micBtn.textContent="🎙";
  micBtn.title="Голосовой ввод";
  micBtn.onclick = ()=> startVoiceInput(ta);

  const sendBtn = el("button","btn primary");
  sendBtn.id="sendBtn";
  sendBtn.textContent="Отправить";

  const clearBtn = el("button","btn");
  clearBtn.textContent="Очистить чат";
  clearBtn.onclick = ()=>{
    if(!confirm("Очистить сообщения в этом чате?")) return;
    // cleanup blobs for this chat
    try{
      (chat.messages||[]).forEach(m=> (m.attachments||[]).forEach(a=> { try{ IDB.del(a.storageKey||a.id); }catch{} }));
    }catch{}
    chat.messages = [];
    persistAll();
    toast("Чат очищен");
    haptic("notify","success");
    render();
  };

  const toolsBtn = el("button","btn");
  toolsBtn.textContent="Инструменты";
  toolsBtn.onclick = ()=> openChatToolsModal();

  controls.appendChild(fileBtn);
  controls.appendChild(micBtn);
  controls.appendChild(sendBtn);
  controls.appendChild(clearBtn);
  controls.appendChild(toolsBtn);

  const filePick = el("input","input");
  filePick.id="filePick";
  filePick.type="file";
  filePick.multiple = true;
  filePick.accept = "image/*,video/*,application/pdf,text/plain,text/csv";
  filePick.classList.add("hidden");

  w.appendChild(controls);
  w.appendChild(filePick);

  // events
  setTimeout(()=>{
    // focus
    if(!state.settings.reduce_motion) ta.focus();

    // render pending attachments
    renderPendingAttachments();

    // drag & drop
    dz.addEventListener("dragover",(e)=>{ e.preventDefault(); dz.classList.add("drag"); });
    dz.addEventListener("dragleave",()=> dz.classList.remove("drag"));
    dz.addEventListener("drop",(e)=>{
      e.preventDefault();
      dz.classList.remove("drag");
      const files = Array.from(e.dataTransfer.files||[]);
      addAttachments(files);
    });

    filePick.onchange = ()=> addAttachments(Array.from(filePick.files||[]));

    ta.oninput = ()=>{
      state.composing = ta.value;
      persistAll();
      syncTgButtons();
    };

    ta.addEventListener("keydown",(ev)=>{
      if(state.settings.enter_to_send && ev.key==="Enter" && !ev.shiftKey){
        ev.preventDefault();
        doSend();
      }
    });

    sendBtn.onclick = doSend;

    $("#chat_rename", w).onclick = ()=>{
      const t = prompt("Название чата:", chat.title);
      if(!t) return;
      chat.title = t.slice(0,80);
      persistAll();
      toast("Переименовано");
      render();
    };

    $("#chat_share", w).onclick = ()=>{
      const text = (chat.messages||[]).slice(-10).map(m=>`${m.role}: ${m.text}`).join("\n\n");
      if(tg?.openTelegramLink){
        // open share link (fallback)
        const url = "https://t.me/share/url?url="+encodeURIComponent("https://t.me")+"&text="+encodeURIComponent(text.slice(0,4000));
        tg.openLink(url);
      }else if(navigator.share){
        navigator.share({text}).catch(()=>{});
      }else{
        copyText(text);
      }
      toast("Поделиться: готово");
    };

    // open attachments (from chat bubbles)
    $$("button[data-open]", w).forEach(b=>{
      b.onclick = ()=>{
        const id = b.getAttribute("data-open");
        const a = findAttachmentById(id);
        if(a) openAttachmentModal(a);
        else toast("Вложение не найдено", false);
      };
    });

  },0);

  function doSend(){
    const text = (ta.value||"").trim();
    const pending = state.attachments.slice();
    if(!text && pending.length===0) return;

    // save user msg
    pushMessage("user", text || "(файлы)", {attachments: pending.map(normalizeSavedAttachment)});
    state.attachments.forEach(a=>{ try{ URL.revokeObjectURL(a._url); }catch{} });
    state.attachments = [];
    state.composing = "";
    ta.value="";
    persistAll();
    render();
    haptic("impact","light");

    // response
    if(state.model==="DEMO") simulateAIResponse(text || "Файлы прикреплены");
    else tryBackendAI(text || "Файлы прикреплены");
  }

  return w;
}

function renderPendingAttachments(){
  const cont = $("#pendingAtt");
  if(!cont) return;
  cont.innerHTML = "";
  state.attachments.forEach(a=>{
    const it = el("div","attach");
    it.innerHTML = `<div style="display:flex;flex-direction:column;min-width:0">
      <div class="name" title="${esc(a.name)}">${esc(a.name)}</div>
      <div class="muted small">${esc(a.type||"file")} · ${formatBytes(a.size||0)}</div>
    </div>
    <button class="btn danger" data-rm="${esc(a.id)}">Удалить</button>`;
    cont.appendChild(it);
  });
  $$("button[data-rm]", cont).forEach(b=>{
    b.onclick = ()=>{
      const id = b.getAttribute("data-rm");
      const idx = state.attachments.findIndex(x=>x.id===id);
      if(idx>=0){
        try{ URL.revokeObjectURL(state.attachments[idx]._url); }catch{}
        try{ IDB.del(state.attachments[idx].storageKey || state.attachments[idx].id); }catch{}
        state.attachments.splice(idx,1);
        renderPendingAttachments();
        syncTgButtons();
      }
    };
  });
}

async function addAttachments(files){
  if(!files?.length) return;
  const maxInline = (state.settings.max_inline_mb || 4) * 1024 * 1024;

  for(const f of files){
    const a = fileToAttachment(f);

    if(f.size > maxInline){
      toast(`Файл ${f.name} слишком большой для inline-превью, прикреплён как метаданные`, true, 2600);
    }else{
      // Try store for later preview (images/pdf/text)
      const ok = await maybePersistAttachmentBlob(a);
      if(ok && a.previewKind){
        toast(`Файл ${f.name} сохранён для предпросмотра`, true, 1600);
      }
    }

    state.attachments.push(a);
  }

  persistAll();
  renderPendingAttachments();
  haptic("select");
  syncTgButtons();
}


function projectsView(){
  ensureProject();
  const w = el("div","card");

  const top = el("div","row");
  top.style.justifyContent="space-between";
  top.innerHTML = `<div><div class="h2">Проекты</div><div class="muted small">Локально (MVP). Позже подключим бэкенд.</div></div>`;
  const add = el("button","btn primary");
  add.textContent="+";
  add.onclick = ()=> openCreateProjectModal();
  top.appendChild(add);
  w.appendChild(top);

  w.appendChild(el("div","hr"));

  const q = (state.searchQuery||"").trim().toLowerCase();
  const list = el("div","col");

  const items = state.projects.filter(p=>!p.archived).filter(p=> !q || p.name.toLowerCase().includes(q));
  if(items.length===0){
    w.appendChild(emptyState("Нет проектов", "Создай первый проект — в нём будут чаты, медиа и настройки.", "Создать проект", ()=> openCreateProjectModal()));
    return w;
  }

  items.forEach(p=>{
    const card = el("div","card");
    card.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <div style="min-width:0">
          <div class="row" style="gap:8px">
            <span style="width:10px;height:10px;border-radius:999px;background:${esc(p.color||'#60a5fa')}"></span>
            <div class="h2" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</div>
          </div>
          <div class="muted small">чаты: ${(state.chats[p.id]||[]).length} · шаблон: ${esc(p.template||"empty")}</div>
        </div>
        <div class="row" style="flex-wrap:wrap;justify-content:flex-end">
          <button class="btn" data-open="${esc(p.id)}">Открыть</button>
          <button class="btn" data-rename="${esc(p.id)}">Имя</button>
          <button class="btn" data-arch="${esc(p.id)}">Архив</button>
        </div>
      </div>
    `;
    list.appendChild(card);
  });

  w.appendChild(list);

  setTimeout(()=>{
    $$("button[data-open]", w).forEach(b=>{
      b.onclick=()=>{
        const id=b.getAttribute("data-open");
        state.activeProjectId = id;
        ensureProject();
        persistAll();
        go("chat/"+state.activeChatId);
        toast("Открыт проект");
      };
    });
    $$("button[data-rename]", w).forEach(b=>{
      b.onclick=()=>{
        const id=b.getAttribute("data-rename");
        const p=state.projects.find(x=>x.id===id);
        if(!p) return;
        const t=prompt("Новое имя проекта:", p.name);
        if(!t) return;
        p.name=t.slice(0,80);
        persistAll();
        toast("Переименовано");
        render();
      };
    });
    $$("button[data-arch]", w).forEach(b=>{
      b.onclick=()=>{
        const id=b.getAttribute("data-arch");
        const p=state.projects.find(x=>x.id===id);
        if(!p) return;
        p.archived = true;
        if(state.activeProjectId===id){
          state.activeProjectId = state.projects.find(x=>!x.archived)?.id || null;
          ensureProject();
        }
        persistAll();
        toast("В архиве");
        render();
      };
    });
  },0);

  return w;
}

function projectDetailView(pid){
  // not used in MVP; kept for future expansion
  const w = el("div","card");
  w.innerHTML = `<div class="h2">Проект</div><div class="muted small">ID: ${esc(pid||"—")}</div>`;
  return w;
}

function mediaView(){
  ensureProject();
  const w = el("div","card");
  w.innerHTML = `<div class="h2">Медиа</div><div class="muted small">Файлы из всех чатов (локально).</div><div class="hr"></div>`;

  const media = collectAllMedia();
  const q = (state.searchQuery||"").trim().toLowerCase();
  const items = media.filter(a=> !q || (a.name||"").toLowerCase().includes(q));

  if(items.length===0){
    w.appendChild(emptyState("Пока пусто", "Прикрепи файл в чате — и он появится здесь.", "Открыть чат", ()=> go("chat/"+state.activeChatId)));
    return w;
  }

  const list = el("div","col");
  items.slice().reverse().forEach(a=>{
    const card = el("div","card");
    const p = state.projects.find(x=>x.id===a._projectId);
    const chat = (state.chats[a._projectId]||[]).find(c=>c.id===a._chatId);
    card.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div style="min-width:0">
          <div class="h2" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.name)}</div>
          <div class="muted small">${esc(a.type||"file")} · ${formatBytes(a.size||0)}</div>
          <div class="muted small">Проект: ${esc(p?.name||"—")} · Чат: ${esc(chat?.title||"—")}</div>
        </div>
        <div class="row" style="flex-wrap:wrap;justify-content:flex-end">
          <button class="btn" data-open="${esc(a.id)}">Открыть</button>
          <button class="btn" data-send="${esc(a.id)}">В чат</button>
        </div>
      </div>
    `;
    list.appendChild(card);
  });
  w.appendChild(list);

  setTimeout(()=>{
    $$("button[data-open]", w).forEach(b=>{
      b.onclick = ()=> {
        const id=b.getAttribute("data-open");
        const a = items.find(x=>x.id===id) || findAttachmentById(id);
        if(a) openAttachmentModal(a);
        else toast("Вложение не найдено", false);
      };
    });
    $$("button[data-send]", w).forEach(b=>{
      b.onclick = ()=>{
        const id=b.getAttribute("data-send");
        const a = items.find(x=>x.id===id);
        if(!a) return;
        // attach as meta to pending attachments
        state.attachments.push({...a, id:uid()});
        go("chat/"+state.activeChatId);
        setTimeout(()=>{ renderPendingAttachments(); }, 50);
      };
    });
  },0);

  return w;
}

function settingsView(){
  const w = el("div","card");
  w.innerHTML = `<div class="h2">Настройки</div><div class="muted small">Часть настроек — локально. В TMA можно сохранять в CloudStorage.</div><div class="hr"></div>`;

  const tabs = el("div","row");
  tabs.style.flexWrap="wrap";

  const tabNames = [["profile","Профиль"],["chat","Чат"],["tma","Telegram"],["data","Данные"],["dev","Dev"]];
  const active = state.route.params.tab || "profile";

  tabNames.forEach(([id,label])=>{
    const b = el("button","btn"+(active===id?" primary":""));
    b.textContent = label;
    b.onclick = ()=> { haptic("select"); go("settings?tab="+encodeURIComponent(id)); };
    tabs.appendChild(b);
  });
  w.appendChild(tabs);
  w.appendChild(el("div","hr"));

  const body = el("div","col");
  w.appendChild(body);

  if(active==="profile"){
    const c = el("div","col");
    const who = el("div","card");
    who.innerHTML = `<div class="h2">${esc(userLabel())}</div><div class="muted small">${tg? "Telegram user" : "Web guest"}</div>`;
    c.appendChild(who);

    const theme = el("select","input");
    theme.innerHTML = `<option value="telegram">Telegram</option><option value="dark">Dark</option><option value="light">Light</option>`;
    theme.value = state.settings.theme || "telegram";
    theme.onchange = ()=>{
      state.settings.theme = theme.value;
      persistAll();
      applyTelegramTheme();
      applyThemeOverride();
      toast("Тема применена");
      render();
    };
    c.appendChild(labelWrap("Тема", theme));

    const compact = checkbox("Компактный режим", state.settings.compact, (v)=>{ state.settings.compact=v; persistAll(); render(); });
    const reduce = checkbox("Reduce motion", state.settings.reduce_motion, (v)=>{ state.settings.reduce_motion=v; persistAll(); render(); });
    c.appendChild(compact);
    c.appendChild(reduce);

    body.appendChild(c);
  }

  if(active==="chat"){
    const c = el("div","col");
    const enter = checkbox("Enter отправляет (Shift+Enter новая строка)", state.settings.enter_to_send, (v)=>{ state.settings.enter_to_send=v; persistAll(); });
    const md = checkbox("Markdown для ответов AI", state.settings.markdown, (v)=>{ state.settings.markdown=v; persistAll(); });
    const stream = checkbox("Стриминг (DEMO)", state.settings.streaming, (v)=>{ state.settings.streaming=v; persistAll(); });
    c.appendChild(enter); c.appendChild(md); c.appendChild(stream);

    const max = el("input","input");
    max.type="number"; max.min="1"; max.max="50";
    max.value = state.settings.max_inline_mb || 4;
    max.oninput = ()=>{ state.settings.max_inline_mb = clamp(parseInt(max.value||"4",10),1,50); persistAll(); };
    c.appendChild(labelWrap("Лимит inline-превью (MB)", max));

    const model = el("select","input");
    model.innerHTML = state.models.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join("");
    model.value = state.model;
    model.onchange = ()=>{ state.model=model.value; persistAll(); toast("Модель сохранена"); };
    c.appendChild(labelWrap("Модель по умолчанию", model));

    body.appendChild(c);
  }

  if(active==="tma"){
    const c = el("div","col");

    const h = el("div","card");
    h.innerHTML = `<div class="h2">Telegram</div><div class="muted small">${tg ? "WebApp API доступен" : "Открой в Telegram для TMA функций"}</div>`;
    c.appendChild(h);

    const hap = checkbox("Haptics", state.settings.haptics, (v)=>{ state.settings.haptics=v; persistAll(); });
    c.appendChild(hap);

    const cloud = checkbox("Сохранять (дублировать) настройки в CloudStorage", state.settings.save_to_cloud, async (v)=>{
      state.settings.save_to_cloud=v; persistAll();
      if(v && tg){
        await CLOUD.set("settings", JSON.stringify(state.settings));
        toast("Сохранено в CloudStorage");
      }
    });
    c.appendChild(cloud);

    if(tg){
      const send = el("button","btn primary");
      send.textContent = "Отправить diagnostics в бота";
      send.onclick = ()=> {
        const d = buildDiagnostics();
        tg.sendData(JSON.stringify({type:"diagnostics", data:d}));
        toast("Отправлено в бота");
      };
      c.appendChild(send);
    }

    body.appendChild(c);
  }

  if(active==="data"){
    const c = el("div","col");
    const exp = el("button","btn"); exp.textContent="Экспорт";
    exp.onclick = ()=> openExportModal();
    const imp = el("button","btn"); imp.textContent="Импорт";
    imp.onclick = ()=> openImportModal();
    const clr = el("button","btn danger"); clr.textContent="Сброс локальных данных";
    clr.onclick = ()=> resetLocalData();
    c.appendChild(exp); c.appendChild(imp); c.appendChild(clr);
    body.appendChild(c);
  }

  if(active==="dev"){
    const c = el("div","col");
    const api = el("input","input");
    api.value = state.apiBase || "/api/v1";
    api.oninput = ()=>{ state.apiBase = api.value.trim() || "/api/v1"; persistAll(); };
    c.appendChild(labelWrap("API base", api));

    const token = el("input","input");
    token.value = state.token || "";
    token.placeholder = "JWT token (опционально)";
    token.oninput = ()=>{ state.token = token.value.trim(); persistAll(); };
    c.appendChild(labelWrap("Token", token));

    const ping = el("button","btn primary"); ping.textContent="Ping API";
    ping.onclick = async ()=>{
      try{
        const t0=performance.now();
        await fetch(state.apiBase + "/health", {method:"GET"});
        const ms=Math.round(performance.now()-t0);
        toast(`Ping: ${ms} ms`);
      }catch(e){
        toast("Ping failed (нет /health или CORS)", false, 3200);
      }
    };

    const diag = el("button","btn"); diag.textContent="Скачать diagnostics.json";
    diag.onclick = ()=> {
      downloadBlob(new Blob([JSON.stringify(buildDiagnostics(),null,2)], {type:"application/json"}), "diagnostics.json");
      toast("Скачано");
    };

    c.appendChild(ping);
    c.appendChild(diag);
    body.appendChild(c);
  }

  // cloud sync (optional)
  setTimeout(async ()=>{
    if(tg && state.settings.save_to_cloud){
      const v = await CLOUD.get("settings");
      if(v){
        try{
          const parsed = JSON.parse(v);
          state.settings = {...state.settings, ...parsed};
          persistAll();
          applyTelegramTheme();
          applyThemeOverride();
          render();
        }catch{}
      }
      // always push latest
      await CLOUD.set("settings", JSON.stringify(state.settings));
    }
  },0);

  return w;
}

function diagnosticsView(){
  const d = buildDiagnostics();
  const w = el("div","card");
  w.innerHTML = `<div class="h2">Диагностика</div><div class="muted small">Полезно для отладки на устройствах.</div><div class="hr"></div>`;
  const pre = el("pre","");
  pre.style.whiteSpace="pre-wrap";
  pre.style.margin="0";
  pre.style.fontSize="12px";
  pre.textContent = JSON.stringify(d,null,2);
  w.appendChild(pre);

  const row = el("div","row");
  row.style.flexWrap="wrap";
  const b1 = el("button","btn primary"); b1.textContent="Скачать";
  b1.onclick = ()=> downloadBlob(new Blob([JSON.stringify(d,null,2)], {type:"application/json"}), "diagnostics.json");
  const b2 = el("button","btn"); b2.textContent="Отправить в бота";
  b2.onclick = ()=> {
    if(!tg) return toast("Открой в Telegram", false);
    tg.sendData(JSON.stringify({type:"diagnostics", data:d}));
    toast("Отправлено");
  };
  row.appendChild(b1); row.appendChild(b2);
  w.appendChild(el("div","hr"));
  w.appendChild(row);
  return w;
}

function buildDiagnostics(){
  return {
    version: "tma-spa-3",
    ts: new Date().toISOString(),
    tg: tg ? {
      platform: tg.platform,
      version: tg.version,
      colorScheme: tg.colorScheme,
      isExpanded: tg.isExpanded,
      viewportStableHeight: tg.viewportStableHeight,
      viewportHeight: tg.viewportHeight,
      themeParams: tg.themeParams
    } : null,
    user: state.tgUser ? {id: state.tgUser.id, name: userLabel(), lang: state.tgUser.language_code} : null,
    route: state.route,
    projects: state.projects.length,
    activeProjectId: state.activeProjectId,
    chatsInProject: (state.chats[state.activeProjectId]||[]).length,
    activeChatId: state.activeChatId,
    settings: state.settings,
    apiBase: state.apiBase,
    hasToken: !!state.token,
    ua: navigator.userAgent,
    online: navigator.onLine
  };
}

function checkbox(label, value, onChange){
  const w = el("div","row");
  w.style.justifyContent="space-between";
  const left = el("div","");
  left.textContent = label;
  const cb = el("input","");
  cb.type="checkbox";
  cb.checked = !!value;
  cb.onchange = ()=>{ onChange(cb.checked); toast("Сохранено"); };
  w.appendChild(left);
  w.appendChild(cb);
  return w;
}

function formatBytes(n){
  const u=["B","KB","MB","GB"];
  let i=0, v=n||0;
  while(v>=1024 && i<u.length-1){ v/=1024; i++; }
  return (i===0? v : v.toFixed(1))+" "+u[i];
}

function openChatToolsModal(){
  const c = el("div","col");
  const b1 = el("button","btn"); b1.textContent="Экспорт текущего чата (txt)";
  b1.onclick = ()=>{
    const chat = currentChat();
    const text = (chat?.messages||[]).map(m=>`${m.role.toUpperCase()}: ${m.text}`).join("\n\n");
    downloadBlob(new Blob([text],{type:"text/plain"}), `chat-${chat?.id||"export"}.txt`);
    toast("Скачано");
  };

  const b2 = el("button","btn"); b2.textContent="Открыть фото-редактор";
  b2.onclick = ()=> openPhotoEditor();

  const b3 = el("button","btn"); b3.textContent="Открыть видео-редактор (trim)";
  b3.onclick = ()=> openVideoEditor();

  c.appendChild(b1);
  c.appendChild(b2);
  c.appendChild(b3);
  showModal("Инструменты", c);
}

/* ----------------------- Photo editor (basic) ----------------------- */
function openPhotoEditor(){
  const c = el("div","col");

  const info = el("div","muted small");
  info.textContent = "MVP редактор: яркость/контраст/насыщенность, поворот, скачать PNG, отправить в чат (как вложение).";
  c.appendChild(info);

  const pick = el("input","input");
  pick.type="file";
  pick.accept="image/*";

  const canvas = el("canvas","");
  canvas.style.width="100%";
  canvas.style.border="1px solid var(--line)";
  canvas.style.borderRadius="14px";
  canvas.style.background="rgba(0,0,0,.12)";

  const ctx = canvas.getContext("2d");
  let img=null, angle=0, filt={b:1,c:1,s:1};

  function redraw(){
    if(!img) return;
    const w = img.naturalWidth, h = img.naturalHeight;
    const rot = ((angle%360)+360)%360;
    const cw = (rot===90||rot===270) ? h : w;
    const ch = (rot===90||rot===270) ? w : h;
    canvas.width = cw;
    canvas.height = ch;

    ctx.save();
    ctx.clearRect(0,0,cw,ch);
    ctx.filter = `brightness(${filt.b}) contrast(${filt.c}) saturate(${filt.s})`;
    ctx.translate(cw/2, ch/2);
    ctx.rotate((rot*Math.PI)/180);
    ctx.drawImage(img, -w/2, -h/2);
    ctx.restore();
  }

  pick.onchange = ()=>{
    const f = pick.files?.[0];
    if(!f) return;
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = ()=>{ img=im; angle=0; filt={b:1,c:1,s:1}; redraw(); URL.revokeObjectURL(url); };
    im.src = url;
  };

  const sliders = el("div","col");
  sliders.appendChild(range("Яркость", 0.5, 1.8, 0.01, 1, (v)=>{filt.b=v; redraw();}));
  sliders.appendChild(range("Контраст", 0.5, 1.8, 0.01, 1, (v)=>{filt.c=v; redraw();}));
  sliders.appendChild(range("Насыщенность", 0, 2, 0.01, 1, (v)=>{filt.s=v; redraw();}));

  const row = el("div","row");
  row.style.flexWrap="wrap";
  const rotL = el("button","btn"); rotL.textContent="⟲";
  rotL.onclick=()=>{ angle-=90; redraw(); };
  const rotR = el("button","btn"); rotR.textContent="⟳";
  rotR.onclick=()=>{ angle+=90; redraw(); };
  const dl = el("button","btn primary"); dl.textContent="Скачать PNG";
  dl.onclick=()=>{
    canvas.toBlob((blob)=>{
      if(!blob) return;
      downloadBlob(blob, "edited.png");
      toast("Скачано");
    }, "image/png");
  };
  const toChat = el("button","btn"); toChat.textContent="В чат (как вложение)";
  toChat.onclick=()=>{
    canvas.toBlob((blob)=>{
      if(!blob) return;
      const file = new File([blob], "edited.png", {type:"image/png"});
      state.attachments.push(fileToAttachment(file));
      toast("Добавлено в вложения");
      go("chat/"+state.activeChatId);
      setTimeout(()=> renderPendingAttachments(), 60);
    }, "image/png");
  };

  row.appendChild(rotL); row.appendChild(rotR); row.appendChild(dl); row.appendChild(toChat);

  // paste image
  window.addEventListener("paste", onPaste, {once:true});
  function onPaste(e){
    const item = Array.from(e.clipboardData?.items||[]).find(it=> it.type.startsWith("image/"));
    if(item){
      const f = item.getAsFile();
      if(f){
        const dt = new DataTransfer(); dt.items.add(f);
        pick.files = dt.files;
        pick.dispatchEvent(new Event("change"));
        toast("Вставлено из буфера");
      }
    }
  }

  c.appendChild(pick);
  c.appendChild(canvas);
  c.appendChild(sliders);
  c.appendChild(row);

  showModal("Фото-редактор", c, {onClose: ()=>{}});
}

function range(label, min, max, step, value, onInput){
  const w = el("div","col");
  const l = el("div","small muted"); l.textContent = `${label}: ${value}`;
  const r = el("input","input");
  r.type="range"; r.min=min; r.max=max; r.step=step; r.value=value;
  r.oninput = ()=>{ l.textContent = `${label}: ${Number(r.value).toFixed(2)}`; onInput(Number(r.value)); };
  w.appendChild(l); w.appendChild(r);
  return w;
}

/* ----------------------- Video editor (trim via ffmpeg.wasm, lazy) ----------------------- */
async function openVideoEditor(){
  const c = el("div","col");
  const info = el("div","muted small");
  info.textContent = "Trim видео работает в браузере через ffmpeg.wasm (подгружается с CDN). Для больших файлов может быть тяжело на телефоне.";
  c.appendChild(info);

  const pick = el("input","input");
  pick.type="file";
  pick.accept="video/*";

  const v = document.createElement("video");
  v.controls = true;
  v.style.width="100%";
  v.style.borderRadius="14px";
  v.style.border="1px solid var(--line)";
  v.style.background="rgba(0,0,0,.12)";
  v.preload="metadata";

  const start = el("input","input"); start.type="number"; start.min="0"; start.step="0.1"; start.placeholder="Start (сек)";
  const dur = el("input","input"); dur.type="number"; dur.min="0.1"; dur.step="0.1"; dur.placeholder="Duration (сек)";
  const row = el("div","row"); row.style.flexWrap="wrap";
  const trim = el("button","btn primary"); trim.textContent="Trim → MP4";
  const toChat = el("button","btn"); toChat.textContent="В чат";
  toChat.disabled = true;

  let file=null, outBlob=null;

  pick.onchange = ()=>{
    file = pick.files?.[0] || null;
    outBlob=null; toChat.disabled=true;
    if(!file) return;
    const url = URL.createObjectURL(file);
    v.src = url;
  };

  trim.onclick = async ()=>{
    if(!file) return toast("Выбери видео", false);
    const s = Math.max(0, Number(start.value||"0"));
    const d = Math.max(0.1, Number(dur.value||"2"));
    try{
      toast("Загрузка ffmpeg…", true, 1800);
      const {createFFmpeg, fetchFile} = await loadFFmpeg();
      const ffmpeg = createFFmpeg({log:false});
      if(!ffmpeg.isLoaded()) await ffmpeg.load();
      ffmpeg.FS("writeFile", "in.mp4", await fetchFile(file));
      // -ss start -t duration -c copy (fast) but may fail on some codecs; fallback to re-encode
      try{
        await ffmpeg.run("-ss", String(s), "-t", String(d), "-i", "in.mp4", "-c", "copy", "out.mp4");
      }catch{
        await ffmpeg.run("-ss", String(s), "-t", String(d), "-i", "in.mp4", "-c:v", "libx264", "-c:a", "aac", "out.mp4");
      }
      const data = ffmpeg.FS("readFile", "out.mp4");
      outBlob = new Blob([data.buffer], {type:"video/mp4"});
      downloadBlob(outBlob, "trimmed.mp4");
      toast("Готово: скачано");
      toChat.disabled = false;
    }catch(e){
      toast("Trim error: "+e.message, false, 3500);
    }
  };

  toChat.onclick = ()=>{
    if(!outBlob) return;
    const outFile = new File([outBlob], "trimmed.mp4", {type:"video/mp4"});
    state.attachments.push(fileToAttachment(outFile));
    toast("Добавлено в вложения");
    go("chat/"+state.activeChatId);
    setTimeout(()=> renderPendingAttachments(), 60);
  };

  row.appendChild(trim);
  row.appendChild(toChat);

  c.appendChild(pick);
  c.appendChild(v);
  c.appendChild(labelWrap("Start (сек)", start));
  c.appendChild(labelWrap("Duration (сек)", dur));
  c.appendChild(row);

  showModal("Видео-редактор", c);
}

let ffmpegCache = null;
async function loadFFmpeg(){
  if(ffmpegCache) return ffmpegCache;
  // CDN scripts (unpkg). Works without bundlers.
  await loadScript("https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/ffmpeg.min.js");
  // window.FFmpeg
  if(!window.FFmpeg) throw new Error("FFmpeg lib not loaded");
  ffmpegCache = window.FFmpeg;
  return ffmpegCache;
}
function loadScript(src){
  return new Promise((resolve,reject)=>{
    const s=document.createElement("script");
    s.src=src; s.onload=resolve; s.onerror=()=>reject(new Error("Failed to load "+src));
    document.head.appendChild(s);
  });
}

/* ----------------------- Voice input (Web Speech API) ----------------------- */
function startVoiceInput(target){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) return toast("SpeechRecognition недоступен", false, 2600);
  try{
    const rec = new SR();
    rec.lang = (state.tgUser?.language_code || "ru-RU");
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = "";
    rec.onresult = (e)=>{
      let s="";
      for(let i=e.resultIndex;i<e.results.length;i++){
        const r=e.results[i];
        if(r.isFinal) finalText += r[0].transcript;
        else s += r[0].transcript;
      }
      target.value = (state.composing||"") + finalText + s;
      state.composing = target.value;
      persistAll();
      syncTgButtons();
    };
    rec.onerror = ()=> toast("Ошибка распознавания", false);
    rec.onend = ()=> toast("Голосовой ввод завершён");
    rec.start();
    toast("Слушаю…");
  }catch{
    toast("Не удалось запустить микрофон", false);
  }
}

/* ----------------------- Telegram MainButton & BackButton ----------------------- */
let backBound = false;
let mainBound = false;

function syncTgButtons(){
  if(!tg) return;
  // MainButton: show on chat when there is text/attachments
  try{
    const isChat = state.route.name==="chat";
    const canSend = ((state.composing||"").trim().length>0) || (state.attachments.length>0);
    if(isChat && canSend){
      tg.MainButton.setText("Отправить");
      tg.MainButton.show();
      tg.MainButton.enable();
    }else{
      tg.MainButton.hide();
    }
  }catch{}

  // BackButton: show if not on main chat route
  try{
    const show = (state.route.name !== "chat") && !(state.route.name==="chat" && state.route.params.id);
    // On TMA we use BackButton for navigation to chat
    if(show) tg.BackButton.show();
    else tg.BackButton.hide();
  }catch{}
}

function bindTgButtonsOnce(){
  if(!tg) return;

  if(!backBound){
    backBound = true;
    tg.BackButton.onClick(()=> {
      haptic("select");
      if(state.drawerOpen){ closeDrawer(); return; }
      if(state.route.name!=="chat") go("chat/"+state.activeChatId);
      else tg.close();
    });
  }

  if(!mainBound){
    mainBound = true;
    tg.MainButton.onClick(()=> {
      // trigger send in chat if present
      const btn = $("#sendBtn");
      if(btn) btn.click();
    });
  }
}

/* ----------------------- Render ----------------------- */
function renderChatLogScrollToBottom(){
  const chatlog = $("#chatlog");
  if(chatlog) chatlog.scrollTop = chatlog.scrollHeight;
}

function render(){
  if(!state.ready) return;
  ensureProject();

  const root = $("#app");
  root.innerHTML="";

  const toastWrap = el("div","toast-wrap");
  root.appendChild(toastWrap);

  const backdrop = el("div","backdrop"+(state.drawerOpen?" show":""));
  backdrop.onclick = ()=> closeDrawer();
  root.appendChild(backdrop);

  const drawer = sidebar(true);
  if(state.drawerOpen) drawer.classList.add("open");
  root.appendChild(drawer);

  const shell = el("div","shell");
  shell.appendChild(sidebar(false));

  const main = el("div","main");
  main.appendChild(topbar());

  // content
  main.appendChild(view());
  shell.appendChild(main);
  root.appendChild(shell);
  root.appendChild(bottomNav());

  // close drawer on resize/orientation
  window.addEventListener("resize", ()=> { if(state.drawerOpen) closeDrawer(); }, {once:true});

  // wire drawer open state
  if(state.drawerOpen) setTimeout(()=> drawer.classList.add("open"), 0);

  // allow clicking nav while drawer open
  bindTgButtonsOnce();
  syncTgButtons();
}

/* ----------------------- Init ----------------------- */
function init(){
  state.ready = true;

  // routing
  window.addEventListener("hashchange", ()=> setRoute(parseHash()));
  setRoute(parseHash());

  // initial data
  ensureProject();

  // no desktop hotkeys in TMA (they are useless on mobile)
  // but keep one: Ctrl+K focuses search (web)
  window.addEventListener("keydown",(e)=>{
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="k"){
      e.preventDefault();
      const i = document.querySelector(".topbar input.input");
      if(i) i.focus();
    }
  });

  render();
}

(async function boot(){
  await telegramAutoInit();
  applyThemeOverride();
  init();
})();
