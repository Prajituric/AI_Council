/* ================================================================
   cache-cleanup.mjs  —  Weekly table hygiene (#46)
   Netlify Functions v2 (ESM + scheduled function)

   Runs every Tuesday at 02:00 UTC (offset from Monday's
   check-model-performance.mjs to spread load).

   Deletes:
   - response_cache rows older than CACHE_TTL_DAYS (default 7)
   - rate_limits rows older than 2 hours (all users, not just current)

   Without this, both tables grow unboundedly:
   - getCachedResponse already ignores old rows on reads, but they
     accumulate and slow index scans.
   - checkRateLimit only cleans the current user's old rows; rows for
     inactive users are never touched.
   ================================================================ */

export const config = {
  schedule: '0 2 * * 2', // Every Tuesday at 02:00 UTC
};

export default async () => {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!sbUrl || !sbKey) {
    console.log('[cache-cleanup] Supabase not configured, skipping');
    return new Response('OK', { status: 200 });
  }

  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
  const results = [];

  // ── 1. response_cache — delete rows older than TTL ────────────
  try {
    const ttlDays = parseFloat(process.env.CACHE_TTL_DAYS || '7');
    const cacheExpiry = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString();

    const cacheRes = await fetch(
      `${sbUrl}/rest/v1/response_cache?created_at=lt.${encodeURIComponent(cacheExpiry)}`,
      { method: 'DELETE', headers }
    );
    if (cacheRes.ok) {
      results.push(`response_cache: deleted rows older than ${ttlDays}d`);
      console.log(`[cache-cleanup] response_cache cleaned (cutoff: ${cacheExpiry})`);
    } else {
      const err = await cacheRes.text();
      results.push(`response_cache: error ${cacheRes.status} — ${err}`);
      console.error(`[cache-cleanup] response_cache error:`, err);
    }
  } catch (e) {
    results.push(`response_cache: exception — ${e.message}`);
    console.error('[cache-cleanup] response_cache exception:', e);
  }

  // ── 2. rate_limits — delete all rows older than 2 hours ───────
  // checkRateLimit only cleans rows for the *current* user on each call.
  // This sweep handles rows belonging to inactive or churned users.
  try {
    const rateLimitExpiry = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const rlRes = await fetch(
      `${sbUrl}/rest/v1/rate_limits?created_at=lt.${encodeURIComponent(rateLimitExpiry)}`,
      { method: 'DELETE', headers }
    );
    if (rlRes.ok) {
      results.push('rate_limits: deleted rows older than 2h');
      console.log(`[cache-cleanup] rate_limits cleaned (cutoff: ${rateLimitExpiry})`);
    } else {
      const err = await rlRes.text();
      results.push(`rate_limits: error ${rlRes.status} — ${err}`);
      console.error('[cache-cleanup] rate_limits error:', err);
    }
  } catch (e) {
    results.push(`rate_limits: exception — ${e.message}`);
    console.error('[cache-cleanup] rate_limits exception:', e);
  }

  const summary = results.join(' | ');
  console.log(`[cache-cleanup] Done: ${summary}`);
  return new Response(`OK: ${summary}`, { status: 200 });
};
