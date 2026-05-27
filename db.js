/* ================================================================
   db.js  —  Supabase + localStorage data layer
   Loaded before app.js. All methods reference globals (S, AUTH, LS)
   that are defined at call-time in app.js — no import needed.
   ================================================================ */

// ══════════════════════════════════════════════════════════════
//  DB — user-scoped queries
// ══════════════════════════════════════════════════════════════
const DB = {
  uid() { return AUTH.userId; },

  async listChats() {
    if (S.sbClient) {
      const { data } = await S.sbClient.from('chats').select('*')
        .eq('user_id', this.uid()).order('updated_at', { ascending: false }).limit(200);
      if (data) return data;
    }
    return LS.get('chats', []);
  },
  async saveChat(c) {
    const chat = { ...c, user_id: this.uid() };
    if (S.sbClient) await S.sbClient.from('chats').upsert(chat);
    const arr = LS.get('chats', []); const i = arr.findIndex(x=>x.id===c.id);
    if (i>=0) arr[i]=chat; else arr.unshift(chat); LS.set('chats', arr);
  },
  async deleteChat(id) {
    if (S.sbClient) await S.sbClient.from('chats').delete().eq('id', id).eq('user_id', this.uid());
    LS.set('chats', LS.get('chats',[]).filter(c=>c.id!==id)); LS.del('msgs_'+id);
  },
  async loadMessages(chatId) {
    if (S.sbClient) {
      const { data } = await S.sbClient.from('messages').select('*')
        .eq('chat_id', chatId).eq('user_id', this.uid()).order('seq', { ascending: true });
      if (data) return data.map(normMsg);
    }
    return LS.get('msgs_'+chatId, []).map(normMsg);
  },
  async saveMsg(chatId, msg) {
    const r = { ...msg, chat_id: chatId, user_id: this.uid() };
    if (S.sbClient) {
      // Only send columns that exist in the schema.
      // Strip client-only fields (activeVariant camelCase, role, content, etc.)
      // and remove raw base64 from attachment objects to avoid payload bloat.
      const dbRow = {
        id:             r.id,
        chat_id:        r.chat_id,
        user_id:        r.user_id,
        seq:            r.seq ?? 0,
        active_variant: r.activeVariant ?? r.active_variant ?? 0,
        variants: (r.variants || []).map(v => ({
          ...v,
          attachments: (v.attachments || []).map(({ data, ...rest }) => rest),
        })),
        updated_at: new Date().toISOString(),
      };
      await S.sbClient.from('messages').upsert(dbRow).catch(() => {});
    }
    const arr = LS.get('msgs_'+chatId, []); const i = arr.findIndex(m=>m.id===msg.id);
    if (i>=0) arr[i]=r; else arr.push(r); LS.set('msgs_'+chatId, arr);
  },
  async listFiles() {
    if (S.sbClient) {
      // Exclude extracted_text — can be many MB per file, not needed for the listing view
      const { data } = await S.sbClient
        .from('stored_files')
        .select('id, user_id, r2_key, url, name, type, size, chat_id, job_id, created_at')
        .eq('user_id', this.uid())
        .order('created_at', { ascending: false })
        .limit(200);
      if (data) return data;
    }
    return LS.get('stored_files', []);
  },
  async saveFile(f) {
    const file = { ...f, user_id: this.uid() };
    if (S.sbClient) await S.sbClient.from('stored_files').upsert(file);
    const arr = LS.get('stored_files', []); arr.unshift(file); LS.set('stored_files', arr);
  },
  async deleteFile(id) {
    if (S.sbClient) await S.sbClient.from('stored_files').delete().eq('id', id).eq('user_id', this.uid());
    LS.set('stored_files', LS.get('stored_files',[]).filter(f=>f.id!==id));
  },

  // ── User-learned skills (synced via Supabase, fallback to LS) ──
  async loadCustomSkills() {
    if (S.sbClient) {
      try {
        const { data } = await S.sbClient.from('user_skills').select('skill_json').eq('user_id', this.uid());
        if (data?.length) {
          const skills = {};
          data.forEach(row => {
            try {
              const s = typeof row.skill_json === 'string' ? JSON.parse(row.skill_json) : row.skill_json;
              if (s?.id) skills[s.id] = s;
            } catch {}
          });
          LS.set('custom_skills', skills); // keep LS in sync
          return skills;
        }
      } catch {}
    }
    return LS.get('custom_skills', {});
  },

  async saveCustomSkill(skill) {
    const row = { user_id: this.uid(), skill_id: skill.id, skill_json: JSON.stringify(skill), updated_at: new Date().toISOString() };
    if (S.sbClient) {
      try { await S.sbClient.from('user_skills').upsert(row); } catch {}
    }
    S.customSkills[skill.id] = skill;
    LS.set('custom_skills', S.customSkills);
  },

  async deleteCustomSkill(skillId) {
    if (S.sbClient) {
      try { await S.sbClient.from('user_skills').delete().eq('user_id', this.uid()).eq('skill_id', skillId); } catch {}
    }
    delete S.customSkills[skillId];
    delete S.skills[skillId];
    LS.set('custom_skills', S.customSkills);
  },
};

function normMsg(m) {
  if (!m.variants||!Array.isArray(m.variants)||!m.variants.length) {
    m.variants=[{userText:m.user_text||'',attachments:[],responses:m.responses||[],synthesis:m.synthesis??null}];
    m.activeVariant=0;
  }
  m.variants = m.variants.map(v=>({...v,attachments:v.attachments||[]}));
  return m;
}
