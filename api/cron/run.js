import { createClient } from '@supabase/supabase-js';

const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// CONFIGURATIE
const STEP_CHANGE = 10;    
const MIN_ACCEPT = 10;     

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

    // 2. Haal data uit Supabase
    const { data: stats, error } = await supabase
      .from('offer_performance_v2')
      .select('offer_id, sub_id, margin_pct, shortform_leads, visits, affise_cost, omzet_totaal, day')
      .eq('day', today);

    if (error) throw error;

    const updates = [];
    const log = [];
    const debug_info = [];

    // 3. Loop door regels
    for (const rule of rules) {
      const identifier = `Offer ${rule.offer_id}` + (rule.sub_id ? ` (Sub ${rule.sub_id})` : '');
      const ruleHasSub = !!rule.sub_id;

      const matchingRows = stats.filter(s => {
        if (norm(s.offer_id) !== norm(rule.offer_id)) return false;
        if (ruleHasSub) return norm(s.sub_id) === norm(rule.sub_id);
        return true; 
      });

      if (matchingRows.length === 0) {
        debug_info.push(`❌ ${identifier}: Geen data gevonden voor datum ${today}`);
        continue;
      }

      // AGGREGATIE
      let totalLeads = 0;
      let totalVisits = 0;
      let totalCost = 0;
      let totalRevenue = 0;

      for (const row of matchingRows) {
        totalLeads   += (row.shortform_leads || 0);
        totalVisits  += (row.visits || 0);
        totalCost    += (row.affise_cost || 0);
        totalRevenue += (row.omzet_totaal || 0);
      }

      const actualMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;
      const actualEpc = totalVisits > 0 ? (totalCost / totalVisits) : 0;

      const currentVolume = totalLeads;
      const minVolume = rule.min_volume || 20;

      if (currentVolume < minVolume) {
        debug_info.push(`⚠️ ${identifier}: Volume te laag (${currentVolume} < ${minVolume}).`);
        continue; 
      }

      const targetMargin = rule.target_margin || 15;
      const targetEpc = rule.min_cpc || 0;

      let currentAccept = rule.percent_accept || 100;
      let newAccept = currentAccept;
      let logMessage = null;
      let reason = "Alles OK";

      // --- BESLIS LOGICA ---
      if (actualMargin < targetMargin) {
        newAccept = Math.max(MIN_ACCEPT, currentAccept - STEP_CHANGE);
        const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
        logMessage = `${time}: ⚠️ Marge ${actualMargin.toFixed(1)}% < ${targetMargin}%. Acc verlaagd naar ${newAccept}%`;
        reason = "Marge te laag";
      } 
      else if (targetEpc > 0) {
        if (actualEpc > targetEpc) {
           newAccept = Math.max(MIN_ACCEPT, currentAccept - STEP_CHANGE);
           const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
           logMessage = `${time}: 💰 EPC €${actualEpc.toFixed(2)} > Doel €${targetEpc.toFixed(2)}. Acc verlaagd naar ${newAccept}%`;
           reason = "EPC te hoog";
        }
        else if (actualEpc < targetEpc) {
           if (actualMargin > (targetMargin + 5)) {
              newAccept = Math.min(100, currentAccept + STEP_CHANGE);
              const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
              logMessage = `${time}: 🤝 EPC €${actualEpc.toFixed(2)} < Doel €${targetEpc.toFixed(2)}. Acc verhoogd naar ${newAccept}%`;
              reason = "EPC te laag + Marge OK";
           } else {
              reason = `EPC te laag, maar marge (${actualMargin.toFixed(1)}%) te krap`;
           }
        } else {
           reason = "EPC stabiel";
        }
      } else {
         reason = "Marge OK";
      }
      
      if (newAccept !== currentAccept) {
        updates.push({ 
          id: rule.id, 
          percent_accept: newAccept,
          pilot_log: logMessage 
        });
        if(logMessage) log.push(`Rule ${rule.id}: ${logMessage}`);
        debug_info.push(`✅ ${identifier}: AANGEPAST. ${reason}`);
      } else {
        debug_info.push(`ℹ️ ${identifier}: Geen actie. ${reason}`);
      }
    }

    // 4. Update Directus (MET RESPONSE CHECK)
    let directus_response = null;
    if (updates.length > 0) {
      directus_response = await dFetch('/items/Optimization_rules', 'PATCH', updates);
    }

    return res.json({ 
      success: true, 
      updates_count: updates.length, 
      logs: log,
      debug_analysis: debug_info,
      directus_response: directus_response // <--- Hier gaan we de fout zien!
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
