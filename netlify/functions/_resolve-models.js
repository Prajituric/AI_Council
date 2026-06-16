/* ================================================================
   _resolve-models.js  —  Boot-time model resolver (shared CJS)

   The app now routes every model call through OpenRouter using a
   single OPENROUTER_API_KEY. This module queries OpenRouter's
   model catalog (https://openrouter.ai/api/v1/models) once per warm
   instance, caches the result for 6 hours, and resolves the best
   available slug for each tier the app needs — so a new Claude,
   GPT, Gemini, DeepSeek, Grok, Llama, or Mistral release is picked
   up automatically without any code change.

   Usage (CJS):   const { resolveModels } = require('./_resolve-models');
   Usage (ESM):   import { createRequire } from 'module';
                  const _req = createRequire(import.meta.url);
                  const { resolveModels } = _req('./_resolve-models.js');
   ================================================================ */

// Hardcoded fallbacks — always valid, used when the OpenRouter catalog
// call fails or OPENROUTER_API_KEY isn't set yet.
const DEFAULTS = {
  opus:      'anthropic/claude-opus-4.1',
  sonnet:    'anthropic/claude-3.7-sonnet',
  haiku:     'anthropic/claude-3.5-haiku',
  gpt4o:     'openai/gpt-4o',
  gpt4oMini: 'openai/gpt-4o-mini',
  gemini:    'google/gemini-2.0-flash-001',
  deepseek:  'deepseek/deepseek-chat',
  grok:      'x-ai/grok-2-1212',
  llama:     'meta-llama/llama-3.3-70b-instruct',
  mistral:   'mistralai/mistral-large-2411',
  fastUtil:  'meta-llama/llama-3.3-70b-instruct',
};

// Module-level cache — persists across warm Lambda invocations
let _cache     = null;
let _cacheTime = 0;
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// Extract a comparable numeric version tuple from a model id, e.g.
// "anthropic/claude-opus-4.1" -> [4, 1]
// "meta-llama/llama-3.3-70b-instruct" -> [3, 3, 70]
function versionTuple(id) {
  const nums = id.match(/\d+(?:\.\d+)?/g) || [];
  return nums.flatMap(n => n.split('.').map(Number));
}

// Descending version compare; shorter id wins ties (cleaner "rolling alias" slug).
function compareVersions(a, b) {
  const va = versionTuple(a), vb = versionTuple(b);
  const len = Math.max(va.length, vb.length);
  for (let i = 0; i < len; i++) {
    const x = va[i] ?? 0, y = vb[i] ?? 0;
    if (x !== y) return y - x;
  }
  return a.length - b.length;
}

// Select the best model for a vendor+tier from the full OpenRouter catalog.
// Prefers non-date-pinned aliases (rolling latest) over date-pinned releases,
// then picks the highest version tuple.
function bestOf(ids, vendor, mustInclude = [], mustExclude = [], fallback) {
  const candidates = ids.filter(id => {
    const l = id.toLowerCase();
    if (!l.startsWith(vendor + '/')) return false;
    if (!mustInclude.every(tok => l.includes(tok))) return false;
    if (mustExclude.some(tok => l.includes(tok))) return false;
    return true;
  });
  if (!candidates.length) return fallback;

  const undated = candidates.filter(id => !/\d{8}/.test(id));
  const pool    = undated.length ? undated : candidates;

  return pool.slice().sort(compareVersions)[0];
}

async function resolveModels() {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;

  const apiKey = process.env.OPENROUTER_API_KEY || '';
  const result  = { ...DEFAULTS };

  if (apiKey) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const { data = [] } = await res.json();
        const ids = data.map(m => m.id).filter(Boolean);

        result.opus       = bestOf(ids, 'anthropic',  ['opus'],            [],       DEFAULTS.opus);
        result.sonnet      = bestOf(ids, 'anthropic',  ['sonnet'],          [],       DEFAULTS.sonnet);
        result.haiku        = bestOf(ids, 'anthropic',  ['haiku'],          [],       DEFAULTS.haiku);
        result.gpt4o       = bestOf(ids, 'openai',     ['gpt-4o'],          ['mini'], DEFAULTS.gpt4o);
        result.gpt4oMini   = bestOf(ids, 'openai',     ['gpt-4o', 'mini'],  [],       DEFAULTS.gpt4oMini);
        result.gemini      = bestOf(ids, 'google',     ['gemini', 'flash'], [],       null)
                           || bestOf(ids, 'google',     ['gemini'],          [],       DEFAULTS.gemini);
        result.deepseek    = bestOf(ids, 'deepseek',   ['chat'],            [],       null)
                           || bestOf(ids, 'deepseek',   [],                  [],       DEFAULTS.deepseek);
        result.grok        = bestOf(ids, 'x-ai',       ['grok'],            ['beta'], null)
                           || bestOf(ids, 'x-ai',       ['grok'],            [],       DEFAULTS.grok);
        result.llama       = bestOf(ids, 'meta-llama', ['instruct'],        [],       DEFAULTS.llama);
        result.mistral     = bestOf(ids, 'mistralai',  ['large'],           [],       DEFAULTS.mistral);
        result.fastUtil    = result.llama || DEFAULTS.fastUtil;
      }
    } catch { /* network/parse failure — keep DEFAULTS already in result */ }
  }

  _cache     = result;
  _cacheTime = Date.now();
  return result;
}

module.exports = { resolveModels, DEFAULTS };
