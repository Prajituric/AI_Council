/* ================================================================
   delete-r2.js  —  Delete a file from Cloudflare R2
   ================================================================ */

const { createHmac, createHash } = require('crypto');
const { requireAuth } = require('./_auth-check');

const ORIGIN = process.env.URL || '*';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (!['POST','DELETE'].includes(event.httpMethod)) return { statusCode: 405, headers: CORS, body: '{}' };

  if (!requireAuth(event)) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID) return respond({ error: 'R2 not configured' });

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: '{}' }; }

  const { r2Key } = body;
  if (!r2Key) return respond({ error: 'Missing r2Key' });

  const bucket  = R2_BUCKET_NAME || 'ai-council-files';
  const host    = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const region  = 'auto';
  const service = 's3';

  const now       = new Date();
  const amzDate   = now.toISOString().replace(/[:-]/g, '').split('.')[0] + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const encodedKey = r2Key.split('/').map(p => encodeURIComponent(p)).join('/');
  const canonicalURI = `/${bucket}/${encodedKey}`;
  const payloadHash  = createHash('sha256').update('').digest('hex');

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders    = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = ['DELETE', canonicalURI, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const strToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');

  const kDate    = createHmac('sha256', 'AWS4' + R2_SECRET_ACCESS_KEY).update(dateStamp).digest();
  const kRegion  = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  const kSign    = createHmac('sha256', kService).update('aws4_request').digest();
  const sig      = createHmac('sha256', kSign).update(strToSign).digest('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${credentialScope},SignedHeaders=${signedHeaders},Signature=${sig}`;

  try {
    const res = await fetch(`https://${host}/${bucket}/${encodedKey}`, {
      method: 'DELETE',
      headers: {
        'Authorization': authHeader,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        'Host': host,
      },
    });

    if (res.ok || res.status === 204 || res.status === 404) {
      return respond({ success: true });
    }
    const txt = await res.text();
    return respond({ error: `R2 delete failed: HTTP ${res.status}`, detail: txt });
  } catch (e) {
    return respond({ error: e.message });
  }
};

function respond(b) { return { statusCode: 200, headers: CORS, body: JSON.stringify(b) }; }
