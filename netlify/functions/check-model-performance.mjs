/* ================================================================
   check-model-performance.mjs  —  Weekly adaptive role monitor (#12)
   Netlify Functions v2 (ESM + scheduled function)

   Runs every Monday at 08:00 UTC.
   Queries model_performance for models that have been
   consistently underperforming in their assigned role for 3+ weeks,
   then writes a notification to the Supabase notifications table.

   The UI reads unread notifications on boot and shows a banner:
   "DeepSeek has scored below average on technical questions
    — consider reassigning the Engineer role."
   ================================================================ */

// Netlify scheduled function config
export const config = {
  schedule: '0 8 * * 1',  // Every Monday at 08:00 UTC
};

// Model → role assignment + expected question types (mirrors CATALOG in app.js)
const MODEL_ROLES = {
  'Claude Sonnet 4':  { role: 'Analyst & Moderator',  strongIn: ['analysis', 'creative', 'research'] },
  'GPT-4o':           { role: 'Product Strategist',   strongIn: ['analysis', 'other', 'creative']    },
  'GPT-4o Mini':      { role: 'Fast Assistant',       strongIn: ['other', 'code']                    },
  'Gemini 2.0 Flash': { role: 'Research Analyst',     strongIn: ['research', 'math']                 },
  'DeepSeek V3':      { role: 'Technical Architect',  strongIn: ['code', 'math']                     },
  'Grok 3 Fast':      { role: 'Contrarian & Critic',  strongIn: ['analysis', 'creative', 'other']    },
  'Llama 3.3 (Groq)': { role: 'Fast Reasoning',       strongIn: ['code', 'math']                     },
  'Mistral Large':    { role: 'Generalist',            strongIn: ['creative', 'research', 'other']    },
};

const UNDERPERFORM_THRESHOLD = 0.8; // below 80% of the top model's score = underperforming
const MIN_SAMPLES = 5;              // need this many samples before making judgements

// Maps a model's empirically best question type to a descriptive role name.
// Used when auto-reassigning roles based on actual performance data.
const QTYPE_TO_ROLE = {
  code:     'Technical Architect',
  math:     'Quantitative Analyst',
  research: 'Research Analyst',
  analysis: 'Strategic Analyst',
  creative: 'Creative Specialist',
  other:    'Generalist',
};

export default async () => {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!sbUrl || !sbKey) {
    console.log('[check-model-performance] Supabase not configured, skipping');
    return new Response('OK', { status: 200 });
  }

  try {
    // ── Fetch all model performance data ─────────────────────
    const perfRes = await fetch(
      `${sbUrl}/rest/v1/model_performance?select=model_name,question_type,avg_score,sample_count`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
    );
    const perfRows = await perfRes.json();
    if (!Array.isArray(perfRows) || !perfRows.length) {
      console.log('[check-model-performance] No performance data yet');
      return new Response('OK', { status: 200 });
    }

    // Build lookup: { questionType: { modelName: { avg_score, sample_count } } }
    const perf = {};
    for (const row of perfRows) {
      if (!perf[row.question_type]) perf[row.question_type] = {};
      perf[row.question_type][row.model_name] = row;
    }

    const notifications = [];

    for (const [modelName, { role, strongIn }] of Object.entries(MODEL_ROLES)) {
      for (const qType of strongIn) {
        const typeData = perf[qType] || {};
        const modelData = typeData[modelName];
        if (!modelData || modelData.sample_count < MIN_SAMPLES) continue;

        // Find the top scorer for this question type
        const allScores = Object.values(typeData).filter(d => d.sample_count >= MIN_SAMPLES);
        if (!allScores.length) continue;
        const topScore = Math.max(...allScores.map(d => d.avg_score));

        const ratio = modelData.avg_score / topScore;
        if (ratio < UNDERPERFORM_THRESHOLD) {
          // Find who IS the top performer
          const topEntry = Object.entries(typeData)
            .filter(([, d]) => d.sample_count >= MIN_SAMPLES)
            .sort(([, a], [, b]) => b.avg_score - a.avg_score)[0];
          const topModelName = topEntry?.[0] || 'another model';

          notifications.push({
            type: 'role_reassignment',
            message:
              `${modelName} has averaged ${modelData.avg_score.toFixed(1)}/10 on ${qType} questions ` +
              `(${Math.round(ratio * 100)}% of ${topModelName}'s ${topScore.toFixed(1)}/10). ` +
              `Consider reassigning the "${role}" role.`,
            data: {
              model_name: modelName,
              role,
              question_type: qType,
              avg_score: modelData.avg_score,
              sample_count: modelData.sample_count,
              top_model: topModelName,
              top_score: topScore,
              ratio: Math.round(ratio * 100),
            },
          });
        }
      }
    }

    // ── Compute optimal role assignments ─────────────────────────
    // For each model with enough data, find their empirically best question type.
    // If it differs from their expected role, auto-reassign.
    const roleOverrides = {};  // { modelName: newRole }
    for (const [modelName, { role, strongIn }] of Object.entries(MODEL_ROLES)) {
      // Find all question type entries for this model with enough samples
      const modelScores = Object.entries(perf)
        .map(([qType, models]) => {
          const d = models[modelName];
          if (!d || d.sample_count < MIN_SAMPLES) return null;
          return { qType, avg_score: d.avg_score };
        })
        .filter(Boolean);

      if (modelScores.length < 2) continue; // not enough data to reassign

      // Find their empirical best question type
      modelScores.sort((a, b) => b.avg_score - a.avg_score);
      const bestQType = modelScores[0].qType;

      // Only reassign if their best type is NOT among their expected strong types
      // AND they are clearly underperforming in their expected types
      const isUnderperformingInRole = strongIn.some(qt => {
        const typeData = perf[qt] || {};
        const d = typeData[modelName];
        if (!d || d.sample_count < MIN_SAMPLES) return false;
        const allScores = Object.values(typeData).filter(x => x.sample_count >= MIN_SAMPLES);
        if (!allScores.length) return false;
        const topScore = Math.max(...allScores.map(x => x.avg_score));
        return d.avg_score / topScore < UNDERPERFORM_THRESHOLD;
      });

      if (isUnderperformingInRole && !strongIn.includes(bestQType)) {
        const newRole = QTYPE_TO_ROLE[bestQType] || role;
        if (newRole !== role) {
          roleOverrides[modelName] = newRole;
          console.log(`[check-model-performance] Role override: ${modelName}: "${role}" → "${newRole}" (best at ${bestQType})`);
        }
      }
    }

    // ── Persist role overrides to preferences table ───────────────
    // Written with user_id='default' so all users benefit from the learning.
    // The client app reads this on boot and applies overrides to model payloads.
    if (Object.keys(roleOverrides).length) {
      await fetch(`${sbUrl}/rest/v1/preferences`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: sbKey, Authorization: `Bearer ${sbKey}`,
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          user_id: 'default',
          key: 'role_overrides',
          value: roleOverrides,
          updated_at: new Date().toISOString(),
        }),
      });
      console.log(`[check-model-performance] Wrote ${Object.keys(roleOverrides).length} role overrides to preferences`);
    }

    if (!notifications.length) {
      const msg = Object.keys(roleOverrides).length
        ? `OK: No notifications, ${Object.keys(roleOverrides).length} role overrides computed`
        : 'OK: All models performing within threshold';
      console.log('[check-model-performance] ' + msg);
      return new Response(msg, { status: 200 });
    }

    // ── Write notifications (for all users — user_id 'default') ─
    // In a multi-user setup, iterate over all user IDs.
    // For now, writes to user_id 'default' which covers most deployments.
    for (const notif of notifications) {
      await fetch(`${sbUrl}/rest/v1/notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: sbKey, Authorization: `Bearer ${sbKey}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          user_id: 'default',
          type: notif.type,
          message: notif.message,
          data: notif.data,
          read: false,
          created_at: new Date().toISOString(),
        }),
      });
      console.log(`[check-model-performance] Notification: ${notif.message}`);
    }

    return new Response(`OK: ${notifications.length} notifications, ${Object.keys(roleOverrides).length} role overrides`, { status: 200 });
  } catch (e) {
    console.error('[check-model-performance] Error:', e);
    return new Response('Error: ' + e.message, { status: 500 });
  }
};
