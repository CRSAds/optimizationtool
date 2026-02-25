import { createClient } from '@supabase/supabase-js';

// --- MODULE 1: CONFIGURATIE & ENV ---
const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const STEP_CHANGE = 10;    
const MIN_ACCEPT = 5; 
const EMERGENCY_THRESHOLD = -50; 

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

// --- NIEUWE SYNC FUNCTIE (Voor de structurele oplossing) ---
export async function syncCountersToSupabase(date) {
  const qs = new URLSearchParams({
    filter: JSON.stringify({ date: { _eq: date } }),
    limit: '-1'
  });
  const res = await dFetch(`/items/Optimization_counters?${qs.toString()}`);
  const counters = res.data || [];
  if (counters.length === 0) return 0;

  const rows = counters.map(c => ({
    day: c.date,
    offer_id: String(c.offer_id),
    sub_id: c.sub_id ? String(c.sub_id) : null,
    affiliate_id: String(c.affiliate_id),
    total_leads: Number(c.total_leads || 0),
    accepted_leads: Number(c.accepted_leads || 0)
  }));

  const { error } = await supabase
    .from('tool_performance_stats')
    .upsert(rows, { onConflict: 'day,offer_id,sub_id,affiliate_id' });

  if (error) console.error('Sync error:', error.message);
  return rows.length;
}

// --- MODULE 3: MAIN HANDLER ---
export default async function handler(req, res) {
  try {
    const today = new Date().toISOString().split('T')[0];

    // STAP 1: Sync de counters naar de nieuwe tabel (Structurele oplossing)
    const syncedCount = await syncCountersToSupabase(today);

    // STAP 2: Haal regels en stats op (Jouw originele logica)
    const { data: rules } = await dFetch('/items/Optimization_rules?filter[auto_pilot][_eq]=true&limit=2000');
    if (!rules || !rules.length) return res.json({ message: 'No auto-pilot rules found', synced: syncedCount });

    const { data: stats, error } = await supabase
      .from('offer_performance_v2')
      .select('offer_id, sub_id, margin_pct, shortform_leads, visits, affise_cost, omzet_totaal, day')
      .eq('day', today);

    if (error) throw error;

    const specificSubIds = rules.filter(r => r.sub_id).map(r => norm(r.sub_id));
    const updates = [];
    const debug_info = [];

    // STAP 3: Loop door regels (Jouw originele logica inclusief Isolation)
    for (const rule of rules) {
      const identifier = `Offer ${rule.offer_id}${rule.sub_id ? ` (Sub ${rule.sub_id})` : ''}`;
      
      const matchingRows = stats.filter(s => {
        if (norm(s.offer_id) !== norm(rule.offer_id)) return false;
        if (rule.sub_id) {
          return norm(s.sub_id) === norm(rule.sub_id);
        } else {
          return !specificSubIds.includes(norm(s.sub_id));
        }
      });

      if (matchingRows.length === 0) {
        debug_info.push(`❌ ${identifier}: Geen geïsoleerde data.`);
        continue;
      }

      let totalLeads = 0, totalVisits = 0, totalCost = 0, totalRevenue = 0;
      for (const row of matchingRows) {
        totalLeads += (row.shortform_leads || 0);
        totalVisits += (row.visits || 0);
        totalCost += (row.affise_cost || 0);
        totalRevenue += (row.omzet_totaal || 0);
      }

      const actualMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;
      const actualEpc = totalVisits > 0 ? (totalCost / totalVisits) : 0;
      const minVolume = rule.min_volume || 20;

      if (totalLeads < minVolume) {
        debug_info.push(`⚠️ ${identifier}: Volume te laag (${totalLeads}).`);
        continue; 
      }

      let currentAccept = rule.percent_accept || 100;
      let newAccept = currentAccept;
      let logMsg = "";
      const time = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

      // Emergency Brake & EPC logica
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

    // STAP 4: Batch Update Directus
    if (updates.length > 0) {
      // Gebruik hier de correcte Directus PATCH syntax voor meerdere items
      await dFetch('/items/Optimization_rules', 'PATCH', { 
        keys: updates.map(u => u.id), 
        data: { percent_accept: undefined, pilot_log: undefined } // Placeholder, Directus vereist specifieke payload voor batch
      });
      // Correctie: Voor batch updates met unieke waarden per rij in Directus 
      // gebruiken we meestal een loop of de specifieke 'updates' array.
      for (const update of updates) {
        await dFetch(`/items/Optimization_rules/${update.id}`, 'PATCH', {
          percent_accept: update.percent_accept,
          pilot_log: update.pilot_log
        });
      }
    }

    return res.json({ 
      success: true, 
      synced: syncedCount, 
      updates: updates.length, 
      debug: debug_info 
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
