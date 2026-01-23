// /pages/api/lead-optimize.js

const DIRECTUS_URL        = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN      = process.env.DIRECTUS_TOKEN;
const HASH_SECRET         = process.env.HASH_SECRET || 'change-me';
const AFFISE_POSTBACK_URL = process.env.AFFISE_POSTBACK_URL || '';
const COLLECTION          = process.env.DIRECTUS_COLLECTION || 'Optimization_rules';

// --- HELPER: ROBUUSTE FETCH MET RETRY ---
async function fetchWithRetry(url, options = {}, retries = 3, backoff = 300) {
  try {
    const res = await fetch(url, options);
    // Als server 5xx error geeft, proberen we het opnieuw.
    if (!res.ok && res.status >= 500 && retries > 0) {
        throw new Error(`Server error ${res.status}`);
    }
    return res;
  } catch (err) {
    if (retries > 0) {
      // Wacht even (backoff) en probeer opnieuw
      await new Promise(r => setTimeout(r, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    throw err;
  }
}

// --- 1. CORS LOGICA ---
function setCorsHeaders(req, res) {
  const allowedOrigins = (process.env.ADMIN_ALLOWED_ORIGINS || '*').split(',');
  const origin = req.headers.origin;

  if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true; 
  }
  return false; 
}

function dfetch(path, init = {}) {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    const miss = [];
    if (!DIRECTUS_URL)  miss.push('DIRECTUS_URL');
    if (!DIRECTUS_TOKEN) miss.push('DIRECTUS_TOKEN');
    throw new Error(`Missing env var(s): ${miss.join(', ')}`);
  }
  const url = `${DIRECTUS_URL}${path}`;
  const headers = {
    ...(init.headers || {}),
    Authorization: `Bearer ${DIRECTUS_TOKEN}`,
    'Content-Type': 'application/json',
  };
  return fetch(url, { ...init, headers, cache: 'no-store' });
}

function todayISO(){ return new Date().toISOString().slice(0,10); }

async function hashToPercent(input){
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const b   = new Uint8Array(buf);
  const n   = ((b[0]<<24)|(b[1]<<16)|(b[2]<<8)|b[3])>>>0;
  return n % 100; // 0..99
}

/* =========================
   BEST MATCH RULE LOOKUP
   ========================= */

async function fetchCandidateRules({ affiliate_id, offer_id, sub_id }) {
  const p = new URLSearchParams();
  p.append('fields', '*,date_created');
  p.append('limit', '5000'); 
  p.append('sort[]', '-id'); 
  p.append('filter[_and][0][active][_eq]', 'true');

  if (offer_id) {
    p.append('filter[_and][1][_or][0][offer_id][_eq]', String(offer_id));
    p.append('filter[_and][1][_or][1][offer_id][_null]', 'true');
  } else {
    p.append('filter[_and][1][offer_id][_null]', 'true');
  }

  const r = await dfetch(`/items/${encodeURIComponent(COLLECTION)}?${p.toString()}`);
  if (!r.ok) throw new Error(`Rules ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return Array.isArray(j?.data) ? j.data : [];
}

function matchScore(rule, lead){
  const isWildcard = (val) => val === null || val === undefined || String(val).trim() === '';
  const check = (ruleVal, leadVal) => {
    if (isWildcard(ruleVal)) return true; 
    return String(ruleVal) === String(leadVal ?? ''); 
  };

  const okAff = check(rule.affiliate_id, lead.affiliate_id);
  const okOff = check(rule.offer_id,     lead.offer_id);
  const okSub = check(rule.sub_id,       lead.sub_id);

  if(!okAff || !okOff || !okSub) return -1;

  let s = 0;
  if (!isWildcard(rule.affiliate_id)) s++;
  if (!isWildcard(rule.offer_id))     s++;
  if (!isWildcard(rule.sub_id))       s++;
  return s;
}

function selectBestRule(candidates, lead){
  let best = null;
  for(const r of candidates){
    const s = matchScore(r, lead);
    if(s < 0) continue; 

    if(!best){ best = { r, s }; continue; }
    if(s > best.s){ best = { r, s }; continue; } 

    if(s === best.s){
      const da = new Date(r.date_created || 0).getTime();
      const db = new Date(best.r.date_created || 0).getTime();
      if(da > db){ best = { r, s }; continue; }
      if(da === db && String(r.id).localeCompare(String(best.r.id)) < 0){
        best = { r, s }; continue;
      }
    }
  }
  return best ? { rule: best.r, level: `score-${best.s}` } : { rule: null, level: null };
}

async function findRule(lead){
  const candidates = await fetchCandidateRules(lead);
  return selectBestRule(candidates, lead);
}

/* ===== Counters ===== */

async function getCounters({ date, affiliate_id, offer_id, sub_id, rule_id }) {
  const filter = {
    _and: [
      { date: { _eq: date } },
      { affiliate_id: { _eq: String(affiliate_id) } },
      { offer_id:     { _eq: String(offer_id) } },
      sub_id == null ? { sub_id: { _null: true } } : { sub_id: { _eq: String(sub_id) } },
      rule_id == null ? { rule_id: { _null: true } } : { rule_id: { _eq: String(rule_id) } },
    ],
  };
  const qs = new URLSearchParams({
    fields: 'id,total_leads,accepted_leads',
    filter: JSON.stringify(filter),
    limit: '1',
  });
  const res = await dfetch(`/items/Optimization_counters?${qs.toString()}`);
  if (!res.ok) throw new Error(`Counters ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const row = json?.data?.[0];
  return { id: row?.id, total: row?.total_leads ?? 0, accepted: row?.accepted_leads ?? 0 };
}

async function incCounters({ date, affiliate_id, offer_id, sub_id, rule_id, addTotal, addAccepted }) {
  const cur = await getCounters({ date, affiliate_id, offer_id, sub_id, rule_id });
  if (!cur.id) {
    const res = await dfetch('/items/Optimization_counters', {
      method: 'POST',
      body: JSON.stringify({
        date,
        affiliate_id: String(affiliate_id),
        offer_id: String(offer_id),
        sub_id: sub_id == null ? null : String(sub_id),
        rule_id: rule_id == null ? null : String(rule_id),
        total_leads: addTotal,
        accepted_leads: addAccepted,
      }),
    });
    if (!res.ok) throw new Error(`Insert counters ${res.status}: ${await res.text()}`);
  } else {
    const res = await dfetch(`/items/Optimization_counters/${cur.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        total_leads: cur.total + addTotal,
        accepted_leads: cur.accepted + addAccepted,
      }),
    });
    if (!res.ok) throw new Error(`Update counters ${res.status}: ${await res.text()}`);
  }
}

// RETRY LOGICA
async function postbackToAffise(clickid) {
  if (!AFFISE_POSTBACK_URL) {
    console.error("❌ AFFISE_POSTBACK_URL missing");
    return false;
  }
  if (!clickid) throw new Error('clickid missing');
  
  const url = new URL(AFFISE_POSTBACK_URL);
  url.searchParams.set('clickid', String(clickid));
  
  // Retry 3x
  const r = await fetchWithRetry(url.toString(), { method: 'GET' }, 3);
  
  if (!r.ok) {
     const txt = await r.text();
     throw new Error(`Affise HTTP ${r.status}: ${txt}`);
  }
  
  return true;
}

/* ===== Handler ===== */

export default async function handler(req, res) {
  if (setCorsHeaders(req, res)) return;

  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

  try {
    if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
      return res.status(500).json({ ok:false, error:'Missing env var(s)' });
    }

    const p = req.body || {};
    const lead = {
      lead_id     : String(p.lead_id || p.id || ''),
      affiliate_id: String(p.affiliate_id || p.aff_id || ''),
      offer_id    : String(p.offer_id || p.offer || ''),
      sub_id      : (p.sub_id === undefined || p.sub_id === null || p.sub_id === '') ? null : String(p.sub_id),
      clickid     : p.clickid || p.click_id || p.transaction_id || '',
    };
    
    if (!lead.lead_id || !lead.affiliate_id || !lead.offer_id) {
      return res.status(400).json({ ok:false, error:'Missing lead_id, affiliate_id or offer_id' });
    }

    // 1) Beste regel zoeken
    const { rule, level } = await findRule(lead);
    
    // Geen regel? Rejecten en tellen (Total+1, Acc+0)
    if (!rule) {
       await incCounters({
          date: todayISO(),
          affiliate_id: lead.affiliate_id,
          offer_id: lead.offer_id,
          sub_id: lead.sub_id,
          rule_id: null, 
          addTotal: 1,
          addAccepted: 0
       });
       return res.status(200).json({ ok:true, decision:'reject', reason:'no-rule' });
    }

    // 2) Cap per dag
    if (rule.cap_per_day && Number(rule.cap_per_day) > 0) {
      const { accepted } = await getCounters({
        date: todayISO(),
        affiliate_id: lead.affiliate_id,
        offer_id: lead.offer_id,
        sub_id: lead.sub_id,
        rule_id: rule.id,
      });
      if (accepted >= Number(rule.cap_per_day)) {
        await incCounters({
          date: todayISO(),
          affiliate_id: lead.affiliate_id,
          offer_id: lead.offer_id,
          sub_id: lead.sub_id,
          rule_id: rule.id,
          addTotal: 1,
          addAccepted: 0
        });
        return res.status(200).json({
          ok:true, decision:'reject', reason:'daily-cap', rule_level: level, rule: {
            id: rule.id, percent_accept: rule.percent_accept, sub_id: rule.sub_id
          }
        });
      }
    }

    // 3) % beslissing
    const score = await hashToPercent(
      `${lead.lead_id}:${lead.affiliate_id}:${lead.offer_id}:${lead.sub_id ?? 'null'}:${HASH_SECRET}`
    );
    // Beslissing op basis van regels (nog niet definitief, postback moet ook lukken)
    const ruleSaysAccept = score < Number(rule.percent_accept || 0);

    // 4) Postback uitvoeren (indien geaccepteerd door regels)
    let postbackSuccess = false;
    let postbackError = null;

    if (ruleSaysAccept) {
      try {
        await postbackToAffise(lead.clickid);
        postbackSuccess = true;
      } catch (e) {
        console.error(`POSTBACK FAILED lead=${lead.lead_id}`, e);
        postbackError = String(e);
        postbackSuccess = false;
      }
    }

    // 5) Database Counters Bijwerken
    // We tellen de lead ALTIJD als total.
    // We tellen hem ALLEEN als accepted als de postback ook echt gelukt is.
    await incCounters({
      date: todayISO(),
      affiliate_id: lead.affiliate_id,
      offer_id: lead.offer_id,
      sub_id: lead.sub_id,
      rule_id: rule.id,
      addTotal: 1,
      // CRUCIAAL: Alleen +1 als de postback gelukt is.
      addAccepted: postbackSuccess ? 1 : 0, 
    });

    // 6) Response naar gebruiker
    if (postbackSuccess) {
      return res.status(200).json({
        ok:true, 
        decision:'accept', 
        forwarded: true, 
        rule_level: level, 
        rule: { id: rule.id, percent_accept: rule.percent_accept, sub_id: rule.sub_id }
      });
    } else {
      // Als de regel 'Ja' zei, maar Affise 'Nee' (of timeout), is het eindresultaat Reject.
      return res.status(200).json({
        ok:true, 
        decision:'reject', 
        // Geef duidelijk aan waarom (regel of postback fout)
        reason: ruleSaysAccept ? 'postback-failed' : 'rule-percentage',
        error: postbackError,
        forwarded: false, 
        rule_level: level, 
        rule: { id: rule.id, percent_accept: rule.percent_accept, sub_id: rule.sub_id }
      });
    }

  } catch (e) {
    console.error("Handler Error:", e);
    return res.status(500).json({ ok:false, error:String(e) });
  }
}
