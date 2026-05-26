/* ================================================================
   upload-r2.js  —  Presigned URL endpoint for Cloudflare R2
   Frontend uploads directly to R2 (no size limit from Netlify)
   Files stored permanently until user deletes them
   ================================================================ */

const { presignR2Put } = require('./r2-sign');
const { requireAuth } = require('./_auth-check');

const ORIGIN = process.env.URL || '*';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: CORS, body: '{}' };

  if (!requireAuth(event)) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME,
    R2_PUBLIC_URL,
  } = process.env;

  // Fallback to Supabase storage if R2 not configured
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return respond({ error: 'R2_NOT_CONFIGURED', message: 'Cloudflare R2 nu este configurat. Fișierele vor fi trimise ca base64 (limitat la ~4MB).' });
  }

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: '{}' }; }

  const { filename, contentType, chatId } = body;
  if (!filename || !contentType) return respond({ error: 'Missing filename or contentType' });

  const ts      = Date.now();
  const safeName = filename.replace(/[^a-z0-9._\-]/gi, '_').toLowerCase();
  const r2Key   = `uploads/${chatId || 'general'}/${ts}_${safeName}`;
  const bucket  = R2_BUCKET_NAME || 'ai-council-files';

  try {
    const uploadUrl = presignR2Put({
      accountId:       R2_ACCOUNT_ID,
      bucket,
      key:             r2Key,
      contentType,
      accessKeyId:     R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      expiresIn:       3600,
    });

    // Public URL — either custom domain or R2 public dev URL
    const basePublic = R2_PUBLIC_URL
      ? R2_PUBLIC_URL.replace(/\/$/, '')
      : `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}`;
    const publicUrl = `${basePublic}/${r2Key}`;

    return respond({ uploadUrl, publicUrl, r2Key });
  } catch (e) {
    return respond({ error: e.message });
  }
};

function respond(body) {
  return { statusCode: 200, headers: CORS, body: JSON.stringify(body) };
}
