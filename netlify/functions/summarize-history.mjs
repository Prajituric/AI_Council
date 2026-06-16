/* ================================================================
   summarize-history.mjs  —  Context window summarization (#2)
   Netlify Functions v2 (ESM + default export)

   POST /api/summarize-history
   Body: { messages: [{role, content}...] }
   Returns: { summary: string }

   Called when a conversation exceeds the rolling history threshold.
   Condenses older turns into a compact summary that preserves all
   facts, decisions, and context a model needs to continue coherently.
   Uses a fast/cheap model (via OpenRouter). Falls back to a simple
   turn-count summary on any error so the pipeline never breaks.
   ================================================================ */
import crypto from 'crypto';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const { resolveModels } = _require('./_resolve-models.js');
const { callOpenRouter } = _require('./_openrouter.js');

const ORIGIN = process.env.URL || '*';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Inline auth ───────────────────────────────────────────────
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

const SUMMARIZER_SYSTEM = `You are a conversation summarizer. Your job is to condense earlier parts of a conversation into a compact, information-dense summary.

The summary will be injected as context at the start of a continued conversation. It must preserve:
- All factual decisions made
- Technical specifics (languages, frameworks, file names, variable names, constraints)
- Open questions or unresolved issues
- The overall goal or problem being worked on
- Any constraints or requirements established

Format: write a single dense paragraph (no headers, no bullets). Be concise but complete. Prioritize technical specifics over pleasantries.`;

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const token = req.headers.get('x-auth-token') || '';
  if (!verifyToken(token)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let body;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const { messages = [] } = body;
  if (!messages.length) {
    return new Response(JSON.stringify({ summary: '' }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const models = await resolveModels();
  const key = process.env.OPENROUTER_API_KEY || '';
  if (!key) {
    // Fallback: simple textual summary without a model call
    const fallback = `[Earlier conversation: ${messages.length} messages covering the context of this session.]`;
    return new Response(JSON.stringify({ summary: fallback }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Format messages as a readable transcript (truncate individual turns at 800 chars)
  const transcript = messages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${(m.content || '').slice(0, 800)}`)
    .join('\n\n');

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000); // 8s — slightly longer since transcript can be large
    let summary = `[Earlier conversation: ${messages.length} messages]`;
    try {
      const result = await callOpenRouter({
        apiKey: key,
        model: models.fastUtil,
        maxTokens: 400,
        temperature: 0.1,
        system: SUMMARIZER_SYSTEM,
        messages: [{ role: 'user', content: `Summarize this conversation history:\n\n${transcript}` }],
        signal: ac.signal,
      });
      const text = result.text?.trim() || '';
      if (text) summary = text;
    } finally {
      clearTimeout(timer);
    }

    return new Response(JSON.stringify({ summary }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch {
    const fallback = `[Earlier conversation: ${messages.length} messages covering this session's context.]`;
    return new Response(JSON.stringify({ summary: fallback }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
};
