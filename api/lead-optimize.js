// --- MODULE 1: CONFIGURATIE & ENV ---
import { createClient } from '@supabase/supabase-js'; // VOEG DIT TOE
const DIRECTUS_URL        = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN      = process.env.DIRECTUS_TOKEN;
const HASH_SECRET         = process.env.HASH_SECRET || 'change-me';
const AFFISE_POSTBACK_URL = process.env.AFFISE_POSTBACK_URL || '';
const COLLECTION          = process.env.DIRECTUS_COLLECTION || 'Optimization_rules';

// Initialiseer Supabase (VOEG DIT TOE)
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- MODULE 2: ROBUUSTE FETCH HELPERS (MET RETRY & TIMEOUT) ---
const fetchWithTimeout = async (url, options, ms = 4000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

async function fetchWithRetry(url, options = {}, retries = 2, backoff = 300) {
  try {
    const res = await fetchWithTimeout(url, options, 4000);
    if (!res.ok && res.status >= 500 && retries > 0) throw new Error(`Server error ${res.status}`);
    return res;
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    throw err;
  }
}

function dfetch(path, init = {}) {
  const url = `${DIRECTUS_URL}${path}`;
  const headers = {
    ...(init.headers || {}),
    Authorization: `Bearer ${DIRECTUS_TOKEN}`,
    'Content-Type': 'application/json',
  };
  return fetchWithRetry(url, { ...init, headers, cache: 'no-store' }, 1);
}

// --- MODULE 3: RULE MATCHING ENGINE (STRICT PRIORITEIT) ---
function matchScore(rule, lead) {
  const isWildcard = (val) => val === null || val === undefined || String(val).trim() === '';
  
  const okAff = isWildcard(rule.affiliate_id) || String(rule.affiliate_id) === String(lead.affiliate_id);
  const okOff = isWildcard(rule.offer_id) || String(rule.offer_id) === String(lead.offer_id);
  const okSub = isWildcard(rule.sub_id) || String(rule.sub_id) === String(lead.sub_id);

  if (!okAff || !okOff || !okSub) return -1;

  let score = 0;
  if (!isWildcard(rule.affiliate_id)) score += 1;
  if (!isWildcard(rule.offer_id))     score += 1;
  // Sub_id krijgt een veel hogere score zodat een sub-match ALTIJD wint van een algemene offer-match
  if (!isWildcard(rule.sub_id))       score += 5; 
  return score;
}

function selectBestRule(candidates, lead) {
  let best = null;
  for (const r of candidates) {
    const s = matchScore(r, lead);
    if (s < 0) continue;

    if (!best || s > best.s) {
      best = { r, s };
    } else if (s === best.s) {
      // Bij gelijke score wint de nieuwste regel
      const da = new Date(r.date_created || 0).getTime();
      const db = new Date(best.r.date_created || 0).getTime();
      if (da > db) best = { r, s };
    }
  }
  return best ? { rule: best.r, level: `score-${best.s}` } : { rule: null, level: null };
}

// --- MODULE 4: COUNTERS & POSTBACK LOGICA ---
async function getCounters({ date, affiliate_id, offer_id, sub_id, rule_id }) {
  const filter = {
    _and: [
      { date: { _eq: date } },
      { affiliate_id: { _eq: String(affiliate_id) } },
      { offer_id: { _eq: String(offer_id) } },
      sub_id == null ? { sub_id: { _null: true } } : { sub_id: { _eq: String(sub_id) } },
      rule_id == null ? { rule_id: { _null: true } } : { rule_id: { _eq: String(rule_id) } },
    ],
  };
  const qs = new URLSearchParams({ fields: 'id,total_leads,accepted_leads', filter: JSON.stringify(filter), limit: '1' });
  const res = await dfetch(`/items/Optimization_counters?${qs}`);
  const json = await res.json();
  const row = json?.data?.[0];
  return { id: row?.id, total: row?.total_leads ?? 0, accepted: row?.accepted_leads ?? 0 };
}

async function incCounters({ date, affiliate_id, offer_id, sub_id, rule_id, addTotal, addAccepted }) {
  try {
    console.log("Poging tot loggen naar Supabase:", { date, offer_id, sub_id }); // Debug log
    
    const { error } = await supabase.rpc('increment_counter', {
      p_day: date,
      p_offer: String(offer_id),
      p_sub: sub_id ? String(sub_id) : null,
      p_aff: String(affiliate_id),
      p_rule: rule_id ? String(rule_id) : null,
      p_add_total: parseInt(addTotal),
      p_add_acc: parseInt(addAccepted)
    });

    if (error) {
      console.error("❌ Supabase RPC Error:", error.message, error.details);
    } else {
      console.log("✅ Supabase counter succesvol bijgewerkt");
    }
  } catch (e) {
    console.error("❌ Kritieke fout in incCounters:", e.message);
  }
}

// --- MODULE 5: MAIN REQUEST HANDLER ---
export default async function handler(req, res) {
  // CORS & Method check
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const p = req.body || {};
    const lead = {
      lead_id: String(p.lead_id || p.id || ''),
      affiliate_id: String(p.affiliate_id || p.aff_id || ''),
      offer_id: String(p.offer_id || p.offer || ''),
      sub_id: (p.sub_id === undefined || p.sub_id === null || p.sub_id === '') ? null : String(p.sub_id),
      clickid: p.clickid || p.click_id || p.transaction_id || '',
    };
    const today = new Date().toISOString().slice(0, 10);

    // 1. Zoek Beste Regel
    const qs = new URLSearchParams({ fields: '*,date_created', filter: JSON.stringify({ active: { _eq: true }, offer_id: { _eq: lead.offer_id } }) });
    const rData = await dfetch(`/items/${COLLECTION}?${qs}`);
    const { data: candidates } = await rData.json();
    const { rule, level } = selectBestRule(candidates || [], lead);

    if (!rule) {
      incCounters({ date: today, ...lead, rule_id: null, addTotal: 1, addAccepted: 0 });
      return res.status(200).json({ ok: true, decision: 'reject', reason: 'no-rule' });
    }

    // 2. Cap Check
    if (rule.cap_per_day > 0) {
      const { accepted } = await getCounters({ date: today, ...lead, rule_id: rule.id });
      if (accepted >= rule.cap_per_day) {
        incCounters({ date: today, ...lead, rule_id: rule.id, addTotal: 1, addAccepted: 0 });
        return res.json({ ok: true, decision: 'reject', reason: 'daily-cap' });
      }
    }

    // 3. Hash Beslissing
    const input = `${lead.lead_id}:${lead.affiliate_id}:${lead.offer_id}:${lead.sub_id ?? 'null'}:${HASH_SECRET}`;
    const data = new TextEncoder().encode(input);
    const buf = await crypto.subtle.digest('SHA-256', data);
    const score = (new Uint8Array(buf)[0] << 24 | new Uint8Array(buf)[1] << 16 | new Uint8Array(buf)[2] << 8 | new Uint8Array(buf)[3]) >>> 0;
    const ruleSaysAccept = (score % 100) < Number(rule.percent_accept || 0);

    // 4. Postback & Response
    let success = false;
    if (ruleSaysAccept && lead.clickid) {
      try {
        const url = new URL(AFFISE_POSTBACK_URL);
        url.searchParams.set('clickid', String(lead.clickid));
        const pb = await fetchWithRetry(url.toString(), { method: 'GET' }, 2);
        if (pb.ok) success = true;
      } catch (e) { console.error("Postback failed", e); }
    }

    incCounters({ date: today, ...lead, rule_id: rule.id, addTotal: 1, addAccepted: success ? 1 : 0 });

    return res.status(200).json({
      ok: true,
      decision: success ? 'accept' : 'reject',
      reason: ruleSaysAccept ? (success ? 'rules' : 'postback-failed') : 'rule-percentage',
      rule: { id: rule.id, percent: rule.percent_accept }
    });

  } catch (e) {
    console.error("CRITICAL ERROR:", e);
    return res.status(200).json({ ok: false, decision: 'reject', error: String(e) });
  }
}
