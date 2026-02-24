import { createClient } from '@supabase/supabase-js';

// --- MODULE 1: CONFIGURATIE & ENV ---
const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const STEP_CHANGE = 10;    
const MIN_ACCEPT = 5; 
const EMERGENCY_THRESHOLD = -50; // Direct ingrijpen bij 50% verlies

// --- MODULE 2: HELPERS ---
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
  return (val === null || val === undefined) ? '' : String(val).trim();
}

function cleanString(str) {
  return str.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '')
            .replace(/\s+/g, ' ')
            .trim();
}

// --- MODULE 3: MAIN HANDLER ---
export default async function handler(req, res) {
  try {
    // 1. Haal regels en stats op
    const { data: rules } = await dFetch('/items/Optimization_rules?filter[auto_pilot][_eq]=true&limit=2000');
    if (!rules || !rules.length) return res.json({ message: 'No auto-pilot rules found' });

    const today = new Date().toISOString().split('T')[0];
    const { data: stats, error } = await supabase
      .from('offer_performance_v2')
      .select('offer_id, sub_id, margin_pct, shortform_leads, visits, affise_cost, omzet_totaal, day')
      .eq('day', today);

    if (error) throw error;

    // 2. Identificeer alle specifieke sub-regels voor isolatie
    const specificSubIds = rules.filter(r => r.sub_id).map(r => norm(r.sub_id));

    const updates = [];
    const debug_info = [];

    // 3. Loop door regels en pas beslislogica toe
    for (const rule of rules) {
      const identifier = `Offer ${rule.offer_id}${rule.sub_id ? ` (Sub ${rule.sub_id})` : ''}`;
      
      // STUUR LOGICA: Strict Isolation
      const matchingRows = stats.filter(s => {
        if (norm(s.offer_id) !== norm(rule.offer_id)) return false;
        
        if (rule.sub_id) {
          // Specifieke regel: alleen eigen sub matchen
          return norm(s.sub_id) === norm(rule.sub_id);
        } else {
          // Algemene regel: Alleen data pakken van subs die GEEN eigen regel hebben
          return !specificSubIds.includes(norm(s.sub_id));
        }
      });

      if (matchingRows.length === 0) {
        debug_info.push(`❌ ${identifier}: Geen geïsoleerde data.`);
        continue;
      }

      // Aggregatie
      let totalLeads = 0, totalVisits = 0, totalCost = 0, totalRevenue = 0;
      for (const row of matchingRows) {
        totalLeads += (row.shortform_leads || 0);
        totalVisits += (row.visits || 0);
        totalCost += (row.affise_cost || 0);
        totalRevenue += (row.omzet_totaal || 0);
      }

      const actualMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;
      const actualEpc = totalVisits > 0 ? (totalCost / totalVisits) : 0;
      const currentVolume = totalLeads;
      const minVolume = rule.min_volume || 20;

      if (currentVolume < minVolume) {
        debug_info.push(`⚠️ ${identifier}: Volume te laag.`);
        continue; 
      }

      // BESLIS LOGICA (Hoofdstuk: Emergency Brake & EPC)
      let currentAccept = rule.percent_accept || 100;
      let newAccept = currentAccept;
      let logMsg = "";
      const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

      if (actualMargin < EMERGENCY_THRESHOLD) {
        newAccept = MIN_ACCEPT;
        logMsg = `${time}: EMERGENCY! Marge ${actualMargin.toFixed(1)}%. Acc naar ${MIN_ACCEPT}%`;
      } else if (actualMargin < (rule.target_margin || 15)) {
        newAccept = Math.max(MIN_ACCEPT, currentAccept - STEP_CHANGE);
        logMsg = `${time}: Marge ${actualMargin.toFixed(1)}% te laag. Acc verlaagd naar ${newAccept}%`;
      } else if (rule.min_cpc > 0) {
        if (actualEpc > rule.min_cpc) {
          newAccept = Math.max(MIN_ACCEPT, currentAccept - STEP_CHANGE);
          logMsg = `${time}: EPC E${actualEpc.toFixed(2)} te hoog. Acc verlaagd naar ${newAccept}%`;
        } else if (actualEpc < rule.min_cpc && actualMargin > (rule.target_margin + 5)) {
          newAccept = Math.min(100, currentAccept + STEP_CHANGE);
          logMsg = `${time}: EPC laag & Marge OK. Acc verhoogd naar ${newAccept}%`;
        }
      }

      if (newAccept !== currentAccept) {
        updates.push({ id: rule.id, percent_accept: newAccept, pilot_log: cleanString(logMsg) });
        debug_info.push(`✅ ${identifier} aangepast.`);
      }
    }

    // 4. Batch Update Directus
    if (updates.length > 0) {
      await dFetch('/items/Optimization_rules', 'PATCH', { keys: updates.map(u => u.id), data: updates });
    }

    return res.json({ success: true, updates: updates.length, debug: debug_info });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
