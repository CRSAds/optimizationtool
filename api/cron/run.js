import { createClient } from '@supabase/supabase-js';

// --- MODULE 1: CONFIGURATIE & ENV ---
const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Harde cuts & Steps
const PAUSE_ACCEPT = 5; 
const FULL_ACCEPT = 80; // Zet dit op 100 als je maximale agressie wilt bij goede stats
const STEP = 20; // Stappen van 20% voor zacht afschalen en voorzichtig opschalen

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

// Strikte matching logica: voorkomt "double-dipping" tussen algemene en sub_id regels
function matchScore(rule, row) {
  const isWildcard = (val) => val === null || val === undefined || String(val).trim() === '';
  const rowSub = String(row.sub_id || '').trim().toLowerCase();
  const ruleSub = String(rule.sub_id || '').trim().toLowerCase();
  const rowOff = String(row.offer_id || '').trim().toLowerCase();
  const ruleOff = String(rule.offer_id || '').trim().toLowerCase();
  
  if (!isWildcard(rule.offer_id) && ruleOff !== rowOff) return -1;
  if (!isWildcard(rule.sub_id) && ruleSub !== rowSub) return -1;

  let score = 0;
  if (!isWildcard(rule.offer_id)) score += 1;
  if (!isWildcard(rule.sub_id)) score += 5; // Sub-match wint áltijd van een algemene match
  return score;
}

function cleanString(str) {
  return str.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '')
            .replace(/\s+/g, ' ').trim();
}

// --- MODULE 3: MAIN HANDLER ---
export default async function handler(req, res) {
  try {
    const now = new Date();
    // Tijdzone compensatie zodat 'today' klopt met de Nederlandse tijd
    const offset = now.getTimezoneOffset() * 60000;
    const localNow = new Date(now.getTime() - offset);
    const today = localNow.toISOString().split('T')[0];
    const timeFull = localNow.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

    // 1. Haal rules & stats op
    const { data: rules } = await dFetch('/items/Optimization_rules?filter[active][_eq]=true&filter[auto_pilot][_eq]=true');
    if (!rules || !rules.length) return res.json({ message: 'No active auto-pilot rules found' });

    const { data: stats, error } = await supabase
      .from('offer_performance_v2')
      .select('offer_id, sub_id, tool_total_leads, visits, affise_cost, omzet_totaal, day')
      .eq('day', today);

    if (error) throw error;

    // 2. DATA ISOLATIE: Koppel elke stat-rij aan MAXIMAAL 1 regel
    const rulePerformance = new Map(); 
    
    for (const row of (stats || [])) {
      let bestRule = null;
      for (const rule of rules) {
        const s = matchScore(rule, row);
        if (s < 0) continue;
        if (!bestRule || s > bestRule.s) bestRule = { rule, s };
      }

      if (bestRule) {
        const id = bestRule.rule.id;
        if (!rulePerformance.has(id)) {
          rulePerformance.set(id, { leads: 0, visits: 0, cost: 0, revenue: 0, rule: bestRule.rule });
        }
        const perf = rulePerformance.get(id);
        perf.leads += (row.tool_total_leads || 0);
        perf.visits += (row.visits || 0);
        perf.cost += (row.affise_cost || 0);
        perf.revenue += (row.omzet_totaal || 0);
      }
    }

    const updates = [];
    const debug_info = [];

    // 3. SMART HYBRID CONTROLLER
    for (const [ruleId, perf] of rulePerformance.entries()) {
      const rule = perf.rule;
      const targetMargin = rule.target_margin || 15;
      const doelEpc = rule.min_cpc || 0; // De Doel EPC van de publisher
      const currentAccept = Number(rule.percent_accept || 100);

      // Berekeningen
      const actualMargin = perf.revenue > 0 
        ? ((perf.revenue - perf.cost) / perf.revenue) * 100 
        : (perf.cost > 0 ? -100 : 0); // Direct -100% marge bij kosten zonder omzet
        
      // Publisher EPC (Onze kosten gedeeld door kliks)
      const publisherEpc = perf.visits > 0 ? (perf.cost / perf.visits) : 0;

      let newAccept = currentAccept;
      let logMsg = "";

      // BESLISBOOM
      if (doelEpc > 0 && publisherEpc > doelEpc) {
        // HARDE CUT: Publisher is te duur. Direct naar 5%.
        newAccept = PAUSE_ACCEPT;
        logMsg = `${timeFull}: Te duur! Pub EPC (€${publisherEpc.toFixed(2)}) > Doel (€${doelEpc.toFixed(2)}). Kraan direct dicht naar ${PAUSE_ACCEPT}%.`;
      } 
      else if (actualMargin < 0 || actualMargin <= (targetMargin - 15)) {
        // HARDE CUT: Marge is zwaar negatief of extreem ver onder target.
        newAccept = PAUSE_ACCEPT;
        logMsg = `${timeFull}: Noodstop! Marge kritiek (${actualMargin.toFixed(1)}%). Kraan direct dicht naar ${PAUSE_ACCEPT}%.`;
      } 
      else if (actualMargin < targetMargin) {
        // ZACHTE CUT: Marge is positief, maar onder de target. We schalen af om risico te mitigeren.
        newAccept = Math.max(PAUSE_ACCEPT, currentAccept - STEP);
        logMsg = `${timeFull}: Marge te laag (${actualMargin.toFixed(1)}% < ${targetMargin}%). Afgeschaald naar ${newAccept}%.`;
      } 
      else if (actualMargin >= targetMargin) {
        // GEZOND: We halen de targets. We schalen voorzichtig op om te testen of de kwaliteit behouden blijft.
        if (currentAccept < FULL_ACCEPT) {
          newAccept = Math.min(FULL_ACCEPT, currentAccept + STEP);
          logMsg = `${timeFull}: Gezond! Marge (${actualMargin.toFixed(1)}%) >= Target. Voorzichtig opgeschaald naar ${newAccept}%.`;
        }
      }

      // 4. PREPARE UPDATES
      if (newAccept !== currentAccept) {
        updates.push({ id: rule.id, percent_accept: newAccept, pilot_log: cleanString(logMsg) });
        
        // Log de ingreep in Supabase
        await supabase.from('pilot_logs').insert({
          offer_id: String(rule.offer_id),
          affiliate_id: String(rule.affiliate_id || ''),
          sub_id: String(rule.sub_id || ''),
          new_accept: newAccept,
          reason: cleanString(logMsg)
        });
        
        debug_info.push(`✅ Offer ${rule.offer_id} (Sub: ${rule.sub_id || '-'}) -> ${newAccept}%`);
      }
    }

    // 5. BATCH UPDATE DIRECTUS
    if (updates.length > 0) {
      for (const update of updates) {
         await dFetch(`/items/Optimization_rules/${update.id}`, 'PATCH', {
           percent_accept: update.percent_accept,
           pilot_log: update.pilot_log
         });
      }
    }

    return res.json({ 
      success: true, 
      evaluated_rules: rulePerformance.size,
      updates: updates.length, 
      debug: debug_info 
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
