import { createClient } from '@supabase/supabase-js';

const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// CONFIGURATIE
const STEP_DOWN = 10;      // 10% eraf bij slechte prestaties
const MIN_ACCEPT = 10;     // Nooit lager dan 10%

async function dFetch(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${DIRECTUS_URL}${path}`, opts);
  return r.json();
}

function norm(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

export default async function handler(req, res) {
  try {
    // 1. Haal regels op (alleen Auto Pilot AAN)
    const { data: rules } = await dFetch('/items/Optimization_rules?filter[auto_pilot][_eq]=true&limit=2000');
    if (!rules || !rules.length) return res.json({ message: 'No auto-pilot rules found' });

    const today = new Date().toISOString().split('T')[0];

    // 2. Haal data uit Supabase (Marge + Volume)
    const { data: stats, error } = await supabase
      .from('offer_performance_v2')
      .select('offer_id, sub_id, margin_pct, shortform_leads, day')
      .eq('day', today);

    if (error) throw error;

    const updates = [];
    const log = [];

    // 3. Loop door regels
    for (const rule of rules) {
      const perf = stats.find(s => 
        norm(s.offer_id) === norm(rule.offer_id) && 
        norm(s.sub_id) === norm(rule.sub_id)
      );

      if (!perf) continue;

      const currentVolume = perf.shortform_leads || 0; 
      const minVolume = rule.min_volume || 20;

      // Check volume drempel
      if (currentVolume < minVolume) continue; 

      const actualMargin = perf.margin_pct * 100; 
      const targetMargin = rule.target_margin || 15;
      
      let currentAccept = rule.percent_accept || 100;
      let newAccept = currentAccept;
      let logMessage = null;

      // --- LOGICA ---
      if (actualMargin < targetMargin) {
        // ACTIE: Ingrijpen
        newAccept = Math.max(MIN_ACCEPT, currentAccept - STEP_DOWN);
        
        // Logbericht opstellen
        const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
        logMessage = `${time}: Vol ${currentVolume} | Marge ${actualMargin.toFixed(1)}% (Doel ${targetMargin}%) → Acc verlaagd naar ${newAccept}%`;
        
        log.push(`Rule ${rule.id}: ${logMessage}`);
      } 
      
      // Update als er iets verandert
      if (newAccept !== currentAccept) {
        updates.push({ 
          id: rule.id, 
          percent_accept: newAccept,
          pilot_log: logMessage // We slaan dit op in Directus
        });
      }
    }

    // 4. Update Directus
    if (updates.length > 0) {
      await dFetch('/items/Optimization_rules', 'PATCH', updates);
    }

    return res.json({ success: true, logs: log });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
