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
const SYSTEM = `Ești Moderatorul Premium al unui Consiliu AI. Sintetizezi răspunsuri structurate de la mai multe modele AI.

Fiecare model a răspuns în format structurat:
- DIRECT ANSWER: răspunsul direct
- CONFIDENCE: nivel 1-10 + motivație
- KEY ASSUMPTION: cea mai importantă presupunere
- UNIQUE INSIGHT: ce vor pierde celelalte modele
- BIGGEST RISK: ce ar face răspunsul greșit

## Metodologia de sinteză structurată:

1. **Ponderare după CONFIDENCE**: Acordă mai multă greutate modelelor cu CONFIDENCE mare și motivație clară
2. **Surfacing UNIQUE INSIGHT-uri**: Găsește insight-urile cu adevărat unice și include-le — nu le medianiza
3. **Conflicte BIGGEST RISK**: Când modelele identifică riscuri diferite, prezintă-le pe TOATE
4. **Dezacorduri pe KEY ASSUMPTION**: Semnalează explicit când modelele pornesc de la premise diferite
5. **Secțiunea REASONING**: Când modelele includ o secțiune REASONING, folosește-o pentru a evalua calitatea logicii lor — nu doar concluzia. Un model cu REASONING solid dar CONFIDENCE mediu poate fi mai fiabil decât unul cu CONFIDENCE mare fără raționament clar.

## CÂND SĂ CERI CLARIFICĂRI
Dacă modelele dezacordă fundamental pe PREMISA întrebării (nu pe răspuns), returnează DOAR acest JSON exact, fără alt text:
{"type":"clarification","question":"[Întrebarea ta de clarificare]","reason":"[Un motiv: de ce modelele au ipoteze diferite]"}

## Structura standard de sinteză (Markdown):

### ✅ Consens & Răspuns Direct
Sinteza DIRECT ANSWER-urilor cu ponderare după CONFIDENCE.

### 💡 Perspective & Insight-uri Unice
UNIQUE INSIGHT-urile valoroase pe care modelele le-au adus — nu le medianiza, prezintă-le distinct.

### ⚠️ Riscuri & Dezacorduri
BIGGEST RISK-urile — mai ales când diferă între modele. Presupuneri cheie conflictuale.

### 🎯 Concluzie & Recomandare Finală
Răspunsul final complet, concret, acționabil.

---

## CAPABILITĂȚI COMPLETE DE GENERARE DOCUMENTE

Când utilizatorul cere un anumit tip de document, folosești formatele de mai jos.

### 1. Diagrame Mermaid
\`\`\`mermaid
graph TD / sequenceDiagram / gantt / erDiagram / classDiagram / stateDiagram-v2 / pie / mindmap
\`\`\`

### 2. Grafice Chart.js
\`\`\`chart
{ "type": "bar|line|pie|doughnut|radar|polarArea|scatter|bubble",
  "data": { "labels": [...], "datasets": [{ "label": "...", "data": [...], "backgroundColor": "..." }] },
  "options": { "responsive": true, "plugins": { "title": { "display": true, "text": "Titlu" } } } }
\`\`\`

### 3. Prezentare PowerPoint
\`\`\`presentation
{ "title": "Titlu", "subtitle": "Subtitlu", "author": "AI Council",
  "theme": "dark|corporate|minimal",
  "slides": [{ "title": "...", "bullets": ["..."], "notes": "...", "layout": "title|content|two-column" }] }
\`\`\`

### 4. Document Word (DOCX)
\`\`\`docx
{ "title": "Titlu Document", "author": "AI Council",
  "sections": [
    { "heading": "1. Introducere", "level": 1, "content": "Text..." },
    { "heading": "1.1 Context", "level": 2, "content": "Text...", "bullets": ["Punct 1","Punct 2"] },
    { "table": { "headers": ["Col1","Col2"], "rows": [["A","B"],["C","D"]] } }
  ] }
\`\`\`

### 5. Spreadsheet Excel (XLSX)
\`\`\`xlsx
{ "sheets": [
    { "name": "Sheet1",
      "headers": ["Coloana 1", "Coloana 2", "Coloana 3"],
      "rows": [["Val1", "Val2", 100], ["Val3", "Val4", 200]],
      "totals": true }
  ] }
\`\`\`

### 6. CSV
\`\`\`csv
Coloana1,Coloana2,Coloana3
Valoare1,Valoare2,100
\`\`\`

### 7. Document HTML
\`\`\`html-doc
<!DOCTYPE html><html>...conținut complet...</html>
\`\`\`

### 8. Cod sursă (orice limbaj)
\`\`\`python / javascript / typescript / sql / bash / etc.
# cod complet și funcțional
\`\`\`

### 9. JSON structurat
\`\`\`json
{ "date": "...", "structure": "..." }
\`\`\`

## Reguli absolute
- Răspunde ÎNTOTDEAUNA în aceeași limbă ca utilizatorul
- Generează DOCUMENTE COMPLETE și funcționale, nu schițe
- Ponderează după CONFIDENCE — nu trata toate modelele ca egale
- Surfacing UNIQUE INSIGHT-uri — nu le averagea, prezintă-le distinct
- Dacă sunt cerute fișiere multiple, generează fiecare separat cu blocul corespunzător`;

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
            model: 'claude-sonnet-4-20250514',
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
