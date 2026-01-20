// /pages/api/lead-optimize.js

const DIRECTUS_URL        = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN      = process.env.DIRECTUS_TOKEN;
const HASH_SECRET         = process.env.HASH_SECRET || 'change-me';
const AFFISE_POSTBACK_URL = process.env.AFFISE_POSTBACK_URL || '';
const COLLECTION          = process.env.DIRECTUS_COLLECTION || 'Optimization_rules';

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
  
  // FIX 1: Caching UITZETTEN. 
  // Dit is cruciaal. Anders 'ziet' Vercel je nieuwe regel de eerste minuten niet.
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
  
  // Preventief de limiet verhogen (ook al heb je er nu minder, dit voorkomt problemen in de toekomst)
  p.append('limit', '5000'); 
  p.append('sort[]', '-id'); // Nieuwste eerst
  p.append('filter[_and][0][active][_eq]', 'true');

  if (affiliate_id == null || affiliate_id === '') {
    p.append('filter[_and][1][affiliate_id][_null]', 'true');
  } else {
    p.append('filter[_and][1][_or][0][affiliate_id][_eq]', String(affiliate_id));
    p.append('filter[_and][1][_or][1][affiliate_id][_null]', 'true');
  }

  if (offer_id == null || offer_id === '') {
    p.append('filter[_and][2][offer_id][_null]', 'true');
  } else {
    p.append('filter[_and][2][_or][0][offer_id][_eq]', String(offer_id));
    p.append('filter[_and][2][_or][1][offer_id][_null]', 'true');
  }

  if (sub_id == null || sub_id === '') {
    p.append('filter[_and][3][sub_id][_null]', 'true');
  } else {
    p.append('filter[_and][3][_or][0][sub_id][_eq]', String(sub_id));
    p.append('filter[_and][3][_or][1][sub_id][_null]', 'true');
  }

  const r = await dfetch(`/items/${encodeURIComponent(COLLECTION)}?${p.toString()}`);
  if (!r.ok) throw new Error(`Rules ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return Array.isArray(j?.data) ? j.data : [];
}

function matchScore(rule, lead){
  const eq = (ruleVal, leadVal) => ruleVal == null ? true : String(ruleVal) === String(leadVal ?? '');
  const okAff = eq(rule.affiliate_id, lead.affiliate_id);
  const okOff = eq(rule.offer_id,     lead.offer_id);
  const okSub = eq(rule.sub_id,       lead.sub_id);
  if(!okAff || !okOff || !okSub) return -1;

  let s = 0;
  if (rule.affiliate_id != null) s++;
  if (rule.offer_id     != null) s++;
  if (rule.sub_id       != null) s++;
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

async function postbackToAffise(clickid) {
  if (!AFFISE_POSTBACK_URL) return false;
  if (!clickid) throw new Error('clickid missing');
  const url = new URL(AFFISE_POSTBACK_URL);
  url.searchParams.set('clickid', String(clickid));
  const r = await fetch(url.toString(), { method: 'GET' });
  if (!r.ok) throw new Error(`Affise postback ${r.status}: ${await r.text()}`);
  return true;
}

/* ===== Handler ===== */

export default async function handler(req, res) {
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
    
    // FIX 2: Geen regel gevonden?
    // EERST tellen in database, DAN pas rejecten.
    // Zo zie je in je dashboard tenminste dat er traffic is (rejected).
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
    const accept = score < Number(rule.percent_accept || 0);

    // 4) Counters update
    await incCounters({
      date: todayISO(),
      affiliate_id: lead.affiliate_id,
      offer_id: lead.offer_id,
      sub_id: lead.sub_id,
      rule_id: rule.id,
      addTotal: 1,
      addAccepted: accept ? 1 : 0,
    });

    // 5) Postback
    if (accept) {
      try {
        const forwarded = await postbackToAffise(lead.clickid);
        return res.status(200).json({
          ok:true, decision:'accept', forwarded, rule_level: level, rule: {
            id: rule.id, percent_accept: rule.percent_accept, sub_id: rule.sub_id
          }
        });
      } catch (e) {
        return res.status(200).json({
          ok:true, decision:'accept', forwarded:false, error:String(e), rule_level: level, rule: {
            id: rule.id, percent_accept: rule.percent_accept, sub_id: rule.sub_id
          }
        });
      }
    } else {
      return res.status(200).json({
        ok:true, decision:'reject', rule_level: level, rule: {
          id: rule.id, percent_accept: rule.percent_accept, sub_id: rule.sub_id
        }
      });
    }
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
}
