import { createClient } from '@supabase/supabase-js';

const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// CONFIGURATIE
const STEP_DOWN = 10;      // Als het slecht gaat: 10% minder accepteren
const MIN_ACCEPT = 10;     // Ondergrens acceptatie (nooit lager dan 10%)

// Helper: Directus Fetch
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

// Helper: Normaliseer ID's (zodat 'null' en '' matchen)
function norm(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

export default async function handler(req, res) {
  try {
    // 1. Haal alle regels op die op Auto Pilot staan
    const { data: rules } = await dFetch('/items/Optimization_rules?filter[auto_pilot][_eq]=true&limit=2000');
    if (!rules || !rules.length) return res.json({ message: 'No auto-pilot rules found' });

    // 2. Bepaal VANDAAG (YYYY-MM-DD)
    const today = new Date().toISOString().split('T')[0];

    // 3. Haal data uit Supabase (Marge én Volume)
    // We gebruiken hier jouw specifieke kolom: shortform_leads
    const { data: stats, error } = await supabase
      .from('offer_performance_v2')
      .select('offer_id, sub_id, margin_pct, shortform_leads, day')
      .eq('day', today);

    if (error) throw error;

    const updates = [];
    const log = [];

    // 4. Loop door de regels
    for (const rule of rules) {
      // Zoek de Supabase data die bij deze regel hoort
      const perf = stats.find(s => 
        norm(s.offer_id) === norm(rule.offer_id) && 
        norm(s.sub_id) === norm(rule.sub_id)
      );

      // Als er nog geen data is in Supabase voor vandaag, doen we niets.
      if (!perf) continue;

      const currentVolume = perf.shortform_leads || 0; 
      const minVolume = rule.min_volume || 20;

      // CHECK: Hebben we genoeg volume om een beslissing te nemen?
      if (currentVolume < minVolume) {
        // log.push(`Skip Rule ${rule.id}: Volume ${currentVolume} < Min ${minVolume}`);
        continue; 
      }

      const actualMargin = perf.margin_pct * 100; // Supabase is bijv 0.15, wij rekenen met 15
      const targetMargin = rule.target_margin || 15;
      
      let currentAccept = rule.percent_accept || 100;
      let newAccept = currentAccept;

      // --- LOGICA: WINST BEWAKER ---
      
      // Situatie 1: We draaien VERLIES of ONDER target
      if (actualMargin < targetMargin) {
        // Actie: Kwaliteitseis verhogen (acceptatie verlagen) om verlies te stoppen.
        newAccept = Math.max(MIN_ACCEPT, currentAccept - STEP_DOWN);
        
        log.push(`🔻 DOWN: Rule ${rule.id} (Off:${rule.offer_id}) Vol:${currentVolume}. Marge ${actualMargin.toFixed(1)}% < Min ${targetMargin}%. Accept: ${currentAccept}% -> ${newAccept}%`);
      } 
      
      // Situatie 2: We draaien BOVEN target (bijv 50% vs 15%)
      else {
        // Actie: NIETS DOEN. 
        // We gaan niet opschalen, want dan geven we onze marge weg aan de publisher.
        // We laten de campagne lekker doorlopen met de huidige settings.
      }

      // Alleen een update sturen naar Directus als we daadwerkelijk ingrijpen
      if (newAccept !== currentAccept) {
        updates.push({ id: rule.id, percent_accept: newAccept });
      }
    }

    // 5. Stuur wijzigingen naar Directus (Batch update)
    if (updates.length > 0) {
      await dFetch('/items/Optimization_rules', 'PATCH', updates);
    }

    return res.json({ 
      success: true, 
      source: 'Supabase Only',
      checks: rules.length, 
      adjustments: updates.length, 
      logs: log 
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
