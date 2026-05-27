/* ================================================================
   synthesize-stream.mjs  —  Streaming synthesis via SSE
   Netlify Functions v2  (must be .mjs + default export)

   POST /api/synthesize-stream
   Body: { question, responses, attachmentsContext?, skillContext?,
           questionType? }
   Response: text/event-stream
     data: {"delta":"..."}               — text chunk
     data: {"done":true}                 — stream complete
     data: {"error":"..."}              — error
     data: {"clarification":{...}}       — ambiguous question, needs clarification

   New in this version:
   - Quality filter: Groq pre-scores each response 1–10 for relevance.
     Low-scoring responses are flagged; synthesizer downweights them.
   - Structured aggregation: system prompt explicitly uses the
     DIRECT ANSWER / CONFIDENCE / UNIQUE INSIGHT / BIGGEST RISK
     fields from model responses.
   - Clarification mode: if models genuinely disagree on the premise,
     returns {"type":"clarification",...} instead of a synthesis.
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

// ── Rate limiting (100 req/hour per user) ─────────────────────
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

// ── Quality filter: Groq pre-scores each response 1–10 ───────
// Fast (Llama 3.3), cheap, adds ~200ms. Returns { ModelName: score }
// or null if Groq not configured or call fails.
async function scoreResponsesWithGroq(question, responses) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey || !responses.length) return null;

  const preview = responses.map(r =>
    `### ${r.name}\n${(r.text || '').slice(0, 600)}`
  ).join('\n\n---\n\n');

  const prompt =
    `Rate each response's relevance to the question on a scale of 1-10.\n` +
    `Question: "${question.slice(0, 300)}"\n\n` +
    `${preview}\n\n` +
    `Respond with ONLY valid JSON: {"scores": {"ModelName": score_integer, ...}}`;

  try {
    // Abort after 5s — Groq is a fast pre-filter; if it's slow/down, skip it gracefully
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    let data;
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 150,
          temperature: 0,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        }),
        signal: ac.signal,
      });
      data = await res.json();
    } finally {
      clearTimeout(timer);
    }
    const text = data?.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(text);
    return parsed.scores || null;
  } catch { return null; } // Any error (timeout, network, parse) → neutral scores, synthesis continues
}

function sseChunk(obj) { return `data: ${JSON.stringify(obj)}\n\n`; }

// ── Synthesizer system prompt (structured-aggregation aware) ─
const SYSTEM = `You are the Moderator of an AI Council — powered by Claude Opus 4.6, the most capable synthesis model available. Your role is to read structured responses from multiple AI models and produce a single, definitive, high-quality synthesis.

Each model responded using this structure:
- DIRECT ANSWER: the model's core answer
- CONFIDENCE: 1–10 score + explanation of certainty
- KEY ASSUMPTION: the biggest premise the model is taking for granted
- UNIQUE INSIGHT: what this model sees that others will miss
- BIGGEST RISK: what would make this answer wrong or incomplete

## Synthesis methodology:

1. **Weight by CONFIDENCE**: Give more authority to models with high CONFIDENCE and clear reasoning behind it.
2. **Surface UNIQUE INSIGHTs**: Extract genuinely novel insights — do NOT average them away. Present them distinctly.
3. **Reconcile BIGGEST RISK**: When models identify different risks, list ALL of them — they reveal blind spots.
4. **Flag KEY ASSUMPTION conflicts**: Explicitly call out when models start from different premises.
5. **Use REASONING depth**: When models include a REASONING section, use it to judge their logic quality — a model with solid step-by-step reasoning but medium confidence may be more reliable than one with high confidence but no justification.

## WHEN TO REQUEST CLARIFICATION
If the models fundamentally disagree on the PREMISE of the question (not the answer), return ONLY this exact JSON with no other text:
{"type":"clarification","question":"[Your clarifying question]","reason":"[One reason: why models have different underlying assumptions]"}

## Standard synthesis structure (Markdown):

### ✅ Consensus & Direct Answer
Synthesize the DIRECT ANSWERs weighted by CONFIDENCE. Lead with the strongest, most defensible answer.

### 💡 Key Perspectives & Unique Insights
The valuable UNIQUE INSIGHTs the models brought — present them distinctly, don't average them.

### ⚠️ Risks & Disagreements
All BIGGEST RISKs — especially where models differ. Conflicting KEY ASSUMPTIONs.

### 🎯 Final Conclusion & Recommendation
The complete, concrete, actionable final answer.

---

## DOCUMENT GENERATION CAPABILITIES

When the user requests a specific document type, use the formats below.

### 1. Mermaid Diagrams
\`\`\`mermaid
graph TD / sequenceDiagram / gantt / erDiagram / classDiagram / stateDiagram-v2 / pie / mindmap
\`\`\`

### 2. Chart.js Charts
\`\`\`chart
{ "type": "bar|line|pie|doughnut|radar|polarArea|scatter|bubble",
  "data": { "labels": [...], "datasets": [{ "label": "...", "data": [...], "backgroundColor": "..." }] },
  "options": { "responsive": true, "plugins": { "title": { "display": true, "text": "Title" } } } }
\`\`\`

### 3. PowerPoint Presentation
\`\`\`presentation
{ "title": "Title", "subtitle": "Subtitle", "author": "AI Council",
  "theme": "dark|corporate|minimal",
  "slides": [{ "title": "...", "bullets": ["..."], "notes": "...", "layout": "title|content|two-column" }] }
\`\`\`

### 4. Word Document (DOCX)
\`\`\`docx
{ "title": "Document Title", "author": "AI Council",
  "sections": [
    { "heading": "1. Introduction", "level": 1, "content": "Text..." },
    { "heading": "1.1 Context", "level": 2, "content": "Text...", "bullets": ["Point 1","Point 2"] },
    { "table": { "headers": ["Col1","Col2"], "rows": [["A","B"],["C","D"]] } }
  ] }
\`\`\`

### 5. Excel Spreadsheet (XLSX)
\`\`\`xlsx
{ "sheets": [
    { "name": "Sheet1",
      "headers": ["Column 1", "Column 2", "Column 3"],
      "rows": [["Val1", "Val2", 100], ["Val3", "Val4", 200]],
      "totals": true }
  ] }
\`\`\`

### 6. CSV
\`\`\`csv
Column1,Column2,Column3
Value1,Value2,100
\`\`\`

### 7. HTML Document
\`\`\`html-doc
<!DOCTYPE html><html>...complete content...</html>
\`\`\`

### 8. Source code (any language)
\`\`\`python / javascript / typescript / sql / bash / etc.
# complete, functional code
\`\`\`

### 9. Structured JSON
\`\`\`json
{ "key": "value" }
\`\`\`

## Absolute rules
- ALWAYS respond in the same language the user used
- Generate COMPLETE, functional documents — never outlines or placeholders
- Weight by CONFIDENCE — do not treat all models as equal
- Surface UNIQUE INSIGHTs — do not average them, present them distinctly
- If multiple files are requested, generate each separately with its own code block`;

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
    return new Response(sseChunk({ error: 'Rate limit exceeded. Max 100 requests/hour.' }), {
      status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' },
    });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response(sseChunk({ error: 'Invalid JSON' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' } }); }

  const { question, responses, attachmentsContext, skillContext, questionType, webContext } = body;
  const key = process.env.ANTHROPIC_API_KEY || '';

  if (!key) {
    return new Response(sseChunk({ error: 'ANTHROPIC_API_KEY not configured.' }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' },
    });
  }
  if (!responses?.length) {
    return new Response(sseChunk({ error: 'No responses to synthesize.' }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' },
    });
  }

  // ── Quality filter: score responses before synthesis ──────
  // Runs in parallel while we build the user message
  const qualityScores = await scoreResponsesWithGroq(question, responses);

  const systemWithSkill = skillContext?.prompt
    ? `${SYSTEM}\n\n---\n## ACTIVE SKILL: ${skillContext.name}\n${skillContext.prompt}`
    : SYSTEM;

  // Build council text with quality scores annotated
  const SCORE_THRESHOLD = 5;
  const councilText = responses.map(r => {
    const score = qualityScores?.[r.name];
    const scoreNote = score !== undefined
      ? (score < SCORE_THRESHOLD
          ? ` ⚠️ Quality score: ${score}/10 — DOWNWEIGHT this response`
          : ` ✓ Quality score: ${score}/10`)
      : '';
    return `### ${r.name} — ${r.role}${scoreNote}\n${r.text}`;
  }).join('\n\n---\n\n');

  const attCtx  = attachmentsContext ? `\n\n**Context fișiere atașate:**\n${attachmentsContext}` : '';
  const qtNote  = questionType ? `\n**Question type:** ${questionType}` : '';
  const webNote = webContext
    ? `\n\n**[LIVE WEB CONTEXT — retrieved just now]**\n${webContext}\nCitează sursele relevante în sinteză.`
    : '';
  const userMsg = `**Întrebarea/Sarcina:**\n"${question}"${webNote}${attCtx}${qtNote}\n\n**Răspunsurile structurate ale consiliului:**\n\n${councilText}`;

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
            model: 'claude-opus-4-6',
            max_tokens: 4000,
            stream: true,
            system: systemWithSkill,
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

        // Check for clarification mode (synthesizer returned JSON)
        const trimmed = fullText.trim();
        if (trimmed.startsWith('{"type":"clarification"')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.type === 'clarification') {
              controller.close();
              return; // client already received the delta, let it parse the JSON
            }
          } catch { /* not valid JSON, treat as normal text */ }
        }

        send({ done: true, qualityScores: qualityScores || undefined });
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
