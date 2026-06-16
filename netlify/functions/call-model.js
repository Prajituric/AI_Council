/* ================================================================
   call-model.js  —  Council model caller (OpenRouter-only)

   Every model call in the app now goes through ONE provider —
   OpenRouter — authenticated with a single OPENROUTER_API_KEY.
   The `provider` field sent by the client is kept only as a label
   for usage logging / cache partitioning; `modelName` is expected
   to be an OpenRouter slug (e.g. "anthropic/claude-sonnet-4.6").
   ================================================================ */
const ORIGIN = process.env.URL || '*';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const { requireAuth } = require('./_auth-check');
const { callOpenRouter, imagePart, filePart } = require('./_openrouter');

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
    provider = 'openrouter',
    modelName,
    history   = [],      // [{role, content, attachments?}]
    // Current message attachments (multiple)
    attachments = [],    // [{url, name, type, text, data}]
    maxTokens = 2500,
    skillContext = null, // {name, prompt} — injected as system message
  } = body;

  const key = process.env.OPENROUTER_API_KEY || '';
  if (!key) return respond({ error: 'OPENROUTER_API_KEY lipsește pe server. Adaugă-l în Netlify → Site Settings → Environment Variables → Save → Redeploy.' });

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

    const result = await callModelViaOpenRouter(key, modelName, history, attachments, maxTokens, skillSystem);

    // Fire-and-forget: log usage + save to cache
    logUsage({ userId, provider, modelName, usage: result.usage }).catch(() => {});
    if (cacheKey) saveCachedResponse(cacheKey, { userId, provider, modelName, text: result.text }).catch(() => {});
    return respond({ text: result.text });
  } catch (e) {
    return respond({ error: e.message });
  }
};

// ── Helpers ────────────────────────────────────────────────────
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

// ── OpenRouter (unified for every vendor) ───────────────────────
async function callModelViaOpenRouter(key, model, history, currentAttachments, maxTokens, skillSystem = '') {
  const messages = [];

  // Build history with their attachments' extracted text
  for (const msg of history) {
    if (msg.role === 'user') {
      let content = msg.content || '';
      if (msg.attachments?.length) content += buildAttachmentContext(msg.attachments);
      messages.push({ role: 'user', content });
    } else {
      messages.push({ role: 'assistant', content: msg.content });
    }
  }

  const lastMsg = messages[messages.length - 1];
  const prompt  = (lastMsg?.role === 'user' ? lastMsg.content : '') || 'Analizează fișierele atașate.';
  if (lastMsg?.role === 'user') messages.pop();

  // Text-extractable attachments (anything that isn't an image or a PDF) get inlined as text
  const textAttachments = (currentAttachments || []).filter(a => !a.type?.startsWith('image/') && a.type !== 'application/pdf');
  let textContent = prompt;
  if (textAttachments.length) textContent += buildAttachmentContext(textAttachments);

  // Images and PDFs become native OpenAI-format content parts (vision / file-parser)
  const mediaParts = [];
  for (const att of (currentAttachments || [])) {
    if (att.type?.startsWith('image/')) {
      const part = imagePart(att);
      if (part) mediaParts.push(part);
    } else if (att.type === 'application/pdf') {
      let data = att.data;
      if (!data && att.url) data = await fetchBase64(att.url);
      const part = filePart({ ...att, data }, att.name);
      if (part) mediaParts.push(part);
    }
  }

  if (mediaParts.length) {
    messages.push({ role: 'user', content: [...mediaParts, { type: 'text', text: textContent }] });
  } else {
    messages.push({ role: 'user', content: textContent });
  }

  return callOpenRouter({ apiKey: key, model, messages, system: skillSystem || undefined, maxTokens });
}
