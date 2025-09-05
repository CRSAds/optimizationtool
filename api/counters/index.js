// /pages/api/counters/index.js
const DIRECTUS_URL   = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const ADMIN_UI_TOKEN = process.env.ADMIN_UI_TOKEN;

// CORS – gelijk trekken met /api/rules
function parseAllowed() {
  return (process.env.ADMIN_ALLOWED_ORIGINS || '*')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}
function applyCors(req, res) {
  const allowed = parseAllowed();
  const origin = req.headers.origin;
  if (origin && (allowed.includes('*') || allowed.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
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
  if (applyCors(req, res)) return;

  // admin check (zelfde als /api/rules)
  const hdr = req.headers['x-admin-token'];
  if (!hdr || String(hdr) !== String(ADMIN_UI_TOKEN)) {
    return res.status(403).json({ ok:false, error:'forbidden' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }

  try {
    // Query params (alias 'from'/'to' voor backwards compat)
    const {
      date_from, from,
      date_to,   to,
      affiliate_id,
      offer_id,
      sub_id,     // 'null' => expliciet null
      rule_id,    // NIEUW: filter per rule
      limit = '500',
      sort = '-date', // default: nieuwste boven
    } = req.query;

    const AND = [];

    const df = date_from || from;
    const dt = date_to   || to;
    if (df || dt) {
      const range = {};
      if (df) range._gte = String(df);
      if (dt) range._lte = String(dt);
      AND.push({ date: range });
    }

    if (affiliate_id) AND.push({ affiliate_id: { _eq: String(affiliate_id) } });
    if (offer_id)     AND.push({ offer_id:     { _eq: String(offer_id) } });

    if (sub_id === 'null') AND.push({ sub_id: { _null: true } });
    else if (sub_id)       AND.push({ sub_id: { _eq: String(sub_id) } });

    if (rule_id === 'null') AND.push({ rule_id: { _null: true } });
    else if (rule_id)       AND.push({ rule_id: { _eq: String(rule_id) } });

    const filter = AND.length ? { _and: AND } : {};

    const qs = new URLSearchParams({
      // Neem rule_id erbij (NIEUW)
      fields: 'id,date,rule_id,affiliate_id,offer_id,sub_id,total_leads,accepted_leads',
      sort: String(sort),
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
