import { createClient } from '@supabase/supabase-js';

// --- MODULE 1: CONFIGURATIE ---
// We hebben DIRECTUS_URL en TOKEN hier niet meer nodig voor de resultaten!
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// --- MODULE 2: HELPERS ---
function norm(val) {
  return (val == null || val === '' || val === 'null') ? null : String(val).trim();
}

// --- MODULE 3: MAIN HANDLER ---
export default async function handler(req, res) {
  // 1. CORS LOGICA (Altijd eerst voor de browser)
  const origin = req.headers.origin;
  const allowed = (process.env.ADMIN_ALLOWED_ORIGINS || '*').split(',');
  
  if (allowed.includes('*') || (origin && allowed.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2. AUTH CHECK
  const incomingToken = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
  if (!incomingToken || String(incomingToken).trim() !== String(process.env.ADMIN_UI_TOKEN).trim()) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { date_from, date_to, offer_id, sub_id, affiliate_id } = req.query;

    // 3. Parallel Queries naar Supabase (Beide bronnen nu in Supabase)
    // We halen tot 10.000 rijen op om afkappen bij lange periodes te voorkomen
    let cQuery = supabase.from('optimization_counters').select('*').limit(10000);
    let pQuery = supabase.from('offer_performance_v2').select('*').limit(10000);

    // Filters toepassen op beide queries
    if (date_from) { cQuery = cQuery.gte('day', date_from); pQuery = pQuery.gte('day', date_from); }
    if (date_to)   { cQuery = cQuery.lte('day', date_to);   pQuery = pQuery.lte('day', date_to); }
    if (offer_id)  { cQuery = cQuery.eq('offer_id', offer_id); pQuery = pQuery.eq('offer_id', offer_id); }
    if (affiliate_id) { cQuery = cQuery.eq('affiliate_id', affiliate_id); }
    if (sub_id && sub_id !== 'null') { cQuery = cQuery.eq('sub_id', sub_id); pQuery = pQuery.eq('sub_id', sub_id); }

    const [cRes, pRes] = await Promise.all([cQuery, pQuery]);

    if (cRes.error) throw cRes.error;
    if (pRes.error) throw pRes.error;

    // 4. Mapping & Matching (Razendsnel via Map)
    const perfMap = new Map();
    (pRes.data || []).forEach(p => {
      // Sleutel: datum_offer_sub
      const key = `${p.day}_${norm(p.offer_id)}_${norm(p.sub_id)}`;
      perfMap.set(key, p);
    });

    const items = (cRes.data || []).map(c => {
      const p = perfMap.get(`${c.day}_${norm(c.offer_id)}_${norm(c.sub_id)}`);
      
      return {
        date: c.day,
        offer_id: c.offer_id,
        sub_id: c.sub_id,
        affiliate_id: c.affiliate_id,
        rule_id: c.rule_id,
        total_leads: c.total_leads,
        accepted_leads: c.accepted_leads,
        actual_margin: p ? (Number(p.margin_pct) * 100) : null,
        revenue: p ? Number(p.omzet_totaal || 0) : 0,
        cost: p ? Number(p.affise_cost || 0) : 0,
        profit: p ? Number(p.profit || 0) : 0,
        visits: p ? Number(p.visits || 0) : 0
      };
    });

    return res.status(200).json({ ok: true, items });
    
  } catch (e) {
    console.error("Dashboard API Error:", e);
    return res.status(500).json({ error: e.message });
  }
}
