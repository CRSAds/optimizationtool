// api/pilot-logs.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  // 1. CORS LOGICA (Gekopieerd van werkende endpoints)
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

  // Preflight verzoek direct beantwoorden
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2. AUTH CHECK
  const incomingToken = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
  if (!incomingToken || String(incomingToken).trim() !== String(process.env.ADMIN_UI_TOKEN).trim()) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    // 3. DATA OPHALEN
    const { data, error } = await supabase
      .from('pilot_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return res.status(200).json({ items: data || [] });
  } catch (e) {
    console.error("Pilot Logs API Error:", e);
    return res.status(500).json({ error: e.message });
  }
}
