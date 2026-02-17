/* Telegram Mini App-first frontend */
const tg = window.Telegram?.WebApp || null;
const $ = (s, r=document) => r.querySelector(s);
const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
const esc = (s)=> String(s??"").replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

const API = {
  base: "/api/v1",
  token: localStorage.getItem("token") || "",
  setToken(t){ this.token = t||""; localStorage.setItem("token", this.token); },
  async req(path, {method="GET", body=null, headers={}} = {}) {
    const h = {"Content-Type":"application/json", ...headers};
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    const res = await fetch(this.base + path, {method, headers:h, body: body?JSON.stringify(body):null});
    const txt = await res.text();
    let data=null; try{ data = txt?JSON.parse(txt):null; } catch { data={raw:txt}; }
    if(!res.ok) throw new Error(data?.detail || data?.error || txt || "Request failed");
    return data;
  }
};

const state = {
  me:null,
  page:"chat",
  chat:[],
  providers:[],
  models:{},
  notifications:[],
  reminders:[],
  events:[]
};

function haptic(type="impact", style="light"){
  if(!tg) return;
  const s = state.me?.settings || {};
  if (s.haptics === false) return;
  try{
    if(type==="impact") tg.HapticFeedback.impactOccurred(style);
    if(type==="notify") tg.HapticFeedback.notificationOccurred(style);
    if(type==="select") tg.HapticFeedback.selectionChanged();
  }catch{}
}
function popup(title, message){
  if(tg?.showPopup) tg.showPopup({title, message:String(message), buttons:[{type:"ok"}]});
  else alert(`${title}: ${message}`);
}
function toast(msg, ok=true){ popup(ok?"Готово":"Ошибка", msg); }

async function telegramAutoLogin(){
  if(!tg) return;
  tg.ready(); tg.expand();
  // theme sync
  try{
    if(tg.colorScheme==="light"){
      document.documentElement.style.setProperty("--bg","#f8fafc");
      document.documentElement.style.setProperty("--text","#0b1220");
      document.documentElement.style.setProperty("--line","#e2e8f0");
      document.documentElement.style.setProperty("--muted","#64748b");
    }
  }catch{}
  if(API.token) return;
  try{
    if(!tg.initData) return;
    const tok = await API.req("/auth/telegram", {method:"POST", body:{init_data: tg.initData}});
    API.setToken(tok.access_token);
    haptic("notify","success");
  }catch(e){
    console.warn("TG login failed:", e.message);
  }
}

/* Layout */
function setPage(p){ state.page=p; haptic("select"); render(); }
function openDrawer(){ $(".backdrop")?.classList.add("show"); $(".sidebar.drawer")?.classList.add("open"); }
function closeDrawer(){ $(".backdrop")?.classList.remove("show"); $(".sidebar.drawer")?.classList.remove("open"); }

function navItems(){
  const items = [
    ["chat","Чат","⌘1"],
    ["projects","Проекты","⌘2"],
    ["keys","Ключи","⌘3"],
    ["reminders","Напоминания","⌘4"],
    ["calendar","Календарь","⌘5"],
    ["notifications","Уведомления","⌘6"],
    ["settings","Настройки","⌘7"],
  ];
  if(state.me?.is_admin) items.push(["admin","Админ","⌘8"]);
  return items;
}

function sidebar(isDrawer){
  const sb = el("div", isDrawer ? "sidebar drawer" : "sidebar");
  const head = el("div","card");
  head.innerHTML = `<div class="h2">AI Platform</div><div class="muted small">TG Mini App + Web</div>`;
  sb.appendChild(head);

  const nav = el("div","");
  navItems().forEach(([id,label,k])=>{
    const b = el("button","navbtn"+(state.page===id?" active":""));
    b.innerHTML = `<span>${label}</span><span class="k">${k}</span>`;
    b.onclick = ()=>{ setPage(id); if(isDrawer) closeDrawer(); };
    nav.appendChild(b);
  });
  sb.appendChild(nav);

  const quick = el("div","card");
  quick.innerHTML = `
    <div class="h2">Быстро</div>
    <div class="hr"></div>
    <div class="row">
      <button class="btn primary" id="qNew">Новый чат</button>
      <button class="btn" id="qReload">Обновить</button>
    </div>
  `;
  sb.appendChild(quick);

  setTimeout(()=>{
    $("#qNew",sb)?.addEventListener("click", ()=>{ state.chat=[]; setPage("chat"); if(isDrawer) closeDrawer(); });
    $("#qReload",sb)?.addEventListener("click", ()=>{ boot(); if(isDrawer) closeDrawer(); });
  },0);

  return sb;
}

function bottomNav(){
  const bn = el("div","bottom-nav");
  const short = [
    ["chat","Чат"],["projects","Проекты"],["keys","Ключи"],["settings","Настройки"]
  ];
  (state.me?.is_admin? short.concat([["admin","Админ"]]) : short).forEach(([id,label])=>{
    const b = el("button", state.page===id ? "active":"");
    b.textContent = label;
    b.onclick = ()=> setPage(id);
    bn.appendChild(b);
  });
  return bn;
}

function titleOf(p){
  return ({
    chat:"Чат", projects:"Проекты", keys:"Ключи", reminders:"Напоминания",
    calendar:"Календарь", notifications:"Уведомления", settings:"Настройки",
    admin:"Админ", login:"Вход"
  })[p] || "AI Platform";
}

function topbar(){
  const t = el("div","topbar");
  const left = el("div","row");
  const burger = el("button","btn");
  burger.textContent = "☰";
  burger.onclick = ()=> openDrawer();
  left.appendChild(burger);
  const h = el("div","h1"); h.textContent = titleOf(state.page);
  left.appendChild(h);

  const right = el("div","row");
  const role = el("span","pill");
  role.textContent = state.me?.is_admin ? "ADMIN" : (state.me ? "USER" : "GUEST");
  right.appendChild(role);

  const authBtn = el("button","btn");
  authBtn.textContent = API.token ? "Выйти" : "Войти";
  authBtn.onclick = ()=> API.token ? logout() : setPage("login");
  right.appendChild(authBtn);

  t.appendChild(left); t.appendChild(right);
  return t;
}

function render(){
  const root = $("#app");
  root.innerHTML = "";
  const backdrop = el("div","backdrop");
  backdrop.onclick = closeDrawer;
  root.appendChild(backdrop);

  const drawer = sidebar(true);
  root.appendChild(drawer);

  const shell = el("div","shell");
  shell.appendChild(sidebar(false));

  const main = el("div","main");
  main.appendChild(topbar());
  main.appendChild(view());
  shell.appendChild(main);

  root.appendChild(shell);
  root.appendChild(bottomNav());

  if(tg){
    tg.BackButton.onClick(()=> {
      if(state.page!=="chat") setPage("chat"); else tg.close();
    });
    if(state.page!=="chat") tg.BackButton.show(); else tg.BackButton.hide();
  }
}

function view(){
  if(!API.token && state.page!=="login") return loginView(true);
  if(state.page==="login") return loginView(false);
  if(state.page==="chat") return chatView();
  if(state.page==="projects") return projectsView();
  if(state.page==="keys") return keysView();
  if(state.page==="reminders") return remindersView();
  if(state.page==="calendar") return calendarView();
  if(state.page==="notifications") return notificationsView();
  if(state.page==="settings") return settingsView();
  if(state.page==="admin") return adminView();
  return el("div","card");
}

/* Auth */
function loginView(){
  const w = el("div","card");
  w.innerHTML = `
    <div class="h1">Вход</div>
    <div class="muted small">В Telegram обычно вход автоматический. Если нет — войди по email.</div>
    <div class="hr"></div>
    <label class="small muted">Email</label>
    <input class="input" id="email" placeholder="you@mail.com"/>
    <div style="height:8px"></div>
    <label class="small muted">Пароль</label>
    <input class="input" id="pass" type="password" placeholder="••••••••"/>
    <div class="hr"></div>
    <div class="row">
      <button class="btn primary" id="btnLogin">Войти</button>
      <button class="btn" id="btnReg">Регистрация</button>
    </div>
    <div class="muted small" style="margin-top:10px">Админ создаётся автоматически из ADMIN_EMAIL/ADMIN_PASSWORD</div>
  `;
  setTimeout(()=>{
    $("#btnLogin",w).onclick = async ()=>{
      try{
        const email=$("#email",w).value.trim();
        const password=$("#pass",w).value;
        const tok = await API.req("/auth/login_json",{method:"POST", body:{email,password}});
        API.setToken(tok.access_token);
        await boot();
        setPage("chat");
      }catch(e){ toast(e.message,false); }
    };
    $("#btnReg",w).onclick = async ()=>{
      try{
        const email=$("#email",w).value.trim();
        const password=$("#pass",w).value;
        const tok = await API.req("/auth/register",{method:"POST", body:{email,password,full_name:""}});
        API.setToken(tok.access_token);
        await boot();
        setPage("chat");
      }catch(e){ toast(e.message,false); }
    };
  },0);
  return w;
}

function logout(){
  API.setToken("");
  state.me=null;
  state.chat=[];
  setPage("login");
}

/* Chat */
function chatView(){
  const w = el("div","card");
  const provOpts = state.providers.map(p=>`<option value="${p}">${p}</option>`).join("");
  w.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div class="h2">AI чат</div>
      <span class="pill">${navigator.onLine?"online":"offline"}</span>
    </div>
    <div class="hr"></div>
    <div class="row">
      <select id="provider" class="input" style="max-width:45%">
        <option value="auto">auto</option>${provOpts}
      </select>
      <select id="model" class="input" style="max-width:55%">
        <option value="">model (auto)</option>
      </select>
    </div>
    <div style="height:10px"></div>
    <div class="chatlog" id="chatlog"></div>
    <div class="hr"></div>
    <textarea id="prompt" class="input" rows="3" placeholder="Напиши запрос..."></textarea>
    <div style="height:10px"></div>
    <div class="row">
      <button class="btn primary" id="send">Отправить</button>
      <button class="btn" id="clear">Очистить</button>
    </div>
    <div class="muted small" style="margin-top:8px">Ctrl/⌘+Enter — отправить</div>
  `;

  setTimeout(()=>{
    const chatlog=$("#chatlog",w);
    const provider=$("#provider",w);
    const model=$("#model",w);
    const prompt=$("#prompt",w);

    function renderChat(){
      chatlog.innerHTML="";
      state.chat.forEach(m=>{
        const b=el("div","msg "+(m.role==="user"?"user":"ai"));
        b.textContent=m.text;
        chatlog.appendChild(b);
      });
      if(state.me?.settings?.auto_scroll_chat !== false) chatlog.scrollTop=chatlog.scrollHeight;
    }
    function fillModels(){
      const p=provider.value;
      const arr = p==="auto" ? [] : (state.models[p]||[]);
      model.innerHTML = `<option value="">model (auto)</option>` + arr.map(x=>`<option value="${x}">${x}</option>`).join("");
    }
    provider.onchange=()=>{ fillModels(); haptic("select"); };
    fillModels(); renderChat();

    async function send(){
      const text=(prompt.value||"").trim();
      if(!text) return;
      state.chat.push({role:"user", text}); prompt.value=""; renderChat(); haptic("impact","light");
      try{
        const resp = await API.req("/ai/generate",{method:"POST", body:{
          prompt:text,
          provider: provider.value==="auto"? null : provider.value,
          model: model.value||null,
          temperature:0.7,
          max_tokens:4000,
          json_mode:false
        }});
        state.chat.push({role:"ai", text: resp.response});
        renderChat(); haptic("notify","success");
      }catch(e){
        state.chat.push({role:"ai", text:"Ошибка: "+e.message});
        renderChat(); haptic("notify","error");
      }
    }
    $("#send",w).onclick=send;
    $("#clear",w).onclick=()=>{ state.chat=[]; renderChat(); haptic("select"); };
    prompt.addEventListener("keydown",(ev)=>{ if((ev.ctrlKey||ev.metaKey)&&ev.key==="Enter"){ ev.preventDefault(); send(); } });
  },0);

  return w;
}

/* Projects */
function projectsView(){
  const w=el("div","card");
  w.innerHTML=`
    <div class="h2">Проекты</div>
    <div class="muted small">Создание/список проектов (MVP)</div>
    <div class="hr"></div>
    <div class="row">
      <input id="name" class="input" placeholder="Название проекта" />
      <button id="create" class="btn primary">Создать</button>
    </div>
    <div class="hr"></div>
    <div id="list" class="list muted">Загрузка...</div>
  `;
  setTimeout(async ()=>{
    const list=$("#list",w);
    async function load(){
      try{
        const items = await API.req("/projects");
        list.innerHTML="";
        (items||[]).forEach(p=>{
          const c=el("div","card");
          c.innerHTML=`<div class="row" style="justify-content:space-between">
            <div><div class="h2">${esc(p.name)}</div><div class="muted small">${esc(p.description||"")}</div></div>
            <span class="pill">${esc(p.status||"")}</span>
          </div>`;
          list.appendChild(c);
        });
        if(!items?.length) list.textContent="Пока проектов нет";
      }catch(e){ list.textContent="Ошибка: "+e.message; }
    }
    $("#create",w).onclick = async ()=>{
      try{
        const name=$("#name",w).value.trim()||"New Project";
        await API.req("/projects",{method:"POST", body:{name, description:"", type:"api", features:[]}});
        $("#name",w).value="";
        await load(); haptic("notify","success");
      }catch(e){ toast(e.message,false); }
    };
    await load();
  },0);
  return w;
}

/* Keys */
function keysView(){
  const w=el("div","card");
  w.innerHTML=`
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
    <div class="row">
      <button id="save" class="btn primary">Сохранить</button>
      <button id="refresh" class="btn">Обновить</button>
    </div>
    <div class="hr"></div>
    <div id="list" class="list muted">Загрузка...</div>
  `;
  setTimeout(async ()=>{
    const list=$("#list",w);
    async function load(){
      try{
        const items = await API.req("/ai/keys");
        list.innerHTML="";
        (items||[]).forEach(it=>{
          const r=el("div","row");
          r.style.justifyContent="space-between";
          r.innerHTML = `<span class="pill">${esc(it.provider)}</span>
                         <button class="btn danger" data-p="${esc(it.provider)}">Удалить</button>`;
          list.appendChild(r);
        });
        if(!items?.length) list.textContent="Ключей нет";
        list.querySelectorAll("button[data-p]").forEach(b=>{
          b.onclick = async ()=>{
            try{
              const p=b.getAttribute("data-p");
              await API.req(`/ai/keys/${encodeURIComponent(p)}`,{method:"DELETE"});
              await boot(); await load(); haptic("notify","success");
            }catch(e){ toast(e.message,false); }
          };
        });
      }catch(e){ list.textContent="Ошибка: "+e.message; }
    }
    $("#save",w).onclick = async ()=>{
      try{
        const provider=$("#prov",w).value;
        const api_key=$("#key",w).value.trim();
        if(!api_key) return toast("Пустой ключ", false);
        await API.req("/ai/keys",{method:"POST", body:{provider, api_key}});
        $("#key",w).value="";
        await boot(); await load(); haptic("notify","success");
      }catch(e){ toast(e.message,false); }
    };
    $("#refresh",w).onclick = async ()=>{ await boot(); await load(); };
    await load();
  },0);
  return w;
}

/* Reminders */
function remindersView(){
  const w=el("div","card");
  w.innerHTML=`
    <div class="h2">Напоминания</div>
    <div class="muted small">Создай напоминание (ISO дата). Пример: 2026-02-17T15:00:00</div>
    <div class="hr"></div>
    <input id="title" class="input" placeholder="Текст напоминания" />
    <div style="height:8px"></div>
    <input id="at" class="input" placeholder="remind_at (ISO)" />
    <div class="hr"></div>
    <button id="add" class="btn primary">Добавить</button>
    <div class="hr"></div>
    <div id="list" class="list muted">Загрузка...</div>
  `;
  setTimeout(async ()=>{
    const list=$("#list",w);
    async function load(){
      try{
        const data = await API.req("/reminders");
        state.reminders = data.reminders||[];
        list.innerHTML="";
        state.reminders.forEach(r=>{
          const c=el("div","card");
          c.innerHTML=`<div class="row" style="justify-content:space-between">
            <div><div class="h2">${esc(r.title)}</div><div class="muted small">${esc(r.remind_at||"")}</div></div>
            <button class="btn danger" data-id="${r.id}">Удалить</button>
          </div>`;
          list.appendChild(c);
        });
        if(!state.reminders.length) list.textContent="Нет напоминаний";
        list.querySelectorAll("button[data-id]").forEach(b=>{
          b.onclick = async ()=>{
            try{
              await API.req(`/reminders/${b.getAttribute("data-id")}`, {method:"DELETE"});
              await load(); haptic("notify","success");
            }catch(e){ toast(e.message,false); }
          };
        });
      }catch(e){ list.textContent="Ошибка: "+e.message; }
    }
    $("#add",w).onclick = async ()=>{
      try{
        const title=$("#title",w).value.trim();
        const remind_at=$("#at",w).value.trim();
        await API.req(`/reminders?title=${encodeURIComponent(title)}&remind_at=${encodeURIComponent(remind_at)}`, {method:"POST"});
        $("#title",w).value=""; $("#at",w).value="";
        await load(); haptic("notify","success");
      }catch(e){ toast(e.message,false); }
    };
    await load();
  },0);
  return w;
}

/* Calendar */
function calendarView(){
  const w=el("div","card");
  w.innerHTML=`
    <div class="h2">Календарь</div>
    <div class="muted small">Добавь событие (ISO дата). start_time обязательно.</div>
    <div class="hr"></div>
    <input id="title" class="input" placeholder="Название события" />
    <div style="height:8px"></div>
    <input id="start" class="input" placeholder="start_time (ISO)" />
    <div style="height:8px"></div>
    <input id="end" class="input" placeholder="end_time (ISO, опц.)" />
    <div class="hr"></div>
    <button id="add" class="btn primary">Добавить</button>
    <div class="hr"></div>
    <div id="list" class="list muted">Загрузка...</div>
  `;
  setTimeout(async ()=>{
    const list=$("#list",w);
    async function load(){
      try{
        const data = await API.req("/calendar/events");
        state.events = data.events||[];
        list.innerHTML="";
        state.events.forEach(e=>{
          const c=el("div","card");
          c.innerHTML = `<div class="row" style="justify-content:space-between">
            <div><div class="h2">${esc(e.title)}</div><div class="muted small">${esc(e.start_time||"")}${e.end_time?(" → "+esc(e.end_time)):""}</div></div>
            <span class="pill">event</span>
          </div>`;
          list.appendChild(c);
        });
        if(!state.events.length) list.textContent="Событий нет";
      }catch(e){ list.textContent="Ошибка: "+e.message; }
    }
    $("#add",w).onclick = async ()=>{
      try{
        const title=$("#title",w).value.trim();
        const start_time=$("#start",w).value.trim();
        const end_time=$("#end",w).value.trim();
        await API.req(`/calendar/events?title=${encodeURIComponent(title)}&start_time=${encodeURIComponent(start_time)}&end_time=${encodeURIComponent(end_time)}`, {method:"POST"});
        $("#title",w).value=""; $("#start",w).value=""; $("#end",w).value="";
        await load(); haptic("notify","success");
      }catch(e){ toast(e.message,false); }
    };
    await load();
  },0);
  return w;
}

/* Notifications */
function notificationsView(){
  const w=el("div","card");
  w.innerHTML=`
    <div class="h2">Уведомления</div>
    <div class="muted small">Список уведомлений (можно помечать прочитанными).</div>
    <div class="hr"></div>
    <button id="refresh" class="btn">Обновить</button>
    <div class="hr"></div>
    <div id="list" class="list muted">Загрузка...</div>
  `;
  setTimeout(async ()=>{
    const list=$("#list",w);
    async function load(){
      try{
        const data = await API.req("/notifications");
        state.notifications = data.notifications||[];
        list.innerHTML="";
        state.notifications.forEach(n=>{
          const c=el("div","card");
          c.innerHTML = `<div class="row" style="justify-content:space-between">
            <div>
              <div class="h2">${esc(n.title)}</div>
              <div class="muted small">${esc(n.message)}</div>
              <div class="muted small">${esc(n.created_at||"")}</div>
            </div>
            <button class="btn" data-id="${n.id}">${n.is_read ? "✓" : "Прочитал"}</button>
          </div>`;
          list.appendChild(c);
        });
        if(!state.notifications.length) list.textContent="Пусто";
        list.querySelectorAll("button[data-id]").forEach(b=>{
          b.onclick = async ()=>{
            try{
              const id=b.getAttribute("data-id");
              await API.req(`/notifications/${id}/read`,{method:"POST"});
              await load(); haptic("select");
            }catch(e){ toast(e.message,false); }
          };
        });
      }catch(e){ list.textContent="Ошибка: "+e.message; }
    }
    $("#refresh",w).onclick = load;
    await load();
  },0);
  return w;
}

/* Settings */
function settingsView(){
  const s=state.me?.settings || {};
  const w=el("div","card");
  w.innerHTML=`
    <div class="h2">Настройки</div>
    <div class="muted small">Сохраняются в профиле.</div>
    <div class="hr"></div>

    <label class="small muted">Тема</label>
    <select id="theme" class="input">
      <option value="light">light</option>
      <option value="dark">dark</option>
      <option value="auto">auto</option>
    </select>

    <div class="hr"></div>
    <div class="row"><input type="checkbox" id="haptics"/><div>Haptics (TG)</div></div>
    <div class="row"><input type="checkbox" id="autoscroll"/><div>Автоскролл чата</div></div>

    <div class="hr"></div>
    <div class="row">
      <button id="save" class="btn primary">Сохранить</button>
      <button id="reload" class="btn">Обновить</button>
    </div>
  `;
  setTimeout(()=>{
    $("#theme",w).value = s.theme || "light";
    $("#haptics",w).checked = s.haptics !== false;
    $("#autoscroll",w).checked = s.auto_scroll_chat !== false;

    $("#save",w).onclick = async ()=>{
      try{
        const patch = {
          theme: $("#theme",w).value,
          haptics: $("#haptics",w).checked,
          auto_scroll_chat: $("#autoscroll",w).checked
        };
        await API.req("/users/me/settings",{method:"PUT", body: patch});
        await boot(); haptic("notify","success"); toast("Сохранено", true);
      }catch(e){ toast(e.message,false); }
    };
    $("#reload",w).onclick = async ()=>{ await boot(); toast("Обновлено", true); };
  },0);
  return w;
}

/* Admin */
function adminView(){
  const w=el("div","card");
  if(!state.me?.is_admin){
    w.textContent="Доступ только администратору.";
    return w;
  }
  w.innerHTML=`
    <div class="h2">Админ панель</div>
    <div class="muted small">Пользователи, ключи, лог запросов (usage).</div>
    <div class="hr"></div>

    <div class="row">
      <input id="q" class="input" placeholder="Поиск email..." />
      <button id="users" class="btn">Пользователи</button>
      <button id="reqs" class="btn">Запросы</button>
      <button id="keys" class="btn">Ключи</button>
    </div>

    <div class="hr"></div>
    <div id="out" class="list muted">Выбери раздел.</div>
  `;
  setTimeout(()=>{
    const out=$("#out",w);

    $("#users",w).onclick = async ()=>{
      try{
        const q=$("#q",w).value.trim();
        const data = await API.req(`/admin/users?q=${encodeURIComponent(q)}&limit=100`);
        out.innerHTML="";
        (data.users||[]).forEach(u=>{
          const c=el("div","card");
          c.innerHTML = `<div class="row" style="justify-content:space-between">
            <div><div class="h2">${esc(u.email)}</div><div class="muted small">id=${u.id} · admin=${u.is_admin} · active=${u.is_active}</div></div>
            <div class="row">
              <button class="btn" data-act="admin" data-id="${u.id}" data-v="${u.is_admin?0:1}">${u.is_admin?"Снять":"Админ"}</button>
              <button class="btn danger" data-act="active" data-id="${u.id}" data-v="${u.is_active?0:1}">${u.is_active?"Откл":"Вкл"}</button>
            </div>
          </div>`;
          out.appendChild(c);
        });
        out.querySelectorAll("button[data-act]").forEach(b=>{
          b.onclick = async ()=>{
            const id=b.getAttribute("data-id");
            const act=b.getAttribute("data-act");
            const v=b.getAttribute("data-v");
            const qs = act==="admin" ? `is_admin=${v}` : `is_active=${v}`;
            await API.req(`/admin/users/${id}/flags?${qs}`, {method:"POST"});
            haptic("notify","success");
            $("#users",w).click();
          };
        });
        if(!data.users?.length) out.textContent="Ничего не найдено";
      }catch(e){ out.textContent="Ошибка: "+e.message; }
    };

    $("#reqs",w).onclick = async ()=>{
      try{
        const data = await API.req(`/admin/requests?limit=200`);
        out.innerHTML="";
        (data.requests||[]).forEach(r=>{
          const c=el("div","card");
          c.innerHTML = `<div class="row" style="justify-content:space-between">
            <div>
              <div class="h2">${esc(r.provider)} · ${esc(r.endpoint||"")}</div>
              <div class="muted small">user=${r.user_id} · tokens=${r.tokens_used} · cost=${r.cost_estimate}</div>
            </div>
            <span class="pill">${esc(r.created_at||"")}</span>
          </div>`;
          out.appendChild(c);
        });
        if(!data.requests?.length) out.textContent="Лог пуст";
      }catch(e){ out.textContent="Ошибка: "+e.message; }
    };

    $("#keys",w).onclick = async ()=>{
      try{
        const data = await API.req(`/admin/keys`);
        out.innerHTML="";
        (data.keys||[]).forEach(k=>{
          const c=el("div","card");
          c.innerHTML = `<div class="row" style="justify-content:space-between">
            <div><div class="h2">${esc(k.provider)}</div><div class="muted small">user=${k.user_id} · created=${esc(k.created_at||"")}</div></div>
            <span class="pill">key</span>
          </div>`;
          out.appendChild(c);
        });
        if(!data.keys?.length) out.textContent="Ключей нет";
      }catch(e){ out.textContent="Ошибка: "+e.message; }
    };
  },0);
  return w;
}

/* Boot */
async function boot(){
  if(!API.token){
    state.me=null; state.providers=[]; state.models={};
    render(); return;
  }
  try{
    state.me = await API.req("/users/me");
  }catch(e){
    API.setToken(""); state.me=null; render(); return;
  }

  try{
    const m = await API.req("/ai/models");
    state.providers = m.providers || [];
    state.models = m.models || {};
  }catch{
    state.providers=[]; state.models={};
  }
  render();
}

/* Hotkeys */
window.addEventListener("keydown",(e)=>{
  if((e.ctrlKey||e.metaKey) && !e.shiftKey){
    const map = {"1":"chat","2":"projects","3":"keys","4":"reminders","5":"calendar","6":"notifications","7":"settings","8":"admin"};
    if(map[e.key]){ if(map[e.key]!=="admin" || state.me?.is_admin) setPage(map[e.key]); }
  }
});
window.addEventListener("resize", ()=> closeDrawer());

(async function init(){
  await telegramAutoLogin();
  await boot();
  if(!API.token) setPage("login");
})();
