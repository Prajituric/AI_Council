#!/usr/bin/env node
/* ================================================================
   benchmark.js  —  AI Council Personal Benchmark Tournament (#9)

   Usage:
     node scripts/benchmark.js

   What it does:
     1. Sends 30 diverse test questions to ALL configured models
     2. Has Claude score each response blind (no model names shown)
     3. Writes results to the model_performance Supabase table
     4. Prints a leaderboard at the end

   Requirements:
     Set these env vars before running:
       ANTHROPIC_API_KEY    — for Claude scoring
       OPENAI_API_KEY       — for GPT models
       GEMINI_API_KEY       — for Gemini
       DEEPSEEK_API_KEY     — for DeepSeek
       XAI_API_KEY          — for Grok
       GROQ_API_KEY         — for Llama/Groq
       MISTRAL_API_KEY      — for Mistral
       SUPABASE_URL         — Supabase project URL
       SUPABASE_SERVICE_KEY — Supabase service role key

   Add your own questions by editing BENCHMARK_QUESTIONS below.
   ================================================================ */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_KEY required'); process.exit(1); }
if (!ANTHROPIC_KEY) { console.error('❌ ANTHROPIC_API_KEY required for blind scoring'); process.exit(1); }

// ── Model definitions ─────────────────────────────────────────
const MODELS = [
  { id: 'claude',     name: 'Claude Sonnet 4',  provider: 'anthropic', model: 'claude-sonnet-4-20250514', key: process.env.ANTHROPIC_API_KEY,  base: null },
  { id: 'gpt4o',      name: 'GPT-4o',           provider: 'openai',    model: 'gpt-4o',                   key: process.env.OPENAI_API_KEY,     base: 'https://api.openai.com' },
  { id: 'gpt4o-mini', name: 'GPT-4o Mini',      provider: 'openai',    model: 'gpt-4o-mini',              key: process.env.OPENAI_API_KEY,     base: 'https://api.openai.com' },
  { id: 'gemini',     name: 'Gemini 2.0 Flash', provider: 'google',    model: 'gemini-2.0-flash',         key: process.env.GEMINI_API_KEY,     base: null },
  { id: 'deepseek',   name: 'DeepSeek V3',      provider: 'deepseek',  model: 'deepseek-chat',            key: process.env.DEEPSEEK_API_KEY,   base: 'https://api.deepseek.com' },
  { id: 'grok',       name: 'Grok 3 Fast',      provider: 'xai',       model: 'grok-3-fast',              key: process.env.XAI_API_KEY,        base: 'https://api.x.ai' },
  { id: 'groq-llama', name: 'Llama 3.3 (Groq)', provider: 'groq',      model: 'llama-3.3-70b-versatile',  key: process.env.GROQ_API_KEY,       base: 'https://api.groq.com/openai' },
  { id: 'mistral',    name: 'Mistral Large',     provider: 'mistral',   model: 'mistral-large-latest',     key: process.env.MISTRAL_API_KEY,    base: 'https://api.mistral.ai' },
].filter(m => m.key);

// ── Benchmark questions (30 diverse questions) ────────────────
// Edit freely — these should represent your real use cases.
const BENCHMARK_QUESTIONS = [
  // code (5)
  { q: 'Write a Python function that finds the two numbers in a list that sum closest to a target value.', type: 'code' },
  { q: 'Explain the difference between async/await and Promise chains in JavaScript with concrete examples.', type: 'code' },
  { q: 'How would you design a rate limiter for a REST API that handles 10,000 requests per second?', type: 'code' },
  { q: 'What is the time complexity of quicksort and when would you use heapsort instead?', type: 'code' },
  { q: 'Write a SQL query to find the top 5 customers by revenue for each country, using window functions.', type: 'code' },

  // research (5)
  { q: 'What does the latest research say about the long-term effects of ultra-processed food on gut microbiome?', type: 'research' },
  { q: 'What are the most well-supported interventions for improving sleep quality in adults over 40?', type: 'research' },
  { q: 'How does the evidence on intermittent fasting compare to caloric restriction for weight loss?', type: 'research' },
  { q: 'What do we know about the mechanisms behind why some people are more resilient to stress than others?', type: 'research' },
  { q: 'What is the current scientific consensus on optimal protein intake for muscle synthesis?', type: 'research' },

  // creative (4)
  { q: 'Write an opening paragraph for a thriller novel where the protagonist discovers their memory has been altered.', type: 'creative' },
  { q: 'Create a product name and one-line tagline for a meditation app targeting burned-out tech workers.', type: 'creative' },
  { q: 'Write a short poem (8 lines) about the feeling of reading a great book for the first time.', type: 'creative' },
  { q: 'Draft a cold email to a potential investor for an AI startup — under 150 words, specific hook.', type: 'creative' },

  // analysis (6)
  { q: 'What are the most significant second-order effects of widespread autonomous vehicle adoption?', type: 'analysis' },
  { q: 'Analyze the key reasons why most consumer hardware startups fail within 3 years of launch.', type: 'analysis' },
  { q: 'What are the strongest arguments for and against a 4-day work week from an employer perspective?', type: 'analysis' },
  { q: 'If you had to identify the single most underrated competitive moat for a SaaS startup, what would it be and why?', type: 'analysis' },
  { q: 'What separates good product managers from great ones? Be specific, not generic.', type: 'analysis' },
  { q: 'Why do most corporate innovation initiatives fail, and what would actually make them work?', type: 'analysis' },

  // math (5)
  { q: 'Explain intuitively why the sum of the first n odd numbers equals n squared.', type: 'math' },
  { q: 'If a disease has a 1% base rate and a test is 95% sensitive and 90% specific, what is P(disease | positive test)?', type: 'math' },
  { q: 'What is the intuition behind the birthday paradox and at what group size does the probability of a shared birthday exceed 50%?', type: 'math' },
  { q: 'Explain the Monty Hall problem and why most people\'s intuition is wrong.', type: 'math' },
  { q: 'Walk me through compound interest vs. simple interest with a concrete example over 20 years at 8%.', type: 'math' },

  // other (5)
  { q: 'What are three questions I should ask a potential business partner before signing anything?', type: 'other' },
  { q: 'How would you structure a 30-60-90 day plan for a new VP of Engineering joining a 50-person startup?', type: 'other' },
  { q: 'What are the most common cognitive biases that affect technical decision-making?', type: 'other' },
  { q: 'Explain Wardley mapping to a product manager who has never heard of it.', type: 'other' },
  { q: 'What are the most important things to get right in the first 90 days of a new job?', type: 'other' },
];

// ── Helper: call a model ──────────────────────────────────────
async function callModel(model, question) {
  const timeout = 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    if (model.provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': model.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: model.model, max_tokens: 800, messages: [{ role: 'user', content: question }] }),
      });
      const d = await res.json();
      return d.content?.map(c => c.text || '').join('') || null;
    }

    if (model.provider === 'google') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model.model}:generateContent?key=${model.key}`,
        {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: question }] }], generationConfig: { maxOutputTokens: 800 } }),
        }
      );
      const d = await res.json();
      return d.candidates?.[0]?.content?.parts?.[0]?.text || null;
    }

    // OpenAI-compatible
    const res = await fetch(`${model.base}/v1/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${model.key}` },
      body: JSON.stringify({ model: model.model, max_tokens: 800, messages: [{ role: 'user', content: question }] }),
    });
    const d = await res.json();
    return d.choices?.[0]?.message?.content || null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Helper: blind-score responses with Claude ─────────────────
async function scoreBlind(question, responses) {
  // Shuffle so ordering doesn't bias Claude
  const shuffled = [...responses].sort(() => Math.random() - 0.5);
  const labels = shuffled.map((_, i) => `Response ${String.fromCharCode(65 + i)}`);

  const prompt = `You are scoring AI responses to a question. Evaluate each response on a 1-10 scale for:
- Accuracy and correctness
- Completeness and depth
- Clarity and communication
- Practical usefulness

Question: "${question}"

${shuffled.map((r, i) => `## ${labels[i]}\n${(r.text || '').slice(0, 1000)}`).join('\n\n---\n\n')}

Respond with ONLY valid JSON: {"scores": {"Response A": score, "Response B": score, ...}}
Score 1-10, integer only.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const d = await res.json();
    const text = d.content?.map(c => c.text || '').join('') || '{}';
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
    const labelScores = parsed.scores || {};

    // Map labels back to model IDs
    const result = {};
    shuffled.forEach((r, i) => {
      result[r.modelId] = labelScores[labels[i]] || null;
    });
    return result;
  } catch { return {}; }
}

// ── Write results to model_performance ───────────────────────
async function writePerformance(modelName, questionType, score) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/model_performance?model_name=eq.${encodeURIComponent(modelName)}&question_type=eq.${encodeURIComponent(questionType)}&select=avg_score,sample_count`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const rows = await res.json().catch(() => []);
  const cur = rows?.[0];
  const newCount = (cur?.sample_count || 0) + 1;
  const newAvg = cur ? ((cur.avg_score * cur.sample_count) + score) / newCount : score;

  await fetch(`${SUPABASE_URL}/rest/v1/model_performance`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      model_name: modelName, question_type: questionType,
      avg_score: Math.round(newAvg * 100) / 100, sample_count: newCount,
      updated_at: new Date().toISOString(),
    }),
  });
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log(`\n🏆 AI Council Benchmark Tournament`);
  console.log(`   Models: ${MODELS.map(m => m.name).join(', ')}`);
  console.log(`   Questions: ${BENCHMARK_QUESTIONS.length}\n`);

  if (MODELS.length < 2) {
    console.error('❌ At least 2 models with API keys required');
    process.exit(1);
  }

  const scores = {}; // { modelId: { type: [scores] } }
  for (const m of MODELS) scores[m.id] = {};

  for (let qi = 0; qi < BENCHMARK_QUESTIONS.length; qi++) {
    const { q, type } = BENCHMARK_QUESTIONS[qi];
    process.stdout.write(`\nQ${qi + 1}/${BENCHMARK_QUESTIONS.length} [${type}] ${q.slice(0, 60)}...\n`);

    // Call all models in parallel
    const responses = await Promise.all(MODELS.map(async (m) => {
      process.stdout.write(`  ↳ ${m.name}...`);
      const text = await callModel(m, q);
      process.stdout.write(text ? ' ✓\n' : ' ✗\n');
      return { modelId: m.id, name: m.name, text };
    }));

    const validResponses = responses.filter(r => r.text);
    if (validResponses.length < 2) { console.log('  ⚠ Too few responses, skipping scoring'); continue; }

    // Blind scoring
    process.stdout.write('  ↳ Scoring blindly with Claude...');
    const roundScores = await scoreBlind(q, validResponses);
    process.stdout.write(' ✓\n');

    // Accumulate scores
    for (const [modelId, score] of Object.entries(roundScores)) {
      if (score === null) continue;
      if (!scores[modelId][type]) scores[modelId][type] = [];
      scores[modelId][type].push(score);
      process.stdout.write(`    ${MODELS.find(m => m.id === modelId)?.name}: ${score}/10\n`);
    }

    // Small delay between questions
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Write results to Supabase ─────────────────────────────
  console.log('\n📊 Writing results to model_performance...');
  for (const model of MODELS) {
    for (const [qType, typeScores] of Object.entries(scores[model.id])) {
      if (!typeScores.length) continue;
      const avg = typeScores.reduce((a, b) => a + b, 0) / typeScores.length;
      await writePerformance(model.name, qType, avg);
      console.log(`  ${model.name} / ${qType}: ${avg.toFixed(1)}/10 (${typeScores.length} samples)`);
    }
  }

  // ── Print leaderboard ─────────────────────────────────────
  console.log('\n🏆 LEADERBOARD\n' + '─'.repeat(60));
  const types = [...new Set(BENCHMARK_QUESTIONS.map(q => q.type))];
  for (const type of types) {
    console.log(`\n${type.toUpperCase()}:`);
    const ranked = MODELS.map(m => {
      const typeScores = scores[m.id][type] || [];
      const avg = typeScores.length ? typeScores.reduce((a, b) => a + b, 0) / typeScores.length : 0;
      return { name: m.name, avg, count: typeScores.length };
    }).sort((a, b) => b.avg - a.avg);
    ranked.forEach((r, i) => {
      if (r.count > 0) console.log(`  ${i + 1}. ${r.name}: ${r.avg.toFixed(1)}/10 (${r.count} samples)`);
    });
  }

  // Overall
  console.log('\nOVERALL:');
  const overall = MODELS.map(m => {
    const allScores = Object.values(scores[m.id]).flat();
    const avg = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
    return { name: m.name, avg, count: allScores.length };
  }).sort((a, b) => b.avg - a.avg);
  overall.forEach((r, i) => {
    if (r.count > 0) console.log(`  ${i + 1}. ${r.name}: ${r.avg.toFixed(1)}/10 (${r.count} total)`);
  });

  console.log('\n✅ Tournament complete. Results written to model_performance table.\n');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
