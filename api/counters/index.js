import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const ADMIN_UI_TOKEN = process.env.ADMIN_UI_TOKEN;

// === CORS HANDLER ===
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
  } else if (!origin && allowed.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
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
  // Pas CORS toe
  if (applyCors(req, res)) return;

  const hdr = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
  if (!hdr || String(hdr) !== String(ADMIN_UI_TOKEN)) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { date_from, date_to, affiliate_id, offer_id, sub_id, limit = '500', sort = '-date' } = req.query;

    const AND = [];
    if (date_from || date_to) {
      const range = {};
      if (date_from) range._gte = String(date_from);
      if (date_to) range._lte = String(date_to);
      AND.push({ date: range });
    }
    if (affiliate_id) AND.push({ affiliate_id: { _eq: String(affiliate_id) } });
    if (offer_id) AND.push({ offer_id: { _eq: String(offer_id) } });
    if (sub_id === 'null') AND.push({ sub_id: { _null: true } });
    else if (sub_id) AND.push({ sub_id: { _eq: String(sub_id) } });

    const filter = AND.length ? { _and: AND } : {};
    const qs = new URLSearchParams({
      fields: 'id,date,rule_id,affiliate_id,offer_id,sub_id,total_leads,accepted_leads',
      sort: String(sort),
      limit: String(limit),
      filter: JSON.stringify(filter),
    });

    // 1. Haal counters uit Directus
    const r = await dFetch(`/items/Optimization_counters?${qs.toString()}`);
    const j = await r.json();
    const counters = j.data || [];

    // 2. Haal Marge data uit Supabase (vandaag/geselecteerde range)
    const { data: marginData } = await supabase
      .from('offer_performance_v2')
      .select('offer_id, sub_id, margin_pct, day')
      .gte('day', date_from || new Date().toISOString().split('T')[0]);

    // 3. Verrijken
    const enrichedItems = counters.map(c => {
      const match = marginData?.find(m => 
        String(m.offer_id) === String(c.offer_id) && 
        String(m.sub_id) === String(c.sub_id) &&
        String(m.day) === String(c.date)
      );
      return {
        ...c,
        actual_margin: match ? (match.margin_pct * 100) : null
      };
    });

    return res.status(200).json({ ok: true, items: enrichedItems });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
