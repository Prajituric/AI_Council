/* ================================================================
   status.js  —  Real health-check endpoint
   GET /api/status
   Pings each configured provider with a minimal 1-token request
   and returns { provider: 'ok' | 'error' | 'unconfigured' }
   Also checks Supabase and R2 connectivity.
   ================================================================ */
const H = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.URL || '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const TIMEOUT_MS = 8000;

async function pingAnthropic(key) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    metho