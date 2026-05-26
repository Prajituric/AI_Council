/* ================================================================
   evaluate-stream.mjs  —  Streaming evaluation via SSE
   Netlify Functions v2  (must be .mjs + default export)

   POST /api/evaluate-stream
   Body: { question, synthesis, responses, skillContext? }
   Response: text/event-stream
     data: {"delta":"..."}             — text chunk
     data: {"done":true,"score":7.4}   — stream complete with parsed score
     data: {"error":"..."}             — error
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

// ── Rate limiting (20 req / 5 min per user — separate eval bucket) ──
const EVAL_RATE_MAX = 20;
const EVAL_RATE_WIN = 5 * 60 * 1000; // 5 minutes

async function checkRateLimit(userId) {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!sbUrl || !sbKey) return false;
  const windowStart = new Date(Date.now() - EVAL_RATE_WIN).toISOString();
  // Prefix userId so eval quota is tracked independently from model-call quota
  const bucketId = `eval:${userId}`;
  try {
    const countRes = await fetch(
      `${sbUrl}/rest/v1/rate_limits?select=id&user_id=eq.${encodeURIComponent(bucketId)}&created_at=gte.${encodeURIComponent(windowStart)}`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
    );
    const rows = await countRes.json();
    if (Array.isArray(rows) && rows.length >= EVAL_RATE_MAX) return true;
    fetch(`${sbUrl}/rest/v1/rate_limits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: `Bearer ${sbKey}`, Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: bucketId }),
    }).catch(() => {});
    return false;
  } catch { return false; }
}

function sseChunk(obj) { return `data: ${JSON.stringify(obj)}\n\n`; }

// ── Exact same evaluator prompt as evaluate.js ────────────────
const EVALUATOR_SYSTEM = `You are an elite AI response evaluator and optimizer. Your job:

1. Evaluate the synthesis against the original question
2. Compare against all individual model responses
3. Identify strongest elements from each
4. Produce the BEST POSSIBLE final answer

Respond in the same language as the question and synthesis you receive.

Your output (strict Markdown):

## 📊 Evaluation
Brief assessment (2-3 sentences).

**Accuracy:** [1-10] — [note]
**Relevance:** [1-10] — [note]
**Completeness:** [1-10] — [note]
**Clarity:** [1-10] — [note]
**Overall Score:** [avg]/10

## 🏆 Strongest Model
[Which model gave the most valuable contribution and why - one sentence]

## ✨ Optimized Final Answer
[The best possible answer - synthesizing and improving ALL responses. More accurate, more complete, better structured than the original synthesis. THIS is what the user should use.]`;

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

  if (await checkRateLimit(userId)) {
    return new Response(sseChunk({ error: 'Rate limit exceeded. Max 20 evaluations per 5 minutes.' }), {
      status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' },
    });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response(sseChunk({ error: 'Invalid JSON' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' } }); }

  const { question, synthesis, responses, skillContext, questionType } = body;
  const key = process.env.ANTHROPIC_API_KEY || '';

  if (!key) {
    return new Response(sseChunk({ error: 'ANTHROPIC_API_KEY not configured.' }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' },
    });
  }
  if (!synthesis) {
    return new Response(sseChunk({ error: 'Missing synthesis.' }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' },
    });
  }
  if (!responses?.length) {
    return new Response(sseChunk({ error: 'Missing model responses.' }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' },
    });
  }

  const responseSummary = responses
    .map(r => `### ${r.name} (${r.role})\n${r.text}`)
    .join('\n\n---\n\n');

  const skillNote = skillContext
    ? `\n\n**Active Skill:** ${skillContext.name} — ${skillContext.prompt?.slice(0, 150)}...`
    : '';

  const userMsg = `**Question:** "${question}"${skillNote}

**Individual Responses:**
${responseSummary}

**Current Synthesis:**
${synthesis}

Evaluate and produce the optimized answer.`;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj) => controller.enqueue(enc.encode(sseChunk(obj)));
      let fullText = '';
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 3000,
            stream: true,
            system: EVALUATOR_SYSTEM,
            messages: [{ role: 'user', content: userMsg }],
          }),
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
              fullText += evt.delta.text;
              send({ delta: evt.delta.text });
            }
          } catch { /* skip malformed */ }
        }

        // Extract score + strongest model from accumulated text
        const scoreMatch = fullText.match(/Overall Score:\s*([0-9.]+)\s*\/\s*10/i);
        const score = scoreMatch ? parseFloat(scoreMatch[1]) : null;

        // Parse strongest model — line after "## 🏆 Strongest Model"
        const strongestMatch = fullText.match(/Strongest Model[^\n]*\n+([^\n]+)/i);
        const strongestLine = strongestMatch ? strongestMatch[1].trim() : null;
        // Match against a known model name from responses
        let strongestModel = null;
        if (strongestLine && responses?.length) {
          for (const r of responses) {
            if (strongestLine.toLowerCase().includes(r.name.toLowerCase())) {
              strongestModel = r.name; break;
            }
          }
        }

        // Write to model_performance (fire-and-forget)
        if (score !== null && strongestModel && questionType) {
          const sbUrl = process.env.SUPABASE_URL;
          const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
          if (sbUrl && sbKey) {
            // Upsert: update running average using Supabase RPC or manual calc
            // Read current avg + count first
            fetch(`${sbUrl}/rest/v1/model_performance?model_name=eq.${encodeURIComponent(strongestModel)}&question_type=eq.${encodeURIComponent(questionType)}&select=avg_score,sample_count`, {
              headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
            }).then(r => r.json()).then(rows => {
              const cur = rows?.[0];
              const newCount = (cur?.sample_count || 0) + 1;
              const newAvg  = cur
                ? ((cur.avg_score * cur.sample_count) + score) / newCount
                : score;
              return fetch(`${sbUrl}/rest/v1/model_performance`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json', apikey: sbKey,
                  Authorization: `Bearer ${sbKey}`,
                  Prefer: 'resolution=merge-duplicates',
                },
                body: JSON.stringify({
                  model_name: strongestModel, question_type: questionType,
                  avg_score: Math.round(newAvg * 100) / 100,
                  sample_count: newCount, updated_at: new Date().toISOString(),
                }),
              });
            }).catch(() => {});
          }
        }

        send({ done: true, score, strongestModel });
      } catch (e) {
        send({ error: e.message });
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
