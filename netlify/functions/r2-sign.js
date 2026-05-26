/* ================================================================
   r2-sign.js  —  AWS Signature V4 presigned URL for Cloudflare R2
   No npm dependencies — uses Node.js built-in crypto
   ================================================================ */

const { createHmac, createHash } = require('crypto');

function sha256hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function hmacSHA256(key, data) {
  return createHmac('sha256', key).update(data).digest();
}

function getSigningKey(secretKey, date, region, service) {
  const kDate    = hmacSHA256('AWS4' + secretKey, date);
  const kRegion  = hmacSHA256(kDate, region);
  const kService = hmacSHA256(kRegion, service);
  const kSigning = hmacSHA256(kService, 'aws4_request');
  return kSigning;
}

/**
 * Generate a presigned PUT URL for Cloudflare R2
 * @param {Object} opts
 * @param {string} opts.accountId   - Cloudflare account ID
 * @param {string} opts.bucket      - R2 bucket name
 * @param {string} opts.key         - Object key (path in bucket)
 * @param {string} opts.contentType - MIME type
 * @param {string} opts.accessKeyId
 * @param {string} opts.secretAccessKey
 * @param {number} opts.expiresIn   - Seconds until expiry (default 3600)
 * @returns {string} Presigned PUT URL
 */
function presignR2Put(opts) {
  const {
    accountId, bucket, key, contentType,
    accessKeyId, secretAccessKey,
    expiresIn = 3600,
  } = opts;

  const region   = 'auto';
  const service  = 's3';
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const host     = `${accountId}.r2.cloudflarestorage.com`;

  const now       = new Date();
  const amzDate   = now.toISOString().replace(/[:-]/g, '').split('.')[0] + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const credential      = `${accessKeyId}/${credentialScope}`;

  const queryParams = new URLSearchParams({
    'X-Amz-Algorithm':     'AWS4-HMAC-SHA256',
    'X-Amz-Credential':    credential,
    'X-Amz-Date':          amzDate,
    'X-Amz-Expires':       String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  });

  // Sort query params for canonical form
  const sortedQuery = Array.from(queryParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const encodedKey     = key.split('/').map(p => encodeURIComponent(p)).join('/');
  const canonicalURI   = `/${bucket}/${encodedKey}`;
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders   = 'host';
  const payloadHash     = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    'PUT',
    canonicalURI,
    sortedQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256hex(canonicalRequest),
  ].join('\n');

  const signingKey  = getSigningKey(secretAccessKey, dateStamp, region, service);
  const signature   = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const presignedUrl = `${endpoint}/${bucket}/${encodedKey}?${sortedQuery}&X-Amz-Signature=${signature}`;
  return presignedUrl;
}

module.exports = { presignR2Put };
