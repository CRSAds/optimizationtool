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
  return (val === null || val === undefined) ? '' : String(val).trim().toLowerCase();
}

function cleanString(str) {
  return str.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '')
            .replace(/\s+/g, ' ')
            .trim();
}

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
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const timeFull = now.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit' }) + ' ' + 
                     now.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

    // STAP 1: Sync de counters
    const syncedCount = await syncCountersToSupabase(today);

    // STAP 2: Haal regels en stats op
    const { data: rules } = await dFetch('/items/Optimization_rules?filter[active][_eq]=true&filter[auto_pilot][_eq]=true&limit=2000');
    if (!rules || !rules.length) return res.json({ message: 'No active auto-pilot rules found', synced: syncedCount });

    const { data: stats, error } = await supabase
      .from('offer_performance_v2')
      .select('offer_id, sub_id, margin_pct, tool_total_leads, visits, affise_cost, omzet_totaal, day')
      .eq('day', today);

    if (error) throw error;

    const updates = [];
    const debug_info = [];

    // STAP 3: Loop door regels
    for (const rule of rules) {
      const off = norm(rule.offer_id);
      const sub = norm(rule.sub_id);
      const identifier = `Offer ${off}${sub ? ` (Sub ${sub})` : ''}`;
      
      // VERBETERDE MATCHING: Algemene regel pakt alle data van het offer als vangnet
      const matchingRows = stats.filter(s => {
        if (norm(s.offer_id) !== off) return false;
        if (sub !== '') return norm(s.sub_id) === sub;
        return true; 
      });

      if (matchingRows.length === 0) {
        debug_info.push(`❌ ${identifier}: Geen data vandaag.`);
        continue;
      }

      let totalLeads = 0, totalVisits = 0, totalCost = 0, totalRevenue = 0;
      for (const row of matchingRows) {
        totalLeads += (row.tool_total_leads || 0);
        totalVisits += (row.visits || 0);
        totalCost += (row.affise_cost || 0);
        totalRevenue += (row.omzet_totaal || 0);
      }

      const actualMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;
      const actualEpc = totalVisits > 0 ? (totalCost / totalVisits) : 0;
      const minVolume = rule.min_volume || 20;

      if (totalLeads < minVolume) {
        debug_info.push(`⚠️ ${identifier}: Volume te laag (${totalLeads}/${minVolume}).`);
        continue; 
      }

      let currentAccept = Number(rule.percent_accept || 100);
      let newAccept = currentAccept;
      let logMsg = "";

      // Agressieve sturing op EPC en Marge
      if (actualMargin < EMERGENCY_THRESHOLD) {
        newAccept = MIN_ACCEPT;
        logMsg = `${timeFull}: EMERGENCY! Marge ${actualMargin.toFixed(1)}%. Acc naar ${MIN_ACCEPT}%`;
      } else if (rule.min_cpc > 0 && actualEpc > rule.min_cpc) {
        // Als EPC > 2x Doel EPC, verlaag dan dubbel zo snel (20% ipv 10%)
        const factor = actualEpc > (rule.min_cpc * 2) ? 2 : 1;
        newAccept = Math.max(MIN_ACCEPT, currentAccept - (STEP_CHANGE * factor));
        logMsg = `${timeFull}: EPC €${actualEpc.toFixed(2)} > €${rule.min_cpc.toFixed(2)}. Acc naar ${newAccept}%`;
      } else if (actualMargin < (rule.target_margin || 15)) {
        newAccept = Math.max(MIN_ACCEPT, currentAccept - STEP_CHANGE);
        logMsg = `${timeFull}: Marge ${actualMargin.toFixed(1)}% te laag. Acc naar ${newAccept}%`;
      } else if (actualMargin > (rule.target_margin + 10) && currentAccept < 100) {
        newAccept = Math.min(100, currentAccept + STEP_CHANGE);
        logMsg = `${timeFull}: Goede marge (${actualMargin.toFixed(1)}%). Acc naar ${newAccept}%`;
      }

      if (newAccept !== currentAccept) {
        updates.push({ id: rule.id, percent_accept: newAccept, pilot_log: cleanString(logMsg) });
        debug_info.push(`✅ ${identifier} aangepast naar ${newAccept}%.`);
      }
    }

    // STAP 4: Batch Update Directus
    for (const update of updates) {
      await dFetch(`/items/Optimization_rules/${update.id}`, 'PATCH', {
        percent_accept: update.percent_accept,
        pilot_log: update.pilot_log
      });
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
