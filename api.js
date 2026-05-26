/* ================================================================
   api.js  —  All Netlify function calls: streaming, model calls,
               skills engine, evaluation engine
   Loaded before app.js. References globals (S, AUTH, patchMsg,
   renderSkillBadge, showToast, etc.) available at call-time.
   ================================================================ */

// ── Context window summarization (#2) ────────────────────────
// When a model's conversation history exceeds HISTORY_THRESHOLD
// messages, we summarize the older turns via Groq and inject the
// summary as a system note. This prevents silent truncation at
// model token limits while keeping full conversational context.
const HISTORY_THRESHOLD = 14;  // messages (7 user+assistant pairs) before summarizing
const HISTORY_KEEP_LAST = 8;   // most recent messages always kept verbatim

// Cache: { chatId: { msgCount: N, summary: "..." } }
// Refreshed when message count grows by >4 since last summary.
const _historySummaryCache = {};

async function condenseHistory(chatId, history) {
  if (history.length <= HISTORY_THRESHOLD) return history;

  const older  = history.slice(0, history.length - HISTORY_KEEP_LAST);
  const recent = history.slice(history.length - HISTORY_KEEP_LAST);

  // Use cached summary if chat hasn't grown much since last summarization
  const cached = _historySummaryCache[chatId];
  const msgCount = S.messages.length;
  if (cached && msgCount - cached.msgCount < 4) {
    return [{ role: 'user', content: `[Context from earlier in this conversation]: ${cached.summary}` },
            { role: 'assistant', content: 'Understood, I have the context.' },
            ...recent];
  }

  try {
    const res = await fetch('/api/summarize-history', {
      method: 'POST', headers: AUTH.headers(),
      body: JSON.stringify({ messages: older }),
    });
    if (res.ok) {
      const { summary } = await res.json();
      _historySummaryCache[chatId] = { msgCount, summary };
      return [{ role: 'user', content: `[Context from earlier in this conversation]: ${summary}` },
              { role: 'assistant', content: 'Understood, I have the context.' },
              ...recent];
    }
  } catch { /* fallback: send full history, risk truncation */ }

  return history;
}
async function callModelStreaming(m, payload, onDelta) {
  const res = await fetch('/api/call-model-stream', {
    method: 'POST', headers: AUTH.headers(),
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) throw new Error(`Stream HTTP ${res.status}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.error) throw new Error(evt.error);
        if (evt.done) return text;
        if (evt.delta) { text += evt.delta; onDelta(text); }
      } catch (e) { if (e.message !== 'skip') throw e; }
    }
  }
  return text;
}

// Stream synthesis from /api/synthesize-stream, calling onDelta on each chunk
// Returns: string (normal synthesis) or { clarification: {...} }
async function streamSynthesis(question, responses, attachmentsContext, questionType, webContext, onDelta) {
  const res = await fetch('/api/synthesize-stream', {
    method: 'POST',
    headers: AUTH.headers(),
    body: JSON.stringify({ question, responses, attachmentsContext, skillContext: S.activeSkill || null, questionType, webContext: webContext || null }),
  });
  if (!res.ok || !res.body) throw new Error(`Synthesis HTTP ${res.status}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.error) throw new Error(evt.error);
        if (evt.done) {
          // Check if accumulated text is actually a clarification JSON
          const trimmed = text.trim();
          if (trimmed.startsWith('{"type":"clarification"')) {
            try { return { clarification: JSON.parse(trimmed) }; } catch { /* not JSON */ }
          }
          return text;
        }
        if (evt.delta) { text += evt.delta; onDelta(text); }
      } catch (e) { if (e.message !== 'skip') throw e; }
    }
  }
  return text;
}

// ── Prompt enhancement (#3) ───────────────────────────────────
// Calls /api/enhance-prompt (Groq-backed). Runs in parallel with
// routeQuestion() so it adds near-zero perceived latency.
// Returns { enhanced, changed } — falls back to original on any error.
async function enhancePrompt(prompt) {
  if (!S.cfg.enhancePrompts) return { enhanced: prompt, changed: false };
  // Pass last 4 user turns as context for domain-aware rewrites
  const recentHistory = S.messages.slice(-8)
    .map(m => {
      const v = m.variants?.[m.activeVariant] || m.variants?.[0];
      return v?.userText ? { role: 'user', content: v.userText } : null;
    })
    .filter(Boolean)
    .slice(-4);
  try {
    const res = await fetch('/api/enhance-prompt', {
      method: 'POST', headers: AUTH.headers(),
      body: JSON.stringify({ prompt, history: recentHistory }),
    });
    if (!res.ok) return { enhanced: prompt, changed: false };
    return await res.json();
  } catch { return { enhanced: prompt, changed: false }; }
}

// ── Skill auto-suggestion (#47) ───────────────────────────────
// Maps routing question types to keywords found in skill IDs / names.
// If no skill is active and we find a match, we surface a one-click suggestion.
const SKILL_TYPE_KEYWORDS = {
  code:     ['code', 'program', 'dev', 'debug', 'script', 'engineer'],
  math:     ['math', 'calc', 'statistic', 'data', 'quant'],
  research: ['research', 'analys', 'academic', 'source'],
  creative: ['creative', 'writ', 'content', 'story', 'blog', 'copy'],
  analysis: ['analys', 'strateg', 'business', 'consult', 'framework'],
};

function suggestSkillForType(questionType) {
  if (S.activeSkill) return null; // already using a skill
  const keywords = SKILL_TYPE_KEYWORDS[questionType];
  if (!keywords) return null;
  const allSkills = Object.values(S.skills || {});
  for (const skill of allSkills) {
    const haystack = `${skill.id} ${skill.name} ${skill.description || ''}`.toLowerCase();
    if (keywords.some(kw => haystack.includes(kw))) return skill;
  }
  return null;
}

// ── Web search (#63) ──────────────────────────────────────────
// Calls /api/web-search (Groq classifier → Tavily).
// Returns { needsSearch, query, results } or null on any failure.
// Results are formatted into a webContext string that gets prepended
// to every model's history so all models see the same live data.
async function searchWeb(prompt) {
  if (!S.cfg.webSearch) return null;
  try {
    const res = await fetch('/api/web-search', {
      method: 'POST', headers: AUTH.headers(),
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.needsSearch || !data.results?.length) return null;
    return data; // { needsSearch:true, query, results:[{title,url,content}] }
  } catch { return null; }
}

// Builds the flat text block injected into model context + synthesis
function buildWebContextString(results) {
  return results.map((r, i) =>
    `Source ${i + 1}: ${r.title}\nURL: ${r.url}\n${r.content}`
  ).join('\n\n');
}

// ── Smart routing (#8) ─────────────────────────────────────────
async function routeQuestion(question, availableModelIds) {
  if (S.cfg.forceAllModels || !availableModelIds.length) return null;
  try {
    const res = await fetch('/api/route-question', {
      method: 'POST', headers: AUTH.headers(),
      body: JSON.stringify({ question, availableModelIds }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function runModels(msg, prompt, attachments, mkHistory) {
  const v  = msg.variants[msg.activeVariant];
  const allActive = activeModels();

  // ── Vision-aware candidate pool ───────────────────────────────
  // When the user attaches images, exclude models that can't process
  // them (hasVision: false). This pool is used for both routing and
  // the final active model list, so non-vision models never receive
  // image payloads they would silently mishandle.
  const hasImageAttachments = attachments.some(a => a.type?.startsWith('image/'));
  const visionPool = hasImageAttachments ? allActive.filter(m => m.hasVision) : allActive;

  // ── Prompt enhancement + smart routing in parallel ───────────
  // Enhancement rewrites the prompt before models see it.
  // Routing classifies the original prompt (runs simultaneously).
  const shouldEnhance = S.cfg.enhancePrompts && !v.skipEnhancement;
  v.skipEnhancement = false; // consume the flag

  const canRoute = !S.cfg.forceAllModels && visionPool.length > 2;

  // Run enhancement, routing, and web search all in parallel.
  // Web search uses the original prompt for classification (fast Groq step).
  // All three are ~200-800ms; running concurrently adds zero perceived latency.
  const [enhResult, routingResult, searchResult] = await Promise.all([
    shouldEnhance    ? enhancePrompt(prompt)                            : Promise.resolve({ enhanced: prompt, changed: false }),
    canRoute         ? routeQuestion(prompt, visionPool.map(m => m.id)) : Promise.resolve(null),
    S.cfg.webSearch  ? searchWeb(prompt)                                : Promise.resolve(null),
  ]);

  // Build web context string once and reuse across all models
  const webCtx = searchResult?.results?.length ? buildWebContextString(searchResult.results) : null;
  if (searchResult?.needsSearch) {
    v.webSearch = { query: searchResult.query, results: searchResult.results, expanded: false };
  } else {
    v.webSearch = null;
  }

  // effectivePrompt is what every model and the synthesizer receives
  const effectivePrompt = enhResult.enhanced || prompt;
  if (enhResult.changed) {
    v.promptEnhancement = { original: prompt, enhanced: effectivePrompt, expanded: false };
  } else {
    v.promptEnhancement = null;
  }

  let routing = routingResult;
  let am = visionPool; // start from vision-filtered pool, not full allActive
  if (routing?.selectedModelIds?.length) {
    const selected = new Set(routing.selectedModelIds);
    const routed   = visionPool.filter(m => selected.has(m.id));
    if (routed.length >= 2) {
      am = routed;
      v.routing = {
        questionType: routing.questionType,
        selectedNames: routed.map(m => m.name),
        confidence: routing.confidence,
        reason: routing.reason,
        allModelIds: visionPool.map(m => m.id),
      };
      // Skill auto-suggestion: surface a relevant skill if none is active
      const suggested = suggestSkillForType(routing.questionType);
      if (suggested) v.skillSuggestion = { id: suggested.id, name: suggested.name, dismissed: false };
    }
  }

  // Preserve per-card collapsed state across response rebuilds
  const collapseMap = new Map((v.responses || []).map(r => [r.modelId, r.collapsed || false]));
  v.responses = am.map(m=>({modelId:m.id,name:m.name,role:m.role,accent:m.accent,loading:true,text:null,error:null,collapsed:collapseMap.get(m.id)||false}));
  patchMsg(msg);

  // Pre-condense history once (uses first active model as representative — older user turns
  // are identical across all models; only recent assistant turns differ).
  // The condensed prefix is reused for all models; each model's recent turns are appended below.
  const representativeHistory = mkHistory(am[0]?.id || '');
  const needsCondensing = representativeHistory.length > HISTORY_THRESHOLD;
  // Build condensed prefix from the oldest turns (user turns only for summary quality)
  const olderForSummary = needsCondensing
    ? representativeHistory.slice(0, representativeHistory.length - HISTORY_KEEP_LAST)
    : [];
  let summaryPrefix = null; // { role:'user', content:'[Context...]' } pair or null
  if (needsCondensing && olderForSummary.length) {
    try {
      const res = await fetch('/api/summarize-history', {
        method: 'POST', headers: AUTH.headers(),
        body: JSON.stringify({ messages: olderForSummary }),
      });
      if (res.ok) {
        const { summary } = await res.json();
        if (summary) summaryPrefix = summary;
        _historySummaryCache[S.activeChatId] = { msgCount: S.messages.length, summary };
      }
    } catch { /* fallback: send full history */ }
  }

  // Try streaming first; each model streams independently and updates the card as tokens arrive
  const results = await Promise.allSettled(am.map((m, i) => {
    // Build history, apply prompt enhancement, then splice in condensed prefix if applicable
    let rawHistory = mkHistory(m.id);
    if (effectivePrompt !== prompt && rawHistory.length) {
      const last = rawHistory[rawHistory.length - 1];
      if (last.role === 'user') last.content = effectivePrompt;
    }
    if (summaryPrefix && rawHistory.length > HISTORY_THRESHOLD) {
      const recent = rawHistory.slice(rawHistory.length - HISTORY_KEEP_LAST);
      rawHistory = [
        { role: 'user',      content: `[Context from earlier in this conversation]: ${summaryPrefix}` },
        { role: 'assistant', content: 'Understood.' },
        ...recent,
      ];
    }
    // Prepend live web search results so the model sees current data before
    // its role mandate. Uses a user/assistant exchange so it works cross-provider.
    if (webCtx) {
      rawHistory = [
        { role: 'user',      content: `[LIVE WEB CONTEXT — retrieved just now]\n${webCtx}\nUse this information to inform your answer. Cite sources where relevant.` },
        { role: 'assistant', content: 'Understood. I have the live web search results and will use them for accurate, up-to-date information.' },
        ...rawHistory,
      ];
    }
    // Role override: use Supabase-stored assignment (auto-reassignment) if present
    const effectiveRole = (S.roleOverrides && S.roleOverrides[m.name]) || m.role || '';
    // Auto-enable chain-of-thought for math/analysis question types
    const autoCoT = S.cfg.chainOfThought === 'auto' &&
      ['math', 'analysis', 'code'].includes(v.routing?.questionType || '');
    const useCoT = S.cfg.chainOfThought === true || autoCoT;

    const payload = {
      provider: m.provider, modelName: m.modelName, baseUrl: m.baseUrl || '',
      role: effectiveRole,
      history: rawHistory,
      attachments: m.hasVision ? attachments : attachments.filter(a => !a.type?.startsWith('image/')),
      maxTokens: 2500,
      skillContext: S.activeSkill || null,
      chainOfThought: useCoT,
    };

    // Streaming — live token-by-token update (skip streaming when attachments include files
    // that need base64 data, since SSE doesn't support that payload size reliably)
    const hasHeavyAttachments = attachments.some(a => a.data && a.data.length > 50000);
    if (!hasHeavyAttachments) {
      return callModelStreaming(m, payload, (partial) => {
        // Live-update the response card as text arrives
        const r = v.responses[i];
        if (r) { r.text = partial; r.streaming = true; patchMsg(msg); }
      }).then(text => {
        const r = v.responses[i]; if (r) r.streaming = false;
        return text;
      });
    }

    // Fallback: non-streaming for heavy attachments
    return fetch('/api/call-model', {
      method: 'POST', headers: AUTH.headers(),
      body: JSON.stringify({ ...payload }),
    }).then(r => r.json()).then(d => { if (d.error) throw new Error(d.error); return d.text; });
  }));

  v.responses = am.map((m,i)=>({
    modelId:m.id, name:m.name, role:m.role, accent:m.accent, loading:false,
    text:  results[i].status==='fulfilled'?results[i].value:null,
    error: results[i].status==='rejected'?(results[i].reason?.message||'Error'):null,
    collapsed: collapseMap.get(m.id) || false, // preserve user's collapse state
  }));

  const good = v.responses.filter(r=>r.text);
  v.synthesis = null; patchMsg(msg); scrollBottom();

  if (good.length) {
    try {
      const attCtx = attachments.filter(a=>a.text&&!a.text.startsWith('[Image')).map(a=>`[${a.name}]: ${a.text.slice(0,3000)}`).join('\n\n');
      const qType  = v.routing?.questionType || null;

      // ── Deep mode second round (#10) ────────────────────────
      if (S.cfg.deepMode && good.length >= 2) {
        const round1Context = good.map(r =>
          `**${r.name} (${r.role}):**\n${r.text}`
        ).join('\n\n---\n\n');

        v.synthesis = '⏳ Deep mode: running second-round debate...';
        patchMsg(msg);

        const round2Results = await Promise.allSettled(am.map((m, i) => {
          const r1 = good.find(r => r.modelId === m.id);
          if (!r1) return Promise.resolve(null);
          const round2Payload = {
            provider: m.provider, modelName: m.modelName, baseUrl: m.baseUrl || '',
            role: m.role || '',
            history: mkHistory(m.id),
            attachments: [],
            maxTokens: 2500,
            skillContext: S.activeSkill || null,
            round2Context: round1Context,
          };
          return callModelStreaming(m, round2Payload, (partial) => {
            const r = v.responses[i];
            if (r) { r.text2 = partial; r.streaming = true; patchMsg(msg); }
          }).then(text => { const r = v.responses[i]; if (r) { r.text2 = text; r.streaming = false; } return text; });
        }));

        // Use round2 responses for synthesis
        good.forEach((r, i) => {
          const m = am.find(m => m.id === r.modelId);
          const idx = am.indexOf(m);
          if (round2Results[idx]?.status === 'fulfilled' && round2Results[idx].value) {
            r.textR1 = r.text;
            r.text   = round2Results[idx].value;
          }
        });
      }

      // ── Streaming synthesis ──────────────────────────────────
      v.synthesis = '';
      patchMsg(msg);
      const synthResult = await streamSynthesis(effectivePrompt, good, attCtx||null, qType, webCtx, (partial) => {
        v.synthesis = partial;
        patchMsg(msg);
      });

      // Handle clarification mode
      if (synthResult && typeof synthResult === 'object' && synthResult.clarification) {
        v.synthesis = null;
        v.clarification = synthResult.clarification;
      } else {
        v.synthesis = synthResult || '⚠ Synthesis returned empty response.';
        v.clarification = null;
      }
    } catch(e){ v.synthesis='⚠ '+e.message; }

    // Evaluation is opt-in per message — user clicks the ⭐ Evaluate button.
    // Only auto-run if the global enableEvaluation flag is explicitly set true.
    if (S.cfg.enableEvaluation === true && v.synthesis && !v.synthesis.startsWith('⚠')) {
      runEvaluation(msg.id, prompt, v.synthesis, good, v.routing?.questionType);
    }

    // Fact-check pass (#56) — opt-in via Fact toggle
    if (S.cfg.factCheck && v.synthesis && typeof v.synthesis === 'string' && !v.synthesis.startsWith('⚠')) {
      runFactCheck(msg.id, effectivePrompt, v.synthesis);
    }
  } else { v.synthesis=undefined; }

  patchMsg(msg); scrollBottom();
}

async function retry(msgId) {
  if(S.busy) return;
  const msg=S.messages.find(m=>m.id===msgId); if(!msg) return;
  const v=msg.variants[msg.activeVariant]; const am=activeModels(); if(!am.length) return;
  S.busy=true; setSendBusy(true);
  v.responses=am.map(m=>({modelId:m.id,name:m.name,role:m.role,accent:m.accent,loading:true,text:null,error:null}));
  v.synthesis=undefined; patchMsg(msg);
  function mkH(modelId){
    const hist=[];
    for(const m of S.messages.slice(0,S.messages.indexOf(msg))){
      const vv=m.variants[m.activeVariant]||m.variants[0];
      if(vv.userText)hist.push({role:'user',content:vv.userText,attachments:vv.attachments});
      const assistantText = vv.optimizedSynthesis || vv.synthesis
        || (vv.responses||[]).find(r=>r.modelId===modelId)?.text;
      if(assistantText)hist.push({role:'assistant',content:assistantText});
    }
    hist.push({role:'user',content:v.userText||'Analyze.'});
    return hist;
  }
  await runModels(msg, v.userText||'Analyze files.', v.attachments||[], mkH);
  await DB.saveMsg(S.activeChatId, msg);
  S.busy=false; setSendBusy(false);
}
//  SKILLS ENGINE
// ══════════════════════════════════════════════════════════════

async function loadSkills() {
  // Load built-in skills from server
  try {
    const res = await fetch('/api/skills');
    if (res.ok) { const d = await res.json(); S.skills = {}; (d.skills||[]).forEach(s => { S.skills[s.id] = s; }); }
  } catch {}
  // Load custom (learned) skills — Supabase first, LS fallback
  S.customSkills = await DB.loadCustomSkills();
  Object.assign(S.skills, S.customSkills);
}

function getAllSkills() { return Object.values(S.skills); }

async function getSkillFull(id) {
  // Built-in: fetch full prompt from server
  if (S.customSkills[id]) return S.customSkills[id];
  try {
    const res = await fetch(`/api/skills?id=${encodeURIComponent(id)}`);
    if (res.ok) return await res.json();
  } catch {}
  return S.skills[id] || null;
}

// Parse slash command from input text
// Returns { command, arg, text } or null if not a command
function parseSlashCommand(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.slice(1).split(/\s+/);
  const command = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ');
  return { command, arg, text: trimmed };
}

// Handle slash command — returns true if handled (swallow input), false to send normally
async function handleSlashCommand(command, arg) {
  switch (command) {
    case 'help':
    case 'skills': {
      showSkillsMenu();
      return true;
    }
    case 'reset':
    case 'clear': {
      S.activeSkill = null;
      LS.del('active_skill_' + (S.activeChatId||''));
      renderSkillBadge();
      showToast('🔄 Skill dezactivat — mod normal');
      return true;
    }
    case 'learn': {
      if (!arg) { showToast('Usage: /learn <topic>  ex: /learn japoneză'); return true; }
      await learnSkill(arg);
      return true;
    }
    default: {
      // Try to activate a known skill by ID
      const skill = await getSkillFull(command);
      if (skill) {
        await activateSkill(skill, arg);
        return true;
      }
      // Unknown command — treat as normal message
      return false;
    }
  }
}

async function activateSkill(skill, arg='') {
  // Fetch full system prompt if we only have metadata
  let fullSkill = skill;
  if (!fullSkill.systemPrompt) fullSkill = await getSkillFull(skill.id) || skill;

  let prompt = fullSkill.systemPrompt || '';
  // Replace {arg} placeholder for dynamic skills (e.g. /learn japoneză)
  if (arg) prompt = prompt.replace(/\{arg\}/g, arg);

  S.activeSkill = { id: fullSkill.id, name: arg ? `${fullSkill.name}: ${arg}` : fullSkill.name, prompt };
  LS.set('active_skill_' + (S.activeChatId||''), S.activeSkill);
  renderSkillBadge();
  showToast(`✅ Skill activat: ${S.activeSkill.name}`);
}

async function learnSkill(topic) {
  showToast(`🔍 Se învață: ${topic}...`, 0);
  try {
    const res = await fetch('/api/learn-skill', {
      method: 'POST', headers: AUTH.headers(),
      body: JSON.stringify({ topic }),
    });
    const data = await res.json();
    if (data.error) { showToast('❌ ' + data.error); return; }
    const skill = data.skill;
    // Save custom skill to Supabase + LS
    await DB.saveCustomSkill(skill);
    S.skills[skill.id] = skill;
    await activateSkill(skill);
    showToast(`🧠 Skill învățat din ${data.sourcesUsed} surse: ${skill.name}`);
  } catch(e) {
    showToast('❌ Eroare: ' + e.message);
  }
}

function showSkillsMenu() {
  const skills = getAllSkills();
  const html = `<div style="display:flex;flex-direction:column;gap:10px">
    <div class="note" style="margin-bottom:4px">
      <strong>Slash commands:</strong><br>
      <code>/help</code> — această listă<br>
      <code>/reset</code> — dezactivează skill-ul curent<br>
      <code>/learn &lt;topic&gt;</code> — învață automat orice topic din GitHub/web<br>
      <code>/&lt;skill-id&gt;</code> — activează un skill specific
    </div>
    <div class="sec-title">Skills disponibile (${skills.length})</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${skills.map(s => `
        <button onclick="App.activateSkillById('${s.id}')" style="display:flex;align-items:center;gap:9px;padding:10px 12px;background:var(--bg4);border:1px solid var(--bd);border-radius:var(--r);cursor:pointer;text-align:left;transition:all .15s;color:var(--tx2)" onmouseover="this.style.borderColor='var(--ac-bd)';this.style.color='var(--tx)'" onmouseout="this.style.borderColor='var(--bd)';this.style.color='var(--tx2)'">
          <i class="ti ${s.icon||'ti-sparkles'}" style="color:var(--ac);font-size:16px;flex-shrink:0"></i>
          <div>
            <div style="font-size:12px;font-weight:500">/${s.id}</div>
            <div style="font-size:11px;color:var(--tx3)">${esc(s.description||s.name)}</div>
          </div>
          ${s.learned?'<span style="font-size:9px;padding:1px 5px;background:rgba(16,185,129,.12);color:var(--green);border-radius:20px;margin-left:auto;flex-shrink:0">learned</span>':''}
        </button>`).join('')}
    </div>
    <button onclick="App.deleteCustomSkills()" style="align-self:flex-start" class="btn-sm btn-danger"><i class="ti ti-trash"></i> Șterge skill-uri învățate</button>
  </div>`;

  // Show in a modal-like overlay using existing modal infrastructure
  document.getElementById('body-settings').innerHTML = html;
  document.getElementById('modal-settings').style.display = 'flex';
  document.getElementById('overlay').classList.add('open');
  document.getElementById('modal-settings').querySelector('.modal-head h2').innerHTML = '<i class="ti ti-command"></i> Skills & Slash Commands';
}

function renderSkillBadge() {
  // Sidebar dot
  const dot = document.getElementById('skill-dot');
  if (dot) dot.style.display = S.activeSkill ? '' : 'none';

  // Input area badge
  let badge = document.getElementById('skill-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'skill-badge';
    badge.style.cssText = 'display:none;align-items:center;gap:7px;padding:5px 10px 5px 12px;margin-bottom:7px;background:var(--ac-bg);border:1px solid var(--ac-bd);border-radius:8px;font-size:12px;color:var(--tx2);';
    const chipsEl = document.getElementById('file-chips');
    if (chipsEl?.parentElement) chipsEl.parentElement.insertBefore(badge, chipsEl);
  }
  if (S.activeSkill) {
    badge.style.display = 'flex';
    badge.innerHTML = `<i class="ti ti-sparkles" style="color:var(--ac);font-size:13px"></i>
      <span>Skill: <strong style="color:var(--tx)">${esc(S.activeSkill.name)}</strong></span>
      <button onclick="App.deactivateSkill()" style="margin-left:auto;padding:1px 7px;border-radius:20px;border:1px solid var(--bd);background:none;color:var(--tx3);font-size:11px;cursor:pointer">/reset</button>`;
  } else {
    badge.style.display = 'none';
  }
}

function deactivateSkill() {
  S.activeSkill = null;
  LS.del('active_skill_' + (S.activeChatId||''));
  renderSkillBadge();
}

async function activateSkillById(id) {
  const skill = await getSkillFull(id);
  if (!skill) return;
  // Dynamic skills that need an arg (like /learn) — prompt for it
  if (skill.dynamic) {
    const arg = prompt(`Enter argument for /${id} (e.g. language name):`);
    if (arg === null) return;
    await activateSkill(skill, arg.trim());
  } else {
    await activateSkill(skill);
  }
  closeModals();
}

async function deleteCustomSkills() {
  if (!confirm('Ștergi toate skill-urile învățate?')) return;
  const ids = Object.keys(S.customSkills);
  for (const id of ids) {
    await DB.deleteCustomSkill(id); // removes from Supabase + LS
  }
  S.customSkills = {};
  showToast('🗑️ Skill-uri șterse');
  showSkillsMenu(); // re-render
}

// Toast notification
let toastTimer = null;
function showToast(msg, duration=3000) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--bg5);border:1px solid var(--bd2);color:var(--tx);padding:9px 18px;border-radius:20px;font-size:13px;z-index:999;box-shadow:0 4px 20px rgba(0,0,0,.4);transition:opacity .2s;pointer-events:none;white-space:nowrap;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toastTimer);
  if (duration > 0) toastTimer = setTimeout(() => { toast.style.opacity='0'; }, duration);
}

// ══════════════════════════════════════════════════════════════
//  EVALUATION ENGINE
// ══════════════════════════════════════════════════════════════

// Called by the ⭐ Evaluate button — opt-in per message
async function requestEval(msgId) {
  const msg = S.messages.find(m => m.id === msgId);
  if (!msg) return;
  const v = msg.variants[msg.activeVariant];
  if (!v.synthesis || v.evaluation !== undefined) return;
  const good = v.responses?.filter(r => r.text) || [];
  if (!good.length) return;
  const chatMsg = msg.variants[0]?.userContent || msg.content || '';
  v.evaluationPending = true;
  patchMsg(msg);
  await runEvaluation(msgId, chatMsg, v.synthesis, good, v.routing?.questionType);
  v.evaluationPending = false;
}

async function runEvaluation(msgId, question, synthesis, responses, questionType) {
  const msg = S.messages.find(m => m.id === msgId);
  if (!msg) return;
  const v = msg.variants[msg.activeVariant];

  // Add evaluation placeholder
  v.evaluation = '';
  v.evaluationPending = true;
  patchMsg(msg);

  try {
    const res = await fetch('/api/evaluate-stream', {
      method: 'POST', headers: AUTH.headers(),
      body: JSON.stringify({
        question, synthesis, responses, questionType,
        skillContext: S.activeSkill ? { name: S.activeSkill.name, prompt: S.activeSkill.prompt } : null,
      }),
    });

    if (!res.ok) {
      v.evaluation = `⚠ Evaluation error: HTTP ${res.status}`;
    } else {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.error) { v.evaluation = `⚠ ${evt.error}`; break outer; }
            if (evt.delta) {
              v.evaluation += evt.delta;
              patchMsg(msg);
              scrollBottom();
            }
            if (evt.done) {
              v.evalScore = evt.score ?? null;
              break outer;
            }
          } catch { /* skip malformed */ }
        }
      }
    }
  } catch(e) {
    v.evaluation = `⚠ Evaluation error: ${e.message}`;
  }

  // Extract the "Optimized Final Answer" section so future history rounds
  // build on the best available answer rather than the raw first synthesis.
  if (v.evaluation && typeof v.evaluation === 'string') {
    const optMatch = v.evaluation.match(/##\s*[✨🏆][^#\n]*Optimized Final Answer[^\n]*\n+([\s\S]+?)(?=\n##\s|$)/i);
    if (optMatch?.[1]?.trim()) v.optimizedSynthesis = optMatch[1].trim();
  }

  v.evaluationPending = false;
  await DB.saveMsg(S.activeChatId, msg);
  patchMsg(msg);
  scrollBottom();
}

// ── Fact-check pass (#56) ─────────────────────────────────────
// Streams a Claude Haiku fact-check of the synthesis.
// Opt-in: only runs when S.cfg.factCheck is true.
// Results stored in v.factCheck; rendered in ui.js below synthesis.
async function runFactCheck(msgId, question, synthesis) {
  const msg = S.messages.find(m => m.id === msgId);
  if (!msg) return;
  const v = msg.variants[msg.activeVariant];
  v.factCheck = '';
  v.factCheckPending = true;
  patchMsg(msg);

  try {
    const res = await fetch('/api/factcheck-stream', {
      method: 'POST',
      headers: AUTH.headers(),
      body: JSON.stringify({ synthesis, question }),
    });
    if (!res.ok || !res.body) throw new Error(`Fact-check HTTP ${res.status}`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.error) throw new Error(evt.error);
          if (evt.done) break;
          if (evt.delta) {
            v.factCheck += evt.delta;
            patchMsg(msg);
          }
        } catch (e) { if (e.message !== 'skip') throw e; }
      }
    }
  } catch(e) {
    v.factCheck = `⚠ Fact-check failed: ${e.message}`;
  } finally {
    v.factCheckPending = false;
    await DB.saveMsg(S.activeChatId, msg);
    patchMsg(msg);
    scrollBottom();
  }
}

// ── Desktop Agent (#65) ──────────────────────────────────────
// Sends tasks to the Python desktop agent via Supabase Realtime broadcast.
// The agent subscribes to channel `desktop:{userId}`, processes the task
// using Claude Computer Use, and broadcasts back status updates.
//
// Channel: desktop:{userId}
//   Outbound event: 'desktop_command'  payload: { task, requestId }
//   Inbound event:  'agent_status'     payload: { requestId, status, step, result, error, screenshot }
//   status values: 'running' | 'step' | 'done' | 'error'
let _desktopChannel = null;

function initDesktopChannel() {
  if (!S.sbClient || !AUTH.userId) return;
  if (_desktopChannel) return; // already subscribed

  _desktopChannel = S.sbClient
    .channel(`desktop:${AUTH.userId}`)
    .on('broadcast', { event: 'agent_status' }, ({ payload }) => {
      const { requestId, status, step, result, error, screenshot, stepNumber } = payload || {};
      if (!requestId) return;

      // Route #1 — council→desktop handoff callbacks (#71)
      const handoffCb = S.handoffCallbacks?.[requestId];
      if (handoffCb) {
        handoffCb({ status, step, result, error, screenshot, stepNumber, requestId });
        // Don't return — the same requestId might also match an agentRequestId in edge cases
      }

      // Route #2 — direct @desktop messages (#65)
      const msg = S.messages.find(m => {
        const v = m.variants[m.activeVariant];
        return v?.agentRequestId === requestId;
      });
      if (!msg) return;
      const v = msg.variants[msg.activeVariant];
      v.agentStatus = { status, step, result, error, screenshot, stepNumber, requestId };
      if (status === 'done' || status === 'error') {
        v.agentPending = false;
        DB.saveMsg(S.activeChatId, msg);
        // Native Electron notification when the window is in the background
        if (window.electronAPI?.notify) {
          const title = status === 'done' ? 'Agent task complete' : 'Agent task failed';
          const body  = (result || error || '').slice(0, 100);
          window.electronAPI.notify(title, body);
        }
      }
      patchMsg(msg);
      scrollBottom();
    })
    .subscribe();
}

// sendToDesktopAgent(task, msg, [requestId])
// requestId is auto-generated if not provided. The council→desktop handoff (#71)
// passes its own pre-allocated requestId so the callback is pre-registered.
async function sendToDesktopAgent(task, msg, requestId) {
  if (!S.sbClient) {
    showToast('❌ Supabase required for desktop agent');
    return;
  }
  if (!requestId) requestId = uid();
  const v = msg.variants[msg.activeVariant];
  v.agentRequestId = requestId;
  v.agentStatus    = { status: 'sending', step: 'Connecting to desktop agent…', requestId };
  v.agentPending   = true;
  patchMsg(msg);

  // Ensure we're subscribed to receive status callbacks before sending
  initDesktopChannel();

  try {
    // Include the session token so the agent can verify the sender is authenticated.
    // The agent uses AGENT_SECRET (= server JWT_SECRET) to verify the HMAC signature.
    const token = AUTH.session?.token || '';

    // Use a fresh channel send; the subscription channel above handles inbound only.
    await S.sbClient
      .channel(`desktop:${AUTH.userId}`)
      .send({ type: 'broadcast', event: 'desktop_command', payload: { task, requestId, token } });

    v.agentStatus = { status: 'running', step: 'Task sent — agent is working…', requestId };
    patchMsg(msg);
  } catch(e) {
    v.agentStatus = { status: 'error', error: e.message, requestId };
    v.agentPending = false;
    patchMsg(msg);
    showToast('❌ Desktop agent send failed: ' + e.message);
  }
}

// Cancel a running desktop agent task.
// Broadcasts cancel_command to the agent; the agent's asyncio.Event is set
// which causes run_computer_use_task() to exit cleanly on next loop iteration.
async function cancelDesktopTask(requestId) {
  if (!S.sbClient || !requestId) return;
  try {
    await S.sbClient
      .channel(`desktop:${AUTH.userId}`)
      .send({ type: 'broadcast', event: 'cancel_command', payload: { requestId } });
    showToast('🛑 Cancel sent — agent will stop after the current step');
  } catch(e) {
    showToast('❌ Cancel failed: ' + e.message);
  }
}
