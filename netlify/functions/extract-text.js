/* ================================================================
   extract-text.js  —  Extract text from files for AI context
   Supports: PDF (via Claude), TXT, MD, CSV, HTML, code files
   Runs after file is uploaded to R2
   ================================================================ */

const { requireAuth } = require('./_auth-check');

const ORIGIN = process.env.URL || '*';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const MAX_CONTEXT_CHARS = 80000; // ~20k tokens — kept per file in context

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: CORS, body: '{}' };

  if (!requireAuth(event)) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: '{}' }; }

  const { fileUrl, fileType, fileName, fileData } = body;
  // fileData is base64 (only for small files without R2)

  try {
    let text = '';

    if (isTextType(fileType, fileName)) {
      // Fetch text directly
      if (fileUrl) {
        const res = await fetch(fileUrl);
        text = await res.text();
      } else if (fileData) {
        text = Buffer.from(fileData, 'base64').toString('utf-8');
      }
      text = text.slice(0, MAX_CONTEXT_CHARS);

    } else if (fileType === 'application/pdf') {
      // Use Claude to extract text from PDF
      const key = process.env.ANTHROPIC_API_KEY;
      if (key) {
        let b64 = fileData;
        if (!b64 && fileUrl) {
          const res = await fetch(fileUrl);
          const buf = await res.arrayBuffer();
          b64 = Buffer.from(buf).toString('base64');
        }
        if (b64) {
          text = await extractPdfWithClaude(key, b64);
        }
      }
    } else if (fileType.startsWith('image/')) {
      // Images don't need text extraction — they're sent directly to vision models
      text = `[Imagine: ${fileName}]`;
    }

    return respond({ text: text.slice(0, MAX_CONTEXT_CHARS) });
  } catch (e) {
    return respond({ error: e.message, text: '' });
  }
};

async function extractPdfWithClaude(key, b64) {
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
          { type: 'text', text: 'Extrage TOT textul din acest document PDF. Păstrează structura, titlurile și paragrafele. Returnează DOAR textul extras, fără comentarii.' },
        ],
      }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'PDF extraction failed');
  return data.content.map(c => c.text || '').join('');
}

function isTextType(type, name) {
  const textTypes = [
    'text/', 'application/json', 'application/xml',
    'application/javascript', 'application/typescript',
    'application/x-yaml', 'application/yaml',
    'application/csv', 'text/csv',
  ];
  if (textTypes.some(t => type.startsWith(t))) return true;

  const ext = (name || '').split('.').pop().toLowerCase();
  const textExts = ['txt','md','csv','json','xml','yaml','yml','html','htm','css','js','ts','py','java','cpp','c','h','go','rs','rb','php','sql','sh','bash','zsh','env','toml','ini','cfg','conf','log'];
  return textExts.includes(ext);
}

function respond(b) { return { statusCode: 200, headers: CORS, body: JSON.stringify(b) }; }
