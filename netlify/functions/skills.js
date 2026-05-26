/* ================================================================
   skills.js  —  Skills endpoint
   GET  /api/skills          → list all available skills
   POST /api/skills          → add/update a custom skill
   GET  /api/skills?id=xxx   → get single skill (with prompt)
   ================================================================ */
const ORIGIN = process.env.URL || '*';
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Built-in skills (loaded from skills.json in the repo root)
let BUILT_IN = null;
function getBuiltIn() {
  if (BUILT_IN) return BUILT_IN;
  try {
    // In Netlify functions, __dirname is the functions directory
    const fs = require('fs');
    const path = require('path');
    const p = path.join(__dirname, '..', '..', 'skills.json');
    BUILT_IN = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    BUILT_IN = {};
  }
  return BUILT_IN;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const { id } = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    const skills = getBuiltIn();
    if (id) {
      const skill = skills[id];
      if (!skill) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Skill not found' }) };
      return { statusCode: 200, headers: CORS, body: JSON.stringify(skill) };
    }
    // Return list (without full system prompts for brevity)
    const list = Object.values(skills).map(s => ({
      id: s.id, name: s.name, icon: s.icon,
      description: s.description, dynamic: s.dynamic || false,
    }));
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ skills: list }) };
  }

  return { statusCode: 405, headers: CORS, body: '{}' };
};
