/* ================================================================
   refresh-token.js  —  Silent token renewal
   POST /api/refresh-token
   Headers: x-auth-token: <valid-token>
   Returns: { token: <new-token> }

   Called automatically on boot when the stored token is within
   5 days of its 30-day expiry, so users never see a surprise 401.
   ================================================================ */
const ORIGIN = process.env.URL || '*';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const { verifyToken, signToken } = require('./_auth-check');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '{}' };

  const token = event.headers['x-auth-token'] || event.headers['X-Auth-Token'] || '';
  const userId = verifyToken(token);
  if (!userId) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const newToken = signToken(userId);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ token: newToken }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
