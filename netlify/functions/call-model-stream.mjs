/* ================================================================
   call-model-stream.mjs  —  Streaming AI responses via SSE
   Netlify Functions v2  (must be .mjs + default export)
   Supports: anthropic, openai-compatible providers, Google Gemini
   Handles attachments (text context + images/PDFs in content blocks)
   Rate-limited: 100 req/hour per user via Supabase rate_limits table
   Injects role mandates + structured response format per model (#4 + #5)
   Supports two-round debate via round2Context field (#10)

   POST /api/call-model-stream
   Body: { provider, modelName, role, history, attachments, maxTokens,
           skillContext, round2Context? }
   Response: text/event-stream
     data: {"delta":"..."}        — text chunk
     data: {"done":true}          — stream complete
     data: {"error":"..."}        — error
   ================================================================ */
import crypto from 'crypto';

const ORIGIN = process.env.URL || '*';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Inline auth check (ESM can't require() CJS _auth-check.js) ─
const JWT_SECRET = process.env.JWT_SECRET || '';
function verifyToken(token) {
  if (!JWT_SECRET || !token) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return null;
    const [userId, ts, sig] = parts;
    if (Date.now() - parseInt(ts, 10) > 30 * 24 * 60 * 60 * 1000) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${userId}:${ts}`).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
    return userId;
  } catch { return null; }
}

// ── Rate limiting (mirrors call-model.js) ─────────────────────
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

async function checkRateLimit(userId) {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey) return false;
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  try {
    const countRes = await fetch(
      `${sbUrl}/rest/v1/rate_limits?select=id&user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(windowStart)}`,
      { headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` } }
    );
    const rows = await countRes.json();
    if (Array.isArray(rows) && rows.length >= RATE_LIMIT_MAX) return true;
    fetch(`${sbUrl}/rest/v1/rate_limits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ user_id: userId }),
    }).catch(() => {});
    fetch(`${sbUrl}/rest/v1/rate_limits?user_id=eq.${encodeURIComponent(userId)}&created_at=lt.${encodeURIComponent(windowStart)}`, {
      method: 'DELETE',
      headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` },
    }).catch(() => {});
    return false;
  } catch { return false; }
}

// ── Role mandates — each model's analytical identity ─────────
// These turn 7 identical queries into 7 genuinely different perspectives.
const ROLE_MANDATES = {
  'Analyst & Moderator':
    `You are the Analyst & Moderator in an AI Council — balanced, evidence-driven, systematic. ` +
    `Your mandate: provide the most defensible analysis, weigh trade-offs explicitly, flag where evidence is weak or missing. ` +
    `You represent the consensus view, well-reasoned and comprehensive.`,

  'Product Strategist':
    `You are the Product Strategist in an AI Council — market-focused, user-centric, ROI-aware. ` +
    `Your mandate: evaluate everything through product-market fit, adoption friction, competitive positioning, and what the market actually rewards. ` +
    `Think like a founder who has shipped and failed before.`,

  'Fast Assistant':
    `You are the Fast Assistant in an AI Council — valued for speed and directness over depth. ` +
    `Your mandate: give the most direct, actionable answer possible with zero hedging. ` +
    `If you're uncertain, acknowledge it in one sentence and move on. No caveats, no "it depends."`,

  'Research Analyst':
    `You are the Research Analyst in an AI Council — systematic, evidence-conscious, and citation-aware. ` +
    `Your mandate: surface what research and data actually shows. Distinguish established consensus from fringe positions. ` +
    `Flag where evidence is absent, contradictory, or cherry-picked.`,

  'Technical Architect':
    `You are the Technical Architect in an AI Council — a systems thinker who cares about implementation, scalability, and production reality. ` +
    `Your mandate: evaluate technical feasibility, flag architectural risks, identify what breaks at scale, and propose concrete implementation paths. ` +
    `You have shipped systems that failed — you know what "works in theory" actually means.`,

  'Contrarian & Critic':
    `You are the Contrarian & Critic in an AI Council. ` +
    `Your mandate: challenge every assumption, argue the opposite position, find what everyone else is missing, and steelman the alternative view. ` +
    `Answer from this critical lens only — no balance, no both-sidesing. Your job is to find the holes.`,

  'Fast Reasoning':
    `You are the Fast Reasoning specialist in an AI Council — built for logical chain-of-thought and rapid inference. ` +
    `Your mandate: show your reasoning step by step, explicitly flag logical gaps in the question itself, and prioritize internal consistency over comprehensiveness. ` +
    `If the question has a hidden assumption, surface it.`,

  'Generalist':
    `You are the Generalist in an AI Council — broad-domain, adaptable, and cross-disciplinary. ` +
    `Your mandate: bring in analogies from unrelated fields, identify non-obvious connections, and provide the perspective that specialists tunnel-vision past. ` +
    `Think laterally, not vertically.`,
};

// Structured response format all models must follow (#5)
const STRUCTURED_FORMAT = `

Respond in EXACTLY this structure — no additional sections, no preamble:

DIRECT ANSWER: [one focused paragraph, no hedging]
CONFIDENCE: [1–10] — [one sentence explaining your certainty level]
KEY ASSUMPTION: [the single biggest thing you're taking for granted]
UNIQUE INSIGHT: [what other models will miss given your specific role/lens]
BIGGEST RISK: [what would make this answer wrong or incomplete]`;

// Chain-of-thought extension (#3): prepends a REASONING section before the structured output.
// Activated when chainOfThought:true in the request payload — auto-enabled by client
// for math/analysis/code question types.
const COT_FORMAT = `

Before your structured response, include:

REASONING: [Think step by step. Walk through your assumptions explicitly, show intermediate steps, and explain how you arrive at your conclusion. This is your scratchpad — be thorough. Then give your structured response below.]
`;

function buildSystemPrompt(role, skillSystem, round2Context, chainOfThought) {
  const mandate = ROLE_MANDATES[role];
  const parts = [];

  if (mandate) {
    const fmt = chainOfThought ? COT_FORMAT + STRUCTURED_FORMAT : STRUCTURED_FORMAT;
    parts.push(mandate + fmt);
  }
  if (skillSystem) {
    parts.push(skillSystem);
  }
  if (round2Context) {
    parts.push(
      `## SECOND ROUND — DEBATE REVISION\n` +
      `You have seen the other council members' first-round responses below.\n` +
      `${round2Context}\n\n` +
      `Now revise your answer. What did they get right? What did they miss given your role?\n` +
      `Pay special attention to revising your UNIQUE INSIGHT and BIGGEST RISK based on what others said.\n` +
      `Use the same ${chainOfThought ? 'REASONING / ' : ''}DIRECT ANSWER / CONFIDENCE / KEY ASSUMPTION / UNIQUE INSIGHT / BIGGEST RISK structure.`
    );
  }

  return parts.join('\n\n---\n\n') || '';
}

const TIMEOUT_MS    = 30_000; // abort model call if no completion within 30s
const RETRY_DELAY   =  2_000; // wait before the single automatic retry

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
    custom:    process.env.CUSTOM_API_KEY || '',
  })[p] || '';
}

function baseUrl(p, custom = '') {
  return ({
    openai:   'https://api.openai.com',
    deepseek: 'https://api.deepseek.com',
    xai:      'https://api.x.ai',
    groq:     'https://api.groq.com/openai',
    mistral:  'https://api.mistral.ai',
    together: 'https://api.together.xyz',
    custom:   custom,
  })[p] || '';
}

// ── Attachment helpers ────────────────────────────────────────
function buildAttachmentContext(attachments) {
  if (!attachments?.length) return '';
  return attachments
    .filter(a => a.text && !a.text.startsWith('[Image'))
    .map(a => `\n\n--- Attached file: ${a.name} ---\n${a.text}`)
    .join('');
}

async function fetchBase64(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString('base64');
}

// ── SSE helpers ───────────────────────────────────────────────
function sseChunk(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

// ── Main handler ──────────────────────────────────────────────
export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return new Response(sseChunk({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' },
    });
  }

  const token = req.headers.get('x-auth-token') || '';
  const userId = verifyToken(token);
  if (!userId) {
    return new Response(sseChunk({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' },
    });
  }

  const rateLimited = await checkRateLimit(userId);
  if (rateLimited) {
    return new Response(sseChunk({ error: 'Rate limit exceeded (100 req/hour). Try again later.' }), {
      status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' },
    });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response(sseChunk({ error: 'Invalid JSON' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' } }); }

  const {
    provider,
    modelName,
    baseUrl: customBase = '',
    role = '',                // council role → injected as system prompt
    history = [],
    attachments = [],
    maxTokens = 2500,
    skillContext = null,
    round2Context = null,     // set during deep mode second round (#10)
    chainOfThought = false,   // prepend REASONING section to structured output (#3)
  } = body;

  const key = serverKey(provider);
  if (!key) {
    return new Response(sseChunk({ error: `API key for ${provider} not configured.` }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' },
    });
  }

  const skillSystem = skillContext?.prompt ? `ACTIVE SKILL — ${skillContext.name}:\n${skillContext.prompt}\n\n---\n` : '';
  const systemPrompt = buildSystemPrompt(role, skillSystem, round2Context, chainOfThought);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let tokensSent = false;
      const send = (obj) => {
        if (obj.delta) tokensSent = true;
        controller.enqueue(enc.encode(sseChunk(obj)));
      };

      // ── Retry + timeout wrapper ───────────────────────────────
      // One automatic retry (2s backoff) for 429/5xx/timeouts, but
      // only if no tokens have been sent yet (partial streams can't retry).
      async function attempt() {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(new Error(`Model timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
        try {
          if (provider === 'anthropic') {
            await streamAnthropic(key, modelName, history, attachments, maxTokens, systemPrompt, send, ac.signal);
          } else if (provider === 'google') {
            await streamGemini(key, modelName, history, attachments, maxTokens, systemPrompt, send, ac.signal);
          } else {
            await streamOpenAI(key, baseUrl(provider, customBase), modelName, history, attachments, maxTokens, systemPrompt, send, ac.signal);
          }
        } finally {
          clearTimeout(timer);
        }
      }

      try {
        try {
          await attempt();
        } catch (e) {
          // Retry once on transient errors — only if client hasn't received tokens yet
          const isTransient = e.name === 'AbortError' ||
            /429|500|502|503|504|timeout/i.test(e.message);
          if (isTransient && !tokensSent) {
            await new Promise(r => setTimeout(r, RETRY_DELAY));
            await attempt(); // throws → outer catch → sends error event
          } else {
            throw e;
          }
        }
        send({ done: true });
      } catch (e) {
        const msg = e.name === 'AbortError'
          ? `Model timed out after ${TIMEOUT_MS / 1000}s`
          : e.message;
        send({ error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
};

// ── Anthropic streaming (with attachment support) ─────────────
async function streamAnthropic(key, model, history, currentAttachments, maxTokens, systemPrompt, send, signal) {
  const messages = [];

  for (const msg of history) {
    if (msg.role === 'user') {
      let content = msg.content || '';
      if (msg.attachments?.length) content += buildAttachmentContext(msg.attachments);
      messages.push({ role: 'user', content });
    } else {
      messages.push({ role: 'assistant', content: msg.content || '' });
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
  const promptText = (lastMsg?.role === 'user' ? lastMsg.content : '') || 'Analyze the attached files.';
  if (lastMsg?.role === 'user') messages.pop();
  contentBlocks.push({ type: 'text', text: promptText });
  messages.push({ role: 'user', content: contentBlocks.length > 1 || contentBlocks[0]?.type !== 'text' ? contentBlocks : promptText });

  const reqBody = { model, max_tokens: maxTokens, stream: true, messages };
  if (systemPrompt) reqBody.system = systemPrompt;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(reqBody),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic HTTP ${res.status}`);
  }

  for await (const line of readLines(res.body)) {
    if (!line.startsWith('data: ')) continue;
    const raw = line.slice(6);
    if (raw === '[DONE]') break;
    try {
      const evt = JSON.parse(raw);
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        send({ delta: evt.delta.text });
      }
    } catch { /* skip malformed */ }
  }
}

// ── OpenAI-compatible streaming (with attachment support) ─────
async function streamOpenAI(key, base, model, history, currentAttachments, maxTokens, systemPrompt, send, signal) {
  const messages = systemPrompt ? [{ role: 'system', content: systemPrompt }] : [];

  for (const msg of history) {
    if (msg.role === 'user') {
      let content = msg.content || '';
      if (msg.attachments?.length) content += buildAttachmentContext(msg.attachments);
      messages.push({ role: 'user', content });
    } else {
      messages.push({ role: 'assistant', content: msg.content || '' });
    }
  }

  const hasImages = currentAttachments?.some(a => a.type?.startsWith('image/'));
  const lastMsg = messages[messages.length - 1];
  const prompt = (lastMsg?.role === 'user' ? lastMsg.content : '') || 'Analyze the attached files.';
  if (lastMsg?.role === 'user') messages.pop();

  let textContent = prompt;
  if (currentAttachments?.length) {
    textContent += buildAttachmentContext(currentAttachments.filter(a => !a.type?.startsWith('image/')));
  }

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

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, stream: true, messages }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }

  for await (const line of readLines(res.body)) {
    if (!line.startsWith('data: ')) continue;
    const raw = line.slice(6);
    if (raw === '[DONE]') break;
    try {
      const evt = JSON.parse(raw);
      const delta = evt.choices?.[0]?.delta?.content;
      if (delta) send({ delta });
    } catch { /* skip */ }
  }
}

// ── Gemini streaming (with attachment support) ────────────────
async function streamGemini(key, model, history, currentAttachments, maxTokens, systemPrompt, send, signal) {
  const contents = [];

  for (const msg of history) {
    const role = msg.role === 'user' ? 'user' : 'model';
    let text = msg.content || '';
    if (msg.attachments?.length) text += buildAttachmentContext(msg.attachments);
    contents.push({ role, parts: [{ text }] });
  }

  const lastMsg = contents[contents.length - 1];
  const prompt = (lastMsg?.role === 'user' ? lastMsg.parts[0]?.text : '') || 'Analyze the attached files.';
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
  if (systemPrompt) gemReq.systemInstruction = { parts: [{ text: systemPrompt }] };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${key}&alt=sse`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gemReq), signal }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini HTTP ${res.status}`);
  }

  for await (const line of readLines(res.body)) {
    if (!line.startsWith('data: ')) continue;
    try {
      const evt = JSON.parse(line.slice(6));
      const text = evt.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) send({ delta: text });
    } catch { /* skip */ }
  }
}

// ── Async line reader ─────────────────────────────────────────
async function* readLines(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) { if (buf) yield buf; break; }
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) yield l;
  }
}
