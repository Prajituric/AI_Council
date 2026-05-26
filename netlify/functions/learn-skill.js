/* ================================================================
   learn-skill.js  —  Auto-learn a skill from external repos/docs
   POST /api/learn-skill { topic, urls? }
   Crawls GitHub topics + README files, synthesizes a skill prompt
   ================================================================ */
const ORIGIN = process.env.URL || '*';
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const { requireAuth } = require('./_auth-check');

const MAX_CONTENT_CHARS = 24000; // ~6k tokens for context
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '{}' };

  if (!requireAuth(event)) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: '{}' }; }

  const { topic, urls } = body;
  if (!topic) return respond({ error: 'Missing topic' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return respond({ error: 'ANTHROPIC_API_KEY required for skill synthesis' });

  try {
    // 1. Gather knowledge from multiple sources
    const sources = [];

    // GitHub search for repos related to the topic
    const ghRepos = await searchGitHub(topic);
    sources.push(...ghRepos);

    // Fetch READMEs from top repos
    const readmes = await fetchReadmes(ghRepos.slice(0, 3), topic);
    sources.push(...readmes);

    // Fetch any user-provided URLs
    if (urls?.length) {
      for (const url of urls.slice(0, 3)) {
        const content = await fetchUrl(url);
        if (content) sources.push({ source: url, content });
      }
    }

    // 2. Combine gathered content
    const combinedContent = sources
      .filter(s => s.content)
      .map(s => `--- Source: ${s.source} ---\n${s.content}`)
      .join('\n\n')
      .slice(0, MAX_CONTENT_CHARS);

    if (!combinedContent.trim()) {
      return respond({ error: `Could not find useful content for topic: ${topic}` });
    }

    // 3. Use Claude to synthesize a skill system prompt from the gathered knowledge
    const synthesizedPrompt = await synthesizeSkill(key, topic, combinedContent);

    const skill = {
      id: slugify(topic),
      name: titleCase(topic),
      icon: 'ti-brain',
      description: `Auto-learned skill for: ${topic}`,
      dynamic: false,
      learned: true,
      learnedAt: new Date().toISOString(),
      sources: sources.map(s => s.source).slice(0, 10),
      systemPrompt: synthesizedPrompt,
    };

    return respond({ skill, sourcesUsed: sources.length });
  } catch (e) {
    return respond({ error: e.message });
  }
};

// ── GitHub search ─────────────────────────────────────────────
async function searchGitHub(topic) {
  const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'AI-Council' };
  if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;

  const results = [];
  try {
    const q = encodeURIComponent(`${topic} in:name,description,readme`);
    const res = await fetch(`https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=5`, { headers });
    if (res.ok) {
      const data = await res.json();
      (data.items || []).forEach(repo => {
        results.push({
          source: repo.html_url,
          content: `Repository: ${repo.full_name}\nDescription: ${repo.description || ''}\nStars: ${repo.stargazers_count}\nLanguage: ${repo.language || 'N/A'}`,
        });
      });
    }
  } catch {}
  return results;
}

// ── Fetch READMEs from top repos ──────────────────────────────
async function fetchReadmes(repos, topic) {
  const results = [];
  for (const repo of repos) {
    try {
      // Extract owner/repo from HTML URL
      const match = repo.source.match(/github\.com\/([^/]+\/[^/]+)/);
      if (!match) continue;
      const repoPath = match[1];
      const headers = { 'Accept': 'application/vnd.github.v3.raw', 'User-Agent': 'AI-Council' };
      if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;

      const res = await fetch(`https://api.github.com/repos/${repoPath}/readme`, { headers });
      if (res.ok) {
        const text = await res.text();
        results.push({
          source: `${repo.source}/README`,
          content: text.slice(0, 4000), // truncate per README
        });
      }
    } catch {}
  }
  return results;
}

// ── Generic URL fetch ─────────────────────────────────────────
async function fetchUrl(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AI-Council/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    // Strip HTML tags for readability
    return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
  } catch { return null; }
}

// ── Claude synthesizes the skill prompt ──────────────────────
async function synthesizeSkill(key, topic, content) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: `Based on the following gathered information about "${topic}", create a comprehensive system prompt that will make an AI assistant an expert in this topic.

The system prompt should:
1. Define the AI's expert persona for this topic
2. List the key knowledge areas and terminology it should master
3. Specify how it should structure responses (formats, depth, examples)
4. Include domain-specific best practices
5. Be 200-400 words, professional, and immediately usable

Gathered information:
${content}

Return ONLY the system prompt text, no preamble or explanation.`,
      }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Synthesis failed');
  return data.content.map(c => c.text || '').join('');
}

// ── Utils ─────────────────────────────────────────────────────
function slugify(str) { return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
function titleCase(str) { return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '); }
function respond(b) { return { statusCode: 200, headers: CORS, body: JSON.stringify(b) }; }
