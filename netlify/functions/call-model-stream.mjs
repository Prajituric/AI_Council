/* ================================================================
   call-model-stream.mjs  —  Streaming AI responses via SSE (OpenRouter-only)
   Netlify Functions v2  (must be .mjs + default export)

   Every council model now streams through ONE provider — OpenRouter —
   authenticated with a single OPENROUTER_API_KEY. The `provider` field
   sent by the client is kept only as a label; `modelName` is expected
   to be an OpenRouter slug (e.g. "anthropic/claude-sonnet-4.6").
   Rate-limited: 100 req/hour per user via Supabase rate_limits table
   Injects role mandates + structured response format per model (#4 + #5)
   Supports two-round debate via round2Context field (#10)

   POST /api/call-model-stream
   Body: { provider, modelName, role, history, attachments, maxTokens,
           skillContext, round2Context?, chainOfThought? }
   Response: text/event-stream
     data: {"delta":"..."}        — text chunk
     data: {"done":true}          — stream complete
     data: {"error":"..."}        — error
   ================================================================ */
import crypto from 'crypto';
import { createRequire } from 'module';

const _req = createRequire(import.meta.url);
const { streamOpenRouter, imagePart, filePart } = _req('./_openrouter.js');

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

// Build OpenAI-format messages (history + current attachments) for OpenRouter.
async function buildMessages(history, currentAttachments) {
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

  const lastMsg = messages[messages.length - 1];
  const prompt  = (lastMsg?.role === 'user' ? lastMsg.content : '') || 'Analyze the attached files.';
  if (lastMsg?.role === 'user') messages.pop();

  const textAttachments = (currentAttachments || []).filter(a => !a.type?.startsWith('image/') && a.type !== 'application/pdf');
  let textContent = prompt;
  if (textAttachments.length) textContent += buildAttachmentContext(textAttachments);

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

  return messages;
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
    modelName,
    role = '',                // council role → injected as system prompt
    history = [],
    attachments = [],
    maxTokens = 2500,
    skillContext = null,
    round2Context = null,     // set during deep mode second round (#10)
    chainOfThought = false,   // prepend REASONING section to structured output (#3)
  } = body;

  const key = process.env.OPENROUTER_API_KEY || '';
  if (!key) {
    return new Response(sseChunk({ error: 'OPENROUTER_API_KEY not configured on the server.' }), {
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
          const messages = await buildMessages(history, attachments);
          await streamOpenRouter({
            apiKey: key,
            model: modelName,
            messages,
            system: systemPrompt || undefined,
            maxTokens,
            onDelta: (delta) => send({ delta }),
            signal: ac.signal,
          });
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
