/* ================================================================
   _auth-check.js  —  Shared HMAC auth helper
   Import in every sensitive function:
     const { requireAuth } = require('./_auth-check');
   ================================================================ */
const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET || '';

/**
 * Sign a userId into an HMAC-verified token.
 * Returns base64(userId:timestamp:sig)
 */
function signToken(userId) {
  if (!SECRET) throw new Error('JWT_SECRET env var not set');
  const payload = `${userId}:${Date.now()}`;
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64');
}

/**
 * Verify a token. Returns userId string on success, null on failure.
 * Tokens expire after 30 days.
 */
function verifyToken(token) {
  if (!SECRET || !token) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return null;
    const [userId, ts, sig] = parts;
    // Check expiry — 30 days in ms
    if (Date.now() - parseInt(ts, 10) > 30 * 24 * 60 * 60 * 1000) return null;
    const expected = crypto.createHmac('sha256', SECRET).update(`${userId}:${ts}`).digest('hex');
    // Constant-time comparison
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
    return userId;
  } catch { return null; }
}

/**
 * requireAuth(event)
 * Returns the userId string if the request carries a valid token,
 * or null if unauthorized.
 */
function requireAuth(event) {
  const token = event.headers['x-auth-token'] || event.headers['X-Auth-Token'];
  return verifyToken(token);
}

module.exports = { signToken, verifyToken, requireAuth };
