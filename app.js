/* ================================================================
   AI Council v6 — app.js
   Multi-tenancy · Background file jobs · i18n (EN/RO/ES)
   ================================================================ */
'use strict';

// ══════════════════════════════════════════════════════════════
//  i18n
// ══════════════════════════════════════════════════════════════
const TRANSLATIONS = {
  en: {
    // Login
    sign_in: 'Sign in', username: 'Username', password: 'Password',
    invalid_creds: 'Invalid username or password.',
    missing_fields: 'Please enter username and password.',
    signing_in: 'Signing in...',
    login_sub: 'Sign in to your account',
    // Sidebar
    models: 'Models', stored_files: 'Stored Files', settings: 'Settings',
    new_chat: 'New chat', search_placeholder: 'Search...',
    logout: 'Logout', no_chats: 'No conversations yet.\nSend your first message.',
    today: 'Today', yesterday: 'Yesterday', this_week: 'This week', older: 'Older',
    // Welcome
    welcome_title: 'AI Council', welcome_sub: 'Simultaneous perspectives from multiple AI models,\nsynthesized by Claude Sonnet 4.',
    s0: 'SaaS PRD with AI integration',
    s1: 'Sales chart + Excel table',
    s2: '8-slide investor pitch deck',
    s3: 'Microservices architecture diagram',
    // Input
    input_placeholder: 'Message AI Council... (attach multiple files)',
    input_note_suffix: ' · diagrams · charts · PPTX · DOCX · XLSX · PDF',
    no_models: 'No models active',
    // File chips
    uploading: 'Uploading...', extracting: 'Extracting...', ready: 'Ready', error: 'Error',
    // Council
    council_active: 'Active council', synthesis_title: 'Moderator — Final Synthesis',
    synthesizing: 'Synthesizing...', claude_sonnet: 'Claude Sonnet 4',
    // Actions
    edit: 'Edit', retry: 'Retry', cancel: 'Cancel', send_variant: 'Send variant',
    // Doc buttons
    copy: 'Copy', download: 'Download',
    // Settings
    api_keys_status: 'API Keys — Server Status',
    api_keys_note: '🔒 API keys are managed exclusively on the server (Netlify Environment Variables). They are not stored in the browser.',
    how_to_add: 'How to add: Netlify → Site Settings → Environment Variables → Add variable → Save → Redeploy',
    configured: 'Configured', missing: 'Missing', reload_status: 'Reload status',
    r2_title: 'Cloudflare R2 — File Storage', supabase_title: 'Supabase — Database (multi-device)',
    local_data: 'Local Data', export_backup: 'Export backup', delete_all: 'Delete all local data',
    // Models modal
    active_models: 'Active models', add_from_catalog: 'Add from catalog',
    custom_model: 'Custom model', add_custom: 'Add custom model (Ollama, Together, etc.)',
    display_name: 'Display name', role_in_council: 'Role in council',
    // Files modal
    no_files: 'No stored files. Uploaded files will appear here.',
    delete_file_confirm: 'Delete this file permanently?',
    // Misc
    delete_chat_confirm: 'Delete this conversation?', delete_model_confirm: 'Remove this model?',
    import_success: '✅ {n} models imported.', import_error: '❌ Invalid JSON.',
    sb_connected: '✅ Supabase connected! Run schema.sql if first time.',
    sb_error: '❌ Connection failed. Check URL and key.',
    sb_fill: 'Please fill in URL and Key.',
    clear_confirm: 'Delete all local data? This is irreversible.',
    r2_configured: '✓ Configured — files up to 500MB',
    r2_not_configured: '⚠ Not configured — limited to 4MB base64',
    db_connected: 'Supabase ✓', db_local: 'Local only',
    active: 'active', no_key: 'key missing',
  },
  ro: {
    sign_in: 'Conectare', username: 'Utilizator', password: 'Parolă',
    invalid_creds: 'Utilizator sau parolă incorectă.',
    missing_fields: 'Introdu utilizatorul și parola.',
    signing_in: 'Se conectează...', login_sub: 'Conectează-te la contul tău',
    models: 'Modele', stored_files: 'Fișiere stocate', settings: 'Setări',
    new_chat: 'Chat nou', search_placeholder: 'Caută...', logout: 'Deconectare',
    no_chats: 'Nicio conversație.\nTrimite primul mesaj.',
    today: 'Azi', yesterday: 'Ieri', this_week: 'Această săptămână', older: 'Mai vechi',
    welcome_title: 'AI Council', welcome_sub: 'Perspective simultane de la mai multe modele AI,\nsintetizate de Claude Sonnet 4.',
    s0: 'PRD complet pentru o aplicație SaaS cu AI',
    s1: 'Grafic vânzări + tabel Excel',
    s2: 'Pitch deck investitori — 8 slide-uri PPTX',
    s3: 'Diagramă arhitectură microservicii (Mermaid)',
    input_placeholder: 'Mesaj pentru AI Council... (atașează mai multe fișiere)',
    input_note_suffix: ' · diagrame · grafice · PPTX · DOCX · XLSX · PDF',
    no_models: 'Niciun model activ',
    uploading: 'Se uploadează...', extracting: 'Se extrage textul...', ready: 'Gata', error: 'Eroare',
    council_active: 'Consiliu activ', synthesis_title: 'Moderator — Sinteză Finală',
    synthesizing: 'Se sintetizează...', claude_sonnet: 'Claude Sonnet 4',
    edit: 'Editează', retry: 'Retry', cancel: 'Anulează', send_variant: 'Trimite varianta',
    copy: 'Copiază', download: 'Descarcă',
    api_keys_status: 'Chei API — Status pe server',
    api_keys_note: '🔒 Cheile API sunt gestionate exclusiv pe server (Netlify Environment Variables). Nu se salvează în browser.',
    how_to_add: 'Cum adaugi: Netlify → Site Settings → Environment Variables → Add variable → Save → Redeploy',
    configured: 'Configurat', missing: 'Lipsă', reload_status: 'Reîncarcă status',
    r2_title: 'Cloudflare R2 — Stocare fișiere', supabase_title: 'Supabase — Baza de date (multi-device)',
    local_data: 'Date locale', export_backup: 'Export backup', delete_all: 'Șterge toate datele locale',
    active_models: 'Modele active', add_from_catalog: 'Adaugă din catalog',
    custom_model: 'Model custom', add_custom: 'Adaugă model custom (Ollama, Together, etc.)',
    display_name: 'Nume afișat', role_in_council: 'Rol în consiliu',
    no_files: 'Niciun fișier stocat. Fișierele uploadate vor apărea aici.',
    delete_file_confirm: 'Ștergi fișierul permanent?',
    delete_chat_confirm: 'Ștergi această conversație?', delete_model_confirm: 'Elimini modelul?',
    import_success: '✅ {n} modele importate.', import_error: '❌ JSON invalid.',
    sb_connected: '✅ Supabase conectat! Rulează schema.sql dacă e prima configurare.',
    sb_error: '❌ Conexiunea a eșuat. Verifică URL și cheia.',
    sb_fill: 'Completează URL și Key.', clear_confirm: 'Ștergi toate datele locale? Acțiunea e ireversibilă.',
    r2_configured: '✓ Configurat — fișiere până la 500MB',
    r2_not_configured: '⚠ Neconfigurat — limitat la 4MB base64',
    db_connected: 'Supabase ✓', db_local: 'Local only',
    active: 'activ', no_key: 'cheie lipsă',
  },
  es: {
    sign_in: 'Iniciar sesión', username: 'Usuario', password: 'Contraseña',
    invalid_creds: 'Usuario o contraseña incorrectos.',
    missing_fields: 'Ingresa usuario y contraseña.',
    signing_in: 'Iniciando sesión...', login_sub: 'Inicia sesión en tu cuenta',
    models: 'Modelos', stored_files: 'Archivos guardados', settings: 'Configuración',
    new_chat: 'Nuevo chat', search_placeholder: 'Buscar...', logout: 'Cerrar sesión',
    no_chats: 'Sin conversaciones.\nEnvía tu primer mensaje.',
    today: 'Hoy', yesterday: 'Ayer', this_week: 'Esta semana', older: 'Más antiguo',
    welcome_title: 'AI Council', welcome_sub: 'Perspectivas simultáneas de múltiples modelos de IA,\nsintetizadas por Claude Sonnet 4.',
    s0: 'PRD completo para app SaaS con IA',
    s1: 'Gráfico de ventas + tabla Excel',
    s2: 'Pitch deck de 8 diapositivas para inversores',
    s3: 'Diagrama de arquitectura de microservicios',
    input_placeholder: 'Mensaje para AI Council... (adjunta varios archivos)',
    input_note_suffix: ' · diagramas · gráficos · PPTX · DOCX · XLSX · PDF',
    no_models: 'Sin modelos activos',
    uploading: 'Subiendo...', extracting: 'Extrayendo...', ready: 'Listo', error: 'Error',
    council_active: 'Consejo activo', synthesis_title: 'Moderador — Síntesis Final',
    synthesizing: 'Sintetizando...', claude_sonnet: 'Claude Sonnet 4',
    edit: 'Editar', retry: 'Reintentar', cancel: 'Cancelar', send_variant: 'Enviar variante',
    copy: 'Copiar', download: 'Descargar',
    api_keys_status: 'Claves API — Estado en servidor',
    api_keys_note: '🔒 Las claves API se gestionan exclusivamente en el servidor (Netlify Environment Variables). No se guardan en el navegador.',
    how_to_add: 'Cómo agregar: Netlify → Site Settings → Environment Variables → Add variable → Save → Redeploy',
    configured: 'Configurado', missing: 'Falta', reload_status: 'Recargar estado',
    r2_title: 'Cloudflare R2 — Almacenamiento', supabase_title: 'Supabase — Base de datos (multi-dispositivo)',
    local_data: 'Datos locales', export_backup: 'Exportar copia', delete_all: 'Eliminar todos los datos locales',
    active_models: 'Modelos activos', add_from_catalog: 'Agregar del catálogo',
    custom_model: 'Modelo personalizado', add_custom: 'Agregar modelo personalizado (Ollama, Together, etc.)',
    display_name: 'Nombre mostrado', role_in_council: 'Rol en el consejo',
    no_files: 'Sin archivos guardados. Los archivos subidos aparecerán aquí.',
    delete_file_confirm: '¿Eliminar este archivo permanentemente?',
    delete_chat_confirm: '¿Eliminar esta conversación?', delete_model_confirm: '¿Quitar este modelo?',
    import_success: '✅ {n} modelos importados.', import_error: '❌ JSON inválido.',
    sb_connected: '✅ Supabase conectado! Ejecuta schema.sql si es la primera vez.',
    sb_error: '❌ Conexión fallida. Verifica la URL y la clave.',
    sb_fill: 'Completa URL y Clave.', clear_confirm: '¿Eliminar todos los datos locales?',
    r2_configured: '✓ Configurado — archivos hasta 500MB',
    r2_not_configured: '⚠ No configurado — limitado a 4MB base64',
    db_connected: 'Supabase ✓', db_local: 'Solo local',
    active: 'activo', no_key: 'clave falta',
  },
};

let LANG = 'en';
function t(key, vars) {
  let str = (TRANSLATIONS[LANG] || TRANSLATIONS.en)[key] || (TRANSLATIONS.en[key] || key);
  if (vars) Object.entries(vars).forEach(([k,v]) => { str = str.replace(`{${k}}`, v); });
  return str;
}
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n');
    el.textContent = t(k);
  });
  const prompt = document.getElementById('prompt');
  if (prompt) prompt.placeholder = t('input_placeholder');
  const si = document.getElementById('search-inp');
  if (si) si.placeholder = t('search_placeholder');
  document.getElementById('login-sub').textContent = t('login_sub');
  document.getElementById('lbl-username').textContent = t('username');
  document.getElementById('lbl-password').textContent = t('password');
  document.getElementById('login-btn-text').textContent = t('sign_in');
  // lang buttons highlight
  ['en','ro','es'].forEach(l => {
    const lb = document.getElementById('lang-'+l);
    const lm = document.getElementById('lm-'+l);
    if (lb) lb.classList.toggle('active', l === LANG);
    if (lm) lm.classList.toggle('active', l === LANG);
  });
}
function setLang(lang) {
  LANG = lang;
  localStorage.setItem('lang', lang);
  applyI18n();
  renderSidebar();
  renderStrip();
  renderMessages();
}

// ══════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════
const AUTH = {
  session: null, // {userId, userName, token}

  load() {
    try {
      const raw = sessionStorage.getItem('council_session');
      if (raw) this.session = JSON.parse(raw);
    } catch { this.session = null; }
  },

  save(s) {
    this.session = s;
    sessionStorage.setItem('council_session', JSON.stringify(s));
  },

  clear() {
    this.session = null;
    sessionStorage.removeItem('council_session');
  },

  get userId()   { return this.session?.userId   || 'anon'; },
  get userName() { return this.session?.userName || '?'; },
  get loggedIn() { return !!this.session?.userId; },
  get token()    { return this.session?.token    || ''; },

  // Prefix all storage keys with userId for isolation
  key(k) { return `${this.userId}__${k}`; },

  // Headers for authenticated API calls
  headers(extra = {}) {
    return { 'Content-Type': 'application/json', 'x-auth-token': this.token, ...extra };
  },
};

// ══════════════════════════════════════════════════════════════
//  CATALOG
// ══════════════════════════════════════════════════════════════
const CATALOG = [
  { id:'claude',     name:'Claude Sonnet 4',  provider:'anthropic', modelName:'claude-sonnet-4-20250514', accent:'#CF6A2F', role:'Analyst & Moderator',   hasVision:true  },
  { id:'gpt4o',      name:'GPT-4o',           provider:'openai',    modelName:'gpt-4o',                   accent:'#10A37F', role:'Product Strategist',     hasVision:true  },
  { id:'gpt4o-mini', name:'GPT-4o Mini',      provider:'openai',    modelName:'gpt-4o-mini',              accent:'#1abc9c', role:'Fast Assistant',         hasVision:true  },
  { id:'gemini',     name:'Gemini 2.0 Flash', provider:'google',    modelName:'gemini-2.0-flash',         accent:'#4285F4', role:'Research Analyst',       hasVision:true  },
  { id:'deepseek',   name:'DeepSeek V3',      provider:'deepseek',  modelName:'deepseek-chat',            accent:'#7C3AED', role:'Technical Architect',    hasVision:false },
  { id:'grok',       name:'Grok 3 Fast',      provider:'xai',       modelName:'grok-3-fast',              accent:'#1C9BEF', role:'Contrarian & Critic',    hasVision:false },
  { id:'groq-llama', name:'Llama 3.3 (Groq)', provider:'groq',      modelName:'llama-3.3-70b-versatile',  accent:'#f97316', role:'Fast Reasoning',         hasVision:false },
  { id:'mistral',    name:'Mistral Large',    provider:'mistral',   modelName:'mistral-large-latest',     accent:'#ff7a59', role:'Generalist',             hasVision:false },
];

// ══════════════════════════════════════════════════════════════
//  LOCAL STORAGE (user-scoped)
// ══════════════════════════════════════════════════════════════
const LS = {
  get: (k,d=null) => { try { const v=localStorage.getItem(AUTH.key(k)); return v!==null?JSON.parse(v):d; } catch { return d; } },
  set: (k,v) => { try { localStorage.setItem(AUTH.key(k),JSON.stringify(v)); } catch {} },
  del: (k)   => { try { localStorage.removeItem(AUTH.key(k)); } catch {} },
  // Global (not user-scoped) — for lang preference
  getGlobal: (k,d=null) => { try { const v=localStorage.getItem(k); return v!==null?JSON.parse(v):d; } catch { return d; } },
  setGlobal: (k,v) => { try { localStorage.setItem(k,JSON.stringify(v)); } catch {} },
};

// ══════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════
const S = {
  cfg: {
    providers:{}, r2:{ok:false}, supabase:{ok:false}, maxFileSizeMB:4,
    enableEvaluation:false,
    forceAllModels: false,   // #8: bypass smart routing, use all active models
    deepMode: false,         // #10: two-round debate before synthesis
    enhancePrompts: true,    // #3: rewrite vague prompts via Groq before council runs
    chainOfThought: 'auto',  // #3: 'auto'=math/analysis/code only, true=always, false=never
    factCheck: false,        // #4: optional Claude fact-check pass after synthesis
    webSearch: true,         // #63: live web search via Tavily when question needs current data
    desktopMode: false,      // #65: route messages to desktop agent instead of model council
  },
  sbClient: null,
  chats: [], activeChatId: null, messages: [],
  pendingFiles: [], // [{id,name,type,size,data,url,r2Key,text,extracting,extractPromise,preview}]
  busy: false,
  models: [],
  storedFiles: [],
  notifications: [],      // #12: unread role-reassignment alerts
  handoffCallbacks: {},   // #71: requestId → callback for council→desktop handoff
  // Skills
  skills: {},         // built-in skills from server
  customSkills: {},   // user-learned skills in LS
  activeSkill: null,  // {id, name, prompt} — active for current chat
};

// ══════════════════════════════════════════════════════════════
//  MODELS
// ══════════════════════════════════════════════════════════════
function loadModels() {
  const s = LS.get('models_v6');
  S.models = (s&&Array.isArray(s)&&s.length)?s:CATALOG.slice(0,4).map(m=>({...m,enabled:true}));
  LS.set('models_v6', S.models);
}
function saveModels() { LS.set('models_v6', S.models); }
function activeModels() { return S.models.filter(m=>m.enabled&&S.cfg.providers[m.provider]); }

// ══════════════════════════════════════════════════════════════
//  FILE UPLOAD + BACKGROUND EXTRACTION
// ══════════════════════════════════════════════════════════════
async function uploadToR2(file) {
  try {
    const res = await fetch('/api/upload-r2', {
      method:'POST', headers: AUTH.headers(),
      body: JSON.stringify({ filename:file.name, contentType:file.type, chatId:S.activeChatId||'general' }),
    });
    const info = await res.json();
    if (info.error==='R2_NOT_CONFIGURED'||info.error) return null;
    const blob = b64toBlob(file.data, file.type);
    const up = await fetch(info.uploadUrl, { method:'PUT', headers:{'Content-Type':file.type}, body:blob });
    if (!up.ok) return null;
    return { url: info.publicUrl, r2Key: info.r2Key };
  } catch { return null; }
}

// Non-blocking extraction: called immediately on file add
// Returns a Promise stored on the file object
function startExtraction(file) {
  const extractPromise = fetch('/api/extract-job', {
    method: 'POST', headers: AUTH.headers(),
    body: JSON.stringify({
      fileUrl:       file.url   || null,
      fileType:      file.type,
      fileName:      file.name,
      fileData:      file.url   ? null : file.data, // don't send base64 if we have URL
      fileSizeBytes: file.size,
      chatId:        S.activeChatId || null,
      userId:        AUTH.userId,
    }),
  })
  .then(r => r.json())
  .then(async data => {
    if (data.status === 'done') {
      file.text      = data.text || '';
      file.jobId     = data.jobId;
      file.extracting = false;
    } else if (data.status === 'processing' && data.jobId) {
      file.jobId = data.jobId;
      // Poll until done
      file.text = await pollJob(data.jobId);
      file.extracting = false;
    } else {
      file.text = '';
      file.extracting = false;
    }
    renderFileChips();
    return file.text;
  })
  .catch(err => {
    file.text = '';
    file.extracting = false;
    file.extractError = err.message;
    renderFileChips();
    return '';
  });

  return extractPromise;
}

async function pollJob(jobId, maxAttempts=60, intervalMs=2000) {
  for (let i=0; i<maxAttempts; i++) {
    await sleep(intervalMs);
    try {
      const res  = await fetch(`/api/job-status?jobId=${jobId}&userId=${AUTH.userId}`);
      const data = await res.json();
      if (data.status==='done')  return data.text || '';
      if (data.status==='error') return '';
    } catch {}
  }
  return '';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ══════════════════════════════════════════════════════════════
//  SEND
// ══════════════════════════════════════════════════════════════
async function send(editMsgId=null, editText=null) {
  if (S.busy) return;
  const input  = document.getElementById('prompt');
  const rawText = editText!==null ? editText : input.value.trim();

  // Handle slash commands
  if (!editMsgId && rawText.startsWith('/')) {
    const parsed = parseSlashCommand(rawText);
    if (parsed) {
      const handled = await handleSlashCommand(parsed.command, parsed.arg);
      if (handled) { input.value=''; grow(input); return; }
      // Unknown command — send as normal message
    }
  }

  // Detect @desktop prefix (explicit) or desktop mode toggle
  const isDesktopPrefix = rawText.startsWith('@desktop');
  const desktopTask = (isDesktopPrefix || S.cfg.desktopMode)
    ? (isDesktopPrefix ? rawText.replace(/^@desktop\s*/i, '').trim() || rawText : rawText)
    : null;

  const text   = rawText;
  const files  = [...S.pendingFiles];
  if (!text&&!files.length) return;

  const am = activeModels();
  if (!editMsgId&&!am.length) { alert(t('no_models')); return; }

  if (!editMsgId) { input.value=''; grow(input); S.pendingFiles=[]; renderFileChips(); }

  // Bug fix 1: preserve original attachments on edit if no new files
  if (editMsgId && !files.length) {
    const origMsg = S.messages.find(m=>m.id===editMsgId);
    if (origMsg) {
      const origV = origMsg.variants[origMsg.activeVariant]||origMsg.variants[0];
      files.push(...(origV.attachments||[]));
    }
  }

  S.busy = true; setSendBusy(true);

  // Ensure active chat
  if (!S.activeChatId) {
    const chat = { id:uid(), title:text?trunc(text,42):(files[0]?.name||'Files'), msg_count:0, preview:'', created_at:now(), updated_at:now() };
    await DB.saveChat(chat); S.chats.unshift(chat); S.activeChatId=chat.id; S.messages=[];
  } else if (!S.messages.length&&text) {
    const chat = S.chats.find(c=>c.id===S.activeChatId);
    if(chat){chat.title=trunc(text,42);chat.updated_at=now();await DB.saveChat(chat);}
  }

  document.getElementById('welcome').style.display='none';
  document.getElementById('msg-list').style.display='flex';
  document.getElementById('btn-export').style.display='';
  document.getElementById('btn-del-chat').style.display='';

  const userPrompt = text||(files.length?`Analyze ${files.length} attached file(s).`:'');

  // Upload to R2 + wait for any in-progress extractions
  const resolvedAtts = [];
  for (const f of files) {
    let url=f.url, r2Key=f.r2Key;
    if (!url && S.cfg.r2?.ok && f.data) {
      const res = await uploadToR2(f);
      if (res) { url=res.url; r2Key=res.r2Key; }
    }
    // Await extraction if still running
    let text_content = f.text;
    if (f.extracting && f.extractPromise) {
      text_content = await f.extractPromise;
    }
    const att = { id:f.id, name:f.name, type:f.type, size:f.size, url:url||null, r2Key:r2Key||null, text:text_content||'', data:url?null:f.data };
    resolvedAtts.push(att);
    if (r2Key) {
      await DB.saveFile({ id:uid(), r2_key:r2Key, url, name:f.name, type:f.type, size:f.size, chat_id:S.activeChatId, extracted_text:text_content||'', created_at:now() });
      S.storedFiles.unshift({ r2_key:r2Key, url, name:f.name, type:f.type, size:f.size });
      document.getElementById('badge-files').textContent = S.storedFiles.length;
    }
  }

  // History builder (memory per chat, per user)
  function mkHistory(modelId) {
    const hist=[];
    const slice = editMsgId ? S.messages.slice(0, S.messages.findIndex(x=>x.id===editMsgId)) : S.messages.slice(0,-1);
    for (const m of slice) {
      const v=m.variants[m.activeVariant]||m.variants[0];
      if(v.userText) hist.push({role:'user',content:v.userText,attachments:v.attachments});
      // Prefer the best available output from the previous turn:
      // optimizedSynthesis (from evaluation) > synthesis > individual model response.
      // This ensures each round builds on the council's best collective output,
      // not just the first-pass response of one model.
      const assistantText = v.optimizedSynthesis || v.synthesis
        || (v.responses||[]).find(r=>r.modelId===modelId)?.text;
      if(assistantText) hist.push({role:'assistant',content:assistantText});
    }
    hist.push({role:'user',content:userPrompt});
    return hist;
  }

  // ── Desktop Agent route (#65) ────────────────────────────────
  // @desktop prefix or desktop mode toggle bypasses the model council
  // and sends the task directly to the local Python agent via Supabase Realtime.
  if (desktopTask && !editMsgId) {
    const msg = { id:uid(), activeVariant:0, variants:[{
      userText:text, attachments:resolvedAtts,
      responses:[], synthesis:undefined,
      agentTask: desktopTask,
    }] };
    S.messages.push(msg); patchMsg(msg); scrollBottom();
    await sendToDesktopAgent(desktopTask, msg);
    await DB.saveMsg(S.activeChatId, msg);
    const chat = S.chats.find(c=>c.id===S.activeChatId);
    if(chat){chat.updated_at=now();chat.msg_count=S.messages.length;chat.preview=trunc(userPrompt,80);await DB.saveChat(chat);S.chats=[chat,...S.chats.filter(c=>c.id!==chat.id)];}
    renderSidebar(); S.busy=false; setSendBusy(false);
    return;
  }

  if (editMsgId) {
    const msg = S.messages.find(m=>m.id===editMsgId);
    if (!msg){S.busy=false;setSendBusy(false);return;}
    msg.variants.push({ userText:text, attachments:resolvedAtts, responses:am.map(m=>({modelId:m.id,name:m.name,role:m.role,accent:m.accent,loading:true,text:null,error:null})), synthesis:undefined });
    msg.activeVariant = msg.variants.length-1;
    patchMsg(msg); scrollBottom();
    await runModels(msg, userPrompt, resolvedAtts, mkHistory);
    await DB.saveMsg(S.activeChatId, msg);
  } else {
    const msg = { id:uid(), activeVariant:0, variants:[{ userText:text, attachments:resolvedAtts, responses:am.map(m=>({modelId:m.id,name:m.name,role:m.role,accent:m.accent,loading:true,text:null,error:null})), synthesis:undefined }] };
    S.messages.push(msg); patchMsg(msg); scrollBottom();
    await runModels(msg, userPrompt, resolvedAtts, mkHistory);
    await DB.saveMsg(S.activeChatId, msg);
  }

  const chat = S.chats.find(c=>c.id===S.activeChatId);
  if(chat){chat.updated_at=now();chat.msg_count=S.messages.length;chat.preview=trunc(userPrompt,80);await DB.saveChat(chat);S.chats=[chat,...S.chats.filter(c=>c.id!==chat.id)];}
  renderSidebar(); S.busy=false; setSendBusy(false);
}

/**
 * Stream one model's response via SSE. Updates the response card in real-time.
 * Falls back to the non-streaming endpoint if SSE fails or is not supported.
 */

// ══════════════════════════════════════════════════════════════
//  EDIT / VARIANTS
// ══════════════════════════════════════════════════════════════
function showEdit(msgId) {
  const el=document.getElementById('edit-slot-'+msgId); if(!el)return;
  const msg=S.messages.find(m=>m.id===msgId);
  const v=msg?.variants[msg.activeVariant];
  el.innerHTML=`<div class="edit-box">
    <textarea class="edit-ta" id="eta-${msgId}" rows="3">${esc(v?.userText||'')}</textarea>
    <div class="edit-actions">
      <button class="btn-sm btn-ghost" onclick="App.cancelEdit('${msgId}')">${t('cancel')}</button>
      <button class="btn-sm btn-primary" onclick="App.submitEdit('${msgId}')"><i class="ti ti-send"></i> ${t('send_variant')}</button>
    </div></div>`;
  const ta=document.getElementById('eta-'+msgId);ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);
}
function cancelEdit(msgId){const el=document.getElementById('edit-slot-'+msgId);if(el)el.innerHTML='';}
async function submitEdit(msgId){const ta=document.getElementById('eta-'+msgId);const tx=ta?.value?.trim();if(!tx)return;cancelEdit(msgId);await send(msgId,tx);}
function prevVar(msgId){const m=S.messages.find(x=>x.id===msgId);if(m&&m.activeVariant>0){m.activeVariant--;patchMsg(m);DB.saveMsg(S.activeChatId,m);}}
function nextVar(msgId){const m=S.messages.find(x=>x.id===msgId);if(m&&m.activeVariant<m.variants.length-1){m.activeVariant++;patchMsg(m);DB.saveMsg(S.activeChatId,m);}}

// ══════════════════════════════════════════════════════════════
//  CHAT MANAGEMENT
// ══════════════════════════════════════════════════════════════
async function newChat(){
  S.activeChatId=null;S.messages=[];
  document.getElementById('welcome').style.display='flex';
  document.getElementById('msg-list').style.display='none';
  document.getElementById('btn-export').style.display='none';
  document.getElementById('btn-del-chat').style.display='none';
  renderSidebar();document.getElementById('prompt').focus();
  if(window.innerWidth<=768)closeSidebar();
}
async function openChat(id){
  if(S.activeChatId===id){closeSidebar();return;}
  S.activeChatId=id;LS.set('last_chat',id);
  S.messages=await DB.loadMessages(id);
  // Restore skill for this chat
  S.activeSkill = LS.get('active_skill_' + id, null);
  renderSkillBadge();
  renderSidebar();renderMessages();scrollBottom();
  document.getElementById('welcome').style.display='none';
  document.getElementById('msg-list').style.display='flex';
  document.getElementById('btn-export').style.display=S.messages.length?'':'none';
  document.getElementById('btn-del-chat').style.display='';
  if(window.innerWidth<=768)closeSidebar();
}
async function deleteChat(id,e){
  if(e)e.stopPropagation();
  if(!confirm(t('delete_chat_confirm')))return;
  await DB.deleteChat(id);S.chats=S.chats.filter(c=>c.id!==id);
  if(S.activeChatId===id)await newChat();
  renderSidebar();
}
async function deleteActiveChat(){if(S.activeChatId)await deleteChat(S.activeChatId,null);}

function exportChat(){
  if(!S.messages.length)return;
  const chat=S.chats.find(c=>c.id===S.activeChatId);
  let md=`# ${chat?.title||'Chat'}\n_AI Council — ${new Date().toLocaleString()}_\n\n---\n\n`;
  S.messages.forEach(msg=>{
    const v=msg.variants[msg.activeVariant];
    (v.attachments||[]).forEach(a=>{md+=`**[File: ${a.name}]**\n\n`;});
    if(v.userText)md+=`## You\n${v.userText}\n\n`;
    (v.responses||[]).forEach(r=>{if(r.text)md+=`## ${r.name} — ${r.role}\n${r.text}\n\n`;});
    if(v.synthesis)md+=`## Synthesis\n${v.synthesis}\n\n---\n\n`;
  });
  dl(md,`chat_${Date.now()}.md`,'text/markdown');
}

// ══════════════════════════════════════════════════════════════
//  FILE HANDLING (multi-file, background extraction)
// ══════════════════════════════════════════════════════════════
function onFiles(e){
  const files=Array.from(e.target.files);if(!files.length)return;
  const maxMB=S.cfg.maxFileSizeMB||4;
  files.forEach(file=>{
    if(file.size>maxMB*1024*1024){alert(`${file.name} exceeds ${maxMB}MB.`);return;}
    const fid=uid();
    const reader=new FileReader();
    reader.onload=ev=>{
      const f={id:fid,name:file.name,type:file.type,size:file.size,
        data:ev.target.result.split(',')[1],
        preview:file.type.startsWith('image/')?ev.target.result:null,
        extracting:true,text:null,extractPromise:null,url:null,r2Key:null};
      // If R2 configured: upload first, then extract. Otherwise extract from base64.
      if(S.cfg.r2?.ok){
        uploadToR2(f).then(res=>{
          if(res){f.url=res.url;f.r2Key=res.r2Key;f.data=null;}
          f.extractPromise=startExtraction(f);
          renderFileChips();
        });
      } else {
        f.extractPromise=startExtraction(f);
      }
      S.pendingFiles.push(f);
      renderFileChips();
    };
    reader.readAsDataURL(file);
  });
  e.target.value='';
}

function removeFile(id){S.pendingFiles=S.pendingFiles.filter(f=>f.id!==id);renderFileChips();}

function renderFileChips(){
  const el=document.getElementById('file-chips');
  if(!S.pendingFiles.length){el.style.display='none';el.innerHTML='';return;}
  el.style.display='flex';
  el.innerHTML=S.pendingFiles.map(f=>{
    let badge='';
    if(f.extracting){
      badge=`<span class="extract-badge processing"><i class="ti ti-loader spin"></i>${t('extracting')}</span>`;
    } else if(f.extractError){
      badge=`<span class="extract-badge error"><i class="ti ti-alert-circle"></i>${t('error')}</span>`;
    } else if(f.text!==null){
      badge=`<span class="extract-badge done"><i class="ti ti-check"></i>${t('ready')}</span>`;
    }
    return `<div class="file-chip ${f.extracting?'extracting':f.text!==null?'ready':''}" id="chip-${f.id}">
      <i class="ti ${fileIcon(f.type,f.name)}"></i>
      <span>${esc(f.name)}</span>
      <span style="color:var(--tx3);font-size:10px">(${(f.size/1024).toFixed(0)}KB)</span>
      ${badge}
      <button class="file-chip-remove" onclick="App.removeFile('${f.id}')"><i class="ti ti-x"></i></button>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
//  AUTH ACTIONS
// ══════════════════════════════════════════════════════════════
async function login(){
  const user=document.getElementById('login-user').value.trim();
  const pass=document.getElementById('login-pass').value;
  const errEl=document.getElementById('login-error');
  const btn=document.getElementById('login-btn');
  const btnTxt=document.getElementById('login-btn-text');

  errEl.style.display='none';
  if(!user||!pass){errEl.textContent=t('missing_fields');errEl.style.display='block';return;}

  btn.disabled=true;btnTxt.textContent=t('signing_in');

  try{
    const res=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user,password:pass})});
    const data=await res.json();
    if(!data.ok){
      errEl.textContent=t(data.error==='invalid_credentials'?'invalid_creds':'missing_fields');
      errEl.style.display='block';btn.disabled=false;btnTxt.textContent=t('sign_in');return;
    }
    AUTH.save({userId:data.userId,userName:data.userName,token:data.token});
    await initApp();
  }catch(e){
    errEl.textContent='Network error: '+e.message;errEl.style.display='block';
    btn.disabled=false;btnTxt.textContent=t('sign_in');
  }
}

function loginKey(e){if(e.key==='Enter')login();}

async function logout(){
  if(!confirm(`Logout ${AUTH.userName}?`))return;
  AUTH.clear();S.chats=[];S.messages=[];S.activeChatId=null;S.models=[];S.pendingFiles=[];
  document.getElementById('layout').style.display='none';
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('login-user').value='';
  document.getElementById('login-pass').value='';
  document.getElementById('login-btn').disabled=false;
  document.getElementById('login-btn-text').textContent=t('sign_in');
  document.getElementById('login-error').style.display='none';
}

// ══════════════════════════════════════════════════════════════
//  INPUT HELPERS
// ══════════════════════════════════════════════════════════════
// ── SLASH AUTOCOMPLETE ────────────────────────────────────────────────
let slashSelected = -1;

function onPromptInput(el) {
  grow(el);
  const val = el.value;
  if (val.startsWith('/') && !val.includes(' ')) {
    showSlashDropdown(val.slice(1).toLowerCase());
  } else {
    hideSlashDropdown();
  }
}

function showSlashDropdown(query) {
  const dd = document.getElementById('slash-dropdown');
  if (!dd) return;

  const builtinCmds = [
    { id:'help', icon:'ti-help', desc:'List all skills' },
    { id:'reset', icon:'ti-refresh', desc:'Deactivate current skill' },
    { id:'learn', icon:'ti-brain', desc:'/learn <topic> — auto-learn from GitHub' },
  ];
  const skillCmds = getAllSkills().map(s => ({ id: s.id, icon: s.icon||'ti-sparkles', desc: s.description||s.name }));
  const all = [...builtinCmds, ...skillCmds];
  const filtered = query ? all.filter(c => c.id.includes(query) || (c.desc||'').toLowerCase().includes(query)) : all;

  if (!filtered.length) { hideSlashDropdown(); return; }
  slashSelected = -1;
  dd.style.display = 'block';
  dd.innerHTML = filtered.map((c, i) =>
    `<div class="slash-item" id="slash-${i}" onclick="App.selectSlash('${c.id}')">
      <i class="ti ${c.icon}" style="color:var(--ac);font-size:14px;flex-shrink:0"></i>
      <code>/${c.id}</code>
      <span class="slash-item-desc">${esc(c.desc)}</span>
    </div>`
  ).join('');
}

function hideSlashDropdown() {
  const dd = document.getElementById('slash-dropdown');
  if (dd) dd.style.display = 'none';
  slashSelected = -1;
}

function selectSlash(id) {
  const input = document.getElementById('prompt');
  if (!input) return;
  // Dynamic skills need an arg — keep the slash command and add a space
  const skill = S.skills[id];
  if (skill?.dynamic || id === 'learn') {
    input.value = `/${id} `;
  } else {
    input.value = `/${id}`;
  }
  hideSlashDropdown();
  input.focus();
  // Place cursor at end
  input.setSelectionRange(input.value.length, input.value.length);
}

function grow(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,200)+'px';}

function onKey(e){
  const dd = document.getElementById('slash-dropdown');
  // Navigate slash dropdown with arrow keys
  if (dd && dd.style.display !== 'none') {
    const items = dd.querySelectorAll('.slash-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      slashSelected = Math.min(slashSelected + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('selected', i === slashSelected));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      slashSelected = Math.max(slashSelected - 1, -1);
      items.forEach((el, i) => el.classList.toggle('selected', i === slashSelected));
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && slashSelected >= 0)) {
      e.preventDefault();
      if (slashSelected >= 0 && items[slashSelected]) {
        const id = items[slashSelected].getAttribute('onclick').match(/'([^']+)'/)?.[1];
        if (id) selectSlash(id);
      }
      return;
    }
    if (e.key === 'Escape') { hideSlashDropdown(); return; }
  }
  if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}
}
function suggest(i){
  const S2=[
    'Create a complete PRD for a SaaS task management app with AI integration — include objectives, user stories, architecture and roadmap.',
    'Generate a bar chart showing monthly sales Q1-Q4 2024 and an Excel table with complete data.',
    'Create an 8-slide PowerPoint pitch deck for a B2B AI startup investor presentation.',
    'Draw a Mermaid diagram showing the complete microservices architecture for a large-scale e-commerce platform.',
  ];
  const el=document.getElementById('prompt');el.value=S2[i];grow(el);el.focus();
}
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('open');}
function closeSidebar(){document.getElementById('sidebar').classList.remove('open');}
function setSendBusy(b){const btn=document.getElementById('btn-send');btn.disabled=b;btn.innerHTML=b?'<i class="ti ti-loader spin"></i>':'<i class="ti ti-arrow-up"></i>';}
function search(q){document.querySelectorAll('.chat-item').forEach(el=>{const tx=el.querySelector('.chat-title')?.textContent?.toLowerCase()||'';el.style.display=tx.includes(q.toLowerCase())?'':'none';});}
function scrollBottom(){setTimeout(()=>{const el=document.getElementById('messages');if(el)el.scrollTop=el.scrollHeight;},60);}

// ══════════════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════════════
function uid(){return crypto.randomUUID?.()??Math.random().toString(36).slice(2)+Date.now().toString(36);}
function now(){return new Date().toISOString();}
function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function trunc(s,n){return s.length>n?s.slice(0,n)+'…':s;}
function fmtTime(iso){try{return new Date(iso).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}catch{return '';}}
function fmtDate(iso){try{return new Date(iso).toLocaleDateString([],{day:'numeric',month:'short'});}catch{return '';}}
function dl(content,name,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();}
function b64toBlob(b64,type){const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);return new Blob([arr],{type});}
function envKey(p){return{anthropic:'ANTHROPIC_API_KEY',openai:'OPENAI_API_KEY',google:'GEMINI_API_KEY',deepseek:'DEEPSEEK_API_KEY',xai:'XAI_API_KEY',groq:'GROQ_API_KEY',mistral:'MISTRAL_API_KEY',together:'TOGETHER_API_KEY',custom:'CUSTOM_API_KEY'}[p]||'API_KEY';}
function fileIcon(type,name){const ext=(name||'').split('.').pop().toLowerCase();if(type?.startsWith('image/'))return'ti-photo';if(type==='application/pdf')return'ti-file-type-pdf';if(['js','ts','py','java','cpp','go','rs'].includes(ext))return'ti-file-code';if(['csv','xlsx','xls'].includes(ext))return'ti-table';if(['doc','docx'].includes(ext))return'ti-file-word';if(['json','xml','yaml','yml'].includes(ext))return'ti-file-code-2';if(['txt','md'].includes(ext))return'ti-file-text';return'ti-file';}

// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
//  PUBLIC API
// ══════════════════════════════════════════════════════════════
const App = {
  send:()=>send(), newChat, openChat, deleteChat, deleteActiveChat, exportChat,
  openModels, openSettings, openFiles, openUsage, closeModals, closeOverlay,
  exportModels, importModels, onImport, onFiles, removeFile,
  suggest, toggleSidebar, grow, onKey, onPromptInput, search,
  retry, showEdit, cancelEdit, submitEdit, prevVar, nextVar,
  dlPptx, dlXlsx, dlDocx, dlHtml, dlCsv, dlMd, dlPdf, copy, deleteStoredFile,
  requestEval,
  login, loginKey, logout, setLang,
  _tog, _fld, _rm, _addC, _addCustom, _recheck, _connDB, _clearAll, _backup,
  // Skills
  activateSkillById, deactivateSkill, deleteCustomSkills, showSkillsHelp: showSkillsMenu,
  selectSlash,
  // Intelligence layer
  dismissNotifications, toggleDeepMode, toggleForceAll, toggleEnhancePrompts,
  toggleChainOfThought, toggleFactCheck, toggleWebSearch, toggleDesktopMode,
  // Desktop agent
  cancelDesktopTask, cancelHandoff: (msgId) => {
    const msg = S.messages.find(m => m.id === msgId);
    if (!msg) return;
    const v = msg.variants[msg.activeVariant];
    if (v.handoffRequestId) cancelDesktopTask(v.handoffRequestId);
  },
  handoffToDesktop,
  sendClarification, overrideRouting,
  // Skill suggestion
  acceptSkillSuggestion, dismissSkillSuggestion,
  // Prompt enhancement + card collapse + web sources
  toggleEnhancement, revertEnhancement, toggleCard, toggleWebSources,
};

// ══════════════════════════════════════════════════════════════
//  INIT APP (called after successful login)
// ══════════════════════════════════════════════════════════════
async function initApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('layout').style.display = 'flex';

  loadModels();

  // Fetch server config — gets provider availability, Supabase keys, R2 status
  try {
    const r = await fetch('/api/config');
    if (r.ok) {
      const d = await r.json();
      S.cfg = { ...S.cfg, ...d };
      // Auto-initialize Supabase from server-provided env vars (no manual setup required)
      if (d.supabase?.ok && !S.sbClient) {
        try { S.sbClient = supabase.createClient(d.supabase.url, d.supabase.anonKey); } catch {}
      }
    }
  } catch {}

  // Load all chats
  S.chats = await DB.listChats();

  // Restore last open chat or start at welcome screen
  const lastId = LS.get('last_chat');
  const found  = lastId && S.chats.find(c => c.id === lastId);
  if (found) {
    S.activeChatId = found.id;
    S.messages     = await DB.loadMessages(found.id);
    S.activeSkill  = LS.get('active_skill_' + found.id, null);
    renderSkillBadge();
    document.getElementById('welcome').style.display = 'none';
    document.getElementById('msg-list').style.display = 'flex';
    document.getElementById('btn-export').style.display = S.messages.length ? '' : 'none';
    document.getElementById('btn-del-chat').style.display = '';
  }

  // File badge
  try {
    S.storedFiles = await DB.listFiles();
    document.getElementById('badge-files').textContent = S.storedFiles.length;
  } catch {}

  // Skills — Supabase-synced custom skills + built-in server skills
  await loadSkills();

  // Notifications — unread role-reassignment alerts (#12)
  await loadNotifications();

  // Role overrides — auto-reassignments from check-model-performance (#57)
  await loadRoleOverrides();

  // Restore UI mode flags from localStorage
  S.cfg.forceAllModels  = LS.get('force_all_models', false);
  S.cfg.deepMode        = LS.get('deep_mode', false);
  S.cfg.enhancePrompts  = LS.get('enhance_prompts', true);       // default on
  S.cfg.chainOfThought  = LS.get('chain_of_thought', 'auto');    // default auto
  S.cfg.factCheck       = LS.get('fact_check', false);
  S.cfg.webSearch       = LS.get('web_search', true);            // default on
  S.cfg.desktopMode     = LS.get('desktop_mode', false);         // #65: desktop agent routing
  renderModeToggles();

  // Subscribe to desktop agent status broadcasts (#65)
  // Runs after Supabase is initialised so the channel exists.
  initDesktopChannel();

  renderStrip();
  renderSidebar();
  renderMessages();
  if (found) scrollBottom();
  applyI18n();

  const p = document.getElementById('prompt');
  if (p) p.focus();
}

// ── Role overrides (#57) ──────────────────────────────────────
// Reads auto-computed role assignments from Supabase preferences.
// Written weekly by check-model-performance.mjs when a model is
// detected to be consistently better at a different question type.
// Falls back to empty object (all models keep their default roles).
S.roleOverrides = {};  // { modelName: overrideRole }

async function loadRoleOverrides() {
  if (!S.sbClient) return;
  try {
    const { data } = await S.sbClient
      .from('preferences')
      .select('value')
      .eq('user_id', 'default')
      .eq('key', 'role_overrides')
      .single();
    if (data?.value && typeof data.value === 'object') {
      S.roleOverrides = data.value;
      const count = Object.keys(S.roleOverrides).length;
      if (count) console.log(`[loadRoleOverrides] ${count} role override(s) loaded`);
    }
  } catch { /* no overrides yet — use defaults */ }
}

// ── Notifications (#12) ───────────────────────────────────────
async function loadNotifications() {
  if (!S.sbClient) return;
  try {
    const { data } = await S.sbClient
      .from('notifications')
      .select('id, type, message, data, created_at')
      .eq('user_id', AUTH.userId)
      .eq('read', false)
      .order('created_at', { ascending: false })
      .limit(5);
    S.notifications = data || [];
    renderNotifications();
  } catch {}
}

function renderNotifications() {
  // Remove existing banner
  const existing = document.getElementById('notif-banner');
  if (existing) existing.remove();
  if (!S.notifications.length) return;

  const banner = document.createElement('div');
  banner.id = 'notif-banner';
  banner.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:200;background:rgba(234,179,8,.12);' +
    'border-bottom:1px solid rgba(234,179,8,.3);padding:8px 16px;display:flex;align-items:flex-start;gap:10px;';

  const first = S.notifications[0];
  const more  = S.notifications.length > 1 ? ` (+${S.notifications.length - 1} more)` : '';
  banner.innerHTML = `
    <i class="ti ti-bell-ringing" style="color:var(--yellow);font-size:15px;flex-shrink:0;margin-top:1px"></i>
    <div style="flex:1;font-size:12px;color:var(--tx2)">
      <strong style="color:var(--yellow)">Role Alert${more}:</strong> ${esc(first.message)}
    </div>
    <button onclick="App.dismissNotifications()" style="flex-shrink:0;padding:2px 10px;border-radius:20px;border:1px solid rgba(234,179,8,.4);background:none;color:var(--yellow);font-size:11px;cursor:pointer">
      Dismiss
    </button>`;

  document.body.prepend(banner);
}

async function dismissNotifications() {
  const ids = S.notifications.map(n => n.id);
  S.notifications = [];
  const existing = document.getElementById('notif-banner');
  if (existing) existing.remove();
  // Mark as read in Supabase (fire-and-forget)
  if (S.sbClient && ids.length) {
    S.sbClient.from('notifications').update({ read: true }).in('id', ids).catch(() => {});
  }
}

// ── Mode toggles: Deep Mode + Force All Models (#8, #10) ──────
function renderModeToggles() {
  let container = document.getElementById('mode-toggles');
  if (!container) {
    container = document.createElement('div');
    container.id = 'mode-toggles';
    container.style.cssText = 'display:flex;align-items:center;gap:6px;';
    // Insert before the send button
    const sendBtn = document.getElementById('btn-send');
    if (sendBtn?.parentElement) sendBtn.parentElement.insertBefore(container, sendBtn);
  }

  const deepActive    = S.cfg.deepMode;
  const forceActive   = S.cfg.forceAllModels;
  const enhActive     = S.cfg.enhancePrompts;
  const webActive     = S.cfg.webSearch;
  const cotMode       = S.cfg.chainOfThought; // 'auto' | true | false
  const cotLabel      = cotMode === true ? 'CoT ON' : cotMode === 'auto' ? 'CoT auto' : 'CoT';
  const cotColor      = cotMode !== false ? '#f97316' : 'var(--tx3)';
  const cotBd         = cotMode !== false ? '#f97316' : 'var(--bd)';
  const cotBg         = cotMode === true ? 'rgba(249,115,22,.1)' : cotMode === 'auto' ? 'rgba(249,115,22,.06)' : 'none';
  const factActive    = S.cfg.factCheck;
  const deskActive    = S.cfg.desktopMode;

  container.innerHTML = `
    <button id="toggle-web" onclick="App.toggleWebSearch()"
      title="${webActive ? 'Web search ON — Tavily fetches live data when needed' : 'Web search OFF — pure model knowledge'}"
      style="padding:4px 10px;border-radius:20px;border:1px solid ${webActive ? '#4285F4' : 'var(--bd)'};
             background:${webActive ? 'rgba(66,133,244,.1)' : 'none'};
             color:${webActive ? '#4285F4' : 'var(--tx3)'};font-size:11px;cursor:pointer;transition:all .15s;white-space:nowrap">
      <i class="ti ti-world"></i> ${webActive ? 'Web ✓' : 'Web'}
    </button>
    <button id="toggle-enhance" onclick="App.toggleEnhancePrompts()"
      title="${enhActive ? 'Prompt enhancement ON — Groq rewrites vague prompts' : 'Prompt enhancement OFF'}"
      style="padding:4px 10px;border-radius:20px;border:1px solid ${enhActive ? '#a78bfa' : 'var(--bd)'};
             background:${enhActive ? 'rgba(167,139,250,.1)' : 'none'};
             color:${enhActive ? '#a78bfa' : 'var(--tx3)'};font-size:11px;cursor:pointer;transition:all .15s;white-space:nowrap">
      <i class="ti ti-sparkles"></i> ${enhActive ? 'Enhance ✓' : 'Enhance'}
    </button>
    <button id="toggle-cot" onclick="App.toggleChainOfThought()"
      title="Chain-of-thought: ${cotMode === true ? 'always ON' : cotMode === 'auto' ? 'auto (math/analysis/code)' : 'OFF'} — click to cycle"
      style="padding:4px 10px;border-radius:20px;border:1px solid ${cotBd};
             background:${cotBg};
             color:${cotColor};font-size:11px;cursor:pointer;transition:all .15s;white-space:nowrap">
      <i class="ti ti-brain"></i> ${cotLabel}
    </button>
    <button id="toggle-fact" onclick="App.toggleFactCheck()"
      title="${factActive ? 'Fact-check ON — Claude verifies synthesis' : 'Fact-check OFF'}"
      style="padding:4px 10px;border-radius:20px;border:1px solid ${factActive ? '#facc15' : 'var(--bd)'};
             background:${factActive ? 'rgba(250,204,21,.08)' : 'none'};
             color:${factActive ? '#facc15' : 'var(--tx3)'};font-size:11px;cursor:pointer;transition:all .15s;white-space:nowrap">
      <i class="ti ti-shield-check"></i> ${factActive ? 'Fact ✓' : 'Fact'}
    </button>
    <button id="toggle-deep" onclick="App.toggleDeepMode()"
      title="${deepActive ? 'Deep Mode ON — two-round debate' : 'Deep Mode OFF — enable two-round debate'}"
      style="padding:4px 10px;border-radius:20px;border:1px solid ${deepActive ? '#818cf8' : 'var(--bd)'};
             background:${deepActive ? 'rgba(99,102,241,.12)' : 'none'};
             color:${deepActive ? '#818cf8' : 'var(--tx3)'};font-size:11px;cursor:pointer;transition:all .15s;white-space:nowrap">
      <i class="ti ti-arrows-exchange"></i> ${deepActive ? 'Deep ON' : 'Deep'}
    </button>
    <button id="toggle-force" onclick="App.toggleForceAll()"
      title="${forceActive ? 'All models forced' : 'Smart routing active'}"
      style="padding:4px 10px;border-radius:20px;border:1px solid ${forceActive ? '#10A37F' : 'var(--bd)'};
             background:${forceActive ? 'rgba(16,163,127,.1)' : 'none'};
             color:${forceActive ? '#10A37F' : 'var(--tx3)'};font-size:11px;cursor:pointer;transition:all .15s;white-space:nowrap">
      <i class="ti ti-layout-grid"></i> ${forceActive ? 'All ✓' : 'All'}
    </button>
    <button id="toggle-desktop" onclick="App.toggleDesktopMode()"
      title="${deskActive ? 'Desktop Mode ON — messages go to your local Python agent (@desktop prefix also works)' : 'Desktop Mode OFF — enable to route messages to your local agent'}"
      style="padding:4px 10px;border-radius:20px;border:1px solid ${deskActive ? '#fb923c' : 'var(--bd)'};
             background:${deskActive ? 'rgba(251,146,60,.12)' : 'none'};
             color:${deskActive ? '#fb923c' : 'var(--tx3)'};font-size:11px;cursor:pointer;transition:all .15s;white-space:nowrap">
      <i class="ti ti-device-desktop"></i> ${deskActive ? 'Agent ✓' : 'Agent'}
    </button>`;
}

function toggleEnhancePrompts() {
  S.cfg.enhancePrompts = !S.cfg.enhancePrompts;
  LS.set('enhance_prompts', S.cfg.enhancePrompts);
  renderModeToggles();
  showToast(S.cfg.enhancePrompts ? '✨ Prompt enhancement ON' : '✨ Prompt enhancement OFF');
}

function toggleDeepMode() {
  S.cfg.deepMode = !S.cfg.deepMode;
  LS.set('deep_mode', S.cfg.deepMode);
  renderModeToggles();
  showToast(S.cfg.deepMode ? '🔄 Deep Mode ON — two-round debate enabled' : '🔄 Deep Mode OFF');
}

function toggleForceAll() {
  S.cfg.forceAllModels = !S.cfg.forceAllModels;
  LS.set('force_all_models', S.cfg.forceAllModels);
  renderModeToggles();
  showToast(S.cfg.forceAllModels ? '🔀 All models forced — routing bypassed' : '⚡ Smart routing active');
}

function toggleWebSearch() {
  S.cfg.webSearch = !S.cfg.webSearch;
  LS.set('web_search', S.cfg.webSearch);
  renderModeToggles();
  showToast(S.cfg.webSearch ? '🌐 Web search ON — live data enabled' : '🌐 Web search OFF — using model knowledge only');
}

function toggleChainOfThought() {
  // Cycle: false → 'auto' → true → false
  const cur = S.cfg.chainOfThought;
  S.cfg.chainOfThought = cur === false ? 'auto' : cur === 'auto' ? true : false;
  LS.set('chain_of_thought', S.cfg.chainOfThought);
  renderModeToggles();
  const label = S.cfg.chainOfThought === true ? 'always ON'
              : S.cfg.chainOfThought === 'auto' ? 'auto (math/analysis/code)'
              : 'OFF';
  showToast(`🧠 Chain-of-thought: ${label}`);
}

function toggleFactCheck() {
  S.cfg.factCheck = !S.cfg.factCheck;
  LS.set('fact_check', S.cfg.factCheck);
  renderModeToggles();
  showToast(S.cfg.factCheck ? '🔍 Fact-check ON — Claude will verify synthesis' : '🔍 Fact-check OFF');
}

// Cancel a running desktop agent task (#70)
function cancelDesktopTask(msgId) {
  const msg = S.messages.find(m => m.id === msgId);
  if (!msg) return;
  const v = msg.variants[msg.activeVariant];
  const requestId = v.agentRequestId || v.handoffRequestId;
  if (!requestId) return;
  cancelDesktopTask(requestId); // api.js
}

// Council → Desktop handoff (#71)
// Sends the current synthesis to the desktop agent as an execution task.
// Status flows back to v.handoffStatus (separate from v.agentStatus).
async function handoffToDesktop(msgId) {
  const msg = S.messages.find(m => m.id === msgId);
  if (!msg) return;
  const v = msg.variants[msg.activeVariant];
  if (!v.synthesis) return;

  const task = v.synthesis;
  const requestId = uid();
  v.handoffRequestId = requestId;
  v.handoffStatus    = { status: 'running', step: 'Sending plan to desktop agent…', requestId };

  // Register a one-shot callback so initDesktopChannel's listener can
  // route status updates back to this specific message variant.
  S.handoffCallbacks[requestId] = (payload) => {
    const m = S.messages.find(x => x.id === msgId);
    if (!m) return;
    const vv = m.variants[m.activeVariant];
    vv.handoffStatus = { ...payload, requestId };
    if (payload.status === 'done' || payload.status === 'error') {
      delete S.handoffCallbacks[requestId]; // clean up after final event
      DB.saveMsg(S.activeChatId, m);
    }
    patchMsg(m);
    scrollBottom();
  };

  patchMsg(msg);
  showToast('🖥️ Sending plan to desktop agent…');
  await sendToDesktopAgent(task, msg, requestId); // api.js — accepts explicit requestId
}

function toggleDesktopMode() {
  S.cfg.desktopMode = !S.cfg.desktopMode;
  LS.set('desktop_mode', S.cfg.desktopMode);
  renderModeToggles();
  if (S.cfg.desktopMode) {
    initDesktopChannel(); // subscribe on first enable
    showToast('🖥️ Desktop Mode ON — messages route to your local agent');
  } else {
    showToast('🖥️ Desktop Mode OFF — back to model council');
  }
}

// ── Clarification handler (#11) ───────────────────────────────
function sendClarification(msgId) {
  const inp = document.getElementById(`clarify-inp-${msgId}`);
  if (!inp || !inp.value.trim()) return;
  const clarification = inp.value.trim();
  // Re-send with clarified prompt appended to the original message
  const msg = S.messages.find(m => m.id === msgId);
  if (!msg) return;
  const v = msg.variants[msg.activeVariant];
  const original = v.userText || '';
  // Set the prompt input and trigger a new variant send
  const promptEl = document.getElementById('prompt');
  if (promptEl) {
    promptEl.value = `${original}\n\nClarification: ${clarification}`;
    App.showEdit(msgId);
  }
}

// ── Override routing: add back all models for this query (#8) ─
function overrideRouting(msgId) {
  // Temporarily force all models and retry this message
  const prev = S.cfg.forceAllModels;
  S.cfg.forceAllModels = true;
  retry(msgId).finally(() => { S.cfg.forceAllModels = prev; });
}

// ── Skill suggestion accept / dismiss (#47) ───────────────────
async function acceptSkillSuggestion(msgId) {
  const msg = S.messages.find(m => m.id === msgId);
  if (!msg) return;
  const v = msg.variants[msg.activeVariant];
  if (!v.skillSuggestion) return;
  await activateSkillById(v.skillSuggestion.id);
  v.skillSuggestion.dismissed = true;
  patchMsg(msg);
}

function dismissSkillSuggestion(msgId) {
  const msg = S.messages.find(m => m.id === msgId);
  if (!msg) return;
  const v = msg.variants[msg.activeVariant];
  if (v.skillSuggestion) { v.skillSuggestion.dismissed = true; patchMsg(msg); }
}

// ── Prompt enhancement UI handlers (#3) ──────────────────────
function toggleEnhancement(msgId) {
  const msg = S.messages.find(m => m.id === msgId);
  if (!msg) return;
  const v = msg.variants[msg.activeVariant];
  if (v.promptEnhancement) { v.promptEnhancement.expanded = !v.promptEnhancement.expanded; patchMsg(msg); }
}

function revertEnhancement(msgId) {
  const msg = S.messages.find(m => m.id === msgId);
  if (!msg) return;
  const v = msg.variants[msg.activeVariant];
  // Clear enhancement state and re-run on the original prompt
  v.promptEnhancement = null;
  v.skipEnhancement = true;   // tell runModels to skip enhancement this time
  retry(msgId);
}

// ── Web sources expand/collapse (#63) ────────────────────────
function toggleWebSources(msgId) {
  const msg = S.messages.find(m => m.id === msgId);
  if (!msg) return;
  const v = msg.variants[msg.activeVariant];
  if (v.webSearch) { v.webSearch.expanded = !v.webSearch.expanded; patchMsg(msg); }
}

// ── Model card collapse (#2) ──────────────────────────────────
function toggleCard(msgId, modelId) {
  const msg = S.messages.find(m => m.id === msgId);
  if (!msg) return;
  const v = msg.variants[msg.activeVariant];
  const r = (v.responses || []).find(r => r.modelId === modelId);
  if (r) { r.collapsed = !r.collapsed; patchMsg(msg); }
}

// ── Silent token refresh ──────────────────────────────────────
// Tokens expire after 30 days. If the stored token is older than
// 25 days (within 5 days of expiry), silently renew it on boot.
async function maybeRefreshToken() {
  if (!AUTH.token) return;
  try {
    const decoded = atob(AUTH.token);
    const parts   = decoded.split(':');
    if (parts.length !== 3) return;
    const ts  = parseInt(parts[1], 10);
    const age = Date.now() - ts;
    const REFRESH_AFTER_MS = 25 * 24 * 60 * 60 * 1000; // 25 days
    if (age < REFRESH_AFTER_MS) return; // still fresh
    const res = await fetch('/api/refresh-token', { method: 'POST', headers: AUTH.headers() });
    if (res.ok) {
      const d = await res.json();
      if (d.token) AUTH.save({ ...AUTH.session, token: d.token });
    }
  } catch {}
}

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  LANG = localStorage.getItem('lang') || 'en';
  applyI18n();

  AUTH.load();
  if (AUTH.loggedIn) {
    await maybeRefreshToken();
    await initApp();
  }
  // Otherwise the login screen is visible by default (HTML default)
});