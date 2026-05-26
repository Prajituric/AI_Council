/* ================================================================
   extract-job.js  —  Non-blocking large-file text extraction
   Called by frontend after R2 upload.
   Immediately returns jobId, then processes file.
   Frontend polls /api/job-status?jobId=xxx
   ================================================================ */
const { requireAuth } = require('./_auth-check');

const ORIGIN = process.env.URL || '*';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const MAX_SYNC_BYTES = 5 * 1024 * 1024; // 5MB — process inline; above this → async job

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '{}' };

  // Auth — userId comes from verified token, not untrusted body
  const userId = requireAuth(event);
  if (!userId) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: '{}' }; }

  const { fileUrl, fileType, fileName, fileData, fileSizeBytes, chatId } = body;
  const sbUrl  = process.env.SUPABASE_URL;
  const sbKey  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  const jobId  = randomId();

  // Small file — process synchronously and return text directly
  if (!fileSizeBytes || fileSizeBytes <= MAX_SYNC_BYTES) {
    const text = await extractText(fileUrl, fileType, fileName, fileData);
    // Optionally store in jobs table if Supabase configured
    if (sbUrl && sbKey) {
      await upsertJob(sbUrl, sbKey, { id: jobId, user_id: userId || 'anon', chat_id: chatId, file_name: fileName, file_type: fileType, status: 'done', extracted_text: text, created_at: new Date().toISOString() });
    }
    return respond({ jobId, status: 'done', text });
  }

  // Large file — create job record immediately, then process
  if (sbUrl && sbKey) {
    await upsertJob(sbUrl, sbKey, { id: jobId, user_id: userId || 'anon', chat_id: chatId, file_name: fileName, file_type: fileType, status: 'processing', extracted_text: null, created_at: new Date().toISOString() });
  }

  // Process asynchronously (Netlify functions can run up to 26s on free tier)
  // For very large files we do best-effort extraction within timeout
  extractText(fileUrl, fileType, fileName, fileData)
    .then(async (text) => {
      if (sbUrl && sbKey) {
        await upsertJob(sbUrl, sbKey, { id: jobId, user_id: userId || 'anon', chat_id: chatId, file_name: fileName, file_type: fileType, status: 'done', extracted_text: text, updated_at: new Date().toISOString() });
      }
    })
    .catch(async (err) => {
      if (sbUrl && sbKey) {
        await upsertJob(sbUrl, sbKey, { id: jobId, user_id: userId || 'anon', chat_id: chatId, file_name: fileName, file_type: fileType, status: 'error', error_msg: err.message, updated_at: new Date().toISOString() });
      }
    });

  return respond({ jobId, status: 'processing' });
};

// ── Text extraction ───────────────────────────────────────────
const MAX_CHARS = 80000;

async function extractText(fileUrl, fileType, fileName, fileData) {
  if (isTextFile(fileType, fileName)) {
    let raw = '';
    if (fileUrl) { const r = await fetch(fileUrl); raw = await r.text(); }
    else if (fileData) { raw = Buffer.from(fileData, 'base64').toString('utf-8'); }
    return raw.slice(0, MAX_CHARS);
  }

  if (fileType === 'application/pdf') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return '[PDF: ANTHROPIC_API_KEY not configured for extraction]';
    let b64 = fileData;
    if (!b64 && fileUrl) {
      const r = await fetch(fileUrl);
      const buf = await r.arrayBuffer();
      b64 = Buffer.from(buf).toString('base64');
    }
    if (!b64) return '[PDF: could not read file]';
    return await extractPdfClaude(key, b64);
  }

  if (fileType?.startsWith('image/')) return `[Image: ${fileName}]`;
  return `[Binary file: ${fileName}]`;
}

async function extractPdfClaude(key, b64) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
          { type: 'text', text: 'Extract ALL text from this PDF. Keep structure. Return ONLY the extracted text, no commentary.' },
        ],
      }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'PDF extraction failed');
  return data.content.map(c => c.text || '').join('').slice(0, MAX_CHARS);
}

function isTextFile(type, name) {
  if (['text/', 'application/json', 'application/xml', 'application/javascript', 'application/yaml'].some(t => (type||'').startsWith(t))) return true;
  const ext = (name || '').split('.').pop().toLowerCase();
  return ['txt','md','csv','json','xml','yaml','yml','html','htm','css','js','ts','py','java','cpp','c','h','go','rs','rb','php','sql','sh','toml','ini'].includes(ext);
}

// ── Supabase helpers ──────────────────────────────────────────
async function upsertJob(sbUrl, sbKey, job) {
  try {
    await fetch(`${sbUrl}/rest/v1/extraction_jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sbKey}`,
        'apikey': sbKey,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(job),
    });
  } catch (e) { console.error('upsertJob failed:', e.message); }
}

function randomId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function respond(b) { return { statusCode: 200, headers: CORS, body: JSON.stringify(b) }; }
