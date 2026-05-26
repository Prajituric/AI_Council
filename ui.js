/* ================================================================
   ui.js  —  All rendering, modals, doc generators
   Loaded before app.js. References globals (S, AUTH, t, marked,
   Chart, mermaid, etc.) that are available at call-time.
   ================================================================ */
// ══════════════════════════════════════════════════════════════
//  RENDER SIDEBAR
// ══════════════════════════════════════════════════════════════
function renderSidebar() {
  const list  = document.getElementById('chat-list');
  const badge = document.getElementById('badge-models');
  const am    = activeModels();

  if (badge) badge.textContent = S.models.filter(m=>m.enabled).length;

  // Input note
  const note = document.getElementById('input-note');
  if (note) {
    note.innerHTML = am.length
      ? am.map(m=>`<span style="color:${m.accent}">${m.name}</span>`).join(', ') + t('input_note_suffix')
      : `<span style="color:var(--red)">${t('no_models')}</span>`;
  }

  // Status row
  const r2ok = S.cfg.r2?.ok; const sbok = S.cfg.supabase?.ok||!!S.sbClient;
  const pok  = Object.values(S.cfg.providers).some(Boolean);
  const si = document.getElementById('status-icon');
  const st = document.getElementById('status-text');
  if (si) si.style.color = pok?'var(--green)':'var(--yellow)';
  if (st) st.textContent = `${pok?'✓ API':'⚠ API'} · ${r2ok?'R2 ✓':'R2 -'} · ${sbok?'DB ✓':'DB -'}`;

  // User badge
  const ub = document.getElementById('user-badge');
  const ul = document.getElementById('user-name-label');
  const ua = document.getElementById('user-avatar');
  if (ul) ul.textContent = AUTH.userName;
  if (ua) ua.textContent = AUTH.userName.charAt(0).toUpperCase();

  if (!S.chats.length) {
    list.innerHTML = `<div class="no-chats">${t('no_chats').replace('\n','<br>')}</div>`;
    return;
  }

  const n = new Date();
  const G = [
    { l: t('today'),      i: [] }, { l: t('yesterday'), i: [] },
    { l: t('this_week'),  i: [] }, { l: t('older'),      i: [] },
  ];
  S.chats.forEach(c => {
    const d = Math.floor((n - new Date(c.updated_at))/86400000);
    (d===0?G[0]:d===1?G[1]:d<7?G[2]:G[3]).i.push(c);
  });

  list.innerHTML = G.filter(g=>g.i.length).map(g =>
    `<div class="chat-group-label">${g.l}</div>` +
    g.i.map(c => `<div class="chat-item ${c.id===S.activeChatId?'active':''}" onclick="App.openChat('${c.id}')">
      <i class="ti ti-message" style="font-size:13px;flex-shrink:0"></i>
      <span class="chat-title">${esc(c.title)}</span>
      <span class="chat-time">${fmtTime(c.updated_at)}</span>
      <button class="chat-del" onclick="App.deleteChat('${c.id}',event)"><i class="ti ti-x"></i></button>
    </div>`).join('')
  ).join('');
}

function renderStrip() {
  const am = activeModels();
  const strip = document.getElementById('model-strip');
  if (!strip) return;
  strip.innerHTML =
    S.models.map(m => `<div class="mpill ${am.find(x=>x.id===m.id)?'active':'inactive'}">
      <div class="mpill-dot" style="background:${m.accent}"></div>${m.name}</div>`).join('') +
    `<div class="mpill synth"><i class="ti ti-sparkles" style="font-size:10px;margin-right:3px"></i>${t('synthesis_title').split('—')[0].trim()}</div>`;
}

// ══════════════════════════════════════════════════════════════
//  RENDER MESSAGES
// ══════════════════════════════════════════════════════════════
function renderMessages() {
  const welcome = document.getElementById('welcome');
  const list    = document.getElementById('msg-list');
  if (!welcome||!list) return;
  const has = S.messages.length>0;
  welcome.style.display = has?'none':'flex';
  list.style.display    = has?'flex':'none';
  document.getElementById('btn-export').style.display   = has?'':'none';
  document.getElementById('btn-del-chat').style.display = S.activeChatId?'':'none';
  if (!has) { list.innerHTML=''; return; }
  list.innerHTML = S.messages.map(m=>exchangeHTML(m)).join('');
  renderVisuals();
}

function patchMsg(msg) {
  const el = document.getElementById('ex-'+msg.id);
  const tmp = document.createElement('div');
  tmp.innerHTML = exchangeHTML(msg);
  if (el) el.replaceWith(tmp.firstElementChild); else renderMessages();
  renderVisuals();
}

function exchangeHTML(msg) {
  const v   = msg.variants[msg.activeVariant]||msg.variants[0];
  const cnt = msg.variants.length;
  const idx = msg.activeVariant;

  let attsHtml = '';
  if (v.attachments?.length) {
    const chips = v.attachments.map(a => {
      if (a.type?.startsWith('image/')&&a.url)
        return `<div class="user-att-thumb"><img src="${esc(a.url)}" alt="${esc(a.name)}" style="max-height:110px;border-radius:8px;border:1px solid var(--bd)"></div>`;
      return `<div class="user-att-chip"><i class="ti ${fileIcon(a.type,a.name)}"></i><span>${esc(a.name)}</span></div>`;
    }).join('');
    attsHtml = `<div class="user-atts">${chips}</div>`;
  }

  const varNav = cnt>1 ? `<div class="variant-nav">
    <button class="btn-variant" onclick="App.prevVar('${msg.id}')" ${idx===0?'disabled':''}><i class="ti ti-chevron-left"></i></button>
    <span class="variant-info">${idx+1} / ${cnt}</span>
    <button class="btn-variant" onclick="App.nextVar('${msg.id}')" ${idx===cnt-1?'disabled':''}><i class="ti ti-chevron-right"></i></button>
  </div>` : '';

  const userRow = `<div class="user-row">
    ${attsHtml?`<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;width:100%">${attsHtml}</div>`:''}
    ${v.userText?`<div class="user-bubble">${esc(v.userText)}</div>`:''}
  </div>`;

  const actions = `<div class="msg-actions">
    <button class="msg-btn" onclick="App.showEdit('${msg.id}')"><i class="ti ti-edit"></i> ${t('edit')}</button>
    <button class="msg-btn" onclick="App.retry('${msg.id}')"><i class="ti ti-refresh"></i> ${t('retry')}</button>
  </div>`;

  // ── Routing indicator (#8) ───────────────────────────────────
  let routingHTML = '';
  if (v.routing) {
    const rt = v.routing;
    const typeColor = { code:'#7C3AED', research:'#4285F4', creative:'#CF6A2F', analysis:'#10A37F', math:'#f97316', other:'#8888aa' }[rt.questionType] || '#8888aa';

    // ── Skill auto-suggestion (#47) — shown only when no skill is active ─
    let skillSuggestHTML = '';
    if (v.skillSuggestion && !v.skillSuggestion.dismissed) {
      const sg = v.skillSuggestion;
      skillSuggestHTML = `
        <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--tx3);padding:2px 0 4px 18px">
          <i class="ti ti-sparkles" style="color:var(--ac);font-size:11px"></i>
          <span>${rt.questionType} question — activate <strong style="color:var(--tx2)">/${sg.id}</strong>?</span>
          <button onclick="App.acceptSkillSuggestion('${msg.id}')" style="padding:1px 8px;border-radius:20px;border:1px solid var(--ac-bd);background:var(--ac-bg);color:var(--ac);font-size:10px;cursor:pointer;font-weight:500">Use</button>
          <button onclick="App.dismissSkillSuggestion('${msg.id}')" style="padding:1px 5px;border-radius:20px;border:none;background:none;color:var(--tx3);font-size:10px;cursor:pointer;opacity:.6" title="Dismiss">✕</button>
        </div>`;
    }

    routingHTML = `
      <div class="routing-chip" style="display:flex;align-items:center;gap:7px;font-size:11px;color:var(--tx3);padding:4px 0 2px 0">
        <i class="ti ti-route" style="color:${typeColor};font-size:12px"></i>
        <span style="color:${typeColor};font-weight:500;text-transform:uppercase;font-size:10px;letter-spacing:.5px">${rt.questionType}</span>
        <span>·</span>
        <span style="color:var(--tx2)">${rt.selectedNames.join(', ')}</span>
        <span style="opacity:.5">(${rt.confidence}%)</span>
        <button onclick="App.overrideRouting('${msg.id}')" style="margin-left:auto;padding:1px 7px;border-radius:20px;border:1px solid var(--bd);background:none;color:var(--tx3);font-size:10px;cursor:pointer;transition:all .1s" onmouseover="this.style.color='var(--tx)'" onmouseout="this.style.color='var(--tx3)'">change</button>
      </div>${skillSuggestHTML}`;
  }

  // ── Prompt enhancement chip (#3) ────────────────────────────
  let enhancementHTML = '';
  if (v.promptEnhancement) {
    const pe = v.promptEnhancement;
    const btnBase = 'padding:1px 7px;border-radius:20px;font-size:10px;cursor:pointer;transition:all .1s';
    enhancementHTML = `
      <div class="enhance-chip" style="font-size:11px;color:var(--tx3);padding:4px 0 3px 0;border-bottom:1px solid var(--bd);margin-bottom:5px">
        <div style="display:flex;align-items:center;gap:6px">
          <i class="ti ti-sparkles" style="color:#a78bfa;font-size:12px;flex-shrink:0"></i>
          <span style="color:#a78bfa;font-weight:500">Prompt enhanced</span>
          <button onclick="App.toggleEnhancement('${msg.id}')" style="${btnBase};border:1px solid var(--bd);background:none;color:var(--tx3)" onmouseover="this.style.color='var(--tx)'" onmouseout="this.style.color='var(--tx3)'">
            ${pe.expanded ? 'hide' : 'show diff'}
          </button>
          <button onclick="App.revertEnhancement('${msg.id}')" style="${btnBase};border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.06);color:var(--red)" title="Re-run council on your original prompt">
            ↩ Revert
          </button>
        </div>
        ${pe.expanded ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
          <div>
            <div style="font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Original</div>
            <div style="background:var(--bg3);border-radius:6px;padding:8px 10px;color:var(--tx2);line-height:1.5;font-size:11px;white-space:pre-wrap">${esc(pe.original)}</div>
          </div>
          <div>
            <div style="font-size:10px;color:#a78bfa;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Enhanced</div>
            <div style="background:rgba(167,139,250,.07);border:1px solid rgba(167,139,250,.2);border-radius:6px;padding:8px 10px;color:var(--tx);line-height:1.5;font-size:11px;white-space:pre-wrap">${esc(pe.enhanced)}</div>
          </div>
        </div>` : ''}
      </div>`;
  }

  const responses = v.responses||[];
  let councilHTML = '';
  if (responses.length) {
    const cards = responses.map(r => {
      const c = r.accent||'#6366f1';
      const icon = r.loading ? `<i class="ti ti-loader spin mcard-status" style="color:${c}"></i>`
        : r.error ? `<i class="ti ti-circle-x mcard-status" style="color:var(--red)"></i>`
        : `<i class="ti ti-circle-check mcard-status" style="color:var(--green)"></i>`;
      // Deep mode: R2 indicator when second-round text exists
      const r2badge = r.text2 !== undefined
        ? `<span style="font-size:9px;padding:1px 5px;background:rgba(99,102,241,.12);color:#818cf8;border-radius:20px;margin-left:4px">R2</span>`
        : '';
      // Collapse/expand toggle — only shown when card has loaded content (#2)
      const collapseBtn = !r.loading ? `<button onclick="event.stopPropagation();App.toggleCard('${msg.id}','${r.modelId}')"
          style="padding:2px 5px;border:none;background:none;color:var(--tx3);cursor:pointer;font-size:11px;line-height:1;flex-shrink:0;opacity:.6" title="${r.collapsed ? 'Expand' : 'Collapse'}">
          <i class="ti ${r.collapsed ? 'ti-chevron-down' : 'ti-chevron-up'}"></i>
        </button>` : '';
      // Body: collapsed → one-line preview; expanded → full text
      const body = r.loading
        ? `<div class="thinking" style="--mc:${c}"><span></span><span></span><span></span></div>`
        : r.error
          ? `<div class="mcard-err"><i class="ti ti-alert-circle"></i><span>${esc(r.error)}</span></div>`
          : r.collapsed
            ? `<p class="mcard-text" style="font-size:11px;color:var(--tx3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0">${esc((r.text||'').slice(0,140))}</p>`
            : `<p class="mcard-text">${esc(r.text||'')}</p>`;
      return `<div class="mcard${r.collapsed ? ' mcard--collapsed' : ''}" style="--mc:${c}">
        <div class="mcard-head"><div class="mcard-dot" style="background:${c}"></div>
          <div style="flex:1;min-width:0"><div class="mcard-name">${esc(r.name)}${r2badge}</div><div class="mcard-role">${esc(r.role)}</div></div>${icon}${collapseBtn}
        </div><div class="mcard-body">${body}</div></div>`;
    }).join('');
    // Web search sources chip (#63)
    let webHTML = '';
    if (v.webSearch) {
      const ws = v.webSearch;
      const sourcesListHTML = ws.expanded
        ? `<div style="padding:4px 0 2px 18px;display:flex;flex-direction:column;gap:3px">` +
          ws.results.map((r, i) =>
            `<div style="display:flex;align-items:baseline;gap:5px">
               <span style="color:var(--tx3);font-size:10px;flex-shrink:0">${i + 1}.</span>
               <a href="${esc(r.url)}" target="_blank" rel="noopener"
                  style="color:var(--ac);font-size:11px;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px"
                  title="${esc(r.url)}">${esc(r.title || r.url)}</a>
             </div>`
          ).join('') + `</div>`
        : '';
      webHTML = `<div style="padding:2px 0">
        <div style="display:flex;align-items:center;gap:7px;font-size:11px;color:var(--tx3);cursor:pointer"
             onclick="App.toggleWebSources('${msg.id}')">
          <i class="ti ti-world" style="color:#4285F4;font-size:12px"></i>
          <span style="color:#4285F4;font-weight:500">Web</span>
          <span>·</span>
          <span style="color:var(--tx2);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ws.query)}</span>
          <span style="opacity:.5;flex-shrink:0">(${ws.results.length} sources)</span>
          <i class="ti ti-chevron-${ws.expanded ? 'up' : 'down'}" style="margin-left:auto;font-size:10px;flex-shrink:0"></i>
        </div>${sourcesListHTML}
      </div>`;
    }

    councilHTML = `<div class="council-label">${t('council_active')}</div>${enhancementHTML}${routingHTML}${webHTML}<div class="council-grid">${cards}</div>`;
  }

  let synthHTML = '';
  // ── Clarification mode (#11) ─────────────────────────────────
  if (v.clarification) {
    const cl = v.clarification;
    synthHTML = `<div class="synth" style="border-color:var(--yellow);background:rgba(234,179,8,.04)">
      <div class="synth-head">
        <i class="ti ti-question-mark" style="font-size:16px;color:var(--yellow);flex-shrink:0"></i>
        <div>
          <div class="synth-title">Clarification needed</div>
          <div class="synth-sub">Models disagreed on the question's premise</div>
        </div>
      </div>
      <div style="padding:12px 0 4px 0">
        <div style="font-size:15px;font-weight:500;color:var(--tx);margin-bottom:6px">${esc(cl.question)}</div>
        <div style="font-size:12px;color:var(--tx3);margin-bottom:14px">${esc(cl.reason)}</div>
        <div style="display:flex;gap:8px">
          <input id="clarify-inp-${msg.id}" type="text" placeholder="Your clarification..."
            style="flex:1;padding:7px 12px;border-radius:8px;border:1px solid var(--bd);background:var(--bg3);color:var(--tx);font-size:13px"
            onkeydown="if(event.key==='Enter')App.sendClarification('${msg.id}')">
          <button onclick="App.sendClarification('${msg.id}')" class="btn" style="padding:7px 14px;font-size:13px">
            <i class="ti ti-send"></i> Send
          </button>
        </div>
      </div>
    </div>`;
  } else if (v.synthesis===null&&responses.length) {
    synthHTML = `<div class="synth"><div class="synth-head"><i class="ti ti-sparkles synth-icon"></i>
      <div><div class="synth-title">${t('synthesis_title')}</div><div class="synth-sub">${t('claude_sonnet')}</div></div></div>
      <div class="synth-loading"><i class="ti ti-loader spin"></i> ${t('synthesizing')}</div></div>`;
  } else if (v.synthesis) {
    const parsed = renderSynthesis(v.synthesis, msg.id);
    const has = (tag) => v.synthesis.includes('```'+tag);
    synthHTML = `<div class="synth"><div class="synth-head"><i class="ti ti-sparkles synth-icon"></i>
      <div><div class="synth-title">${t('synthesis_title')}</div><div class="synth-sub">${t('claude_sonnet')}</div></div>
      <i class="ti ti-circle-check synth-check"></i></div>
      <div class="md synth-md-${msg.id}">${parsed}</div>
      <div class="synth-actions">
        ${has('presentation')?`<button class="doc-btn" onclick="App.dlPptx('${msg.id}')"><i class="ti ti-presentation"></i>PPTX</button>`:''}
        ${has('xlsx')?`<button class="doc-btn" onclick="App.dlXlsx('${msg.id}')"><i class="ti ti-table"></i>Excel</button>`:''}
        ${has('docx')?`<button class="doc-btn" onclick="App.dlDocx('${msg.id}')"><i class="ti ti-file-word"></i>Word</button>`:''}
        ${has('html-doc')?`<button class="doc-btn" onclick="App.dlHtml('${msg.id}')"><i class="ti ti-brand-html5"></i>HTML</button>`:''}
        ${has('csv')?`<button class="doc-btn" onclick="App.dlCsv('${msg.id}')"><i class="ti ti-table-export"></i>CSV</button>`:''}
        <button class="doc-btn" onclick="App.dlMd('${msg.id}')"><i class="ti ti-file-text"></i>Markdown</button>
        <button class="doc-btn" onclick="App.dlPdf('${msg.id}')"><i class="ti ti-file-type-pdf"></i>PDF</button>
        <button class="doc-btn" onclick="App.copy('${msg.id}')"><i class="ti ti-copy"></i>${t('copy')}</button>
        ${v.evaluation === undefined && !v.evaluationPending
          ? `<button class="doc-btn" onclick="App.requestEval('${msg.id}')" title="Run quality evaluation (uses Claude credits)"><i class="ti ti-star"></i>Evaluate</button>`
          : ''}
        ${S.cfg.desktopMode || S.sbClient ? `<button class="doc-btn" onclick="App.handoffToDesktop('${msg.id}')" title="Send this plan to your desktop agent to execute" style="color:#fb923c;border-color:rgba(251,146,60,.3)"><i class="ti ti-device-desktop"></i>Run on Desktop</button>` : ''}
      </div></div>`;
  }

  // Evaluation card
  let evalHTML = '';
  if (v.evaluation === null || v.evaluationPending) {
    evalHTML = `<div class="eval-card"><div class="eval-head"><i class="ti ti-trophy synth-icon" style="color:var(--yellow)"></i>
      <div><div class="synth-title">Quality Evaluator</div><div class="synth-sub">AI Optimizer</div></div></div>
      <div class="synth-loading"><i class="ti ti-loader spin"></i> Se evaluează calitatea răspunsului...</div>
    </div>`;
  } else if (v.evaluation) {
    const score = v.evalScore;
    const scoreColor = score>=8?'var(--green)':score>=6?'var(--yellow)':'var(--red)';
    evalHTML = `<div class="eval-card"><div class="eval-head">
      <i class="ti ti-trophy synth-icon" style="color:var(--yellow)"></i>
      <div><div class="synth-title">Quality Evaluator</div><div class="synth-sub">AI Optimizer</div></div>
      ${score?`<div style="margin-left:auto;font-size:18px;font-weight:600;color:${scoreColor}">${score.toFixed(1)}<span style="font-size:11px;color:var(--tx2)">/10</span></div>`:''}
    </div>
    <div class="md">${marked.parse(v.evaluation)}</div>
    </div>`;
  }

  // Fact-check card (#56)
  let factHTML = '';
  if (v.factCheckPending || v.factCheck === '') {
    factHTML = `<div class="eval-card" style="border-color:rgba(250,204,21,.2)">
      <div class="eval-head">
        <i class="ti ti-shield-check synth-icon" style="color:var(--yellow)"></i>
        <div><div class="synth-title">Fact Check</div><div class="synth-sub">Claude Haiku</div></div>
      </div>
      <div class="synth-loading"><i class="ti ti-loader spin"></i> Verifying claims...</div>
    </div>`;
  } else if (v.factCheck) {
    const fc = v.factCheck;
    const overallHigh   = /overall confidence:\s*HIGH/i.test(fc);
    const overallMedium = /overall confidence:\s*MEDIUM/i.test(fc);
    const confColor = overallHigh ? 'var(--green)' : overallMedium ? 'var(--yellow)' : 'var(--red)';
    const confLabel = overallHigh ? 'HIGH' : overallMedium ? 'MEDIUM' : 'LOW';
    factHTML = `<div class="eval-card" style="border-color:rgba(250,204,21,.2)">
      <div class="eval-head">
        <i class="ti ti-shield-check synth-icon" style="color:var(--yellow)"></i>
        <div><div class="synth-title">Fact Check</div><div class="synth-sub">Claude Haiku</div></div>
        <div style="margin-left:auto;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:rgba(0,0,0,.15);color:${confColor}">${confLabel}</div>
      </div>
      <div class="md">${marked.parse(fc)}</div>
    </div>`;
  }

  // Desktop Agent status card (#65)
  // Shown instead of (or alongside) the council when the message was routed to the local agent.
  let agentHTML = '';
  if (v.agentTask !== undefined) {
    const as = v.agentStatus;
    if (!as || as.status === 'sending' || as.status === 'running') {
      // Still pending — show spinner + cancel button
      const stepText = as?.step || 'Connecting to desktop agent…';
      agentHTML = `<div class="eval-card" style="border-color:rgba(251,146,60,.25)">
        <div class="eval-head">
          <i class="ti ti-device-desktop synth-icon" style="color:#fb923c"></i>
          <div>
            <div class="synth-title">Desktop Agent</div>
            <div class="synth-sub">Claude Computer Use</div>
          </div>
          <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;color:#fb923c;display:flex;align-items:center;gap:4px">
              <i class="ti ti-loader spin" style="font-size:12px"></i> Running
            </span>
            <button onclick="App.cancelDesktopTask('${msg.id}')"
              style="padding:2px 9px;border-radius:20px;border:1px solid var(--red);background:none;color:var(--red);font-size:11px;cursor:pointer;transition:opacity .15s" title="Cancel task">
              <i class="ti ti-player-stop" style="font-size:10px"></i> Cancel
            </button>
          </div>
        </div>
        <div class="synth-loading" style="color:var(--tx2);padding:8px 0 4px">${esc(stepText)}</div>
      </div>`;
    } else if (as.status === 'step') {
      // Intermediate step — progress line + optional screenshot + cancel button
      agentHTML = `<div class="eval-card" style="border-color:rgba(251,146,60,.25)">
        <div class="eval-head">
          <i class="ti ti-device-desktop synth-icon" style="color:#fb923c"></i>
          <div>
            <div class="synth-title">Desktop Agent</div>
            <div class="synth-sub">Step ${as.stepNumber || '…'}</div>
          </div>
          <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;color:#fb923c;display:flex;align-items:center;gap:4px">
              <i class="ti ti-loader spin" style="font-size:12px"></i> Working
            </span>
            <button onclick="App.cancelDesktopTask('${msg.id}')"
              style="padding:2px 9px;border-radius:20px;border:1px solid var(--red);background:none;color:var(--red);font-size:11px;cursor:pointer" title="Cancel task">
              <i class="ti ti-player-stop" style="font-size:10px"></i> Cancel
            </button>
          </div>
        </div>
        <div style="padding:6px 0;font-size:13px;color:var(--tx2)">${esc(as.step || '')}</div>
        ${as.screenshot ? `<img src="data:image/png;base64,${as.screenshot}" style="width:100%;border-radius:6px;margin-top:8px;border:1px solid var(--bd)" alt="screenshot">` : ''}
      </div>`;
    } else if (as.status === 'done') {
      agentHTML = `<div class="eval-card" style="border-color:rgba(251,146,60,.3)">
        <div class="eval-head">
          <i class="ti ti-device-desktop synth-icon" style="color:#fb923c"></i>
          <div>
            <div class="synth-title">Desktop Agent</div>
            <div class="synth-sub">Claude Computer Use</div>
          </div>
          <div style="margin-left:auto;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:rgba(0,0,0,.15);color:var(--green)">DONE</div>
        </div>
        ${as.result ? `<div class="md" style="margin-top:8px">${marked.parse(as.result)}</div>` : ''}
        ${as.screenshot ? `<img src="data:image/png;base64,${as.screenshot}" style="width:100%;border-radius:6px;margin-top:8px;border:1px solid var(--bd)" alt="final screenshot">` : ''}
      </div>`;
    } else if (as.status === 'error') {
      agentHTML = `<div class="eval-card" style="border-color:rgba(239,68,68,.25)">
        <div class="eval-head">
          <i class="ti ti-device-desktop synth-icon" style="color:var(--red)"></i>
          <div>
            <div class="synth-title">Desktop Agent</div>
            <div class="synth-sub">Claude Computer Use</div>
          </div>
          <div style="margin-left:auto;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:rgba(0,0,0,.15);color:var(--red)">ERROR</div>
        </div>
        <div style="padding:6px 0;font-size:13px;color:var(--red)">${esc(as.error || 'Agent error')}</div>
      </div>`;
    }
  }

  // Council → Desktop handoff card (#71)
  // Appears below synthesis when the user clicks "Run on Desktop".
  let handoffHTML = '';
  if (v.handoffStatus) {
    const hs = v.handoffStatus;
    const isRunning = hs.status === 'running' || hs.status === 'step' || hs.status === 'sending';
    if (isRunning) {
      handoffHTML = `<div class="eval-card" style="border-color:rgba(251,146,60,.2)">
        <div class="eval-head">
          <i class="ti ti-device-desktop synth-icon" style="color:#fb923c"></i>
          <div><div class="synth-title">Executing on Desktop</div><div class="synth-sub">Agent is running the plan</div></div>
          <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;color:#fb923c;display:flex;align-items:center;gap:4px">
              <i class="ti ti-loader spin" style="font-size:12px"></i>
              Step ${hs.stepNumber || '…'}
            </span>
            <button onclick="App.cancelHandoff('${msg.id}')"
              style="padding:2px 9px;border-radius:20px;border:1px solid var(--red);background:none;color:var(--red);font-size:11px;cursor:pointer">
              <i class="ti ti-player-stop" style="font-size:10px"></i> Cancel
            </button>
          </div>
        </div>
        <div style="padding:6px 0;font-size:13px;color:var(--tx2)">${esc(hs.step || 'Working…')}</div>
        ${hs.screenshot ? `<img src="data:image/png;base64,${hs.screenshot}" style="width:100%;border-radius:6px;margin-top:8px;border:1px solid var(--bd)" alt="screenshot">` : ''}
      </div>`;
    } else if (hs.status === 'done') {
      handoffHTML = `<div class="eval-card" style="border-color:rgba(251,146,60,.3)">
        <div class="eval-head">
          <i class="ti ti-device-desktop synth-icon" style="color:#fb923c"></i>
          <div><div class="synth-title">Desktop Execution Complete</div><div class="synth-sub">Agent finished the plan</div></div>
          <div style="margin-left:auto;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:rgba(0,0,0,.15);color:var(--green)">DONE</div>
        </div>
        ${hs.result ? `<div class="md" style="margin-top:8px">${marked.parse(hs.result)}</div>` : ''}
        ${hs.screenshot ? `<img src="data:image/png;base64,${hs.screenshot}" style="width:100%;border-radius:6px;margin-top:8px;border:1px solid var(--bd)" alt="final screenshot">` : ''}
      </div>`;
    } else if (hs.status === 'error') {
      handoffHTML = `<div class="eval-card" style="border-color:rgba(239,68,68,.2)">
        <div class="eval-head">
          <i class="ti ti-device-desktop synth-icon" style="color:var(--red)"></i>
          <div><div class="synth-title">Desktop Execution Failed</div><div class="synth-sub">Agent encountered an error</div></div>
          <div style="margin-left:auto;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:rgba(0,0,0,.15);color:var(--red)">ERROR</div>
        </div>
        <div style="padding:6px 0;font-size:13px;color:var(--red)">${esc(hs.error || 'Agent error')}</div>
      </div>`;
    }
  }

  return `<div class="exchange" id="ex-${msg.id}">
    ${varNav}${userRow}${actions}
    <div id="edit-slot-${msg.id}"></div>
    ${agentHTML||councilHTML||synthHTML||evalHTML||factHTML||handoffHTML?`<div style="display:flex;flex-direction:column;gap:10px">${agentHTML}${councilHTML}${synthHTML}${evalHTML}${factHTML}${handoffHTML}</div>`:''}
  </div>`;
}

// ══════════════════════════════════════════════════════════════
//  VISUAL RENDERING
// ══════════════════════════════════════════════════════════════
function renderSynthesis(text, msgId) {
  let mIdx=0, cIdx=0;
  text = text.replace(/```mermaid\n([\s\S]*?)```/g, (_,code) => {
    const id=`mmd-${msgId}-${mIdx++}`;
    return `<div class="visual-block"><div class="visual-label"><i class="ti ti-graph"></i> Diagram</div>
      <div class="mermaid-wrap" id="${id}"><div class="mermaid">${esc(code.trim())}</div></div></div>`;
  });
  text = text.replace(/```chart\n([\s\S]*?)```/g, (_,json) => {
    const id=`chart-${msgId}-${cIdx++}`;
    return `<div class="visual-block"><div class="visual-label"><i class="ti ti-chart-bar"></i> Chart</div>
      <div class="chart-wrap"><canvas id="${id}" data-chart="${esc(json.trim())}"></canvas></div></div>`;
  });
  ['presentation','docx','xlsx','html-doc','csv'].forEach(tag => {
    text = text.replace(new RegExp('```'+tag+'\\n([\\s\\S]*?)```','g'), (_,content) =>
      `<div class="visual-block"><div class="visual-label"><i class="ti ti-file"></i> ${tag.toUpperCase()}</div>
        <div style="display:none" class="doc-data-${msgId}-${tag}">${esc(content.trim())}</div></div>`
    );
  });
  return marked.parse(text);
}

function renderVisuals() {
  if (typeof mermaid!=='undefined') mermaid.run({querySelector:'.mermaid'}).catch(()=>{});
  document.querySelectorAll('canvas[data-chart]').forEach(canvas => {
    if (canvas._chart) return;
    try {
      const raw=canvas.dataset.chart.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
      const cfg=JSON.parse(raw);
      cfg.options=cfg.options||{};cfg.options.plugins=cfg.options.plugins||{};
      cfg.options.plugins.legend={...(cfg.options.plugins.legend||{}),labels:{color:'#8888aa'}};
      if(cfg.options.scales)Object.values(cfg.options.scales).forEach(ax=>{
        ax.ticks={...(ax.ticks||{}),color:'#8888aa'};ax.grid={...(ax.grid||{}),color:'#2e2e42'};
      });
      canvas._chart = new Chart(canvas,cfg);
    } catch(e){canvas.parentElement.innerHTML=`<p style="color:var(--red);font-size:12px">Chart error: ${e.message}</p>`;}
  });
}

// ══════════════════════════════════════════════════════════════
//  FILES MODAL
// ══════════════════════════════════════════════════════════════
async function openFiles(){
  S.storedFiles=await DB.listFiles();
  document.getElementById('badge-files').textContent=S.storedFiles.length;
  renderFilesModal();
  document.getElementById('modal-files').style.display='flex';
  document.getElementById('overlay').classList.add('open');
}
function renderFilesModal(){
  const body=document.getElementById('body-files');
  if(!S.storedFiles.length){body.innerHTML=`<div class="note">${t('no_files')}</div>`;return;}
  body.innerHTML=`<div class="sec">
    <p class="sec-title">${S.storedFiles.length} files${S.cfg.r2?.ok?' (Cloudflare R2)':' (local)'}</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${S.storedFiles.map(f=>`<div class="file-row">
        <i class="ti ${fileIcon(f.type||'',f.name)}" style="font-size:20px;color:var(--ac);flex-shrink:0"></i>
        <div class="file-row-info">
          <div class="file-row-name">${esc(f.name)}</div>
          <div class="file-row-meta">${f.type||''} · ${f.size?(f.size/1024).toFixed(0)+'KB':''} · ${fmtDate(f.created_at)}</div>
        </div>
        ${f.url?`<a href="${esc(f.url)}" target="_blank" class="btn-sm btn-ghost" style="text-decoration:none"><i class="ti ti-external-link"></i></a>`:''}
        <button class="btn-sm btn-danger" onclick="App.deleteStoredFile('${f.id||f.r2_key}','${esc(f.r2_key||'')}')"><i class="ti ti-trash"></i></button>
      </div>`).join('')}
    </div></div>`;
}
async function deleteStoredFile(id,r2Key){
  if(!confirm(t('delete_file_confirm')))return;
  if(r2Key&&S.cfg.r2?.ok)await fetch('/api/delete-r2',{method:'POST',headers: AUTH.headers(),body:JSON.stringify({r2Key})});
  await DB.deleteFile(id);
  S.storedFiles=S.storedFiles.filter(f=>f.id!==id&&f.r2_key!==r2Key);
  renderFilesModal();document.getElementById('badge-files').textContent=S.storedFiles.length;
}

// ══════════════════════════════════════════════════════════════
//  MODELS MODAL
// ══════════════════════════════════════════════════════════════
function openModels(){renderModelsModal();document.getElementById('modal-models').style.display='flex';document.getElementById('overlay').classList.add('open');}
function renderModelsModal(){
  const body=document.getElementById('body-models');
  const inUse=new Set(S.models.map(m=>m.id));
  const notAdded=CATALOG.filter(c=>!inUse.has(c.id));
  body.innerHTML=`<div class="sec"><p class="sec-title">${t('active_models')} (${S.models.length})</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${S.models.map(m=>{
        const avail=!!S.cfg.providers[m.provider];const custom=m.provider==='custom';
        return `<div class="mcat ${m.enabled&&avail?'on':''}" style="--mc:${m.accent}">
          <div class="mcat-head">
            <div style="width:10px;height:10px;border-radius:50%;background:${m.accent};flex-shrink:0"></div>
            <div class="mcat-info">
              <div class="mcat-name">${esc(m.name)} <span style="font-size:10px;color:${avail?'var(--green)':'var(--red)'}">${avail?'✓ '+t('active'):'! '+t('no_key')}</span></div>
              <div class="mcat-meta">${esc(m.role)} · ${m.provider}${m.hasVision?' · vision ✓':' · text only'}</div>
            </div>
            <label class="toggle"><input type="checkbox" ${m.enabled?'checked':''} onchange="App._tog('${m.id}',this.checked)"><div class="ttrack"></div></label>
            <button class="btn-icon" onclick="App._rm('${m.id}')" style="color:var(--tx3)"><i class="ti ti-trash"></i></button>
          </div>
          <div class="mcat-body">
            <div class="mcat-row">
              <div class="mcat-field"><label>${t('display_name')}</label><input class="mcat-input" type="text" value="${esc(m.name)}" oninput="App._fld('${m.id}','name',this.value)"></div>
              <div class="mcat-field"><label>${t('role_in_council')}</label><input class="mcat-input" type="text" value="${esc(m.role)}" oninput="App._fld('${m.id}','role',this.value)"></div>
            </div>
            ${custom?`<div class="mcat-row">
              <div class="mcat-field"><label>Base URL</label><input class="mcat-input" type="text" value="${esc(m.baseUrl||'')}" placeholder="https://..." oninput="App._fld('${m.id}','baseUrl',this.value)"></div>
              <div class="mcat-field"><label>Model ID</label><input class="mcat-input" type="text" value="${esc(m.modelName||'')}" placeholder="model-name" oninput="App._fld('${m.id}','modelName',this.value)"></div>
            </div>`:''}
            ${!avail?`<p style="font-size:11px;color:var(--red);margin-top:4px"><i class="ti ti-alert-circle"></i> Add <code style="font-size:10px;background:var(--bg5);padding:1px 4px;border-radius:3px">${envKey(m.provider)}</code> in Netlify → Environment Variables</p>`:''}
          </div></div>`;
      }).join('')}
    </div></div>
    ${notAdded.length?`<div class="sec"><p class="sec-title">${t('add_from_catalog')}</p>
      ${notAdded.map(c=>`<button class="add-btn" onclick="App._addC('${c.id}')">
        <div style="width:9px;height:9px;border-radius:50%;background:${c.accent}"></div>
        <span>${c.name}</span><span style="color:var(--tx3);font-size:11px;margin-left:auto">${c.role}</span>
      </button>`).join('')}</div>`:''}
    <div class="sec"><p class="sec-title">${t('custom_model')}</p>
      <button class="add-btn" onclick="App._addCustom()"><i class="ti ti-plus"></i><span>${t('add_custom')}</span></button>
    </div>`;
}

// ══════════════════════════════════════════════════════════════
//  SETTINGS MODAL
// ══════════════════════════════════════════════════════════════
function renderSettings(){
  const body=document.getElementById('body-settings');
  const sbUrl=LS.get('sb_url','');const sbAnon=LS.get('sb_anon','');
  body.innerHTML=`<div class="sec">
    <p class="sec-title">${t('api_keys_status')}</p>
    <div class="note">${t('api_keys_note')}<br><br>${t('how_to_add')}</div>
    ${S.models.map(m=>`<div class="key-item">
      <div class="key-dot" style="background:${m.accent}"></div>
      <div class="key-info"><div class="key-name">${m.name}</div><div class="key-env">${envKey(m.provider)}</div></div>
      ${S.cfg.providers[m.provider]?`<span class="tag-ok">✓ ${t('configured')}</span>`:`<span class="tag-miss">${t('missing')}</span>`}
    </div>`).join('')}
    <button class="btn-sm btn-ghost" onclick="App._recheck()" style="margin-top:4px"><i class="ti ti-refresh"></i> ${t('reload_status')}</button>
  </div>
  <div class="sec"><p class="sec-title">${t('r2_title')}</p>
    <div class="note">${t('r2_title')}: <strong style="color:${S.cfg.r2?.ok?'var(--green)':'var(--yellow)'}">${S.cfg.r2?.ok?t('r2_configured'):t('r2_not_configured')}</strong><br><br>
      Netlify env vars: <code>R2_ACCOUNT_ID</code> · <code>R2_ACCESS_KEY_ID</code> · <code>R2_SECRET_ACCESS_KEY</code> · <code>R2_BUCKET_NAME</code> · <code>R2_PUBLIC_URL</code>
    </div></div>
  <div class="sec"><p class="sec-title">${t('supabase_title')}</p>
    <div class="note">${S.cfg.supabase?.ok||S.sbClient?`<strong style="color:var(--green)">✓ ${t('db_connected')}</strong>`:`<strong style="color:var(--yellow)">⚠ ${t('db_local')}</strong>`}</div>
    <div class="field"><label>Supabase URL</label><input class="field-input" id="sb-url" type="text" placeholder="https://xxx.supabase.co" value="${esc(sbUrl)}" oninput="LS.set('sb_url',this.value)"></div>
    <div class="field"><label>Anon Key</label><input class="field-input" id="sb-anon" type="password" placeholder="eyJh..." value="${esc(sbAnon)}" oninput="LS.set('sb_anon',this.value)"></div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button class="btn-sm btn-primary" onclick="App._connDB()"><i class="ti ti-plug"></i> Connect</button>
      <a href="https://supabase.com/dashboard" target="_blank" class="btn-sm btn-ghost" style="text-decoration:none"><i class="ti ti-external-link"></i> Dashboard</a>
    </div></div>
  <div class="sec"><p class="sec-title">${t('local_data')}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-sm btn-ghost" onclick="App._backup()"><i class="ti ti-download"></i> ${t('export_backup')}</button>
      <button class="btn-sm btn-danger" onclick="App._clearAll()"><i class="ti ti-trash"></i> ${t('delete_all')}</button>
    </div></div>
  ${window.electronAPI ? `<div class="sec"><p class="sec-title">Desktop App</p>
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0">
      <label style="font-size:13px;color:var(--tx2);flex:1">Launch on login</label>
      <input type="checkbox" id="login-item-chk" style="width:16px;height:16px;cursor:pointer"
        onchange="window.electronAPI.setLoginItem(this.checked)">
    </div>
    <div id="login-item-loading" style="display:none"></div>
    <div style="font-size:11px;color:var(--tx3);margin-top:2px">Shortcut: Cmd/Ctrl+Shift+A — show/hide window from anywhere</div>
  </div>` : ''}`;
}

// ══════════════════════════════════════════════════════════════
//  MODALS
// ══════════════════════════════════════════════════════════════
function closeModals(){
  ['modal-models','modal-files','modal-settings'].forEach(id=>{document.getElementById(id).style.display='none';});
  document.getElementById('overlay').classList.remove('open');
  renderStrip();renderSidebar();
}
function openSettings(){
  renderSettings();
  document.getElementById('modal-settings').style.display='flex';
  document.getElementById('overlay').classList.add('open');
  // Populate Electron login-item checkbox (can't use <script> inside innerHTML)
  if(window.electronAPI){
    window.electronAPI.getLoginItem().then(v=>{
      const el=document.getElementById('login-item-chk');if(el)el.checked=v;
    }).catch(()=>{});
  }
}
function closeOverlay(e){if(e.target===document.getElementById('overlay'))closeModals();}

// ══════════════════════════════════════════════════════════════
//  DOC GENERATORS
// ══════════════════════════════════════════════════════════════
function getSynthText(id){const m=S.messages.find(x=>x.id===id);return m?.variants[m.activeVariant]?.synthesis||'';}
function getDocData(msgId,type){const el=document.querySelector(`.doc-data-${msgId}-${type}`);if(!el)return null;return el.textContent.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');}
function dlMd(id){const t2=getSynthText(id);if(t2)dl(t2,`synthesis_${id}.md`,'text/markdown');}
function copy(id){const t2=getSynthText(id);if(t2)navigator.clipboard?.writeText(t2);}
function dlPdf(id){
  const t2=getSynthText(id);if(!t2)return;
  if(typeof window.jspdf==='undefined'){alert('jsPDF not loaded.');return;}
  const {jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'p',unit:'mm',format:'a4'});
  const lines=t2.replace(/[#*`]/g,'').split('\n').filter(l=>l.trim());let y=20;
  lines.forEach(line=>{if(y>270){doc.addPage();y=20;}doc.setFontSize(line.match(/^#+/)?14:11);doc.text(doc.splitTextToSize(line.slice(0,200),170),15,y);y+=line.match(/^#+/)?8:6;});
  doc.save(`GenX_${id}.pdf`);
}
function dlPptx(id){const raw=getDocData(id,'presentation');let cfg;if(raw){try{cfg=JSON.parse(raw);}catch{}}if(!cfg){const t2=getSynthText(id);cfg=autoToPptx(t2,S.messages.find(m=>m.id===id)?.variants[0]?.userText||'');}buildPptx(cfg);}
function dlXlsx(id){const raw=getDocData(id,'xlsx');let cfg;if(raw){try{cfg=JSON.parse(raw);}catch{}}if(!cfg||!cfg.sheets)cfg=mdToXlsx(getSynthText(id));buildXlsx(cfg);}
function dlDocx(id){const raw=getDocData(id,'docx');let cfg;if(raw){try{cfg=JSON.parse(raw);}catch{}}buildDocxFromText(cfg||{},getSynthText(id));}
function dlHtml(id){const raw=getDocData(id,'html-doc');if(raw){dl(raw,`doc_${id}.html`,'text/html');return;}const t2=getSynthText(id);const html=`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>GenX</title><style>body{font-family:system-ui;max-width:900px;margin:0 auto;padding:2rem;line-height:1.7}h1,h2,h3{color:#333}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px}th{background:#f5f5f5}code{background:#f0f0f0;padding:2px 5px;border-radius:3px}pre{background:#f0f0f0;padding:1rem;border-radius:6px;overflow-x:auto}</style></head><body>${marked.parse(t2)}</body></html>`;dl(html,`doc_${id}.html`,'text/html');}
function dlCsv(id){const raw=getDocData(id,'csv');if(raw){dl(raw,`data_${id}.csv`,'text/csv');return;}const t2=getSynthText(id);const m=t2.match(/\|.+\|[\s\S]*?\n(?=\n|$)/);if(m){const csv=m[0].split('\n').filter(r=>!r.match(/^[\|\s\-:]+$/)).map(r=>r.split('|').filter(c=>c.trim()).map(c=>`"${c.trim()}"`).join(',')).join('\n');dl(csv,`data_${id}.csv`,'text/csv');}}

function autoToPptx(text,title){const slides=[];let cur=null;text.split('\n').forEach(line=>{if(line.startsWith('## ')||line.startsWith('### ')){if(cur)slides.push(cur);cur={title:line.replace(/^#+\s*/,'').replace(/[✅💡⚠🎯]/g,'').trim(),bullets:[],notes:''};}else if(cur&&(line.startsWith('- ')||line.startsWith('* '))){cur.bullets.push(line.slice(2).trim());}else if(cur&&line.trim()&&!line.startsWith('```')){cur.notes+=line.trim()+' ';}});if(cur)slides.push(cur);return{title:title||'GenX',subtitle:'Generated by GenX',slides:slides.slice(0,15)};}
function buildPptx(cfg){if(typeof PptxGenJS==='undefined'){alert('PptxGenJS not loaded.');return;}const prs=new PptxGenJS();prs.layout='LAYOUT_WIDE';prs.author='GenX';const ts=prs.addSlide();ts.background={color:'0f0f13'};ts.addText(cfg.title||'Presentation',{x:.5,y:1.5,w:12,h:1.5,fontSize:40,color:'E8E8F2',bold:true,align:'center'});if(cfg.subtitle)ts.addText(cfg.subtitle,{x:.5,y:3.2,w:12,h:.6,fontSize:20,color:'8888AA',align:'center'});ts.addText('GenX',{x:.5,y:6.8,w:12,h:.3,fontSize:12,color:'4a7fc1',align:'center'});(cfg.slides||[]).forEach((slide,i)=>{const s=prs.addSlide();s.background={color:'0f0f13'};s.addText(slide.title||`Slide ${i+1}`,{x:.5,y:.3,w:12,h:.8,fontSize:26,color:'E8E8F2',bold:true});s.addShape(prs.ShapeType.rect,{x:.5,y:1.2,w:12,h:.03,fill:{color:'4a7fc1'}});if(slide.bullets?.length){const bt=slide.bullets.slice(0,8).map(b=>({text:b,options:{bullet:{code:'2022'},fontSize:18,color:'E8E8F2',paraSpaceBefore:10}}));s.addText(bt,{x:.5,y:1.4,w:12,h:4.5,valign:'top'});}if(slide.notes)s.addNotes(slide.notes);s.addText(`${i+2}`,{x:12.3,y:6.9,w:.5,h:.3,fontSize:11,color:'444466',align:'right'});});prs.writeFile({fileName:`GenX_${Date.now()}.pptx`});}
function mdToXlsx(text){const sheets=[];let cur=null;text.split('\n').forEach(line=>{if(line.startsWith('## ')||line.startsWith('### ')){if(cur)sheets.push(cur);cur={name:line.replace(/^#+\s*/,'').slice(0,31),headers:[],rows:[]};}else if(cur&&line.match(/^\|.+\|$/)){const cells=line.split('|').filter(c=>c.trim());if(!cur.headers.length&&!line.match(/^[\|\s\-:]+$/))cur.headers=cells.map(c=>c.trim());else if(!line.match(/^[\|\s\-:]+$/))cur.rows.push(cells.map(c=>c.trim()));}});if(cur)sheets.push(cur);if(!sheets.length)sheets.push({name:'Sheet1',headers:['Content'],rows:text.split('\n').filter(l=>l.trim()).map(l=>[l])});return{sheets};}
function buildXlsx(cfg){if(typeof XLSX==='undefined'){alert('SheetJS not loaded.');return;}const wb=XLSX.utils.book_new();(cfg.sheets||[]).forEach(sheet=>{const data=[sheet.headers||[],...(sheet.rows||[])];const ws=XLSX.utils.aoa_to_sheet(data);XLSX.utils.book_append_sheet(wb,ws,(sheet.name||'Sheet1').slice(0,31));});XLSX.writeFile(wb,`GenX_${Date.now()}.xlsx`);}
function buildDocxFromText(cfg,rawText){if(typeof docx==='undefined'){dl(rawText,'document.md','text/markdown');return;}const{Document,Packer,Paragraph,TextRun,HeadingLevel}=docx;const children=[];(rawText||'').split('\n').forEach(line=>{if(line.startsWith('# '))children.push(new Paragraph({text:line.slice(2),heading:HeadingLevel.HEADING_1}));else if(line.startsWith('## '))children.push(new Paragraph({text:line.slice(3),heading:HeadingLevel.HEADING_2}));else if(line.startsWith('### '))children.push(new Paragraph({text:line.slice(4),heading:HeadingLevel.HEADING_3}));else if(line.startsWith('- '))children.push(new Paragraph({text:line.slice(2),bullet:{level:0}}));else if(line.trim())children.push(new Paragraph({children:[new TextRun(line)]}));else children.push(new Paragraph({}));});const doc2=new Document({sections:[{properties:{},children}]});Packer.toBlob(doc2).then(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`GenX_${Date.now()}.docx`;a.click();});}

// ══════════════════════════════════════════════════════════════
//  USAGE / COST DASHBOARD
// ══════════════════════════════════════════════════════════════
async function openUsage() {
  const body = document.getElementById('body-settings');
  document.getElementById('modal-settings').style.display = 'flex';
  document.getElementById('overlay').classList.add('open');
  document.getElementById('modal-settings').querySelector('.modal-head h2').innerHTML =
    '<i class="ti ti-chart-bar"></i> Usage & Cost';

  if (!S.sbClient) {
    body.innerHTML = '<div class="note" style="text-align:center;padding:32px;color:var(--tx2)">Supabase not connected — connect it in Settings to enable usage tracking.</div>';
    return;
  }

  body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:40px;gap:10px"><i class="ti ti-loader spin" style="font-size:20px"></i> Loading usage...</div>';

  try {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { data, error } = await S.sbClient.from('usage_log')
      .select('provider, input_tokens, output_tokens, total_tokens')
      .eq('user_id', AUTH.userId)
      .gte('created_at', monthStart);

    if (error) throw new Error(error.message);

    if (!data?.length) {
      body.innerHTML = '<div class="note" style="text-align:center;padding:40px;color:var(--tx2)">No usage recorded this month.</div>';
      return;
    }

    // Aggregate by provider
    const byProvider = {};
    data.forEach(row => {
      if (!byProvider[row.provider]) byProvider[row.provider] = { input: 0, output: 0, total: 0 };
      byProvider[row.provider].input  += row.input_tokens  || 0;
      byProvider[row.provider].output += row.output_tokens || 0;
      byProvider[row.provider].total  += row.total_tokens  || 0;
    });

    // Approximate cost per 1M tokens (blended mid-2025 prices)
    const PRICE = {
      anthropic: { i: 3.00,  o: 15.00 },
      openai:    { i: 2.50,  o: 10.00 },
      google:    { i: 0.075, o: 0.30  },
      deepseek:  { i: 0.14,  o: 0.28  },
      xai:       { i: 5.00,  o: 15.00 },
      groq:      { i: 0.59,  o: 0.79  },
      mistral:   { i: 2.00,  o: 6.00  },
      together:  { i: 0.90,  o: 0.90  },
    };
    const ACCENT = {
      anthropic:'#CF6A2F', openai:'#10A37F', google:'#4285F4', deepseek:'#7C3AED',
      xai:'#1C9BEF', groq:'#f97316', mistral:'#ff7a59', together:'#6366f1',
    };

    const rows = Object.entries(byProvider).map(([p, v]) => {
      const pr = PRICE[p] || { i: 1, o: 1 };
      const cost = ((v.input / 1e6) * pr.i + (v.output / 1e6) * pr.o).toFixed(4);
      return { provider: p, ...v, cost, color: ACCENT[p] || '#888' };
    }).sort((a, b) => b.total - a.total);

    const totalTokens = rows.reduce((s, r) => s + r.total, 0);
    const totalCost   = rows.reduce((s, r) => s + parseFloat(r.cost), 0).toFixed(4);
    const monthLabel  = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

    body.innerHTML = `
      <div class="sec-title" style="margin-bottom:4px">Usage — ${monthLabel}</div>
      <div style="font-size:12px;color:var(--tx3);margin-bottom:16px">
        <strong style="color:var(--tx)">${totalTokens.toLocaleString()}</strong> tokens &nbsp;·&nbsp;
        ~<strong style="color:var(--green)">$${totalCost}</strong> estimated &nbsp;·&nbsp;
        user: <code style="font-size:11px">${esc(AUTH.userId)}</code>
      </div>
      <canvas id="usage-chart" height="160" style="margin-bottom:20px;max-width:100%"></canvas>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="color:var(--tx3)">
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd)">Provider</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--bd)">Input</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--bd)">Output</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--bd)">Total</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--bd)">~Cost</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td style="padding:6px 8px;border-bottom:1px solid var(--bd)">
              <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${r.color};margin-right:6px;vertical-align:middle"></span>${r.provider}
            </td>
            <td style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--bd);color:var(--tx3)">${r.input.toLocaleString()}</td>
            <td style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--bd);color:var(--tx3)">${r.output.toLocaleString()}</td>
            <td style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--bd)">${r.total.toLocaleString()}</td>
            <td style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--bd);color:var(--green)">$${r.cost}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;

    // Bar chart via Chart.js (already loaded in index.html)
    if (typeof Chart !== 'undefined') {
      const ctx = document.getElementById('usage-chart')?.getContext('2d');
      if (ctx) {
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels: rows.map(r => r.provider),
            datasets: [{
              label: 'Total Tokens',
              data: rows.map(r => r.total),
              backgroundColor: rows.map(r => r.color),
              borderRadius: 5,
            }],
          },
          options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
              y: { beginAtZero: true, ticks: { color: '#888', font: { size: 11 } }, grid: { color: 'rgba(128,128,128,.15)' } },
              x: { ticks: { color: '#aaa', font: { size: 11 } }, grid: { display: false } },
            },
          },
        });
      }
    }
  } catch(e) {
    body.innerHTML = '<div class="note" style="color:var(--red);padding:20px">Error loading usage: ' + esc(e.message) + '</div>';
  }
}
