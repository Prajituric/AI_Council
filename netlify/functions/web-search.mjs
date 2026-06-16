/* ================================================================
   web-search.mjs  —  Live web search for AI Council (#63)
   Netlify Functions v2 (ESM + default export)

   POST /api/web-search
   Body: { prompt }
   Returns: { needsSearch, query, results: [{title, url, content}] }

   Pipeline:
   1. A fast/cheap model (via OpenRouter) classifies whether live web
      data is needed.
   2. If yes, Tavily fires a clean search (purpose-built for LLM agents).
   3. Returns structured results for injection into every model's context.

   needsSearch = true:  current events, prices, news, recent releases,
                         sports results, live data, anything time-sensitive.
   needsSearch = false: math, creative writing, coding help, philosophy,
                         general stable knowledge, analysis of attached files.
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

// ── Search necessity classifier ───────────────────────────────
const CLASSIFIER_SYSTEM = `You are a search necessity classifier for an AI assistant pipeline.
Decide whether a user's question requires live web data to answer well.

Return ONLY valid JSON with no markdown, no explanation:
{"needsSearch": boolean, "query": "optimized search query or empty string"}

needsSearch = true when the question involves:
- Current events, breaking news, recent developments
- Live prices (stocks, crypto, commodities, products)
- Recent software/model releases, changelogs, version numbers
- Sports results, standings, schedules
- Weather, traffic, real-time status
- Anything where the answer meaningfully changes week-to-week

needsSearch = false for:
- Math, logic, algorithms, proofs
- Creative writing, brainstorming, storytelling
- Coding help (syntax, architecture, debugging)
- General stable knowledge (history, science, concepts)
- Analysis of content the user provided in their message
- Philosophical or subjective questions

When needsSearch = true, produce a concise, search-engine-optimized query.
Strip filler words. Focus on the key entities and intent.`;

async function classifyQuestion(prompt, apiKey, model) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const result = await callOpenRouter({
      apiKey,
      model,
      maxTokens: 80,
      temperature: 0.1,
      system: CLASSIFIER_SYSTEM,
      messages: [{ role: 'user', content: `Classify this question: "${prompt.slice(0, 400)}"` }],
      signal: ac.signal,
    });
    const text = result.text?.trim() || '';
    // Strip markdown code fences if the model wraps the JSON
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(clean);
  } finally {
    clearTimeout(timer);
  }
}

// ── Tavily search ─────────────────────────────────────────────
async function tavilySearch(query, tavilyKey) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: tavilyKey,
        query,
        max_results: 6,
        search_depth: 'basic',
        include_answer: false,
        include_raw_content: false,
      }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
    const data = await res.json();
    // Normalize to [{title, url, content}] — truncate content at 600 chars for token efficiency
    return (data.results || []).map(r => ({
      title:   r.title   || '',
      url:     r.url     || '',
      content: (r.content || '').slice(0, 600),
    }));
  } finally {
    clearTimeout(timer);
  }
}

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

  const { prompt = '' } = body;
  const models    = await resolveModels();
  const key       = process.env.OPENROUTER_API_KEY || '';
  const tavilyKey = process.env.TAVILY_API_KEY;

  // No keys — return needsSearch: false gracefully
  if (!key || !tavilyKey) {
    return new Response(JSON.stringify({ needsSearch: false, query: '', results: [] }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Step 1: classify
    let classification;
    try {
      classification = await classifyQuestion(prompt, key, models.fastUtil);
    } catch {
      return new Response(JSON.stringify({ needsSearch: false, query: '', results: [] }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (!classification?.needsSearch || !classification.query) {
      return new Response(JSON.stringify({ needsSearch: false, query: '', results: [] }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Step 2: search
    let results = [];
    try {
      results = await tavilySearch(classification.query, tavilyKey);
    } catch {
      // Search failed — degrade gracefully, don't break the pipeline
      return new Response(JSON.stringify({ needsSearch: true, query: classification.query, results: [] }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ needsSearch: true, query: classification.query, results }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[web-search] Error:', err.message);
    return new Response(JSON.stringify({ needsSearch: false, query: '', results: [] }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
};
