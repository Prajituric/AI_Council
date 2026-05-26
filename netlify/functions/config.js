/* ================================================================
   config.js  —  Serves public configuration to frontend
   Called once on boot — frontend knows what's available
   ================================================================ */
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.URL || '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async () => ({
  statusCode: 200, headers: CORS,
  body: JSON.stringify({
    providers: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai:    !!process.env.OPENAI_API_KEY,
      google:    !!process.env.GEMINI_API_KEY,
      deepseek:  !!process.env.DEEPSEEK_API_KEY,
      xai:       !!process.env.XAI_API_KEY,
      groq:      !!process.env.GROQ_API_KEY,
      mistral:   !!process.env.MISTRAL_API_KEY,
      together:  !!process.env.TOGETHER_API_KEY,
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
  }),
});
