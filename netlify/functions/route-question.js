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

// Model descriptions — used by the LLM selector to understand each model's strengths
const MODEL_DESCRIPTIONS = {
  'claude':     'Claude Opus 4.6 — exceptional deep reasoning, synthesis, nuanced writing, complex multi-step analysis',
  'gpt4o':      'GPT-4o — strong at coding, structured problem-solving, vision/multimodal tasks, broad world knowledge',
  'gpt4o-mini': 'GPT-4o Mini — fast and cost-effective for straightforward questions, light tasks',
  'gemini':     'Gemini 2.0 Flash — excellent for research, science, factual accuracy, technical documentation',
  'deepseek':   'DeepSeek V3 — top-tier mathematics, algorithms, code optimization, logical/formal reasoning',
  'grok':       'Grok 3 — real-time web knowledge, current events, creative writing, pop culture',
  'groq-llama': 'Llama 3.3 (Groq) — ultra-fast responses, general Q&A, conversational tasks',
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

  // ── Step 3: LLM-based intelligent model selection ────────────
  // Ask Groq (fast + cheap) to read the actual question and pick the
  // best 2-3 models based on their specific strengths and the question content.
  // Falls back to affinity-score heuristic if Groq is unavailable.
  let selectedModelIds = [];
  let reason = '';
  let hasRealData = false;

  const modelList = availableModelIds
    .map(id => `- ${id}: ${MODEL_DESCRIPTIONS[id] || id}`)
    .join('\n');

  if (groqKey && availableModelIds.length > 2) {
    try {
      const selectorRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 120,
          temperature: 0.1,
          messages: [{
            role: 'user',
            content:
              `You are a router for a multi-model AI system. Select the best 2-3 models for this specific question.\n\n` +
              `Question: "${question.slice(0, 500)}"\n` +
              `Question type: ${questionType}\n\n` +
              `Available models:\n${modelList}\n\n` +
              `Rules:\n` +
              `- Pick 2-3 models that would give the most VALUABLE and DIVERSE perspectives\n` +
              `- Prefer models with a clear strength advantage for this question's domain\n` +
              `- Avoid picking models that would give nearly identical responses\n` +
              `- ONLY output valid JSON, no other text\n\n` +
              `Respond with ONLY: {"selected":["id1","id2"],"reason":"one short sentence"}`,
          }],
          response_format: { type: 'json_object' },
        }),
      });
      const selData = await selectorRes.json();
      const parsed = JSON.parse(selData.choices?.[0]?.message?.content || '{}');
      const candidates = (parsed.selected || []).filter(id => availableModelIds.includes(id));
      if (candidates.length >= MIN_MODELS_TO_SELECT) {
        selectedModelIds = candidates.slice(0, MAX_MODELS_TO_SELECT);
        reason = parsed.reason || `AI-selected for ${questionType} question`;
      }
    } catch { /* fall through to affinity scoring */ }
  }

  // ── Step 4: Affinity-score fallback (if LLM selection failed) ─
  if (selectedModelIds.length < MIN_MODELS_TO_SELECT) {
    const scores = {};
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
            (selectedModelIds.length < MAX_MODELS_TO_SELECT && topScore - score <= 1.0)) {
          selectedModelIds.push(id);
        }
      }
    } else {
      selectedModelIds = availableModelIds.slice(0, MAX_MODELS_TO_SELECT);
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
