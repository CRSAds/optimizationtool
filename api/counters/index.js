import { createClient } from '@supabase/supabase-js';

// --- MODULE 1: CONFIGURATIE ---
const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// --- MODULE 2: HELPERS ---
function norm(val) {
  return (val == null || val === '' || val === 'null') ? null : String(val).trim();
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // AUTH CHECK (Verbeterd)
  const incomingToken = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
  if (!incomingToken || String(incomingToken).trim() !== String(process.env.ADMIN_UI_TOKEN).trim()) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { date_from, date_to, affiliate_id, offer_id } = req.query;

    // 1. Haal Counters op uit Directus
    const filter = { _and: [] };
    if (date_from) filter._and.push({ date: { _gte: date_from } });
    if (date_to)   filter._and.push({ date: { _lte: date_to } });
    if (affiliate_id) filter._and.push({ affiliate_id: { _eq: affiliate_id } });
    if (offer_id) filter._and.push({ offer_id: { _eq: offer_id } });

    const qs = new URLSearchParams({
      fields: 'date,rule_id,affiliate_id,offer_id,sub_id,total_leads,accepted_leads',
      limit: '5000',
      filter: JSON.stringify(filter)
    });

    const dRes = await fetch(`${DIRECTUS_URL}/items/Optimization_counters?${qs}`, {
      headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` }
    });
    const { data: rawCounters } = await dRes.json();

    // 2. Haal Performance op uit Supabase
    let query = supabase.from('offer_performance_v2').select('day, offer_id, sub_id, margin_pct, omzet_totaal, affise_cost, profit, visits');
    if (date_from) query = query.gte('day', date_from);
    if (date_to)   query = query.lte('day', date_to);
    const { data: margins } = await query;

    // 3. SNELLE MATCHING (Met verbeterde sub-id fallback)
    const marginMap = new Map();
    (margins || []).forEach(m => {
      const key = `${m.day}_${norm(m.offer_id)}_${norm(m.sub_id)}`;
      marginMap.set(key, m);
    });

    const enriched = (rawCounters || []).map(c => {
      const nOff = norm(c.offer_id);
      const nSub = norm(c.sub_id);
      
      // Zoek match op specifieke sub, of fallback naar offer-level data
      const matchKey = `${c.date}_${nOff}_${nSub}`;
      const match = marginMap.get(matchKey);

      return {
        ...c,
        actual_margin: match ? (Number(match.margin_pct) * 100) : null,
        revenue: match ? Number(match.omzet_totaal || 0) : 0,
        cost: match ? Number(match.affise_cost || 0) : 0,
        profit: match ? Number(match.profit || 0) : 0,
        visits: match ? Number(match.visits || 0) : 0
      };
    });

    return res.status(200).json({ ok: true, items: enriched });

  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
