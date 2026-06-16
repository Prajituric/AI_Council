/* ================================================================
   factcheck-stream.mjs  —  Post-synthesis fact-check pass (#56)
   Netlify Functions v2 (ESM + default export)

   POST /api/factcheck-stream
   Body: { synthesis: string, question: string }
   Returns: SSE stream of { delta } chunks, then { done: true }

   Uses Claude Haiku to identify factual claims in the synthesis,
   assess confidence, and flag anything uncertain or potentially
   incorrect. Streams results so the UI can render incrementally.
   ================================================================ */
import crypto from 'crypto';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const { resolveModels } = _require('./_resolve-models.js');
const { streamOpenRouter } = _require('./_openrouter.js');

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

// ── SSE helpers ───────────────────────────────────────────────
function sseChunk(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

// ── Fact-check system prompt ──────────────────────────────────
const FACTCHECK_SYSTEM = `You are a fact-checking assistant reviewing an AI-generated synthesis for accuracy.

Your task:
1. Identify the key factual claims made in the synthesis (statistics, dates, names, causal relationships, technical assertions).
2. For each claim, assess your confidence: HIGH (very likely correct), MEDIUM (plausible but uncertain), LOW (potentially incorrect or unverifiable).
3. Flag any claims that seem inconsistent, contradictory, or suspiciously specific without basis.
4. Note if the synthesis overall appears well-grounded or speculative.

Format your response as:

**FACT-CHECK SUMMARY**
Overall confidence: [HIGH / MEDIUM / LOW]
[One sentence summary of the synthesis's reliability]

**CLAIMS REVIEWED**
• [Claim] — [HIGH/MEDIUM/LOW confidence] [Brief note if needed]
• [Claim] — [HIGH/MEDIUM/LOW confidence] [Brief note if needed]
...

**FLAGS** (only include if there are genuine concerns)
⚠ [Specific concern about a claim or assertion]

Respond in the same language as the question and synthesis you receive.

Be concise. Focus on substance, not style. If there are no concerns, say so clearly. Do not hallucinate specific facts you cannot verify — acknowledge uncertainty.`;

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

  const { synthesis = '', question = '' } = body;
  if (!synthesis.trim()) {
    return new Response(JSON.stringify({ error: 'No synthesis provided' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const models = await resolveModels();
  const key = process.env.OPENROUTER_API_KEY || '';
  if (!key) {
    return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }), {
      status: 503, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try { controller.enqueue(new TextEncoder().encode(sseChunk(obj))); } catch {}
      };

      try {
        const userContent = question
          ? `Original question: ${question}\n\nSynthesis to fact-check:\n${synthesis}`
          : `Synthesis to fact-check:\n${synthesis}`;

        await streamOpenRouter({
          apiKey: key,
          model: models.haiku,
          maxTokens: 600,
          system: FACTCHECK_SYSTEM,
          messages: [{ role: 'user', content: userContent }],
          onDelta: (delta) => send({ delta }),
        });

        send({ done: true });
      } catch (err) {
        send({ error: err.message || 'Fact-check failed' });
      } finally {
        try { controller.close(); } catch {}
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
