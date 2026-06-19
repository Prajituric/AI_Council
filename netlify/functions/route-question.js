/* ================================================================
   route-question.js  —  Smart question routing (#8)
   Fast model call (via OpenRouter) classifies question type, then
   queries model_performance to select top models for that type.

   POST /api/route-question
   Body: { question, availableModelIds, modelDescriptions?, maxModels? }
   Returns: {
     questionType,        // 'code'|'research'|'creative'|'analysis'|'math'|'other'
     selectedModelIds,    // best model IDs for this task (configurable count)
     confidence,          // 0-100 routing confidence
     reason,              // human-readable explanation
     allScores,           // { modelId: avgScore } for available models
   }

   modelDescriptions: optional { modelId: "description" } for custom/user-added models
   maxModels: optional max number to select (default: uses LLM judgment, min 2)
   ================================================================ */
const { requireAuth }  = require('./_auth-check');
const { resolveModels } = require('./_resolve-models');
const { callOpenRouter } = require('./_openrouter');

const ORIGIN = process.env.URL || '*';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const QUESTION_TYPES = ['code', 'research', 'creative', 'analysis', 'math', 'other'];

// Model name → model ID mapping (must match CATALOG in app.js).
// Note: 'claude' name is resolved dynamically at runtime from the live
// OpenRouter catalog (see app.js initApp()), so this entry tracks the
// *current default* and may drift after a new Claude release — same
// best-effort fragility this lookup always had with versioned names.
const MODEL_NAME_TO_ID = {
  'Claude 3.7 Sonnet': 'claude',
  'GPT-4o':            'gpt4o',
  'GPT-4o Mini':       'gpt4o-mini',
  'Gemini Flash':      'gemini',
  'DeepSeek V3':       'deepseek',
  'Grok':              'grok',
  'Llama 3.3 70B':     'groq-llama',
  'Mistral Large':     'mistral',
};

// Model descriptions — used by the LLM selector to understand each model's strengths
const MODEL_DESCRIPTIONS = {
  'claude':     'Claude Sonnet — exceptional deep reasoning, synthesis, nuanced writing, complex multi-step analysis (top-ranked model)',
  'gpt4o':      'GPT-4o — strong at coding, structured problem-solving, vision/multimodal tasks, broad world knowledge',
  'gpt4o-mini': 'GPT-4o Mini — fast and cost-effective for straightforward questions, light tasks',
  'gemini':     'Gemini Flash — excellent for research, science, factual accuracy, technical documentation',
  'deepseek':   'DeepSeek V3 — top-tier mathematics, algorithms, code optimization, logical/formal reasoning',
  'grok':       'Grok — real-time web knowledge, current events, creative writing, pop culture',
  'groq-llama': 'Llama 3.3 70B — ultra-fast responses, general Q&A, conversational tasks',
  'mistral':    'Mistral Large — multilingual content, European regulatory context, business writing',
};

// Fallback affinity scores (used only when LLM selection fails)
const ROLE_AFFINITY = {
  'claude':     { code: 8, research: 8, creative: 9, analysis: 9, math: 7, other: 8 },
  'gpt4o':      { code: 9, research: 8, creative: 8, analysis: 8, math: 8, other: 8 },
  'gpt4o-mini': { code: 7, research: 6, creative: 7, analysis: 6, math: 6, other: 7 },
  'gemini':     { code: 7, research: 9, creative: 7, analysis: 8, math: 8, other: 7 },
  'deepseek':   { code: 9, research: 7, creative: 6, analysis: 8, math: 9, other: 7 },
  'grok':       { code: 7, research: 7, creative: 9, analysis: 8, math: 7, other: 8 },
  'groq-llama': { code: 8, research: 7, creative: 7, analysis: 7, math: 8, other: 7 },
  'mistral':    { code: 7, research: 8, creative: 8, analysis: 7, math: 7, other: 8 },
};

const MIN_MODELS_TO_SELECT = 2;
const DEFAULT_MAX_MODELS = 4; // default upper bound, can be overridden by request
const MIN_SAMPLES_FOR_DATA = 3; // minimum sample_count to trust performance data

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '{}' };

  if (!requireAuth(event)) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: '{}' }; }

  const { question, availableModelIds = [], modelDescriptions = {}, maxModels = DEFAULT_MAX_MODELS } = body;
  if (!question) return respond({ error: 'Missing question' });

  const models  = await resolveModels();
  const key     = process.env.OPENROUTER_API_KEY || '';
  const sbUrl   = process.env.SUPABASE_URL;
  const sbKey   = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  // ── Step 1: Classify question type with a fast model ─────────
  let questionType = 'other';
  let classifyConfidence = 60;

  if (key) {
    try {
      const result = await callOpenRouter({
        apiKey: key,
        model: models.fastUtil,
        maxTokens: 60,
        temperature: 0,
        messages: [{
          role: 'user',
          content:
            `Classify this question into exactly one category: code, research, creative, analysis, math, other.\n` +
            `Also give confidence 0-100.\n` +
            `Question: "${question.slice(0, 400)}"\n` +
            `Respond with ONLY JSON: {"type":"<category>","confidence":<number>}`,
        }],
        responseFormat: { type: 'json_object' },
      });
      const cleaned = result.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned || '{}');
      if (QUESTION_TYPES.includes(parsed.type)) {
        questionType = parsed.type;
        classifyConfidence = parsed.confidence || 70;
      }
    } catch { /* fall back to 'other' */ }
  }

  // ── Step 2: Query model_performance for this question type ───
  let perfData = {}; // { modelName: { avg_score, sample_count } }
  if (sbUrl && sbKey) {
    try {
      const perfRes = await fetch(
        `${sbUrl}/rest/v1/model_performance?question_type=eq.${encodeURIComponent(questionType)}&select=model_name,avg_score,sample_count`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
      );
      const rows = await perfRes.json();
      if (Array.isArray(rows)) {
        for (const row of rows) { perfData[row.model_name] = row; }
      }
    } catch { /* ignore, use priors */ }
  }

  // ── Step 3: LLM-based intelligent model selection ────────────
  // Ask a fast/cheap model (via OpenRouter) to read the actual question and pick
  // the best models based on their specific strengths and the question content.
  // Falls back to affinity-score heuristic if unavailable.
  let selectedModelIds = [];
  let reason = '';
  let hasRealData = false;
  let scores = {};

  // Merge static MODEL_DESCRIPTIONS with any dynamic descriptions passed from client
  const allDescriptions = { ...MODEL_DESCRIPTIONS, ...modelDescriptions };
  const modelList = availableModelIds
    .map(id => `- ${id}: ${allDescriptions[id] || 'General-purpose AI model'}`)
    .join('\n');

  if (key && availableModelIds.length > 2) {
    try {
      const result = await callOpenRouter({
        apiKey: key,
        model: models.fastUtil,
        maxTokens: 150,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content:
            `You are a router for a multi-model AI system. Select the best models for this specific question.\n\n` +
            `Question: "${question.slice(0, 500)}"\n` +
            `Question type: ${questionType}\n\n` +
            `Available models:\n${modelList}\n\n` +
            `Rules:\n` +
            `- Pick 2-${maxModels} models that would give the most VALUABLE and DIVERSE perspectives\n` +
            `- Prefer models with a clear strength advantage for this question's domain\n` +
            `- More complex/broad questions benefit from more models (up to ${maxModels})\n` +
            `- Focused questions may only need 2-3 models\n` +
            `- Avoid picking models that would give nearly identical responses\n` +
            `- ONLY output valid JSON, no other text\n\n` +
            `Respond with ONLY: {"selected":["id1","id2",...],"reason":"one short sentence"}`,
        }],
        responseFormat: { type: 'json_object' },
      });
      const cleaned = result.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned || '{}');
      const candidates = (parsed.selected || []).filter(id => availableModelIds.includes(id));
      if (candidates.length >= MIN_MODELS_TO_SELECT) {
        selectedModelIds = candidates.slice(0, maxModels);
        reason = parsed.reason || `AI-selected for ${questionType} question`;
      }
    } catch { /* fall through to affinity scoring */ }
  }

  // ── Step 4: Affinity-score fallback (if LLM selection failed) ─
  if (selectedModelIds.length < MIN_MODELS_TO_SELECT) {
    for (const modelId of availableModelIds) {
      const modelName = Object.entries(MODEL_NAME_TO_ID).find(([, id]) => id === modelId)?.[0];
      const perf = modelName ? perfData[modelName] : null;
      const prior = ROLE_AFFINITY[modelId] || { [questionType]: 7 };
      if (perf && perf.sample_count >= MIN_SAMPLES_FOR_DATA) {
        scores[modelId] = (perf.avg_score * 0.7) + ((prior[questionType] || 7) * 0.3);
        hasRealData = true;
      } else {
        scores[modelId] = prior[questionType] || 7;
      }
    }
    const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
    if (sorted.length > 0) {
      const topScore = sorted[0][1];
      for (const [id, score] of sorted) {
        if (selectedModelIds.length < MIN_MODELS_TO_SELECT ||
            (selectedModelIds.length < maxModels && topScore - score <= 1.0)) {
          selectedModelIds.push(id);
        }
      }
    } else {
      selectedModelIds = availableModelIds.slice(0, maxModels);
    }
    reason = hasRealData
      ? `Performance data (${questionType}): top ${selectedModelIds.length} models`
      : `Role affinity for "${questionType}"`;
  }

  return respond({
    questionType,
    selectedModelIds,
    confidence: Math.round(classifyConfidence),
    reason,
    allScores: scores,
    hasRealData,
  });
};

function respond(b) { return { statusCode: 200, headers: CORS, body: JSON.stringify(b) }; }
