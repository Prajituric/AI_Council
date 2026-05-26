/* ================================================================
   enhance-prompt.mjs  —  Prompt enhancement via Groq (#3)
   Netlify Functions v2 (ESM + default export)

   POST /api/enhance-prompt
   Body: { prompt, history? }
   Returns: { enhanced: string, changed: boolean }

   Rewrites vague/ambiguous prompts into clearer, more structured
   versions before they reach the council. Uses Groq Llama 3.3 70B
   for sub-200ms turnaround. Falls back to returning the original
   prompt unchanged on any error (timeout, missing key, bad JSON).
   ================================================================ */
import crypto from 'crypto';

const ORIGIN = process.env.URL || '*';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Inline auth (ESM can't require CJS) ──────────────────────
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

// ── Rewriter system prompt ────────────────────────────────────
const REWRITER_SYSTEM = `You are an expert prompt engineer. Rewrite user prompts to be clearer, more specific, and more actionable — without changing intent.

Rules:
1. Remove ambiguity — make implicit requirements explicit
2. Split compound questions into numbered sub-questions
3. Strip hedging filler ("I was wondering if maybe possibly...")
4. Add implied constraints only ("write a sorting algorithm" → efficiency is always implied)
5. If recent conversation context clarifies domain or language/framework, include it concisely
6. If the prompt is already precise and well-structured, return it UNCHANGED
7. NEVER change the user's intent — if they asked for A, return A, not B
8. NEVER add information that wasn't implied by the prompt
9. NEVER change the language (Romanian in → Romanian out; English in → English out)
10. NEVER aggressively rewrite creative or open-ended prompts ("write a poem about rain" stays exactly that)
11. Keep the result concise — don't pad it out

Return ONLY the rewritten prompt. No explanation, no preamble, no surrounding quotes.`;

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

  const { prompt = '', history = [] } = body;

  // Trim to sane limits
  const trimmedPrompt = prompt.slice(0, 2000);
  if (!trimmedPrompt.trim()) {
    return new Response(JSON.stringify({ enhanced: prompt, changed: false }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    // No key → return original unchanged (non-fatal)
    return new Response(JSON.stringify({ enhanced: prompt, changed: false }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Build context from recent user turns (last 4 messages, 150 chars each)
  const recentContext = history
    .filter(h => h.role === 'user' && h.content)
    .slice(-4)
    .map(h => `- ${h.content.slice(0, 150)}`)
    .join('\n');

  const userMsg = recentContext
    ? `Recent conversation context:\n${recentContext}\n\nPrompt to enhance:\n${trimmedPrompt}`
    : trimmedPrompt;

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000); // 5s hard timeout

    let enhanced = prompt;
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 500,
          temperature: 0.1,
          messages: [
            { role: 'system', content: REWRITER_SYSTEM },
            { role: 'user', content: userMsg },
          ],
        }),
        signal: ac.signal,
      });
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim() || '';
      if (text) enhanced = text;
    } finally {
      clearTimeout(timer);
    }

    const changed = enhanced.trim() !== prompt.trim();
    return new Response(JSON.stringify({ enhanced, changed }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch {
    // Timeout, network error, or parse failure → silent fallback to original
    return new Response(JSON.stringify({ enhanced: prompt, changed: false }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
};
