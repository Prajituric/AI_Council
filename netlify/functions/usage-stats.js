/* ================================================================
   usage-stats.js  —  Server-side usage query (avoids CORS)
   Queries Supabase from the server so browsers never hit Supabase
   directly, eliminating CORS / network issues.
   ================================================================ */
const { requireAuth } = require('./_auth-check');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.URL || '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const userId = requireAuth(event);
  if (!userId) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };

  const sbUrl  = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const sbKey  = (process.env.SUPABASE_ANON_KEY || '').trim();

  if (!sbUrl || !sbKey) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: 'SUPABASE_NOT_CONFIGURED' }) };
  }

  try {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const url = `${sbUrl}/rest/v1/usage_log`
      + `?user_id=eq.${encodeURIComponent(userId)}`
      + `&created_at=gte.${encodeURIComponent(monthStart)}`
      + `&select=provider,input_tokens,output_tokens,total_tokens`;

    const res = await fetch(url, {
      headers: {
        'apikey':         sbKey,
        'Authorization':  `Bearer ${sbKey}`,
        'Content-Type':   'application/json',
        'Accept':         'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      // Table doesn't exist yet — user needs to run schema.sql
      if (res.status === 404 || (body && body.includes('usage_log'))) {
        return { statusCode: 200, headers: CORS,
          body: JSON.stringify({ error: 'TABLE_NOT_FOUND' }) };
      }
      throw new Error(`Supabase ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    return { statusCode: 200, headers: CORS,
      body: JSON.stringify({ data: Array.isArray(data) ? data : [] }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
