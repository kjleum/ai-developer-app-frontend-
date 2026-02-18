/* AI Platform — Telegram Mini App-first frontend (no build tools)
   Goals:
   - Works in Telegram WebApp (TMA) and normal web
   - Real routing, no duplicate UI
   - Guest mode works (chat demo + local projects)
   - Telegram WebApp API integration: ready/expand/theme/MainButton/BackButton/Haptics/CloudStorage/popups
   - Media: attachments + image editor (canvas) + basic video trim via ffmpeg.wasm (optional)
*/

'use strict';

// ---------- helpers ----------
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
const esc = (s)=> String(s ?? '').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const clamp = (v,a,b)=> Math.min(b, Math.max(a, v));
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));

// ---------- Telegram ----------
const tg = window.Telegram?.WebApp || null;

const TG = {
  ready:false,
  user:null,
  init(){
    if (!tg) return;

    try {
      tg.ready();
      tg.expand();
      this.ready = true;
    } catch {}

    try {
      this.user = tg.initDataUnsafe?.user || null;
    } catch { this.user = null; }

    this.applyTheme();

    // theme changes
    try {
      tg.onEvent('themeChanged', () => this.applyTheme());
    } catch {}

    // viewport changes: save draft + rerender small layout fixes
    try {
      tg.onEvent('viewportChanged', () => {
        persistDraft();
        requestRender();
      });
    } catch {}

    // avoid swipe-to-close glitches on iOS
    try { document.body.style.overscrollBehavior = 'none'; } catch {}
  },
  applyTheme(){
    const root = document.documentElement;
    // defaults
    const theme = tg?.themeParams || {};
    const scheme = tg?.colorScheme || 'dark';

    // Telegram passes hex strings like "#ffffff"
    const pick = (key, fallback) => {
      const v = theme?.[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
      return fallback;
    };

    // Background / text
    const bg = pick('bg_color', scheme === 'light' ? '#f8fafc' : '#0b1020');
    const text = pick('text_color', scheme === 'light' ? '#0b1220' : '#e8eefc');
    const hint = pick('hint_color', scheme === 'light' ? '#64748b' : 'rgba(232,238,252,.65)');
    const sep = pick('secondary_bg_color', scheme === 'light' ? '#ffffff' : 'rgba(255,255,255,.06)');
    const btn = pick('button_color', scheme === 'light' ? '#2ea6ff' : '#6ee7ff');

    root.style.setProperty('--bg', bg);
    root.style.setProperty('--text', text);
    root.style.setProperty('--muted', hint);
    root.style.setProperty('--card', sep);
    // derive line & accent
    root.style.setProperty('--line', scheme === 'light' ? 'rgba(15,23,42,.12)' : 'rgba(255,255,255,.12)');
    root.style.setProperty('--accent', btn);

    // Telegram may provide dark/light; keep our radius/shadow consistent
  },
  haptic(kind='impact', style='light'){
    if (!tg) return;
    if (Settings.get('haptics') === false) return;
    try {
      if (kind === 'impact') tg.HapticFeedback?.impactOccurred?.(style);
      if (kind === 'notify') tg.HapticFeedback?.notificationOccurred?.(style);
      if (kind === 'select') tg.HapticFeedback?.selectionChanged?.();
    } catch {}
  },
  popup(title, message, buttons=[{type:'ok'}]){
    if (tg?.showPopup) tg.showPopup({ title, message: String(message ?? ''), buttons });
    else alert(`${title}: ${message}`);
  },
  confirm(title, message){
    return new Promise((resolve)=>{
      if (!tg?.showPopup) return resolve(confirm(`${title}\n\n${message}`));
      tg.showPopup({
        title,
        message,
        buttons: [{id:'ok', type:'default', text:'OK'}, {id:'cancel', type:'destructive', text:'Отмена'}]
      }, (btnId)=> resolve(btnId === 'ok'));
    });
  },
  toastOK(msg){ this.popup('Готово', msg); },
  toastErr(msg){ this.popup('Ошибка', msg); },
  sendData(payload){
    if (!tg?.sendData) return;
    try { tg.sendData(typeof payload === 'string' ? payload : JSON.stringify(payload)); } catch {}
  },
  setMainButton({text, visible, enabled, color}={}){
    if (!tg?.MainButton) return;
    if (typeof text === 'string') tg.MainButton.setText(text);
    if (typeof color === 'string') tg.MainButton.color = color;
    if (typeof enabled === 'boolean') enabled ? tg.MainButton.enable() : tg.MainButton.disable();
    if (typeof visible === 'boolean') visible ? tg.MainButton.show() : tg.MainButton.hide();
  },
  setBackButton(visible){
    if (!tg?.BackButton) return;
    try { visible ? tg.BackButton.show() : tg.BackButton.hide(); } catch {}
  },
  cloudGet(key){
    return new Promise((resolve)=>{
      const cs = tg?.CloudStorage;
      if (!cs?.getItem) return resolve(null);
      try { cs.getItem(key, (err, value)=> resolve(err ? null : value)); } catch { resolve(null); }
    });
  },
  cloudSet(key, value){
    return new Promise((resolve)=>{
      const cs = tg?.CloudStorage;
      if (!cs?.setItem) return resolve(false);
      try { cs.setItem(key, value, (err)=> resolve(!err)); } catch { resolve(false); }
    });
  },
  cloudDel(key){
    return new Promise((resolve)=>{
      const cs = tg?.CloudStorage;
      if (!cs?.removeItem) return resolve(false);
      try { cs.removeItem(key, (err)=> resolve(!err)); } catch { resolve(false); }
    });
  },
};

// ---------- Settings / Storage ----------
const LS = {
  get(key, fallback=null){
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value){
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
  del(key){
    try { localStorage.removeItem(key); } catch {}
  }
};

const Settings = {
  key: 'aip.settings.v2',
  data: {
    theme: 'auto', // auto | light | dark
    compact: false,
    markdown: true,
    typewriter: false,
    reduceMotion: false,
    haptics: true,
    fontScale: 1.0,
    apiBase: '/api/v1',
    demoMode: true,
    attachmentMaxMB: 8,
    logToBot: false,
    language: 'ru',
  },
  load(){
    const saved = LS.get(this.key, null);
    if (saved && typeof saved === 'object') this.data = { ...this.data, ...saved };
    this.apply();
  },
  apply(){
    // reduce motion toggle
    document.documentElement.style.setProperty('font-size', `${clamp(this.data.fontScale, 0.85, 1.35) * 16}px`);
    if (this.data.reduceMotion) document.documentElement.classList.add('rm');
    else document.documentElement.classList.remove('rm');

    // theme override (Telegram theme still supplies colors, but we can force scheme-ish feel)
    if (this.data.theme === 'light') {
      document.documentElement.style.setProperty('--bg', '#f8fafc');
      document.documentElement.style.setProperty('--text', '#0b1220');
      document.documentElement.style.setProperty('--muted', '#64748b');
      document.documentElement.style.setProperty('--line', 'rgba(15,23,42,.12)');
      document.documentElement.style.setProperty('--card', '#ffffff');
    }
    if (this.data.theme === 'dark') {
      document.documentElement.style.setProperty('--bg', '#0b1020');
      document.documentElement.style.setProperty('--text', '#e8eefc');
      document.documentElement.style.setProperty('--muted', 'rgba(232,238,252,.65)');
      document.documentElement.style.setProperty('--line', 'rgba(255,255,255,.12)');
      document.documentElement.style.setProperty('--card', 'rgba(255,255,255,.06)');
    }
    // if auto: use Telegram theme (already applied by TG.applyTheme)
  },
  get(k){ return this.data[k]; },
  set(k, v){ this.data[k]=v; LS.set(this.key, this.data); this.apply(); },
  export(){ return { ...this.data }; },
  import(obj){ if (obj && typeof obj === 'object') { this.data = { ...this.data, ...obj }; LS.set(this.key,this.data); this.apply(); } }
};

// ---------- API wrapper ----------
const API = {
  token: LS.get('aip.token',''),
  get base(){ return Settings.get('apiBase') || '/api/v1'; },
  setToken(t){ this.token = t || ''; LS.set('aip.token', this.token); },
  clearToken(){ this.token=''; LS.del('aip.token'); },
  async req(path, {method='GET', body=null, headers={}} = {}){
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 30000);
    try {
      const h = { ...headers };
      if (body && !(body instanceof FormData)) h['Content-Type'] = 'application/json';
      if (this.token) h['Authorization'] = `Bearer ${this.token}`;
      const res = await fetch(this.base + path, {
        method,
        headers: h,
        body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : null,
        signal: ctrl.signal
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw:text }; }
      if (!res.ok) {
        const msg = data?.detail || data?.error || text || 'Request failed';
        throw new Error(msg);
      }
      return data;
    } finally {
      clearTimeout(t);
    }
  },
  async ping(){
    const t0 = performance.now();
    await this.req('/ping', {method:'GET'});
    return Math.round(performance.now()-t0);
  }
};

// ---------- App State ----------
const State = {
  route: 'chat',
  // chat: [{id, role:'me'|'ai'|'sys', text, ts, attachments:[] }]
  chat: LS.get('aip.chat.v2', []),
  draft: LS.get('aip.draft.v2', { text:'', attachments:[] }),
  // projects: [{id, name, desc, tags:[], updatedAt, chats:[messageIds], files:[] }]
  projects: LS.get('aip.projects.v2', []),
  activeProjectId: LS.get('aip.activeProject', null),
  // ui
  drawerOpen:false,
  modal:null,
  // media
  media: {
    image: { src:null, filters:{brightness:1, contrast:1, saturate:1}, rotate:0 },
    video: { file:null, url:null, start:0, end:0, working:false, ffmpegReady:false }
  }
};

function persistChat(){ LS.set('aip.chat.v2', State.chat); }
function persistProjects(){ LS.set('aip.projects.v2', State.projects); LS.set('aip.activeProject', State.activeProjectId); }
function persistDraft(){ LS.set('aip.draft.v2', State.draft); }

// ---------- Router ----------
const ROUTES = [
  {id:'chat', title:'Чат'},
  {id:'projects', title:'Проекты'},
  {id:'media', title:'Медиа'},
  {id:'keys', title:'Ключи'},
  {id:'reminders', title:'Напоминания'},
  {id:'calendar', title:'Календарь'},
  {id:'notifications', title:'Уведомления'},
  {id:'settings', title:'Настройки'},
  {id:'diagnostics', title:'Диагностика'},
];

const protectedRoutes = new Set(['keys','reminders','calendar','notifications']);

function setRoute(route){
  if (!ROUTES.find(r=>r.id===route)) route='chat';
  State.route = route;
  TG.haptic('select');
  requestRender();
}

function routeTitle(){
  return ROUTES.find(r=>r.id===State.route)?.title || 'AI Platform';
}

function isAuthed(){ return !!API.token; }

// ---------- UI: rendering cycle ----------
let renderQueued=false;
function requestRender(){
  if (renderQueued) return;
  renderQueued=true;
  requestAnimationFrame(()=>{ renderQueued=false; render(); });
}

function render(){
  const root = $('#app');
  root.innerHTML='';

  const backdrop = el('div','backdrop');
  backdrop.onclick = ()=>{ State.drawerOpen=false; requestRender(); };
  if (State.drawerOpen) backdrop.classList.add('show');
  root.appendChild(backdrop);

  // drawer
  const drawer = renderSidebar(true);
  if (State.drawerOpen) drawer.classList.add('open');
  root.appendChild(drawer);

  const shell = el('div','shell safe');
  // wide sidebar
  shell.appendChild(renderSidebar(false));

  const main = el('div','main');
  main.appendChild(renderTopbar());

  const content = el('div','content');
  content.appendChild(renderView());
  main.appendChild(content);

  shell.appendChild(main);
  root.appendChild(shell);

  root.appendChild(renderBottomNav());

  // Telegram nav buttons
  if (tg) {
    // BackButton behavior:
    // - if modal open: close modal
    // - else if route not chat: back to chat
    // - else: close mini app
    TG.setBackButton(State.route !== 'chat' || !!State.modal);
    try {
      if (!render._tgBackBound) {
        render._tgBackBound = true;
        tg.BackButton.onClick(()=>{
          if (State.modal) { State.modal=null; requestRender(); return; }
          if (State.route !== 'chat') { setRoute('chat'); return; }
          tg.close();
        });
      }
    } catch {}

    // MainButton context
    if (State.route === 'chat') {
      const canSend = ($('#msgText')?.value || '').trim().length > 0 || (State.draft.attachments?.length||0)>0;
      TG.setMainButton({ text: 'Отправить', visible: true, enabled: canSend });
      try {
        if (!render._tgMainBound) {
          render._tgMainBound = true;
          tg.MainButton.onClick(()=> sendMessage());
        }
      } catch {}
    } else {
      TG.setMainButton({ visible: false });
    }
  }

  // focus input in chat
  if (State.route === 'chat') {
    const ta = $('#msgText');
    if (ta && document.activeElement !== ta) {
      // don't steal focus if user is scrolling in messages
      if (!render._focusedOnce) {
        render._focusedOnce = true;
        ta.focus();
      }
    }
  }

  // modal
  if (State.modal) root.appendChild(renderModal());
}

function renderTopbar(){
  const t = el('div','topbar');
  const inner = el('div','topbar-inner');

  const left = el('div','title');
  const burger = el('button','btn');
  burger.textContent = '☰';
  burger.onclick = ()=>{ State.drawerOpen=true; requestRender(); };

  const h1 = el('h1');
  h1.textContent = routeTitle();

  left.appendChild(burger);
  left.appendChild(h1);

  const right = el('div','row');

  // user pill (avatar + name / guest)
  const pill = el('div','pill');
  const name = TG.user?.first_name || TG.user?.username || (isAuthed() ? 'User' : 'Guest');
  const avatar = TG.user?.photo_url || null;
  if (avatar) {
    const img = el('img'); img.alt=''; img.src = avatar; pill.appendChild(img);
  }
  const span = el('span'); span.textContent = name; pill.appendChild(span);
  pill.title = 'Меню';
  pill.onclick = ()=>{ State.modal = {type:'quick'}; requestRender(); };

  right.appendChild(pill);

  inner.appendChild(left);
  inner.appendChild(right);
  t.appendChild(inner);
  return t;
}

function renderSidebar(isDrawer){
  const sb = el('div', isDrawer ? 'sidebar drawer' : 'sidebar');

  // header card
  const head = el('div','card section');
  head.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div>
        <div style="font-weight:800;letter-spacing:.3px;">AI Platform</div>
        <div class="muted small">Telegram Mini App</div>
      </div>
      <button class="btn ghost" id="closeDrawer" style="display:${isDrawer?'inline-flex':'none'}">✕</button>
    </div>
  `;
  sb.appendChild(head);

  const nav = el('div','nav');
  const items = [
    ['chat','Чат'],
    ['projects','Проекты'],
    ['media','Медиа'],
    ['settings','Настройки'],
    ['diagnostics','Диагностика'],
  ];

  // show protected routes only when authed, otherwise hide (no empty dead buttons)
  if (isAuthed()) {
    items.splice(3,0, ['keys','Ключи'], ['reminders','Напоминания'], ['calendar','Календарь'], ['notifications','Уведомления']);
  }

  items.forEach(([id,label])=>{
    const b = el('button','btn navbtn' + (State.route===id?' active':''));
    b.innerHTML = `<span>${esc(label)}</span><span class="muted small">›</span>`;
    b.onclick = ()=>{ setRoute(id); State.drawerOpen=false; requestRender(); };
    nav.appendChild(b);
  });

  sb.appendChild(nav);

  const quick = el('div','card section');
  quick.innerHTML = `
    <div style="font-weight:700;">Быстро</div>
    <div class="hr"></div>
    <div class="row" style="flex-wrap:wrap;">
      <button class="btn primary" id="newChat">Новый чат</button>
      <button class="btn" id="exportAll">Экспорт</button>
      <button class="btn" id="importAll">Импорт</button>
    </div>
    <div class="hr"></div>
    <div class="row" style="flex-wrap:wrap;">
      <button class="btn" id="sendToBot">Отправить в бота</button>
      <button class="btn danger" id="resetLocal">Сброс локальных</button>
    </div>
  `;
  sb.appendChild(quick);

  // bind
  sb.addEventListener('click', async (e)=>{
    const id = e.target?.id;
    if (!id) return;
    if (id === 'closeDrawer') { State.drawerOpen=false; requestRender(); }
    if (id === 'newChat') { await newChat(); State.drawerOpen=false; requestRender(); }
    if (id === 'exportAll') { await exportAll(); State.drawerOpen=false; requestRender(); }
    if (id === 'importAll') { await importAll(); State.drawerOpen=false; requestRender(); }
    if (id === 'resetLocal') { await resetLocal(); State.drawerOpen=false; requestRender(); }
    if (id === 'sendToBot') { await sendAllToBot(); State.drawerOpen=false; requestRender(); }
  });

  return sb;
}

function renderBottomNav(){
  const bn = el('div','bottom-nav');
  const items = [
    ['chat','Чат'],
    ['projects','Проекты'],
    ['media','Медиа'],
    ['settings','Настройки'],
  ];
  items.forEach(([id,label])=>{
    const b = el('button','btn' + (State.route===id?' primary':''));
    b.textContent = label;
    b.onclick = ()=> setRoute(id);
    bn.appendChild(b);
  });
  return bn;
}

function renderView(){
  if (protectedRoutes.has(State.route) && !isAuthed()) return renderNeedAuth();
  if (State.route === 'chat') return renderChat();
  if (State.route === 'projects') return renderProjects();
  if (State.route === 'media') return renderMedia();
  if (State.route === 'settings') return renderSettings();
  if (State.route === 'diagnostics') return renderDiagnostics();
  if (State.route === 'keys') return renderKeys();
  if (State.route === 'reminders') return renderReminders();
  if (State.route === 'calendar') return renderCalendar();
  if (State.route === 'notifications') return renderNotifications();
  return el('div');
}

function renderNeedAuth(){
  const w = el('div','card section');
  w.innerHTML = `
    <div style="font-weight:800;font-size:16px;">Нужен доступ</div>
    <div class="muted" style="margin-top:6px;">
      Этот раздел требует авторизации через бэкенд. В Telegram обычно всё делается автоматически.
    </div>
    <div class="hr"></div>
    <div class="row" style="flex-wrap:wrap;">
      <button class="btn primary" id="tryTgAuth">Войти через Telegram</button>
      <button class="btn" id="goSettings">Настройки</button>
    </div>
  `;
  w.addEventListener('click', async (e)=>{
    if (e.target?.id === 'tryTgAuth') await telegramAuth();
    if (e.target?.id === 'goSettings') setRoute('settings');
  });
  return w;
}

// ---------- Chat ----------
function renderChat(){
  const wrap = el('div','card section');

  // header controls
  const header = el('div','row');
  header.style.justifyContent = 'space-between';
  header.style.flexWrap = 'wrap';

  const left = el('div','row');
  const proj = currentProject();
  const projBtn = el('button','btn');
  projBtn.textContent = proj ? `Проект: ${proj.name}` : 'Проект: —';
  projBtn.onclick = ()=>{ State.modal = {type:'pickProject'}; requestRender(); };
  left.appendChild(projBtn);

  const right = el('div','row');
  right.style.flexWrap='wrap';

  const demo = el('button','btn' + (Settings.get('demoMode') ? ' primary':''));
  demo.textContent = Settings.get('demoMode') ? 'DEMO' : 'LIVE';
  demo.title = 'DEMO: без бэкенда, быстрый ответ; LIVE: попытка вызвать API (если настроено)';
  demo.onclick = ()=>{ Settings.set('demoMode', !Settings.get('demoMode')); requestRender(); };

  const searchBtn = el('button','btn');
  searchBtn.textContent = 'Поиск';
  searchBtn.onclick = ()=>{ State.modal = {type:'searchChat'}; requestRender(); };

  const shareBtn = el('button','btn');
  shareBtn.textContent = 'Поделиться';
  shareBtn.onclick = ()=> shareLast();

  right.appendChild(demo);
  right.appendChild(searchBtn);
  right.appendChild(shareBtn);

  header.appendChild(left);
  header.appendChild(right);

  const chat = el('div','chat');

  const msgs = el('div','msgs');
  msgs.id = 'msgs';
  chat.appendChild(msgs);

  const attachRow = el('div','attach-row');
  attachRow.id = 'attachRow';
  chat.appendChild(attachRow);

  const composer = el('div','composer');

  const attachBtn = el('button','btn');
  attachBtn.textContent = '📎';
  attachBtn.title = 'Прикрепить файлы';
  attachBtn.onclick = ()=> $('#filePicker')?.click();

  const ta = el('textarea','textarea');
  ta.id = 'msgText';
  ta.placeholder = 'Сообщение…';
  ta.value = State.draft.text || '';
  ta.oninput = ()=>{
    State.draft.text = ta.value;
    persistDraft();
    if (tg) requestRender(); // update MainButton enable state
  };
  ta.onkeydown = (e)=>{
    // Enter = send, Shift+Enter = newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const sendBtn = el('button','btn primary');
  sendBtn.textContent = 'Отправить';
  sendBtn.onclick = ()=> sendMessage();

  composer.appendChild(attachBtn);
  composer.appendChild(ta);
  composer.appendChild(sendBtn);

  // hidden file input
  const file = el('input');
  file.type='file';
  file.id='filePicker';
  file.multiple = true;
  file.accept = '*/*';
  file.style.display='none';
  file.onchange = async ()=>{
    const files = Array.from(file.files || []);
    await addAttachments(files);
    file.value='';
    requestRender();
  };

  wrap.appendChild(header);
  wrap.appendChild(el('div','hr'));
  wrap.appendChild(chat);
  wrap.appendChild(composer);
  wrap.appendChild(file);

  // drag & drop
  wrap.ondragover = (e)=>{ e.preventDefault(); };
  wrap.ondrop = async (e)=>{
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) {
      await addAttachments(files);
      requestRender();
      TG.haptic('impact','light');
    }
  };

  // render messages
  renderMessages(msgs);
  renderAttachments(attachRow);

  // scroll to bottom
  requestAnimationFrame(()=>{
    msgs.scrollTop = msgs.scrollHeight;
  });

  return wrap;
}

function renderMessages(container){
  container.innerHTML='';
  const s = Settings.get('markdown');

  State.chat.forEach(m=>{
    const b = el('div','bubble ' + (m.role==='me'?'me':'ai'));

    // header line
    const head = el('div','muted small');
    head.style.display='flex';
    head.style.justifyContent='space-between';
    head.style.gap='8px';
    head.innerHTML = `<span>${m.role==='me' ? 'Вы' : 'AI'}</span><span>${new Date(m.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>`;

    const body = el('div');

    if (s && m.role !== 'me') body.innerHTML = renderMarkdown(m.text || '');
    else body.textContent = m.text || '';

    b.appendChild(head);
    b.appendChild(body);

    // attachments preview
    if (m.attachments?.length) {
      const ar = el('div');
      ar.style.marginTop='8px';
      ar.style.display='flex';
      ar.style.flexWrap='wrap';
      ar.style.gap='8px';
      m.attachments.forEach(a=>{
        const chip = el('div','attachment');
        chip.innerHTML = `<span class="muted small">${esc(a.name)}</span>`;
        const open = el('button','btn');
        open.style.height='32px';
        open.textContent = 'Открыть';
        open.onclick = ()=>{
          if (a.dataUrl) window.open(a.dataUrl, '_blank');
          else TG.popup('Файл', 'Нет локальных данных (слишком большой файл).');
        };
        chip.appendChild(open);
        ar.appendChild(chip);
      });
      b.appendChild(ar);
    }

    // actions
    const actions = el('div','row');
    actions.style.marginTop='8px';
    actions.style.flexWrap='wrap';
    const copy = el('button','btn');
    copy.style.height='32px';
    copy.textContent = 'Копировать';
    copy.onclick = async ()=>{
      try { await navigator.clipboard.writeText(m.text || ''); TG.haptic('notify','success'); }
      catch { TG.toastErr('Не удалось скопировать'); }
    };
    actions.appendChild(copy);

    if (m.role === 'ai') {
      const like = el('button','btn');
      like.style.height='32px';
      like.textContent = '👍';
      like.onclick = ()=>{ TG.haptic('impact','light'); logEvent('like', {messageId:m.id}); };
      const dislike = el('button','btn');
      dislike.style.height='32px';
      dislike.textContent = '👎';
      dislike.onclick = ()=>{ TG.haptic('impact','light'); logEvent('dislike', {messageId:m.id}); };
      actions.appendChild(like);
      actions.appendChild(dislike);
    }

    b.appendChild(actions);

    container.appendChild(b);
  });

  if (!State.chat.length) {
    const empty = el('div','muted small');
    empty.style.padding='12px';
    empty.textContent = 'Начните диалог. Можно прикреплять файлы (drag&drop или 📎).';
    container.appendChild(empty);
  }
}

function renderAttachments(container){
  container.innerHTML='';
  const items = State.draft.attachments || [];
  items.forEach((a, idx)=>{
    const chip = el('div','attachment');
    const label = el('span','muted small');
    label.textContent = a.name;
    const open = el('button','btn');
    open.style.height='32px';
    open.textContent = a.type?.startsWith('image/') ? 'Ред.' : 'Открыть';
    open.onclick = ()=>{
      if (a.type?.startsWith('image/') && a.dataUrl) {
        State.media.image.src = a.dataUrl;
        State.media.image.rotate = 0;
        State.media.image.filters = {brightness:1, contrast:1, saturate:1};
        State.modal = {type:'imageEditor', fromDraftIndex: idx};
        requestRender();
        return;
      }
      if (a.dataUrl) window.open(a.dataUrl, '_blank');
      else TG.popup('Файл', 'Нет локальных данных (слишком большой файл).');
    };
    const x = el('span','x');
    x.textContent = '✕';
    x.onclick = ()=>{
      State.draft.attachments.splice(idx,1);
      persistDraft();
      requestRender();
    };
    chip.appendChild(label);
    chip.appendChild(open);
    chip.appendChild(x);
    container.appendChild(chip);
  });
}

async function addAttachments(files){
  const maxMB = clamp(Number(Settings.get('attachmentMaxMB')||8), 1, 50);
  const maxBytes = maxMB * 1024 * 1024;

  State.draft.attachments = State.draft.attachments || [];

  for (const f of files) {
    const att = { name: f.name, type: f.type || 'application/octet-stream', size: f.size, dataUrl: null };

    // store small files as dataUrl for preview/edit; large files keep metadata only
    if (f.size <= maxBytes) {
      try {
        att.dataUrl = await fileToDataUrl(f);
      } catch {
        att.dataUrl = null;
      }
    }

    State.draft.attachments.push(att);
  }

  persistDraft();
}

function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = ()=> resolve(String(r.result||''));
    r.onerror = ()=> reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

async function sendMessage(){
  const text = ($('#msgText')?.value || '').trim();
  const atts = (State.draft.attachments || []).slice();

  if (!text && !atts.length) {
    TG.haptic('notify','warning');
    return;
  }

  const meMsg = {
    id: crypto.randomUUID(),
    role: 'me',
    text,
    ts: Date.now(),
    attachments: atts
  };
  State.chat.push(meMsg);
  persistChat();

  // clear draft
  State.draft.text='';
  State.draft.attachments=[];
  persistDraft();

  requestRender();

  // associate with active project
  attachMessageToProject(meMsg);

  // response
  await respondToMessage(meMsg);
}

async function respondToMessage(meMsg){
  const aiMsg = {
    id: crypto.randomUUID(),
    role:'ai',
    text: '…',
    ts: Date.now(),
    attachments: []
  };
  State.chat.push(aiMsg);
  persistChat();
  requestRender();

  const useDemo = Settings.get('demoMode') || !isAuthed();

  try {
    if (useDemo) {
      aiMsg.text = await demoAnswer(meMsg);
    } else {
      // Attempt: /chat endpoint (user can adapt backend). Fallback to demo.
      const payload = {
        messages: lastMessagesForContext(30),
        attachments: (meMsg.attachments||[]).map(a=>({name:a.name,type:a.type,size:a.size,dataUrl:a.dataUrl}))
      };
      const res = await API.req('/chat', {method:'POST', body: payload});
      aiMsg.text = res?.text || res?.message || res?.answer || JSON.stringify(res);
    }
    aiMsg.ts = Date.now();
    persistChat();
    requestRender();
    TG.haptic('notify','success');

    attachMessageToProject(aiMsg);
  } catch (e) {
    aiMsg.text = `Ошибка: ${e.message || e}`;
    aiMsg.ts = Date.now();
    persistChat();
    requestRender();
    TG.haptic('notify','error');
  }
}

function lastMessagesForContext(n){
  const slice = State.chat.slice(-n);
  return slice.map(m=>({role: m.role==='me'?'user':'assistant', content: m.text || ''}));
}

async function demoAnswer(meMsg){
  // A useful deterministic demo: summarise + file awareness
  const hasFiles = (meMsg.attachments||[]).length;
  const parts = [];
  parts.push('DEMO-ответ (без бэкенда).');

  if (hasFiles) {
    const imgs = meMsg.attachments.filter(a=>a.type?.startsWith('image/')).length;
    const vids = meMsg.attachments.filter(a=>a.type?.startsWith('video/')).length;
    const other = hasFiles - imgs - vids;
    parts.push(`Вложения: ${hasFiles} (изображения: ${imgs}, видео: ${vids}, другое: ${other}).`);
  }

  const t = (meMsg.text||'').trim();
  if (t) {
    // pseudo “assistant”: short actionable bullets
    const lines = t.split(/\n+/).map(s=>s.trim()).filter(Boolean);
    const top = lines.slice(0,4);
    parts.push('Я вижу запрос:');
    parts.push(top.map((l,i)=>`${i+1}. ${l}`).join('\n'));
    parts.push('Что могу сделать дальше в DEMO:');
    parts.push('- сохранить в проект\n- экспортировать историю\n- отредактировать изображение/видео в разделе “Медиа”');
  } else {
    parts.push('Напиши сообщение, и я отвечу.');
  }

  // typewriter effect (optional)
  const full = parts.join('\n\n');
  if (!Settings.get('typewriter')) return full;

  let out='';
  for (const ch of full) {
    out += ch;
    // update last ai message live
    const last = State.chat[State.chat.length-1];
    if (last?.role === 'ai') {
      last.text = out;
      persistChat();
      requestRender();
    }
    await sleep(8);
  }
  return out;
}

function shareLast(){
  const last = [...State.chat].reverse().find(m=>m.role==='ai');
  if (!last) return TG.toastErr('Нет ответа для шаринга');

  // Telegram: open share popup by sending data to bot OR open link.
  // We use sendData with a small payload.
  TG.sendData({ type:'share', text: last.text, ts: last.ts });
  TG.toastOK('Отправлено в бота через tg.sendData (если бот настроен).');
}

// Minimal markdown renderer (safe-ish): code blocks + inline code + links + bold/italic
function renderMarkdown(text){
  const safe = esc(text);
  // code blocks ```
  let out = safe.replace(/```([\s\S]*?)```/g, (m, code)=>{
    return `<pre><code>${code}</code></pre>`;
  });
  // inline code
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  // bold **x**
  out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  // italic *x*
  out = out.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  // links
  out = out.replace(/(https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+)/g, '<a target="_blank" rel="noopener">$1</a>');
  // newlines
  out = out.replace(/\n/g, '<br/>');
  return out;
}

// ---------- Projects ----------
function currentProject(){
  return State.projects.find(p=>p.id===State.activeProjectId) || null;
}

async function newChat(){
  const ok = State.chat.length ? await TG.confirm('Новый чат', 'Очистить текущий диалог?') : true;
  if (!ok) return;
  State.chat = [];
  persistChat();
  requestRender();
}

function renderProjects(){
  const wrap = el('div','card section');

  const head = el('div','row');
  head.style.justifyContent='space-between';
  head.style.flexWrap='wrap';

  const left = el('div');
  left.innerHTML = `<div style="font-weight:800;">Проекты</div><div class="muted small">Локально (в гостевом режиме) или синхронизация через бэкенд</div>`;

  const right = el('div','row');
  right.style.flexWrap='wrap';
  const add = el('button','btn primary'); add.textContent='Создать'; add.onclick=()=>{ State.modal={type:'editProject', id:null}; requestRender(); };
  const exp = el('button','btn'); exp.textContent='Экспорт'; exp.onclick=()=> exportProjects();
  right.appendChild(add); right.appendChild(exp);

  head.appendChild(left); head.appendChild(right);

  const tools = el('div','row');
  tools.style.flexWrap='wrap';
  tools.style.marginTop='10px';
  tools.innerHTML = `
    <input id="projSearch" class="textarea" style="min-height:44px;max-height:44px;" placeholder="Поиск проектов…" />
    <select id="projSort" class="btn" style="height:44px;">
      <option value="updated">По дате</option>
      <option value="name">По имени</option>
    </select>
  `;

  const list = el('div');
  list.style.marginTop='10px';

  wrap.appendChild(head);
  wrap.appendChild(el('div','hr'));
  wrap.appendChild(tools);
  wrap.appendChild(list);

  const renderList = ()=>{
    const q = ($('#projSearch', wrap)?.value || '').trim().toLowerCase();
    const sort = $('#projSort', wrap)?.value || 'updated';

    let items = [...State.projects];
    if (q) items = items.filter(p=> (p.name||'').toLowerCase().includes(q) || (p.desc||'').toLowerCase().includes(q) || (p.tags||[]).join(' ').toLowerCase().includes(q));

    if (sort === 'name') items.sort((a,b)=> String(a.name||'').localeCompare(String(b.name||'')));
    else items.sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0));

    list.innerHTML='';
    if (!items.length) {
      const empty = el('div','muted small');
      empty.textContent = 'Проектов нет. Нажми “Создать”.';
      list.appendChild(empty);
      return;
    }

    items.forEach(p=>{
      const card = el('div','card section');
      card.style.marginBottom='10px';
      const active = p.id === State.activeProjectId;
      card.innerHTML = `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
          <div style="min-width:0;">
            <div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.name||'Без названия')}</div>
            <div class="muted small" style="margin-top:4px;">${esc(p.desc||'')}</div>
            <div class="muted small" style="margin-top:6px;">${(p.tags||[]).map(t=>`#${esc(t)}`).join(' ')}</div>
          </div>
          <div class="row" style="flex-wrap:wrap;justify-content:flex-end;">
            <button class="btn ${active?'primary':''}" data-act="use" data-id="${p.id}">${active?'Выбран':'Выбрать'}</button>
            <button class="btn" data-act="open" data-id="${p.id}">Открыть</button>
          </div>
        </div>
      `;
      list.appendChild(card);
    });
  };

  renderList();

  wrap.addEventListener('input', (e)=>{
    if (e.target?.id === 'projSearch') renderList();
  });
  wrap.addEventListener('change', (e)=>{
    if (e.target?.id === 'projSort') renderList();
  });
  wrap.addEventListener('click', (e)=>{
    const btn = e.target?.closest('button');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    if (!act || !id) return;

    if (act === 'use') {
      State.activeProjectId = id;
      persistProjects();
      TG.haptic('impact','light');
      renderList();
    }
    if (act === 'open') {
      State.modal = {type:'projectDetails', id};
      requestRender();
    }
  });

  return wrap;
}

function upsertProject(p){
  const idx = State.projects.findIndex(x=>x.id===p.id);
  if (idx >= 0) State.projects[idx] = p;
  else State.projects.unshift(p);
  persistProjects();
}

function deleteProject(id){
  State.projects = State.projects.filter(p=>p.id!==id);
  if (State.activeProjectId === id) State.activeProjectId = null;
  persistProjects();
}

function attachMessageToProject(msg){
  const p = currentProject();
  if (!p) return;
  p.updatedAt = Date.now();
  p.chats = p.chats || [];
  p.chats.push(msg.id);
  upsertProject(p);
}

async function exportProjects(){
  const payload = {
    projects: State.projects,
    activeProjectId: State.activeProjectId,
    exportedAt: new Date().toISOString()
  };
  downloadJson(payload, 'projects.json');
  TG.toastOK('Проекты экспортированы');
}

// ---------- Media ----------
function renderMedia(){
  const wrap = el('div','card section');
  wrap.innerHTML = `
    <div style="font-weight:800;">Медиа</div>
    <div class="muted small" style="margin-top:6px;">Редактор фото (canvas) и базовые инструменты для видео (trim через ffmpeg.wasm)</div>
    <div class="hr"></div>
  `;

  const grid = el('div','grid');

  // Image editor card
  const imgCard = el('div','card section');
  imgCard.innerHTML = `
    <div style="font-weight:800;">🖼 Фото</div>
    <div class="muted small" style="margin-top:6px;">Загрузка, фильтры, поворот, сохранение PNG, отправка в чат</div>
    <div class="hr"></div>
    <div class="row" style="flex-wrap:wrap;">
      <button class="btn primary" id="imgPick">Загрузить</button>
      <button class="btn" id="imgPaste">Вставить</button>
      <button class="btn" id="imgReset">Сброс</button>
    </div>
    <div style="margin-top:10px;" class="canvas-wrap">
      <canvas id="imgCanvas" width="900" height="600"></canvas>
    </div>
    <div class="hr"></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;">
      <div>
        <div class="muted small">Яркость</div>
        <input type="range" id="fBright" min="0" max="2" step="0.01" value="1" />
      </div>
      <div>
        <div class="muted small">Контраст</div>
        <input type="range" id="fContr" min="0" max="2" step="0.01" value="1" />
      </div>
      <div>
        <div class="muted small">Насыщенность</div>
        <input type="range" id="fSat" min="0" max="3" step="0.01" value="1" />
      </div>
      <div>
        <div class="muted small">Поворот</div>
        <input type="range" id="fRot" min="-180" max="180" step="1" value="0" />
      </div>
    </div>
    <div class="hr"></div>
    <div class="row" style="flex-wrap:wrap;">
      <button class="btn" id="imgDownload">Скачать PNG</button>
      <button class="btn" id="imgToChat">В чат</button>
    </div>
    <input id="imgFile" type="file" accept="image/*" style="display:none" />
  `;

  const vidCard = el('div','card section');
  vidCard.innerHTML = `
    <div style="font-weight:800;">🎬 Видео</div>
    <div class="muted small" style="margin-top:6px;">Trim (обрезка) — опционально через ffmpeg.wasm, работает полностью в браузере</div>
    <div class="hr"></div>
    <div class="row" style="flex-wrap:wrap;">
      <button class="btn primary" id="vidPick">Загрузить</button>
      <button class="btn" id="vidLoad">Загрузить редактор</button>
      <button class="btn" id="vidReset">Сброс</button>
    </div>
    <div style="margin-top:10px;">
      <video id="vid" controls playsinline style="width:100%;border-radius:14px;border:1px solid var(--line);"></video>
    </div>
    <div class="hr"></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;">
      <div>
        <div class="muted small">Start (сек)</div>
        <input type="number" id="vidStart" class="textarea" style="min-height:44px;max-height:44px;" value="0" min="0" step="0.1" />
      </div>
      <div>
        <div class="muted small">End (сек)</div>
        <input type="number" id="vidEnd" class="textarea" style="min-height:44px;max-height:44px;" value="0" min="0" step="0.1" />
      </div>
    </div>
    <div class="hr"></div>
    <div class="row" style="flex-wrap:wrap;">
      <button class="btn" id="vidSnapshot">Кадр → PNG</button>
      <button class="btn primary" id="vidTrim">Trim</button>
      <button class="btn" id="vidToChat">В чат</button>
    </div>
    <div class="muted small" id="vidStatus" style="margin-top:8px;"></div>
    <input id="vidFile" type="file" accept="video/*" style="display:none" />
  `;

  grid.appendChild(imgCard);
  grid.appendChild(vidCard);
  wrap.appendChild(grid);

  // bind image
  const imgFile = $('#imgFile', imgCard);
  $('#imgPick', imgCard).onclick = ()=> imgFile.click();
  imgFile.onchange = async ()=>{
    const f = imgFile.files?.[0];
    if (!f) return;
    const max = clamp(Number(Settings.get('attachmentMaxMB')||8),1,50)*1024*1024;
    if (f.size > max) { TG.toastErr(`Слишком большой файл для inline-редактирования (лимит ${Settings.get('attachmentMaxMB')}MB).`); return; }
    State.media.image.src = await fileToDataUrl(f);
    State.media.image.rotate = 0;
    State.media.image.filters = {brightness:1, contrast:1, saturate:1};
    drawImageCanvas();
    imgFile.value='';
  };

  $('#imgPaste', imgCard).onclick = async ()=>{
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const types = it.types || [];
        const imgType = types.find(t=>t.startsWith('image/'));
        if (!imgType) continue;
        const blob = await it.getType(imgType);
        const file = new File([blob], `pasted.${imgType.split('/')[1]||'png'}`, {type: imgType});
        const max = clamp(Number(Settings.get('attachmentMaxMB')||8),1,50)*1024*1024;
        if (file.size > max) { TG.toastErr(`Слишком большой файл (лимит ${Settings.get('attachmentMaxMB')}MB).`); return; }
        State.media.image.src = await fileToDataUrl(file);
        State.media.image.rotate = 0;
        State.media.image.filters = {brightness:1, contrast:1, saturate:1};
        drawImageCanvas();
        TG.haptic('notify','success');
        return;
      }
      TG.toastErr('В буфере нет изображения');
    } catch {
      TG.toastErr('Clipboard API недоступен');
    }
  };

  $('#imgReset', imgCard).onclick = ()=>{
    State.media.image.src = null;
    State.media.image.rotate = 0;
    State.media.image.filters = {brightness:1, contrast:1, saturate:1};
    drawImageCanvas(true);
  };

  const bindRange = (id, key, min, max)=>{
    const r = $('#'+id, imgCard);
    r.value = String(State.media.image[key] ?? (key==='rotate'?0:1));
  };

  $('#fBright', imgCard).oninput = (e)=>{ State.media.image.filters.brightness = Number(e.target.value); drawImageCanvas(); };
  $('#fContr', imgCard).oninput = (e)=>{ State.media.image.filters.contrast = Number(e.target.value); drawImageCanvas(); };
  $('#fSat', imgCard).oninput = (e)=>{ State.media.image.filters.saturate = Number(e.target.value); drawImageCanvas(); };
  $('#fRot', imgCard).oninput = (e)=>{ State.media.image.rotate = Number(e.target.value); drawImageCanvas(); };

  $('#imgDownload', imgCard).onclick = ()=>{
    const c = $('#imgCanvas', imgCard);
    const url = c.toDataURL('image/png');
    downloadDataUrl(url, 'image.png');
  };

  $('#imgToChat', imgCard).onclick = async ()=>{
    const c = $('#imgCanvas', imgCard);
    const url = c.toDataURL('image/png');
    State.draft.attachments = State.draft.attachments || [];
    State.draft.attachments.push({ name:'edited.png', type:'image/png', size: url.length, dataUrl: url });
    persistDraft();
    TG.toastOK('Добавлено в вложения чата');
  };

  // image drag drop
  imgCard.ondragover = (e)=> e.preventDefault();
  imgCard.ondrop = async (e)=>{
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (!String(f.type||'').startsWith('image/')) { TG.toastErr('Это не изображение'); return; }
    const max = clamp(Number(Settings.get('attachmentMaxMB')||8),1,50)*1024*1024;
    if (f.size > max) { TG.toastErr(`Слишком большой файл (лимит ${Settings.get('attachmentMaxMB')}MB).`); return; }
    State.media.image.src = await fileToDataUrl(f);
    State.media.image.rotate = 0;
    State.media.image.filters = {brightness:1, contrast:1, saturate:1};
    drawImageCanvas();
  };

  // bind video
  const vidFile = $('#vidFile', vidCard);
  $('#vidPick', vidCard).onclick = ()=> vidFile.click();
  vidFile.onchange = ()=>{
    const f = vidFile.files?.[0];
    if (!f) return;
    loadVideoFile(f);
    vidFile.value='';
  };

  $('#vidReset', vidCard).onclick = ()=> resetVideo();
  $('#vidLoad', vidCard).onclick = ()=> loadFFmpeg();

  $('#vidStart', vidCard).oninput = ()=>{};
  $('#vidEnd', vidCard).oninput = ()=>{};

  $('#vidSnapshot', vidCard).onclick = ()=> snapshotVideo();
  $('#vidTrim', vidCard).onclick = ()=> trimVideo();
  $('#vidToChat', vidCard).onclick = ()=> videoToChat();

  vidCard.ondragover = (e)=> e.preventDefault();
  vidCard.ondrop = (e)=>{
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (!String(f.type||'').startsWith('video/')) { TG.toastErr('Это не видео'); return; }
    loadVideoFile(f);
  };

  drawImageCanvas(true);
  syncVideoUI();

  return wrap;
}

function drawImageCanvas(clear=false){
  const c = $('#imgCanvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.clearRect(0,0,c.width,c.height);

  // background
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0,0,c.width,c.height);

  if (clear || !State.media.image.src) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '14px ui-sans-serif';
    ctx.fillText('Перетащи изображение сюда или нажми “Загрузить”', 18, 30);
    ctx.restore();
    return;
  }

  const img = new Image();
  img.onload = ()=>{
    const {brightness, contrast, saturate} = State.media.image.filters;
    const rot = (State.media.image.rotate || 0) * Math.PI/180;

    ctx.clearRect(0,0,c.width,c.height);

    // fit image
    const scale = Math.min(c.width / img.width, c.height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;

    ctx.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturate})`;

    // rotate around center
    ctx.translate(c.width/2, c.height/2);
    ctx.rotate(rot);
    ctx.drawImage(img, -w/2, -h/2, w, h);

    ctx.restore();
    ctx.filter = 'none';

    // sync sliders
    const b = $('#fBright'); if (b) b.value = String(brightness);
    const k = $('#fContr'); if (k) k.value = String(contrast);
    const s = $('#fSat'); if (s) s.value = String(saturate);
    const r = $('#fRot'); if (r) r.value = String(State.media.image.rotate || 0);

  };
  img.src = State.media.image.src;
}

function loadVideoFile(file){
  resetVideo();
  State.media.video.file = file;
  State.media.video.url = URL.createObjectURL(file);

  const v = $('#vid');
  v.src = State.media.video.url;
  v.onloadedmetadata = ()=>{
    State.media.video.start = 0;
    State.media.video.end = Number(v.duration || 0);
    syncVideoUI();
  };

  syncVideoUI();
}

function resetVideo(){
  const v = State.media.video;
  if (v.url) {
    try { URL.revokeObjectURL(v.url); } catch {}
  }
  State.media.video = { file:null, url:null, start:0, end:0, working:false, ffmpegReady: v.ffmpegReady || false };
  syncVideoUI();
  const vid = $('#vid');
  if (vid) { vid.removeAttribute('src'); vid.load(); }
}

function syncVideoUI(){
  const s = $('#vidStart');
  const e = $('#vidEnd');
  const st = $('#vidStatus');
  const trim = $('#vidTrim');
  const toChat = $('#vidToChat');

  if (s) s.value = String(State.media.video.start || 0);
  if (e) e.value = String(State.media.video.end || 0);

  if (st) {
    const ready = State.media.video.ffmpegReady ? 'редактор загружен' : 'редактор не загружен';
    const file = State.media.video.file ? `${State.media.video.file.name} (${Math.round(State.media.video.file.size/1024/1024*10)/10}MB)` : 'файл не выбран';
    st.textContent = `${file} • ${ready}${State.media.video.working ? ' • обработка…' : ''}`;
  }

  if (trim) trim.disabled = !State.media.video.file || State.media.video.working;
  if (toChat) toChat.disabled = !State.media.video.file;
}

function snapshotVideo(){
  const vid = $('#vid');
  if (!vid || !State.media.video.file) return TG.toastErr('Видео не выбрано');
  const c = document.createElement('canvas');
  c.width = vid.videoWidth || 640;
  c.height = vid.videoHeight || 360;
  const ctx = c.getContext('2d');
  ctx.drawImage(vid, 0,0,c.width,c.height);
  const url = c.toDataURL('image/png');
  downloadDataUrl(url, 'frame.png');
  TG.toastOK('Кадр сохранён');
}

async function videoToChat(){
  const f = State.media.video.file;
  if (!f) return;
  const max = clamp(Number(Settings.get('attachmentMaxMB')||8),1,50)*1024*1024;
  let dataUrl = null;
  if (f.size <= max) {
    try { dataUrl = await fileToDataUrl(f); } catch { dataUrl = null; }
  }
  State.draft.attachments = State.draft.attachments || [];
  State.draft.attachments.push({ name: f.name, type: f.type || 'video/mp4', size: f.size, dataUrl });
  persistDraft();
  TG.toastOK('Видео добавлено в вложения чата');
}

// ffmpeg.wasm (optional). We load from CDN at runtime.
let FF = null;
async function loadFFmpeg(){
  if (State.media.video.ffmpegReady) return TG.toastOK('Редактор уже загружен');
  try {
    const status = $('#vidStatus');
    if (status) status.textContent = 'Загрузка ffmpeg.wasm…';

    // load script
    await loadScriptOnce('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js', 'ffmpeg-umd');
    const { FFmpeg } = window.FFmpegWASM || window;

    if (!window.FFmpeg || !window.FFmpeg.createFFmpeg) {
      // older UMD exposes createFFmpeg
    }

    // create instance
    if (window.FFmpeg?.createFFmpeg) {
      FF = window.FFmpeg.createFFmpeg({ log: false, corePath: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js' });
      await FF.load();
    } else if (window.FFmpegWASM?.createFFmpeg) {
      FF = window.FFmpegWASM.createFFmpeg({ log: false, corePath: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js' });
      await FF.load();
    } else {
      throw new Error('FFmpeg API not found');
    }

    State.media.video.ffmpegReady = true;
    syncVideoUI();
    TG.toastOK('Видео-редактор загружен');
  } catch (e) {
    TG.toastErr(`Не удалось загрузить ffmpeg.wasm: ${e.message || e}`);
  }
}

function loadScriptOnce(src, id){
  return new Promise((resolve,reject)=>{
    if (id && document.getElementById(id)) return resolve(true);
    const s = document.createElement('script');
    if (id) s.id = id;
    s.src = src;
    s.async = true;
    s.onload = ()=> resolve(true);
    s.onerror = ()=> reject(new Error('script load failed'));
    document.head.appendChild(s);
  });
}

async function trimVideo(){
  const f = State.media.video.file;
  if (!f) return;
  const start = Math.max(0, Number($('#vidStart')?.value || 0));
  const end = Math.max(0, Number($('#vidEnd')?.value || 0));
  if (end <= start) return TG.toastErr('End должен быть больше Start');

  if (!State.media.video.ffmpegReady) {
    const ok = await TG.confirm('Нужно загрузить редактор', 'Trim требует ffmpeg.wasm (загрузится с CDN). Загрузить сейчас?');
    if (!ok) return;
    await loadFFmpeg();
  }
  if (!FF) return;

  try {
    State.media.video.working = true;
    syncVideoUI();

    const inName = 'in.mp4';
    const outName = 'out.mp4';

    const buf = new Uint8Array(await f.arrayBuffer());
    FF.FS('writeFile', inName, buf);

    // fast trim: -ss before -i for speed, -t duration
    const dur = Math.max(0.1, end - start);
    await FF.run('-ss', String(start), '-i', inName, '-t', String(dur), '-c', 'copy', outName);

    const out = FF.FS('readFile', outName);
    const blob = new Blob([out.buffer], {type: 'video/mp4'});
    const url = URL.createObjectURL(blob);

    // offer download
    downloadBlob(blob, 'trimmed.mp4');

    // update current video preview
    resetVideo();
    const newFile = new File([blob], `trimmed_${f.name.replace(/\s+/g,'_')}`, {type: 'video/mp4'});
    loadVideoFile(newFile);

    // cleanup
    try { FF.FS('unlink', inName); FF.FS('unlink', outName); } catch {}

    TG.toastOK('Trim готов');
  } catch (e) {
    TG.toastErr(`Trim ошибка: ${e.message || e}`);
  } finally {
    State.media.video.working = false;
    syncVideoUI();
  }
}

// ---------- Settings View ----------
function renderSettings(){
  const wrap = el('div','card section');
  wrap.innerHTML = `
    <div style="font-weight:800;">Настройки</div>
    <div class="muted small" style="margin-top:6px;">Локально + (опционально) Telegram CloudStorage</div>
    <div class="hr"></div>
  `;

  const form = el('div');
  form.innerHTML = `
    <div class="grid">
      <div class="card section">
        <div style="font-weight:700;">Интерфейс</div>
        <div class="hr"></div>
        <label class="muted small">Тема</label>
        <select id="setTheme" class="btn" style="width:100%;height:44px;">
          <option value="auto">Авто (Telegram)</option>
          <option value="light">Светлая</option>
          <option value="dark">Тёмная</option>
        </select>
        <div style="height:10px"></div>
        <label class="muted small">Размер шрифта</label>
        <input id="setFont" type="range" min="0.85" max="1.35" step="0.01" />
        <div class="hr"></div>
        <div class="row" style="flex-wrap:wrap;">
          <button class="btn" id="togCompact">Компактный</button>
          <button class="btn" id="togMarkdown">Markdown</button>
          <button class="btn" id="togType">Typewriter</button>
          <button class="btn" id="togRM">Reduce motion</button>
          <button class="btn" id="togH">Haptics</button>
        </div>
      </div>

      <div class="card section">
        <div style="font-weight:700;">Сеть / API</div>
        <div class="hr"></div>
        <label class="muted small">API base</label>
        <input id="setApi" class="textarea" style="min-height:44px;max-height:44px;" placeholder="/api/v1 или https://domain/api/v1" />
        <div style="height:10px"></div>
        <label class="muted small">Макс. размер inline-вложений (MB)</label>
        <input id="setMax" type="range" min="1" max="50" step="1" />
        <div class="hr"></div>
        <div class="row" style="flex-wrap:wrap;">
          <button class="btn" id="btnPing">Ping API</button>
          <button class="btn" id="btnAuth">TG auth</button>
          <button class="btn danger" id="btnLogout">Logout</button>
        </div>
        <div class="muted small" id="pingOut" style="margin-top:8px"></div>
      </div>

      <div class="card section">
        <div style="font-weight:700;">Данные</div>
        <div class="hr"></div>
        <div class="row" style="flex-wrap:wrap;">
          <button class="btn" id="btnExport">Экспорт</button>
          <button class="btn" id="btnImport">Импорт</button>
          <button class="btn" id="btnCloudSave">Сохранить в Cloud</button>
          <button class="btn" id="btnCloudLoad">Загрузить из Cloud</button>
          <button class="btn danger" id="btnClear">Очистить всё</button>
        </div>
        <div class="muted small" style="margin-top:8px">CloudStorage доступен только внутри Telegram.</div>
        <input id="importFile" type="file" accept="application/json" style="display:none" />
      </div>

      <div class="card section">
        <div style="font-weight:700;">О приложении</div>
        <div class="hr"></div>
        <div class="muted small">Версия UI: <b>v2</b></div>
        <div class="muted small" style="margin-top:8px">User: ${esc(TG.user ? `${TG.user.first_name||''} ${TG.user.last_name||''}`.trim() : 'guest')}</div>
      </div>
    </div>
  `;

  wrap.appendChild(form);

  // init controls
  $('#setTheme', wrap).value = Settings.get('theme');
  $('#setFont', wrap).value = String(Settings.get('fontScale'));
  $('#setApi', wrap).value = String(Settings.get('apiBase'));
  $('#setMax', wrap).value = String(Settings.get('attachmentMaxMB'));

  // toggle buttons reflect state
  const reflect = ()=>{
    setBtnState('#togCompact', Settings.get('compact'));
    setBtnState('#togMarkdown', Settings.get('markdown'));
    setBtnState('#togType', Settings.get('typewriter'));
    setBtnState('#togRM', Settings.get('reduceMotion'));
    setBtnState('#togH', Settings.get('haptics'));
  };
  reflect();

  $('#setTheme', wrap).onchange = (e)=>{ Settings.set('theme', e.target.value); TG.applyTheme(); requestRender(); };
  $('#setFont', wrap).oninput = (e)=>{ Settings.set('fontScale', Number(e.target.value)); };
  $('#setApi', wrap).onchange = (e)=>{ Settings.set('apiBase', String(e.target.value||'').trim() || '/api/v1'); };
  $('#setMax', wrap).oninput = (e)=>{ Settings.set('attachmentMaxMB', Number(e.target.value)); };

  $('#togCompact', wrap).onclick = ()=>{ Settings.set('compact', !Settings.get('compact')); reflect(); };
  $('#togMarkdown', wrap).onclick = ()=>{ Settings.set('markdown', !Settings.get('markdown')); reflect(); requestRender(); };
  $('#togType', wrap).onclick = ()=>{ Settings.set('typewriter', !Settings.get('typewriter')); reflect(); };
  $('#togRM', wrap).onclick = ()=>{ Settings.set('reduceMotion', !Settings.get('reduceMotion')); reflect(); };
  $('#togH', wrap).onclick = ()=>{ Settings.set('haptics', !Settings.get('haptics')); reflect(); };

  $('#btnPing', wrap).onclick = async ()=>{
    const out = $('#pingOut', wrap);
    out.textContent = '…';
    try {
      const ms = await API.ping();
      out.textContent = `Ping: ${ms} ms`;
    } catch (e) {
      out.textContent = `Ошибка: ${e.message || e}`;
    }
  };

  $('#btnAuth', wrap).onclick = ()=> telegramAuth();
  $('#btnLogout', wrap).onclick = async ()=>{
    if (!isAuthed()) return TG.toastErr('Токена нет');
    const ok = await TG.confirm('Выход', 'Удалить токен из браузера?');
    if (!ok) return;
    API.clearToken();
    TG.toastOK('Токен удалён');
    requestRender();
  };

  $('#btnExport', wrap).onclick = ()=> exportAll();

  const importFile = $('#importFile', wrap);
  $('#btnImport', wrap).onclick = ()=> importFile.click();
  importFile.onchange = async ()=>{
    const f = importFile.files?.[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      importAllObject(obj);
      TG.toastOK('Импортировано');
      requestRender();
    } catch (e) {
      TG.toastErr('Неверный JSON');
    } finally {
      importFile.value='';
    }
  };

  $('#btnCloudSave', wrap).onclick = async ()=> cloudSave();
  $('#btnCloudLoad', wrap).onclick = async ()=> cloudLoad();

  $('#btnClear', wrap).onclick = async ()=> resetLocal();

  return wrap;
}

function setBtnState(sel, on){
  const b = $(sel);
  if (!b) return;
  b.classList.toggle('primary', !!on);
}

// ---------- Diagnostics ----------
function renderDiagnostics(){
  const wrap = el('div','card section');
  wrap.innerHTML = `
    <div style="font-weight:800;">Диагностика</div>
    <div class="muted small" style="margin-top:6px;">Снимок состояния для отладки</div>
    <div class="hr"></div>
    <div class="row" style="flex-wrap:wrap;">
      <button class="btn" id="dlDiag">Скачать diagnostics.json</button>
      <button class="btn" id="logBot">Отправить лог в бота</button>
    </div>
    <div class="hr"></div>
    <pre id="diagPre"></pre>
  `;

  const diag = buildDiagnostics();
  $('#diagPre', wrap).textContent = JSON.stringify(diag, null, 2);

  $('#dlDiag', wrap).onclick = ()=> downloadJson(diag, 'diagnostics.json');
  $('#logBot', wrap).onclick = ()=> TG.sendData({type:'diagnostics', diag});

  return wrap;
}

function buildDiagnostics(){
  return {
    at: new Date().toISOString(),
    isTelegram: !!tg,
    user: TG.user ? {id: TG.user.id, username: TG.user.username, first_name: TG.user.first_name, language_code: TG.user.language_code} : null,
    themeParams: tg?.themeParams || null,
    viewport: tg ? {height: tg.viewportHeight, stableHeight: tg.viewportStableHeight, expanded: tg.isExpanded} : null,
    api: { base: API.base, authed: isAuthed() },
    settings: Settings.export(),
    chat: { messages: State.chat.length, last: State.chat.slice(-3) },
    projects: { count: State.projects.length, activeProjectId: State.activeProjectId },
    media: { imageLoaded: !!State.media.image.src, videoLoaded: !!State.media.video.file, ffmpegReady: !!State.media.video.ffmpegReady }
  };
}

// ---------- Protected sections (stubs until backend) ----------
function stubSection(title, hint){
  const w = el('div','card section');
  w.innerHTML = `
    <div style="font-weight:800;">${esc(title)}</div>
    <div class="muted" style="margin-top:6px;">${esc(hint)}</div>
    <div class="hr"></div>
    <div class="row" style="flex-wrap:wrap;">
      <button class="btn" id="btnLoad">Загрузить</button>
      <button class="btn" id="btnSave">Сохранить</button>
    </div>
    <div class="muted small" style="margin-top:10px;">Этот экран готов для подключения к бэкенду.</div>
  `;
  w.addEventListener('click', (e)=>{
    if (e.target?.id === 'btnLoad') TG.toastOK('TODO: backend');
    if (e.target?.id === 'btnSave') TG.toastOK('TODO: backend');
  });
  return w;
}

function renderKeys(){
  const w = stubSection('Ключи', 'Управление API-ключами (ввод/маскирование/удаление)');
  // minimal local key vault (masked)
  const vault = LS.get('aip.keys.v1', []);
  const box = el('div');
  box.style.marginTop='12px';
  box.innerHTML = `
    <div class="hr"></div>
    <div style="font-weight:700;">Локально</div>
    <div class="muted small" style="margin-top:6px;">Хранится в localStorage (небезопасно для продакшена).</div>
    <div class="row" style="flex-wrap:wrap;margin-top:10px;">
      <input id="kName" class="textarea" style="min-height:44px;max-height:44px;" placeholder="Название" />
      <input id="kVal" class="textarea" style="min-height:44px;max-height:44px;" placeholder="Ключ" />
      <button class="btn primary" id="kAdd">Добавить</button>
    </div>
    <div id="kList" style="margin-top:10px;"></div>
  `;
  w.appendChild(box);

  const renderList = ()=>{
    const list = $('#kList', w);
    list.innerHTML='';
    const items = LS.get('aip.keys.v1', []);
    if (!items.length) {
      const m = el('div','muted small'); m.textContent='Ключей нет'; list.appendChild(m); return;
    }
    items.forEach((it, idx)=>{
      const row = el('div','card section');
      row.style.marginBottom='8px';
      const masked = String(it.value||'').slice(0,4) + '••••' + String(it.value||'').slice(-4);
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
          <div>
            <div style="font-weight:700;">${esc(it.name||'key')}</div>
            <div class="muted small">${esc(masked)}</div>
          </div>
          <div class="row">
            <button class="btn" data-act="copy" data-i="${idx}" style="height:32px;">Копировать</button>
            <button class="btn danger" data-act="del" data-i="${idx}" style="height:32px;">Удалить</button>
          </div>
        </div>
      `;
      list.appendChild(row);
    });
  };

  renderList();

  $('#kAdd', w).onclick = ()=>{
    const name = ($('#kName', w).value||'').trim();
    const value = ($('#kVal', w).value||'').trim();
    if (!name || !value) return TG.toastErr('Заполни оба поля');
    const items = LS.get('aip.keys.v1', []);
    items.unshift({name, value, createdAt: Date.now()});
    LS.set('aip.keys.v1', items);
    $('#kName', w).value='';
    $('#kVal', w).value='';
    renderList();
    TG.toastOK('Добавлено');
  };

  w.addEventListener('click', async (e)=>{
    const btn = e.target?.closest('button');
    if (!btn) return;
    const act = btn.dataset.act;
    const i = Number(btn.dataset.i);
    if (!act) return;
    const items = LS.get('aip.keys.v1', []);
    const it = items[i];
    if (!it) return;
    if (act==='copy') {
      try { await navigator.clipboard.writeText(it.value); TG.toastOK('Скопировано'); } catch { TG.toastErr('Clipboard недоступен'); }
    }
    if (act==='del') {
      const ok = await TG.confirm('Удалить', `Удалить ключ “${it.name}”?`);
      if (!ok) return;
      items.splice(i,1);
      LS.set('aip.keys.v1', items);
      renderList();
      TG.toastOK('Удалено');
    }
  });

  return w;
}

function renderReminders(){
  return stubSection('Напоминания', 'Создание напоминаний (требуется бэкенд + бот для уведомлений)');
}
function renderCalendar(){
  return stubSection('Календарь', 'Синхронизация календаря (требуется бэкенд/интеграции)');
}
function renderNotifications(){
  return stubSection('Уведомления', 'Подписки и уведомления (требуется бэкенд/бот)');
}

// ---------- Modal ----------
function renderModal(){
  const m = el('div','modal show');
  const bd = el('div','backdrop show');
  bd.onclick = ()=>{ State.modal=null; requestRender(); };
  m.appendChild(bd);

  const card = el('div','card section modal-card');

  const close = el('button','btn');
  close.textContent = 'Закрыть';
  close.onclick = ()=>{ State.modal=null; requestRender(); };

  const type = State.modal?.type;

  if (type === 'quick') {
    card.innerHTML = `
      <div style="font-weight:800;">Меню</div>
      <div class="muted small" style="margin-top:6px;">${esc(TG.user ? 'Telegram user' : 'Guest mode')}</div>
      <div class="hr"></div>
      <div class="row" style="flex-wrap:wrap;">
        <button class="btn" id="qExport">Экспорт</button>
        <button class="btn" id="qImport">Импорт</button>
        <button class="btn" id="qDiag">Диагностика</button>
        <button class="btn" id="qSettings">Настройки</button>
      </div>
      <div class="hr"></div>
      <div class="row" style="flex-wrap:wrap;">
        <button class="btn" id="qCloudSave">Cloud Save</button>
        <button class="btn" id="qCloudLoad">Cloud Load</button>
        <button class="btn" id="qAuth">TG auth</button>
        <button class="btn danger" id="qReset">Сброс</button>
      </div>
      <div class="hr"></div>
    `;
    card.appendChild(close);

    card.addEventListener('click', async (e)=>{
      const id = e.target?.id;
      if (!id) return;
      if (id==='qExport') await exportAll();
      if (id==='qImport') await importAll();
      if (id==='qDiag') setRoute('diagnostics');
      if (id==='qSettings') setRoute('settings');
      if (id==='qCloudSave') await cloudSave();
      if (id==='qCloudLoad') await cloudLoad();
      if (id==='qAuth') await telegramAuth();
      if (id==='qReset') await resetLocal();
      State.modal = null;
      requestRender();
    });
  }

  if (type === 'pickProject') {
    card.innerHTML = `
      <div style="font-weight:800;">Выбор проекта</div>
      <div class="muted small" style="margin-top:6px;">Свяжи чат с проектом</div>
      <div class="hr"></div>
      <div id="plist"></div>
      <div class="hr"></div>
      <div class="row" style="flex-wrap:wrap;">
        <button class="btn primary" id="pNew">Создать</button>
        <button class="btn" id="pNone">Без проекта</button>
      </div>
    `;

    const list = $('#plist', card);
    const items = [...State.projects].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    if (!items.length) {
      const m0 = el('div','muted small'); m0.textContent='Проектов нет.'; list.appendChild(m0);
    } else {
      items.forEach(p=>{
        const b = el('button','btn navbtn' + (p.id===State.activeProjectId?' active':''));
        b.innerHTML = `<span>${esc(p.name||'Без названия')}</span><span class="muted small">${new Date(p.updatedAt||Date.now()).toLocaleDateString()}</span>`;
        b.onclick = ()=>{
          State.activeProjectId = p.id;
          persistProjects();
          State.modal=null;
          requestRender();
        };
        list.appendChild(b);
      });
    }

    card.appendChild(el('div','hr'));
    card.appendChild(close);

    card.addEventListener('click', (e)=>{
      if (e.target?.id === 'pNew') { State.modal = {type:'editProject', id:null}; requestRender(); }
      if (e.target?.id === 'pNone') { State.activeProjectId = null; persistProjects(); State.modal=null; requestRender(); }
    });
  }

  if (type === 'editProject') {
    const id = State.modal.id;
    const p = id ? State.projects.find(x=>x.id===id) : null;
    card.innerHTML = `
      <div style="font-weight:800;">${p?'Редактировать':'Создать'} проект</div>
      <div class="hr"></div>
      <label class="muted small">Название</label>
      <input id="pn" class="textarea" style="min-height:44px;max-height:44px;" placeholder="Например: Мой проект" value="${esc(p?.name||'')}" />
      <div style="height:10px"></div>
      <label class="muted small">Описание</label>
      <textarea id="pd" class="textarea" placeholder="Коротко о проекте…">${esc(p?.desc||'')}</textarea>
      <div style="height:10px"></div>
      <label class="muted small">Теги (через запятую)</label>
      <input id="pt" class="textarea" style="min-height:44px;max-height:44px;" placeholder="ai, web, tg" value="${esc((p?.tags||[]).join(', '))}" />
      <div class="hr"></div>
      <div class="row" style="flex-wrap:wrap;">
        <button class="btn primary" id="psave">Сохранить</button>
        ${p?'<button class="btn danger" id="pdel">Удалить</button>':''}
        <button class="btn" id="pcancel">Отмена</button>
      </div>
    `;

    card.addEventListener('click', async (e)=>{
      if (e.target?.id === 'pcancel') { State.modal=null; requestRender(); }
      if (e.target?.id === 'psave') {
        const name = ($('#pn', card).value||'').trim() || 'Без названия';
        const desc = ($('#pd', card).value||'').trim();
        const tags = ($('#pt', card).value||'').split(',').map(s=>s.trim()).filter(Boolean).slice(0,12);

        const obj = p ? {...p} : {id: crypto.randomUUID(), chats:[]};
        obj.name = name;
        obj.desc = desc;
        obj.tags = tags;
        obj.updatedAt = Date.now();

        upsertProject(obj);
        State.activeProjectId = obj.id;
        persistProjects();
        TG.toastOK('Сохранено');
        State.modal=null;
        requestRender();
      }
      if (e.target?.id === 'pdel' && p) {
        const ok = await TG.confirm('Удалить проект', `Удалить “${p.name}”?`);
        if (!ok) return;
        deleteProject(p.id);
        TG.toastOK('Удалено');
        State.modal=null;
        requestRender();
      }
    });

    card.appendChild(el('div','hr'));
    card.appendChild(close);
  }

  if (type === 'projectDetails') {
    const p = State.projects.find(x=>x.id===State.modal.id);
    if (!p) { State.modal=null; requestRender(); return m; }

    const msgs = p.chats ? State.chat.filter(m=>p.chats.includes(m.id)) : [];

    card.innerHTML = `
      <div style="font-weight:800;">${esc(p.name||'Проект')}</div>
      <div class="muted small" style="margin-top:6px;">Обновлён: ${new Date(p.updatedAt||Date.now()).toLocaleString()}</div>
      <div class="hr"></div>
      <div class="muted">${esc(p.desc||'')}</div>
      <div class="muted small" style="margin-top:6px;">${(p.tags||[]).map(t=>`#${esc(t)}`).join(' ')}</div>
      <div class="hr"></div>
      <div class="row" style="flex-wrap:wrap;">
        <button class="btn" id="pEdit">Редактировать</button>
        <button class="btn" id="pExport">Экспорт MD</button>
        <button class="btn" id="pToChat">Открыть чат</button>
      </div>
      <div class="hr"></div>
      <div style="font-weight:700;">Сообщения: ${msgs.length}</div>
      <div class="muted small" style="margin-top:6px;">Показываются только сообщения, связанные с проектом.</div>
    `;

    card.addEventListener('click', (e)=>{
      if (e.target?.id === 'pEdit') { State.modal = {type:'editProject', id:p.id}; requestRender(); }
      if (e.target?.id === 'pToChat') { State.activeProjectId = p.id; persistProjects(); State.modal=null; setRoute('chat'); }
      if (e.target?.id === 'pExport') {
        const md = exportProjectMarkdown(p, msgs);
        downloadText(md, `${(p.name||'project').replace(/[^a-z0-9а-яё_-]+/gi,'_')}.md`);
        TG.toastOK('Экспортировано');
      }
    });

    card.appendChild(el('div','hr'));
    card.appendChild(close);
  }

  if (type === 'searchChat') {
    card.innerHTML = `
      <div style="font-weight:800;">Поиск по чату</div>
      <div class="hr"></div>
      <input id="sq" class="textarea" style="min-height:44px;max-height:44px;" placeholder="Текст…" />
      <div class="hr"></div>
      <div id="sr"></div>
    `;
    card.appendChild(close);

    const q = $('#sq', card);
    const r = $('#sr', card);
    q.oninput = ()=>{
      const s = (q.value||'').trim().toLowerCase();
      r.innerHTML='';
      if (!s) return;
      const found = State.chat.filter(m=> (m.text||'').toLowerCase().includes(s)).slice(-20);
      if (!found.length) { const m = el('div','muted small'); m.textContent='Ничего не найдено'; r.appendChild(m); return; }
      found.forEach(m=>{
        const b = el('button','btn navbtn');
        b.innerHTML = `<span>${esc((m.text||'').slice(0,40))}${(m.text||'').length>40?'…':''}</span><span class="muted small">${m.role==='me'?'Вы':'AI'}</span>`;
        b.onclick = ()=>{
          State.modal=null;
          requestRender();
          // crude: scroll to bottom (we keep latest). In future: message anchors.
        };
        r.appendChild(b);
      });
    };
    setTimeout(()=> q.focus(), 0);
  }

  if (type === 'imageEditor') {
    // dedicated editor for a draft attachment
    const idx = State.modal.fromDraftIndex;
    const a = State.draft.attachments?.[idx];
    if (!a?.dataUrl) { State.modal=null; requestRender(); return m; }

    card.innerHTML = `
      <div style="font-weight:800;">Редактор изображения</div>
      <div class="muted small" style="margin-top:6px;">Изменения применяются к вложению</div>
      <div class="hr"></div>
      <div class="canvas-wrap"><canvas id="edCanvas" width="900" height="600"></canvas></div>
      <div class="hr"></div>
      <div class="grid" style="grid-template-columns:1fr 1fr;">
        <div>
          <div class="muted small">Яркость</div>
          <input type="range" id="edB" min="0" max="2" step="0.01" value="1" />
        </div>
        <div>
          <div class="muted small">Контраст</div>
          <input type="range" id="edC" min="0" max="2" step="0.01" value="1" />
        </div>
        <div>
          <div class="muted small">Насыщенность</div>
          <input type="range" id="edS" min="0" max="3" step="0.01" value="1" />
        </div>
        <div>
          <div class="muted small">Поворот</div>
          <input type="range" id="edR" min="-180" max="180" step="1" value="0" />
        </div>
      </div>
      <div class="hr"></div>
      <div class="row" style="flex-wrap:wrap;">
        <button class="btn primary" id="edApply">Применить</button>
        <button class="btn" id="edCancel">Отмена</button>
      </div>
    `;

    const c = $('#edCanvas', card);
    const ctx = c.getContext('2d');
    let f = {brightness:1, contrast:1, saturate:1, rotate:0};

    const draw = ()=>{
      const img = new Image();
      img.onload = ()=>{
        ctx.save();
        ctx.clearRect(0,0,c.width,c.height);
        const scale = Math.min(c.width/img.width, c.height/img.height);
        const w = img.width*scale;
        const h = img.height*scale;
        ctx.filter = `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturate})`;
        ctx.translate(c.width/2, c.height/2);
        ctx.rotate((f.rotate||0)*Math.PI/180);
        ctx.drawImage(img, -w/2, -h/2, w, h);
        ctx.restore();
      };
      img.src = a.dataUrl;
    };

    draw();

    $('#edB', card).oninput = (e)=>{ f.brightness = Number(e.target.value); draw(); };
    $('#edC', card).oninput = (e)=>{ f.contrast = Number(e.target.value); draw(); };
    $('#edS', card).oninput = (e)=>{ f.saturate = Number(e.target.value); draw(); };
    $('#edR', card).oninput = (e)=>{ f.rotate = Number(e.target.value); draw(); };

    card.addEventListener('click', (e)=>{
      if (e.target?.id === 'edCancel') { State.modal=null; requestRender(); }
      if (e.target?.id === 'edApply') {
        const url = c.toDataURL('image/png');
        a.dataUrl = url;
        a.type = 'image/png';
        a.name = a.name.replace(/\.[a-z0-9]+$/i,'') + '.png';
        a.size = url.length;
        persistDraft();
        TG.toastOK('Применено');
        State.modal=null;
        requestRender();
      }
    });
  }

  m.appendChild(card);
  return m;
}

// ---------- Export / Import / Reset ----------
function exportAllObject(){
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: Settings.export(),
    chat: State.chat,
    draft: State.draft,
    projects: State.projects,
    activeProjectId: State.activeProjectId,
    keys: LS.get('aip.keys.v1', [])
  };
}

async function exportAll(){
  const obj = exportAllObject();
  downloadJson(obj, 'ai-platform-export.json');
  TG.haptic('notify','success');
}

function importAllObject(obj){
  if (!obj || typeof obj !== 'object') throw new Error('bad');
  if (obj.settings) Settings.import(obj.settings);
  if (Array.isArray(obj.chat)) { State.chat = obj.chat; persistChat(); }
  if (obj.draft && typeof obj.draft === 'object') { State.draft = obj.draft; persistDraft(); }
  if (Array.isArray(obj.projects)) { State.projects = obj.projects; State.activeProjectId = obj.activeProjectId || null; persistProjects(); }
  if (Array.isArray(obj.keys)) LS.set('aip.keys.v1', obj.keys);
}

async function importAll(){
  // open file picker via modal
  const input = document.createElement('input');
  input.type='file';
  input.accept='application/json';
  input.onchange = async ()=>{
    const f = input.files?.[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      importAllObject(obj);
      TG.toastOK('Импортировано');
      requestRender();
    } catch { TG.toastErr('Неверный JSON'); }
  };
  input.click();
}

async function resetLocal(){
  const ok = await TG.confirm('Сброс', 'Удалить локальные данные (чат, проекты, настройки)?');
  if (!ok) return;
  // keep token unless user logs out explicitly
  LS.del(Settings.key);
  LS.del('aip.chat.v2');
  LS.del('aip.draft.v2');
  LS.del('aip.projects.v2');
  LS.del('aip.activeProject');
  LS.del('aip.keys.v1');
  Settings.load();
  State.chat = [];
  State.draft = {text:'', attachments:[]};
  State.projects = [];
  State.activeProjectId = null;
  TG.toastOK('Сброшено');
  requestRender();
}

// ---------- CloudStorage ----------
async function cloudSave(){
  if (!tg?.CloudStorage) return TG.toastErr('CloudStorage доступен только в Telegram');
  const obj = exportAllObject();
  const ok = await TG.cloudSet('aip.export.v2', JSON.stringify(obj));
  ok ? TG.toastOK('Сохранено в CloudStorage') : TG.toastErr('Не удалось сохранить');
}

async function cloudLoad(){
  if (!tg?.CloudStorage) return TG.toastErr('CloudStorage доступен только в Telegram');
  const raw = await TG.cloudGet('aip.export.v2');
  if (!raw) return TG.toastErr('В CloudStorage нет данных');
  try {
    const obj = JSON.parse(raw);
    importAllObject(obj);
    TG.toastOK('Загружено из CloudStorage');
    requestRender();
  } catch {
    TG.toastErr('Данные в CloudStorage повреждены');
  }
}

// ---------- Telegram Auth (backend) ----------
async function telegramAuth(){
  if (!tg) return TG.toastErr('Открой в Telegram');
  if (!tg.initData) return TG.toastErr('Нет tg.initData');

  try {
    const res = await API.req('/auth/telegram', {method:'POST', body:{ init_data: tg.initData }});
    const token = res?.access_token || res?.token;
    if (!token) throw new Error('Нет токена в ответе');
    API.setToken(token);
    TG.toastOK('Авторизация успешна');
    requestRender();
  } catch (e) {
    TG.toastErr(`TG auth: ${e.message || e}`);
  }
}

// ---------- Send all to bot ----------
async function sendAllToBot(){
  const obj = exportAllObject();
  TG.sendData({type:'export', payload: obj});
  TG.toastOK('Экспорт отправлен в бота через tg.sendData');
}

// ---------- Logging ----------
function logEvent(name, data={}){
  if (!Settings.get('logToBot')) return;
  TG.sendData({type:'log', name, data, at: Date.now()});
}

// ---------- Download helpers ----------
function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
  setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch{} }, 1000);
}

function downloadDataUrl(url, filename){
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadJson(obj, filename){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type:'application/json'});
  downloadBlob(blob, filename);
}

function downloadText(text, filename){
  const blob = new Blob([text], {type:'text/plain'});
  downloadBlob(blob, filename);
}

function exportProjectMarkdown(p, msgs){
  const lines = [];
  lines.push(`# ${p.name||'Проект'}`);
  if (p.desc) lines.push(`\n${p.desc}\n`);
  if (p.tags?.length) lines.push(`\nТеги: ${p.tags.map(t=>`#${t}`).join(' ')}\n`);
  lines.push('\n---\n');
  lines.push('## Чат\n');
  msgs.forEach(m=>{
    lines.push(`**${m.role==='me'?'Вы':'AI'}** (${new Date(m.ts).toLocaleString()}):\n\n${m.text||''}\n`);
  });
  return lines.join('\n');
}

// ---------- Boot ----------
async function boot(){
  Settings.load();
  TG.init();

  // try to hydrate from CloudStorage (optional) if user enabled (we do not auto-load to avoid surprises)

  // compact mode: slightly tighter paddings
  if (Settings.get('compact')) {
    document.documentElement.style.setProperty('--radius', '16px');
  }

  // first render
  requestRender();
}

boot();
