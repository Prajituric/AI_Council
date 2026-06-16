/* ================================================================
   status.js  —  Real health-check endpoint
   GET /api/status

   The app now authenticates with a single provider — OpenRouter —
   instead of separate keys for Anthropic, OpenAI, Gemini, DeepSeek,
   xAI, Groq, and Mistral. This pings OpenRouter once and mirrors
   the result onto the legacy per-vendor keys for backward
   compatibility with any older client/cache that still reads them.
   Also checks Supabase and R2 connectivity.

   Returns: { openrouter, anthropic, openai, google, deepseek, xai,
              groq, mistral, supabase, r2, checkedAt }
   Each provider/service field is 'ok' | 'error' | 'unconfigured'.
   ================================================================ */
const H = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.URL || '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const TIMEOUT_MS = 8000;

function timeoutSignal() {
  try { return AbortSignal.timeout(TIMEOUT_MS); } catch { return undefined; }
}

async function pingOpenRouter(key) {
  if (!key) return 'unconfigured';
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` },
      signal: timeoutSignal(),
    });
    return res.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

async function pingSupabase(url, key) {
  if (!url || !key) return 'unconfigured';
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: timeoutSignal(),
    });
    return res.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

function checkR2(accountId, accessKeyId) {
  // No cheap unauthenticated ping for R2 without signing a request —
  // presence of both credentials is the best signal available here.
  return (accountId && accessKeyId) ? 'ok' : 'unconfigured';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: H, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: H, body: '{}' };

  const openrouterKey = process.env.OPENROUTER_API_KEY || '';
  const sbUrl = process.env.SUPABASE_URL || '';
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

  const [openrouter, supabase] = await Promise.all([
    pingOpenRouter(openrouterKey),
    pingSupabase(sbUrl, sbKey),
  ]);

  const r2 = checkR2(process.env.R2_ACCOUNT_ID, process.env.R2_ACCESS_KEY_ID);

  return {
    statusCode: 200,
    headers: H,
    body: JSON.stringify({
      openrouter,
      // Legacy per-vendor flags — every model now routes through OpenRouter,
      // so they all mirror the single check above.
      anthropic: openrouter,
      openai:    openrouter,
      google:    openrouter,
      deepseek:  openrouter,
      xai:       openrouter,
      groq:      openrouter,
      mistral:   openrouter,
      supabase,
      r2,
      checkedAt: new Date().toISOString(),
    }),
  };
};
