// api/pilot-logs.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  const incomingToken = req.headers['x-admin-token'];
  if (incomingToken !== process.env.ADMIN_UI_TOKEN) return res.status(403).json({ error: 'Forbidden' });

  try {
    // Haal de laatste 50 ingrepen op
    const { data, error } = await supabase
      .from('pilot_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return res.json({ items: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
