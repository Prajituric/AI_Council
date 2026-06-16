/* ================================================================
   evaluate.js  —  Quality Evaluator + Best Response Selector
   Called after synthesis is ready.
   Evaluates all council responses, picks best elements, produces
   an optimized final answer better than any single model.
   ================================================================ */
const { resolveModels } = require('./_resolve-models');
const { callOpenRouter } = require('./_openrouter');
const ORIGIN = process.env.URL || '*';
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const { requireAuth } = require('./_auth-check');

const EVALUATOR_SYSTEM = `You are an elite AI response evaluator and optimizer. Your job:

1. Evaluate the synthesis against the original question
2. Compare against all individual model responses
3. Identify strongest elements from each
4. Produce the BEST POSSIBLE final answer

Your output (strict Markdown):

## 📊 Evaluation
Brief assessment (2-3 sentences).

**Accuracy:** [1-10] — [note]
**Relevance:** [1-10] — [note]
**Completeness:** [1-10] — [note]
**Clarity:** [1-10] — [note]
**Overall Score:** [avg]/10

## 🏆 Strongest Model
[Which model gave the most valuable contribution and why - one sentence]

## ✨ Optimized Final Answer
[The best possible answer - synthesizing and improving ALL responses. More accurate, more complete, better structured than the original synthesis. THIS is what the user should use.]`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '{}' };

  if (!requireAuth(event)) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: '{}' }; }

  const { question, synthesis, responses, skillContext } = body;
  const key = process.env.OPENROUTER_API_KEY || '';
  const models = await resolveModels();

  if (!key)               return respond({ error: 'OPENROUTER_API_KEY required for evaluation' });
  if (!synthesis)         return respond({ error: 'Missing synthesis' });
  if (!responses?.length) return respond({ error: 'Missing model responses' });

  const responseSummary = responses
    .map(r => `### ${r.name} (${r.role})\n${r.text}`)
    .join('\n\n---\n\n');

  const skillNote = skillContext
    ? `\n\n**Active Skill:** ${skillContext.name} — ${skillContext.prompt?.slice(0, 150)}...`
    : '';

  const userMsg = `**Question:** "${question}"${skillNote}

**Individual Responses:**
${responseSummary}

**Current Synthesis:**
${synthesis}

Evaluate and produce the optimized answer.`;

  try {
    const result = await callOpenRouter({
      apiKey: key,
      model: models.sonnet,
      maxTokens: 3000,
      system: EVALUATOR_SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    });
    const text = result.text;
    const scoreMatch = text.match(/Overall Score:\s*([0-9.]+)\s*\/\s*10/i);
    return respond({ evaluation: text, score: scoreMatch ? parseFloat(scoreMatch[1]) : null });
  } catch (e) {
    return respond({ error: e.message });
  }
};

function respond(b) { return { statusCode: 200, headers: CORS, body: JSON.stringify(b) }; }
