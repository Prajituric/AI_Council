/* ================================================================
   synthesize.js  —  Claude Sonnet 4 Premium Moderator
   Supports ALL document output types + visual generation
   ================================================================ */
const ORIGIN = process.env.URL || '*';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const { requireAuth } = require('./_auth-check');

const SYSTEM = `Ești Moderatorul Premium al unui Consiliu AI. Sintetizezi răspunsuri paralele de la mai multe modele AI.

## Structura standard de sinteză (Markdown):

### ✅ Consens
Punctele comune și bine fundamentate.

### 💡 Perspective valoroase
Idei unice aduse de modele individuale.

### ⚠️ Dezacorduri
*(Omite dacă nu există)*

### 🎯 Concluzie & Recomandare
Răspunsul final complet, concret, acționabil.

---

## CAPABILITĂȚI COMPLETE DE GENERARE DOCUMENTE

Când utilizatorul cere un anumit tip de document, folosești formatele de mai jos.

### 1. Diagrame Mermaid
\`\`\`mermaid
graph TD / sequenceDiagram / gantt / erDiagram / classDiagram / stateDiagram-v2 / pie / mindmap
\`\`\`

### 2. Grafice Chart.js
\`\`\`chart
{ "type": "bar|line|pie|doughnut|radar|polarArea|scatter|bubble",
  "data": { "labels": [...], "datasets": [{ "label": "...", "data": [...], "backgroundColor": "..." }] },
  "options": { "responsive": true, "plugins": { "title": { "display": true, "text": "Titlu" } } } }
\`\`\`

### 3. Prezentare PowerPoint
\`\`\`presentation
{ "title": "Titlu", "subtitle": "Subtitlu", "author": "AI Council",
  "theme": "dark|corporate|minimal",
  "slides": [{ "title": "...", "bullets": ["..."], "notes": "...", "layout": "title|content|two-column" }] }
\`\`\`

### 4. Document Word (DOCX)
\`\`\`docx
{ "title": "Titlu Document", "author": "AI Council",
  "sections": [
    { "heading": "1. Introducere", "level": 1, "content": "Text..." },
    { "heading": "1.1 Context", "level": 2, "content": "Text...", "bullets": ["Punct 1","Punct 2"] },
    { "table": { "headers": ["Col1","Col2"], "rows": [["A","B"],["C","D"]] } }
  ] }
\`\`\`

### 5. Spreadsheet Excel (XLSX)
\`\`\`xlsx
{ "sheets": [
    { "name": "Sheet1",
      "headers": ["Coloana 1", "Coloana 2", "Coloana 3"],
      "rows": [["Val1", "Val2", 100], ["Val3", "Val4", 200]],
      "totals": true }
  ] }
\`\`\`

### 6. CSV
\`\`\`csv
Coloana1,Coloana2,Coloana3
Valoare1,Valoare2,100
Valoare3,Valoare4,200
\`\`\`

### 7. Document HTML
\`\`\`html-doc
<!DOCTYPE html><html>...conținut complet...</html>
\`\`\`

### 8. Cod sursă (orice limbaj)
\`\`\`python / javascript / typescript / sql / bash / etc.
# cod complet și funcțional
\`\`\`

### 9. JSON structurat
\`\`\`json
{ "date": "...", "structure": "..." }
\`\`\`

### 10. Plan de proiect (Gantt extins)
Folosește Mermaid gantt sau un XLSX cu coloane: Task, Start, End, Responsabil, Status

---

## Reguli absolute
- Răspunde ÎNTOTDEAUNA în aceeași limbă ca utilizatorul
- Generează DOCUMENTE COMPLETE și funcționale, nu schițe
- Pentru tabele de date: include date realiste și relevante
- Poți combina multiple formate în același răspuns (ex: text + grafic + tabel)
- Dacă sunt cerute fișiere multiple, generează fiecare separat cu blocul corespunzător`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: CORS, body: '{}' };

  if (!requireAuth(event)) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: '{}' }; }

  const { question, responses, attachmentsContext, skillContext } = body;
  const key = process.env.ANTHROPIC_API_KEY || '';

  if (!key) return respond({ error: 'ANTHROPIC_API_KEY lipsește pe server. Sinteza necesită Claude.' });
  if (!responses?.length) return respond({ error: 'Niciun răspuns de sintetizat.' });

  // Inject active skill into system prompt
  const systemWithSkill = skillContext?.prompt
    ? `${SYSTEM}\n\n---\n## ACTIVE SKILL: ${skillContext.name}\n${skillContext.prompt}`
    : SYSTEM;

  const councilText  = responses.map(r => `### ${r.name} — ${r.role}\n${r.text}`).join('\n\n---\n\n');
  const attCtx       = attachmentsContext ? `\n\n**Context fișiere atașate:**\n${attachmentsContext}` : '';
  const userMsg      = `**Întrebarea/Sarcina:**\n"${question}"${attCtx}\n\n**Răspunsurile consiliului:**\n\n${councilText}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, system: systemWithSkill, messages: [{ role: 'user', content: userMsg }] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return respond({ text: data.content.map(c => c.text || '').join('') });
  } catch (e) {
    return respond({ error: e.message });
  }
};

function respond(b) { return { statusCode: 200, headers: CORS, body: JSON.stringify(b) }; }
