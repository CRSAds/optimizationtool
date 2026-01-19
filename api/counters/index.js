import { createClient } from '@supabase/supabase-js';

const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const ADMIN_UI_TOKEN = process.env.ADMIN_UI_TOKEN;

// Initialiseer Supabase
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Helper: Maakt vergelijken van ID's veilig (zodat null, undefined en "" matchen)
function norm(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

export default async function handler(req, res) {
  // --- 1. CORS LOGICA ---
  const origin = req.headers.origin;
  const allowed = (process.env.ADMIN_ALLOWED_ORIGINS || '*').split(',');
  
  if (allowed.includes('*') || (origin && allowed.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  // --- 2. AUTH CHECK ---
  const hdr = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
  if (!hdr || String(hdr) !== String(ADMIN_UI_TOKEN)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { date_from, date_to, affiliate_id, offer_id, sub_id, limit = '2000' } = req.query;

    // --- 3. DIRECTUS DATA OPHALEN ---
    const AND = [];
    if (date_from) AND.push({ date: { _gte: date_from } });
    if (date_to)   AND.push({ date: { _lte: date_to } });
    if (affiliate_id) AND.push({ affiliate_id: { _eq: affiliate_id } });
    if (offer_id) AND.push({ offer_id: { _eq: offer_id } });
    
    // Robuuste check voor sub_id (zowel expliciet null als specifieke waarde)
    if (sub_id === 'null' || sub_id === '') AND.push({ sub_id: { _null: true } });
    else if (sub_id) AND.push({ sub_id: { _eq: sub_id } });

    const qs = new URLSearchParams({
      fields: 'id,date,rule_id,affiliate_id,offer_id,sub_id,total_leads,accepted_leads',
      sort: '-date',
      limit: String(limit),
      filter: JSON.stringify(AND.length ? { _and: AND } : {}),
    });

    const dRes = await fetch(`${DIRECTUS_URL}/items/Optimization_counters?${qs}`, {
      headers: { 
        Authorization: `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    const dJson = await dRes.json();
    if (!dRes.ok) throw new Error(JSON.stringify(dJson));
    const counters = dJson.data || [];

    // --- 4. SUPABASE DATA OPHALEN ---
    // We halen hier jouw specifieke kolommen op: omzet_totaal, affise_cost, profit
    let query = supabase
      .from('offer_performance_v2')
      .select('offer_id, sub_id, margin_pct, omzet_totaal, affise_cost, profit, day');
    
    if (date_from) query = query.gte('day', date_from);
    if (date_to)   query = query.lte('day', date_to);

    const { data: marginData, error } = await query;
    if (error) {
      console.error('Supabase Error:', error);
      throw error;
    }

    const margins = marginData || [];

    // --- 5. MATCH & MERGE ---
    const enriched = counters.map(c => {
      // Zoek de match in Supabase data
      const match = margins.find(m => 
        norm(m.offer_id) === norm(c.offer_id) && 
        norm(m.sub_id)   === norm(c.sub_id) &&
        m.day === c.date
      );

      return {
        ...c,
        actual_margin: match ? (match.margin_pct * 100) : null,
        
        // Vertaalslag: Database kolomnaam -> Frontend naam
        revenue: match ? (match.omzet_totaal || 0) : 0,
        cost:    match ? (match.affise_cost || 0)  : 0,
        profit:  match ? (match.profit || 0)       : 0
      };
    });

    return res.status(200).json({ ok: true, items: enriched });

  } catch (e) {
    console.error("API Error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
