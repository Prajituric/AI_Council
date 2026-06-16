/* ================================================================
   config.js  —  Serves public configuration to frontend
   Called once on boot — frontend knows what's available
   Resolves best available model versions via OpenRouter's catalog.
   ================================================================ */
const { resolveModels } = require('./_resolve-models');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.URL || '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async () => {
  const models = await resolveModels();
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;

  return {
    statusCode: 200, headers: CORS,
    body: JSON.stringify({
      // Single unified provider — every model call routes through OpenRouter now.
      providers: {
        openrouter: hasOpenRouter,
        // Legacy per-vendor flags kept (all mirror the single OpenRouter key) so any
        // older client code/cache that still reads these doesn't silently break.
        anthropic: hasOpenRouter,
        openai:    hasOpenRouter,
        google:    hasOpenRouter,
        deepseek:  hasOpenRouter,
        xai:       hasOpenRouter,
        groq:      hasOpenRouter,
        mistral:   hasOpenRouter,
        together:  hasOpenRouter,
      },
      supabase: {
        url:     process.env.SUPABASE_URL     || '',
        anonKey: process.env.SUPABASE_ANON_KEY || '',
        ok:      !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
      },
      r2: {
        ok:      !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID),
        hasPublicUrl: !!process.env.R2_PUBLIC_URL,
      },
      maxFileSizeMB: process.env.R2_ACCOUNT_ID ? 500 : 4,
      enableEvaluation: process.env.ENABLE_EVALUATION === 'true',
      githubToken: !!process.env.GITHUB_TOKEN,
      // Dynamically resolved model versions — client uses these to keep
      // the council catalog and synthesizer references always up to date
      resolvedModels: models,
    }),
  };
};
