/* ================================================================
   job-status.js  —  Poll extraction job status
   GET /api/job-status?jobId=xxx
   ================================================================ */
const { requireAuth } = require('./_auth-check');

const ORIGIN = process.env.URL || '*';
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, x-auth-token',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  if (!requireAuth(event)) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const { jobId } = event.queryStringParameters || {};
  if (!jobId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing jobId' }) };

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!sbUrl || !sbKey) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'unknown', error: 'Supabase not configured' }) };
  }

  try {
    const res = await fetch(
      `${sbUrl}/rest/v1/extraction_jobs?id=eq.${encodeURIComponent(jobId)}&select=id,status,extracted_text,error_msg,file_name`,
      { headers: { 'Authorization': `Bearer ${sbKey}`, 'apikey': sbKey } }
    );
    const data = await res.json();
    if (!data?.length) return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'not_found' }) };

    const job = data[0];
    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({
        status:    job.status,
        text:      job.status === 'done' ? job.extracted_text : null,
        error:     job.error_msg || null,
        fileName:  job.file_name,
      }),
    };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ status: 'error', error: e.message }) };
  }
};
