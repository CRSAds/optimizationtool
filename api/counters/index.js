import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  // 1. GECORRIGEERDE CORS LOGICA
  const origin = req.headers.origin;
  const allowedOrigins = (process.env.ADMIN_ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
  
  if (allowedOrigins.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Belangrijk: Beantwoord het OPTIONS (preflight) verzoek direct
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2. AUTH CHECK
  const incomingToken = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
  if (!incomingToken || String(incomingToken).trim() !== String(process.env.ADMIN_UI_TOKEN).trim()) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { date_from, date_to, offer_id, affiliate_id } = req.query;

    // 3. Haal alles in één keer uit de geoptimaliseerde view
    let query = supabase
      .from('offer_performance_v2')
      .select(`
        day, 
        offer_id, 
        sub_id, 
        affiliate_id,
        tool_total_leads, 
        tool_accepted_leads, 
        margin_pct, 
        omzet_totaal, 
        affise_cost, 
        profit, 
        visits
      `);

    if (date_from) query = query.gte('day', date_from);
    if (date_to)   query = query.lte('day', date_to);
    if (offer_id)  query = query.eq('offer_id', offer_id);
    if (affiliate_id) query = query.eq('affiliate_id', affiliate_id);

    const { data, error } = await query.order('day', { ascending: false }).limit(5000);

    if (error) throw error;

    // 4. Map de data EN FIX SYNTAX FOUT bij filter
    const items = (data || [])
      .map(row => ({
        date: row.day,
        offer_id: row.offer_id,
        sub_id: row.sub_id,
        affiliate_id: row.affiliate_id,
        total_leads: Number(row.tool_total_leads || 0),
        accepted_leads: Number(row.tool_accepted_leads || 0),
        actual_margin: row.margin_pct ? (Number(row.margin_pct) * 100) : null,
        revenue: Number(row.omzet_totaal || 0),
        cost: Number(row.affise_cost || 0),
        profit: Number(row.profit || 0),
        visits: Number(row.visits || 0)
      }))
      .filter(item => item.total_leads > 0 || item.accepted_leads > 0);

    return res.status(200).json({ ok: true, items });
  } catch (e) {
    console.error("Dashboard API Error:", e);
    return res.status(500).json({ error: e.message });
  }
}
