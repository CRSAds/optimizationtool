// /pages/api/counters/index.js
const DIRECTUS_URL   = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const ADMIN_UI_TOKEN = process.env.ADMIN_UI_TOKEN;

// CORS
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // of jouw domein
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}

function dFetch(path, init = {}) {
  const url = `${DIRECTUS_URL}${path}`;
  const headers = {
    ...(init.headers || {}),
    Authorization: `Bearer ${DIRECTUS_TOKEN}`,
    'Content-Type': 'application/json',
  };
  return fetch(url, { ...init, headers });
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // simpele admin check (zelfde als bij /api/rules)
  const hdr = req.headers['x-admin-token'];
  if (!hdr || String(hdr) !== String(ADMIN_UI_TOKEN)) {
    return res.status(403).json({ ok:false, error:'forbidden' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }

  try {
    // Query params
    const {
      date_from,
      date_to,
      affiliate_id,
      offer_id,
      sub_id, // 'null' betekent expliciet null
      limit = '500',
    } = req.query;

    // Directus filter opbouwen
    const AND = [];

    if (date_from || date_to) {
      const range = {};
      if (date_from) range._gte = String(date_from);
      if (date_to)   range._lte = String(date_to);
      AND.push({ date: range });
    }
    if (affiliate_id) AND.push({ affiliate_id: { _eq: String(affiliate_id) } });
    if (offer_id)     AND.push({ offer_id:     { _eq: String(offer_id) } });

    if (sub_id === 'null') AND.push({ sub_id: { _null: true } });
    else if (sub_id)       AND.push({ sub_id: { _eq: String(sub_id) } });

    const filter = AND.length ? { _and: AND } : {};

    const qs = new URLSearchParams({
      fields: 'id,date,affiliate_id,offer_id,sub_id,total_leads,accepted_leads',
      sort: '-date',
      limit: String(limit),
      filter: JSON.stringify(filter),
    });

    const r = await dFetch(`/items/Optimization_counters?${qs.toString()}`);
    const j = await r.json();
    if (!r.ok) return res.status(r.status).json(j);

    return res.status(200).json({ ok:true, items: j.data || [] });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
}
