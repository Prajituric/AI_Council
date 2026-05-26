/* ================================================================
   call-model.js  —  AI provider router
   Supports: multiple attachments, R2 URLs, extracted text context
   ALL keys from server env only — never from client
   ================================================================ */
const ORIGIN = process.env.URL || '*';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const { requireAuth } = require('./_auth-check');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')   return err(405, 'Method not allowed');

  const userId = requireAuth(event);
  if (!userId) return err(401, 'Unauthorized');

  // Rate limiting — 100 requests per user per hour
  const rateLimited = await checkRateLimit(userId);
  if (rateLimited) return err(429, 'Rate limit exceeded (100 req/hour). Try again later.');

  let body;
  try { body = JSON.parse(event.body); } catch { return err(400, 'Invalid JSON'); }

  const {
    provider,
    modelName,
    baseUrl   = '',
    history   = [],      // [{role, content, attachments?}]
    // Current message attachments (multiple)
    attachments = [],    // [{url, name, type, text, data}]
    maxTokens = 2500,
    skillContext = null, // {name, prompt} — injected as system message
  } = body;

  const key = serverKey(provider);
  if (!key) return respond({ error: `API key pentru ${provider} nu este configurat. Adaugă ${envName(provider)} în Netlify → Site Settings → Environment Variables și re-deploy.` });

  // Build skill system prefix if active
  const skillSystem = skillContext?.prompt
    ? `ACTIVE SKILL — ${skillContext.name}:\n${skillContext.prompt}\n\n---\n`
    : '';

  // Build a cache key from the conversation context (skip caching if attachments present)
  const lastUserMsg = [...history].reverse().find(m => m.role === 'user')?.content || '';
  const cacheKey = attachments?.length
    ? null
    : makeCacheKey(userId, provider, modelName, lastUserMsg, skillSystem);

  try {
    // Check cache first (only for text-only queries)
    if (cacheKey) {
      const cached = await getCachedResponse(cacheKey);
      if (cached) return respond({ text: cached, cached: true });
    }

    let result;
    switch (provider) {
      case 'anthropic': result = await callAnthropic(key, modelName, history, attachments, maxTokens, skillSystem); break;
      case 'openai':    result = await callOpenAI(key, 'https://api.openai.com', modelName, history, attachments, maxTokens, skillSystem); break;
      case 'google':    result = await callGemini(key, modelName, history, attachments, maxTokens, skillSystem); break;
      case 'deepseek':  result = await callOpenAI(key, 'https://api.deepseek.com', modelName, history, attachments, maxTokens, skillSystem); break;
      case 'xai':       result = await callOpenAI(key, 'https://api.x.ai', modelName, history, attachments, maxTokens, skillSystem); break;
      case 'groq':      result = await callOpenAI(key, 'https://api.groq.com/openai', modelName, history, attachments, maxTokens, skillSystem); break;
      case 'mistral':   result = await callOpenAI(key, 'https://api.mistral.ai', modelName, history, attachments, maxTokens, skillSystem); break;
      case 'together':  result = await callOpenAI(key, 'https://api.together.xyz', modelName, history, attachments, maxTokens, skillSystem); break;
      case 'custom':    result = await callOpenAI(key, baseUrl, modelName, history, attachments, maxTokens, skillSystem); break;
      default: return respond({ error: `Provider necunoscut: ${provider}` });
    }
    // Fire-and-forget: log usage + save to cache
    logUsage({ userId, provider, modelName, usage: result.usage }).catch(() => {});
    if (cacheKey) saveCachedResponse(cacheKey, { userId, provider, modelName, text: result.text }).catch(() => {});
    return respond({ text: result.text });
  } catch (e) {
    return respond({ error: e.message });
  }
};

// ── Helpers ────────────────────────────────────────────────────
function serverKey(p) {
  return ({
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai:    process.env.OPENAI_API_KEY,
    google:    process.env.GEMINI_API_KEY,
    deepseek:  process.env.DEEPSEEK_API_KEY,
    xai:       process.env.XAI_API_KEY,
    groq:      process.env.GROQ_API_KEY,
    mistral:   process.env.MISTRAL_API_KEY,
    together:  process.env.TOGETHER_API_KEY,
    custom:    process.env.CUSTOM_API_KEY || 'placeholder',
  })[p] || '';
}

function envName(p) {
  return ({ anthropic:'ANTHROPIC_API_KEY', openai:'OPENAI_API_KEY', google:'GEMINI_API_KEY',
    deepseek:'DEEPSEEK_API_KEY', xai:'XAI_API_KEY', groq:'GROQ_API_KEY',
    mistral:'MISTRAL_API_KEY', together:'TOGETHER_API_KEY' })[p] || 'API_KEY';
}

function respond(b) { return { statusCode: 200, headers: CORS, body: JSON.stringify(b) }; }
function err(c, m)  { return { statusCode: c, headers: CORS, body: JSON.stringify({ error: m }) }; }

// ── Rate limiting (100 req/hour per user via Supabase) ────────
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function checkRateLimit(userId) {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey) return false; // no Supabase → skip rate limiting

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  try {
    // Count requests in the last hour
    const countRes = await fetch(
      `${sbUrl}/rest/v1/rate_limits?select=id&user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(windowStart)}`,
      { headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` } }
    );
    const rows = await countRes.json();
    if (Array.isArray(rows) && rows.length >= RATE_LIMIT_MAX) return true; // limit hit

    // Insert a new row for this request (fire-and-forget)
    fetch(`${sbUrl}/rest/v1/rate_limits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ user_id: userId }),
    }).catch(() => {});

    // Clean up old rows (fire-and-forget, best effort)
    fetch(`${sbUrl}/rest/v1/rate_limits?user_id=eq.${encodeURIComponent(userId)}&created_at=lt.${encodeURIComponent(windowStart)}`, {
      method: 'DELETE',
      headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` },
    }).catch(() => {});

    return false;
  } catch { return false; } // on error, allow request
}

// ── Token usage logging ────────────────────────────────────────
async function logUsage({ userId, provider, modelName, usage }) {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey || !usage) return;
  await fetch(`${sbUrl}/rest/v1/usage_log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': sbKey,
      'Authorization': `Bearer ${sbKey}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      user_id:       userId,
      provider,
      model_name:    modelName,
      input_tokens:  usage.input_tokens  || 0,
      output_tokens: usage.output_tokens || 0,
      total_tokens:  (usage.input_tokens || 0) + (usage.output_tokens || 0),
    }),
  });
}

// ── Response caching ──────────────────────────────────────────
const { createHash } = require('crypto');

function makeCacheKey(userId, provider, modelName, question, skillSystem) {
  return createHash('sha256')
    .update(`${userId}:${provider}:${modelName}:${skillSystem}:${question}`)
    .digest('hex');
}

async function getCachedResponse(cacheKey) {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey) return null;
  const ttlDays = parseFloat(process.env.CACHE_TTL_DAYS || '7');
  const sevenDaysAgo = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const res = await fetch(
      `${sbUrl}/rest/v1/response_cache?cache_key=eq.${cacheKey}&created_at=gte.${encodeURIComponent(sevenDaysAgo)}&select=response_text,hit_count`,
      { headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` } }
    );
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows[0]) return null;
    // Bump hit count asynchronously
    fetch(`${sbUrl}/rest/v1/response_cache?cache_key=eq.${cacheKey}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ hit_count: rows[0].hit_count + 1, last_hit_at: new Date().toISOString() }),
    }).catch(() => {});
    return rows[0].response_text;
  } catch { return null; }
}

async function saveCachedResponse(cacheKey, { userId, provider, modelName, text }) {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey) return;
  await fetch(`${sbUrl}/rest/v1/response_cache`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`,
      'Prefer': 'return=minimal,resolution=ignore-duplicates',
    },
    body: JSON.stringify({ cache_key: cacheKey, user_id: userId, provider, model_name: modelName, response_text: text }),
  });
}

// Fetch file as base64 from URL
async function fetchBase64(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString('base64');
}

// Build text summary of all attachments (for models without native file support)
function buildAttachmentContext(attachments) {
  if (!attachments?.length) return '';
  const parts = attachments
    .filter(a => a.text && a.text !== `[Imagine: ${a.name}]`)
    .map(a => `\n\n--- Fișier atașat: ${a.name} ---\n${a.text}`);
  return parts.join('');
}

// ── Anthropic ──────────────────────────────────────────────────
async function callAnthropic(key, model, history, currentAttachments, maxTokens, skillSystem = '') {
  const messages = [];

  // Build history with their attachments' extracted text
  for (const msg of history) {
    if (msg.role === 'user') {
      let userContent = msg.content || '';
      if (msg.attachments?.length) userContent += buildAttachmentContext(msg.attachments);
      messages.push({ role: 'user', content: userContent });
    } else {
      messages.push({ role: 'assistant', content: msg.content });
    }
  }

  const contentBlocks = [];
  for (const att of (currentAttachments || [])) {
    if (att.type === 'application/pdf') {
      let b64 = att.data; if (!b64 && att.url) b64 = await fetchBase64(att.url);
      if (b64) contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } });
    } else if (att.type?.startsWith('image/')) {
      let b64 = att.data; if (!b64 && att.url) b64 = await fetchBase64(att.url);
      if (b64) contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: att.type, data: b64 } });
    } else if (att.text) {
      contentBlocks.push({ type: 'text', text: `--- ${att.name} ---\n${att.text}` });
    }
  }

  const lastMsg = messages[messages.length - 1];
  const promptText = (lastMsg?.role === 'user' ? lastMsg.content : '') || 'Analizează fișierele atașate.';
  if (lastMsg?.role === 'user') messages.pop();
  contentBlocks.push({ type: 'text', text: promptText });
  messages.push({ role: 'user', content: contentBlocks });

  const reqBody = { model, max_tokens: maxTokens, messages };
  if (skillSystem) reqBody.system = skillSystem;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(reqBody),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Anthropic HTTP ${res.status}`);
  return {
    text: data.content.map(c => c.text || '').join(''),
    usage: { input_tokens: data.usage?.input_tokens || 0, output_tokens: data.usage?.output_tokens || 0 },
  };
}

// ── OpenAI-compatible ──────────────────────────────────────────
async function callOpenAI(key, baseUrl, model, history, currentAttachments, maxTokens, skillSystem = '') {
  const messages = [];

  // Inject skill as system message
  if (skillSystem) messages.push({ role: 'system', content: skillSystem });

  for (const msg of history) {
    if (msg.role === 'user') {
      let content = msg.content || '';
      if (msg.attachments?.length) content += buildAttachmentContext(msg.attachments);
      messages.push({ role: 'user', content });
    } else {
      messages.push({ role: 'assistant', content: msg.content });
    }
  }

  const hasImages = currentAttachments?.some(a => a.type?.startsWith('image/'));
  const lastMsg   = messages[messages.length - 1];
  const prompt    = (lastMsg?.role === 'user' ? lastMsg.content : '') || 'Analizează fișierele atașate.';
  if (lastMsg?.role === 'user') messages.pop();

  let textContent = prompt;
  if (currentAttachments?.length) textContent += buildAttachmentContext(currentAttachments.filter(a => !a.type?.startsWith('image/')));

  if (hasImages) {
    const parts = [];
    for (const att of currentAttachments || []) {
      if (!att.type?.startsWith('image/')) continue;
      if (att.url) parts.push({ type: 'image_url', image_url: { url: att.url } });
      else if (att.data) parts.push({ type: 'image_url', image_url: { url: `data:${att.type};base64,${att.data}` } });
    }
    parts.push({ type: 'text', text: textContent });
    messages.push({ role: 'user', content: parts });
  } else {
    messages.push({ role: 'user', content: textContent });
  }

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return {
    text: data.choices[0].message.content,
    usage: { input_tokens: data.usage?.prompt_tokens || 0, output_tokens: data.usage?.completion_tokens || 0 },
  };
}

// ── Google Gemini ──────────────────────────────────────────────
async function callGemini(key, model, history, currentAttachments, maxTokens, skillSystem = '') {
  const contents = [];

  for (const msg of history) {
    const role = msg.role === 'user' ? 'user' : 'model';
    let text = msg.content || '';
    if (msg.attachments?.length) text += buildAttachmentContext(msg.attachments);
    contents.push({ role, parts: [{ text }] });
  }

  const lastMsg  = contents[contents.length - 1];
  const prompt   = (lastMsg?.role === 'user' ? lastMsg.parts[0]?.text : '') || 'Analizează fișierele.';
  if (lastMsg?.role === 'user') contents.pop();

  const parts = [];
  for (const att of (currentAttachments || [])) {
    if (att.type?.startsWith('image/') || att.type === 'application/pdf') {
      let b64 = att.data;
      if (!b64 && att.url) b64 = await fetchBase64(att.url);
      if (b64) parts.push({ inline_data: { mime_type: att.type, data: b64 } });
    } else if (att.text) {
      parts.push({ text: `--- ${att.name} ---\n${att.text}` });
    }
  }

  let fullPrompt = prompt;
  const nonVisualText = buildAttachmentContext((currentAttachments || []).filter(a => !a.type?.startsWith('image/') && a.type !== 'application/pdf'));
  if (nonVisualText) fullPrompt += nonVisualText;
  parts.push({ text: fullPrompt });
  contents.push({ role: 'user', parts });

  const gemReq = { contents, generationConfig: { maxOutputTokens: maxTokens } };
  if (skillSystem) gemReq.systemInstruction = { parts: [{ text: skillSystem }] };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gemReq) }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Gemini HTTP ${res.status}`);
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    usage: {
      input_tokens:  data.usageMetadata?.promptTokenCount     || 0,
      output_tokens: data.usageMetadata?.candidatesTokenCount || 0,
    },
  };
}
