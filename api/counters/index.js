import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const incomingToken = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
  if (String(incomingToken).trim() !== String(process.env.ADMIN_UI_TOKEN).trim()) return res.status(403).end();

  try {
    const { date_from, date_to, offer_id } = req.query;

    // 1. Haal alle counters en performance data parallel op uit Supabase
    let cQuery = supabase.from('optimization_counters').select('*').limit(10000);
    let pQuery = supabase.from('offer_performance_v2').select('*').limit(10000);

    if (date_from) { cQuery = cQuery.gte('day', date_from); pQuery = pQuery.gte('day', date_from); }
    if (date_to)   { cQuery = cQuery.lte('day', date_to);   pQuery = pQuery.lte('day', date_to); }
    if (offer_id)  { cQuery = cQuery.eq('offer_id', offer_id); pQuery = pQuery.eq('offer_id', offer_id); }

    const [cRes, pRes] = await Promise.all([cQuery, pQuery]);

    const perfMap = new Map();
    (pRes.data || []).forEach(p => {
      perfMap.set(`${p.day}_${p.offer_id}_${p.sub_id || ''}`, p);
    });

    // 2. Combineer de data direct
    const items = (cRes.data || []).map(c => {
      const p = perfMap.get(`${c.day}_${c.offer_id}_${c.sub_id || ''}`);
      return {
        date: c.day, offer_id: c.offer_id, sub_id: c.sub_id, affiliate_id: c.affiliate_id,
        rule_id: c.rule_id, total_leads: c.total_leads, accepted_leads: c.accepted_leads,
        actual_margin: p ? (p.margin_pct * 100) : null,
        revenue: p ? p.omzet_totaal : 0, cost: p ? p.affise_cost : 0,
        profit: p ? p.profit : 0, visits: p ? p.visits : 0
      };
    });

    return res.status(200).json({ ok: true, items });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
