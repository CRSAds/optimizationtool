import { createClient } from '@supabase/supabase-js';

// --- MODULE 1: CONFIGURATIE ---
const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// --- MODULE 2: HELPERS ---
function norm(val) {
  return (val == null || val === '' || val === 'null') ? null : String(val).trim();
}

// --- MODULE 3: MAIN HANDLER ---
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const incomingToken = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
  if (!incomingToken || String(incomingToken).trim() !== String(process.env.ADMIN_UI_TOKEN).trim()) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { date_from, date_to, affiliate_id, offer_id, sub_id } = req.query;

    // 1. Voorbereiden Directus Query
    const dFilter = { _and: [] };
    if (date_from) dFilter._and.push({ date: { _gte: date_from } });
    if (date_to)   dFilter._and.push({ date: { _lte: date_to } });
    if (affiliate_id) dFilter._and.push({ affiliate_id: { _eq: affiliate_id } });
    if (offer_id)     dFilter._and.push({ offer_id: { _eq: offer_id } });
    if (sub_id && sub_id !== 'null') dFilter._and.push({ sub_id: { _eq: sub_id } });

    const qs = new URLSearchParams({
      fields: 'date,rule_id,affiliate_id,offer_id,sub_id,total_leads,accepted_leads',
      limit: '10000',
      filter: JSON.stringify(dFilter)
    });

    // 2. Voorbereiden Supabase Query
    let sQuery = supabase.from('offer_performance_v2')
      .select('day, offer_id, sub_id, margin_pct, omzet_totaal, affise_cost, profit, visits')
      .limit(10000);
    
    if (date_from) sQuery = sQuery.gte('day', date_from);
    if (date_to)   sQuery = sQuery.lte('day', date_to);
    if (offer_id)  sQuery = sQuery.eq('offer_id', offer_id);
    if (sub_id && sub_id !== 'null') sQuery = sQuery.eq('sub_id', sub_id);

    // 3. PARALLEL OPHALEN (Voorkomt timeouts)
    const [dRes, sRes] = await Promise.all([
      fetch(`${DIRECTUS_URL}/items/Optimization_counters?${qs}`, { headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` } }),
      sQuery
    ]);

    if (!dRes.ok) throw new Error(`Directus error: ${dRes.status}`);
    const { data: rawCounters } = await dRes.json();
    const margins = sRes.data || [];

    // 4. Matching Map bouwen
    const marginMap = new Map();
    margins.forEach(m => {
      const key = `${m.day}_${norm(m.offer_id)}_${norm(m.sub_id)}`;
      marginMap.set(key, m);
    });

    // 5. Aggregatie (Voorkom dubbeltelling)
    const aggregated = {};
    (rawCounters || []).forEach(row => {
      const key = `${row.date}_${norm(row.offer_id)}_${norm(row.sub_id)}_${norm(row.affiliate_id)}`;
      if (!aggregated[key]) {
        aggregated[key] = { ...row, total_leads: Number(row.total_leads), accepted_leads: Number(row.accepted_leads) };
      } else {
        aggregated[key].total_leads += Number(row.total_leads);
        aggregated[key].accepted_leads += Number(row.accepted_leads);
      }
    });

    // 6. Verrijken
    const items = Object.values(aggregated).map(c => {
      const match = marginMap.get(`${c.date}_${norm(c.offer_id)}_${norm(c.sub_id)}`);
      return {
        ...c,
        actual_margin: match ? (Number(match.margin_pct) * 100) : null,
        revenue: match ? Number(match.omzet_totaal || 0) : 0,
        cost: match ? Number(match.affise_cost || 0) : 0,
        profit: match ? Number(match.profit || 0) : 0,
        visits: match ? Number(match.visits || 0) : 0
      };
    });

    return res.status(200).json({ ok: true, items });

  } catch (e) {
    console.error("API Error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
