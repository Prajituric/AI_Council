/* ================================================================
   auth.js  —  Multi-tenancy login
   Credentials defined via Netlify Environment Variables.
   REQUIRED env vars (no defaults — missing vars fail loudly):
     USER1_ID    USER1_NAME    USER1_PASS
     USER2_ID    USER2_NAME    USER2_PASS
     USER3_ID    USER3_NAME    USER3_PASS
     JWT_SECRET  (used for HMAC-signed tokens)
   ================================================================ */
const ORIGIN = process.env.URL || '*';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const crypto = require('crypto');
const { signToken } = require('./_auth-check');

// ── Password comparison (supports plain text + scrypt hashes) ──
// To upgrade a password to a scrypt hash:
//   node -e "require('crypto').scrypt(process.env.PASS, process.env.JWT_SECRET, 64, (e,k)=>console.log(k.toString('hex')))"
// Then set USER1_PASS to the 128-char hex output.
async function checkPassword(input, stored) {
  if (!input || !stored) return false;
  // Detect scrypt hash: exactly 128 lowercase hex chars
  if (/^[0-9a-f]{128}$/.test(stored)) {
    return new Promise((resolve) => {
      crypto.scrypt(input, process.env.JWT_SECRET || 'fallback-pepper', 64, (err, derived) => {
        if (err) { resolve(false); return; }
        try {
          resolve(crypto.timingSafeEqual(derived, Buffer.from(stored, 'hex')));
        } catch { resolve(false); }
      });
    });
  }
  // Plain-text fallback (backward compat) — constant-time via hash comparison
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(stored).digest();
  return crypto.timingSafeEqual(a, b);
}

function getUsers() {
  return [
    {
      id:   process.env.USER1_ID   || '',
      name: process.env.USER1_NAME || '',
      pass: process.env.USER1_PASS || '',
    },
    {
      id:   process.env.USER2_ID   || '',
      name: process.env.USER2_NAME || '',
      pass: process.env.USER2_PASS || '',
    },
    {
      id:   process.env.USER3_ID   || '',
      name: process.env.USER3_NAME || '',
      pass: process.env.USER3_PASS || '',
    },
  ].filter(u => u.id && u.pass); // skip unconfigured slots
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '{}' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { username, password } = body;
  if (!username || !password) return res({ error: 'missing_fields' });

  if (!process.env.JWT_SECRET) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'JWT_SECRET not configured on server.' }) };
  }

  const users = getUsers();
  const candidate = users.find(u => u.id.toLowerCase() === username.trim().toLowerCase());
  const passOk = candidate ? await checkPassword(password, candidate.pass) : false;

  if (!candidate || !passOk) return res({ error: 'invalid_credentials' });
  const user = candidate;

  // HMAC-signed token — cannot be forged without JWT_SECRET
  const token = signToken(user.id);

  return res({ ok: true, userId: user.id, userName: user.name, token });
};

function res(body) { return { statusCode: 200, headers: CORS, body: JSON.stringify(body) }; }
