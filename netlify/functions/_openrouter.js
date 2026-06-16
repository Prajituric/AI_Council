/* ================================================================
   _openrouter.js — Shared OpenRouter call helper (CJS)

   The entire app now authenticates with ONE provider — OpenRouter —
   instead of separate keys for Anthropic, OpenAI, Gemini, DeepSeek,
   xAI, Groq, and Mistral. OpenRouter exposes all of them through a
   single OpenAI-compatible endpoint, so every call site in this app
   (council members, synthesis, evaluation, fact-check, routing,
   prompt enhancement, summarization, web-search classification)
   should call through here.

   Usage (CJS):   const { callOpenRouter, streamOpenRouter } = require('./_openrouter');
   Usage (ESM):   import { createRequire } from 'module';
                  const _req = createRequire(import.meta.url);
                  const { callOpenRouter, streamOpenRouter } = _req('./_openrouter.js');
   ================================================================ */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function siteHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    // Optional but recommended by OpenRouter for analytics/rankings — harmless if generic.
    'HTTP-Referer': process.env.URL || 'https://genx.app',
    'X-Title': 'GenX AI Council',
  };
}

function accessDeniedIfAuth(status, msg) {
  if (status === 401 || status === 403) return new Error(`ACCESS_DENIED:${msg}`);
  return new Error(msg);
}

/**
 * Non-streaming chat completion via OpenRouter.
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model        OpenRouter model slug, e.g. "anthropic/claude-opus-4.1"
 * @param {Array}  opts.messages     OpenAI-format messages (role/content), content may be a string or content-part array
 * @param {string} [opts.system]     Optional system prompt, prepended as a system message
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @param {object} [opts.responseFormat]  e.g. { type: 'json_object' } to request strict JSON output
 * @returns {Promise<{text:string, usage:{input_tokens:number, output_tokens:number}, raw:object}>}
 */
async function callOpenRouter({ apiKey, model, messages, system, maxTokens = 4000, temperature, responseFormat, signal }) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured on the server.');
  const fullMessages = system ? [{ role: 'system', content: system }, ...messages] : messages;

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: siteHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: fullMessages,
      max_tokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }),
    signal,
  });

  let data;
  try { data = await res.json(); } catch { data = {}; }

  if (!res.ok) {
    const msg = data.error?.message || `OpenRouter HTTP ${res.status}`;
    throw accessDeniedIfAuth(res.status, msg);
  }

  const choice = data.choices?.[0];
  return {
    text: choice?.message?.content || '',
    usage: {
      input_tokens:  data.usage?.prompt_tokens     || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
    raw: data,
  };
}

/**
 * Streaming chat completion via OpenRouter (SSE).
 * @param {object} opts Same as callOpenRouter, plus:
 * @param {(delta:string)=>void} [opts.onDelta]  Called for each text chunk as it arrives.
 * @returns {Promise<string>} The full concatenated text once the stream ends.
 */
async function streamOpenRouter({ apiKey, model, messages, system, maxTokens = 4000, temperature, onDelta, signal }) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured on the server.');
  const fullMessages = system ? [{ role: 'system', content: system }, ...messages] : messages;

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: siteHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: fullMessages,
      max_tokens: maxTokens,
      stream: true,
      ...(temperature !== undefined ? { temperature } : {}),
    }),
    signal,
  });

  if (!res.ok) {
    let msg = `OpenRouter HTTP ${res.status}`;
    try { const data = await res.json(); msg = data.error?.message || msg; } catch { /* ignore */ }
    throw accessDeniedIfAuth(res.status, msg);
  }

  let full = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content || '';
        if (delta) {
          full += delta;
          if (onDelta) onDelta(delta);
        }
      } catch { /* ignore malformed SSE chunk */ }
    }
  }

  return full;
}

/**
 * Build an OpenAI-format image content part from a base64 string or URL.
 */
function imagePart(att) {
  if (att.url) return { type: 'image_url', image_url: { url: att.url } };
  if (att.data) return { type: 'image_url', image_url: { url: `data:${att.type};base64,${att.data}` } };
  return null;
}

/**
 * Build an OpenAI-format file content part for PDFs (OpenRouter file-parser plugin format).
 * Falls back gracefully — if the underlying model doesn't support file parsing,
 * OpenRouter will return a clear error which the caller already surfaces.
 */
function filePart(att, filename) {
  if (!att.data && !att.url) return null;
  const dataUrl = att.data
    ? `data:application/pdf;base64,${att.data}`
    : att.url; // some OpenRouter models accept a direct URL too
  return { type: 'file', file: { filename: filename || att.name || 'document.pdf', file_data: dataUrl } };
}

module.exports = { callOpenRouter, streamOpenRouter, imagePart, filePart, OPENROUTER_URL };
