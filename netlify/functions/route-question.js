/* ================================================================
   route-question.js  —  Smart question routing (#8)
   Fast Groq call classifies question type, then queries
   model_performance to select top models for that type.

   POST /api/route-question
   Body: { question, availableModelIds }
   Returns: {
     questionType,        // 'code'|'research'|'creative'|'analysis'|'math'|'other'
     selectedModelIds,    // top 2-3 model IDs to use (or all if no data)
     confidence,          // 0-100 routing confidence
     reason,              // human-readable explanation
     allScores,           // { modelId: avgScore } for available models
   }
   ================================================================ */
const { requireAuth } = require('./_auth-check');

const ORIGIN = process.env.URL || '*';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const QUESTION_TYPES = ['code', 'research', 'creative', 'analysis', 'math', 'other'];

// Model name → model ID mapping (must match CATALOG in app.js)
const MODEL_NAME_TO_ID = {
  'Claude Sonnet 4':  'claude',
  'GPT-4o':           'gpt4o',
  'GPT-4o Mini':      'gpt4o-mini',
  'Gemini 2.0 Flash': 'gemini',
  'DeepSeek V3':      'deepseek',
  'Grok 3 Fast':      'grok',
  'Llama 3.3 (Groq)': 'groq-llama',
  'Mistral Large':    'mistral',
};

// Default role-based affinity scores (used when no performance data exists)
// These are reasonable priors based on each model's known strengths.
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
const MAX_MODELS_TO_SELECT = 3;
const MIN_SAMPLES_FOR_DATA = 3; // minimum sample_count to trust performance data

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '{}' };

  if (!requireAuth(event)) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: '{}' }; }

  const { question, availableModelIds = [] } = body;
  if (!question) return respond({ error: 'Missing question' });

  const groqKey = process.env.GROQ_API_KEY;
  const sbUrl   = process.env.SUPABASE_URL;
  const sbKey   = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  // ── Step 1: Classify question type with Groq ─────────────────
  let questionType = 'other';
  let classifyConfidence = 60;

  if (groqKey) {
    try {
      const classifyRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 60,
          temperature: 0,
          messages: [{
            role: 'user',
            content:
              `Classify this question into exactly one category: code, research, creative, analysis, math, other.\n` +
              `Also give confidence 0-100.\n` +
              `Question: "${question.slice(0, 400)}"\n` +
              `Respond with ONLY JSON: {"type":"<category>","confidence":<number>}`,
          }],
          response_format: { type: 'json_object' },
        }),
      });
      const classData = await classifyRes.json();
      const parsed = JSON.parse(classData.choices?.[0]?.message?.content || '{}');
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

  // ── Step 3: Score each available model ───────────────────────
  const scores = {};
  let hasRealData = false;

  for (const modelId of availableModelIds) {
    // Find model name from ID mapping (reverse lookup)
    const modelName = Object.entries(MODEL_NAME_TO_ID).find(([, id]) => id === modelId)?.[0];
    const perf = modelName ? perfData[modelName] : null;
    const prior = ROLE_AFFINITY[modelId] || { [questionType]: 7 };

    if (perf && perf.sample_count >= MIN_SAMPLES_FOR_DATA) {
      // Weight: 70% real performance data, 30% role affinity prior
      scores[modelId] = (perf.avg_score * 0.7) + ((prior[questionType] || 7) * 0.3);
      hasRealData = true;
    } else {
      // Pure prior — role affinity
      scores[modelId] = prior[questionType] || 7;
    }
  }

  // ── Step 4: Select top models ─────────────────────────────────
  const sorted = Object.entries(scores)
    .sort(([, a], [, b]) => b - a);

  // Always include at least MIN_MODELS_TO_SELECT, up to MAX_MODELS_TO_SELECT
  // Include models within 1.0 score of the top scorer (up to max)
  let selectedModelIds = [];
  if (sorted.length > 0) {
    const topScore = sorted[0][1];
    for (const [id, score] of sorted) {
      if (selectedModelIds.length < MIN_MODELS_TO_SELECT ||
          (selectedModelIds.length < MAX_MODELS_TO_SELECT && topScore - score <= 1.0)) {
        selectedModelIds.push(id);
      }
    }
  } else {
    selectedModelIds = availableModelIds.slice(0, MAX_MODELS_TO_SELECT);
  }

  const reason = hasRealData
    ? `Performance data (${questionType}): routing to top ${selectedModelIds.length} models`
    : `No performance data yet for "${questionType}" — using role affinity priors`;

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
