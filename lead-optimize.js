// pages/api/lead-optimize.js
const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const HASH_SECRET = process.env.HASH_SECRET || 'change-me';
const AFFISE_POSTBACK_URL = process.env.AFFISE_POSTBACK_URL || '';
const COLLECTION = process.env.DIRECTUS_COLLECTION || 'Optimization_rules'; // let op: hoofdletter O

function dfetch(path, init = {}) {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    const miss = [];
    if (!DIRECTUS_URL) miss.push('DIRECTUS_URL');
    if (!DIRECTUS_TOKEN) miss.push('DIRECTUS_TOKEN');
    throw new Error(`Missing env var(s): ${miss.join(', ')}`);
  }
  const url = `${DIRECTUS_URL}${path}`;
  const headers = {
    ...(init.headers || {}),
    Authorization: `Bearer ${DIRECTUS_TOKEN}`,
    'Content-Type': 'application/json',
  };
  return fetch(url, { ...init, headers });
}

function todayISO() { return new Date().toISOString().slice(0,10); }

async function hashToPercent(input) {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const b = new Uint8Array(buf);
  const n = ((b[0]<<24)|(b[1]<<16)|(b[2]<<8)|b[3])>>>0;
  return n % 100; // 0..99
}

// === FIXED: zelfde filterlogica als debug ===
async function findRule({ affiliate_id, offer_id, sub_id }) {
  const params = new URLSearchParams();
  params.append('fields', '*');
  params.append('limit', '1');
  params.append('sort[]', '-priority');
  params.append('filter[_and][0][active][_eq]', 'true');
  params.append('filter[_and][1][affiliate_id][_eq]', String(affiliate_id));
  params.append('filter[_and][2][offer_id][_eq]', String(offer_id));

  // sub_id: exact + fallback null, of alleen null als je geen sub_id meestuurt
  const normalizedSub = (sub_id === undefined || sub_id === null || sub_id === '') ? null : String(sub_id);
  if (normalizedSub !== null) {
    params.append('filter[_and][3][_or][0][sub_id][_eq]', normalizedSub);
    params.append('filter[_and][3][_or][1][sub_id][_null]', 'true');
  } else {
    params.append('filter[_and][3][sub_id][_null]', 'true');
  }

  const res = await dfetch(`/items/${encodeURIComponent(COLLECTION)}?${params.toString()}`);
  if (!res.ok) throw new Error(`Rules ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data?.data || [])[0] || null;
}

// === counters (ongewijzigd) ===
async function getCounters({ date, affiliate_id, offer_id, sub_id }) {
  const filter = {
    _and: [
      { date: { _eq: date } },
      { affiliate_id: { _eq: String(affiliate_id) } },
      { offer_id: { _eq: String(offer_id) } },
      sub_id == null ? { sub_id: { _null: true } } : { sub_id: { _eq: String(sub_id) } },
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

async function incCounters({ date, affiliate_id, offer_id, sub_id, addTotal, addAccepted }) {
  const cur = await getCounters({ date, affiliate_id, offer_id, sub_id });
  if (!cur.id) {
    const res = await dfetch('/items/Optimization_counters', {
      method: 'POST',
      body: JSON.stringify({
        date,
        affiliate_id: String(affiliate_id),
        offer_id: String(offer_id),
        sub_id: sub_id == null ? null : String(sub_id),
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
  if (!AFFISE_POSTBACK_URL) throw new Error('AFFISE_POSTBACK_URL missing');
  if (!clickid) throw new Error('clickid missing');
  const url = new URL(AFFISE_POSTBACK_URL);
  url.searchParams.set('clickid', String(clickid));
  const r = await fetch(url.toString(), { method: 'GET' });
  if (!r.ok) throw new Error(`Affise postback ${r.status}: ${await r.text()}`);
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

  try {
    const p = req.body || {};
    const lead = {
      lead_id: String(p.lead_id || p.id || ''),
      affiliate_id: String(p.affiliate_id || p.aff_id || ''),
      offer_id: String(p.offer_id || p.offer || ''),
      sub_id: (p.sub_id === undefined || p.sub_id === null || p.sub_id === '') ? null : String(p.sub_id),
      clickid: p.clickid || p.click_id || p.transaction_id || '',
    };
    if (!lead.lead_id || !lead.affiliate_id || !lead.offer_id) {
      return res.status(400).json({ ok:false, error:'Missing lead_id, affiliate_id or offer_id' });
    }

    // 1) Rule (nu met juiste filter)
    const rule = await findRule(lead);
    if (!rule) return res.status(200).json({ ok:true, decision:'reject', reason:'no-rule' });

    // 2) (optioneel) cap per dag
    if (rule.cap_per_day && Number(rule.cap_per_day) > 0) {
      const { accepted } = await getCounters({
        date: todayISO(),
        affiliate_id: lead.affiliate_id,
        offer_id: lead.offer_id,
        sub_id: lead.sub_id
      });
      if (accepted >= Number(rule.cap_per_day)) {
        await incCounters({
          date: todayISO(),
          affiliate_id: lead.affiliate_id,
          offer_id: lead.offer_id,
          sub_id: lead.sub_id,
          addTotal: 1,
          addAccepted: 0
        });
        return res.status(200).json({ ok:true, decision:'reject', reason:'daily-cap' });
      }
    }

    // 3) % beslissing (deterministisch)
    const score = await hashToPercent(
      `${lead.lead_id}:${lead.affiliate_id}:${lead.offer_id}:${lead.sub_id ?? 'null'}:${HASH_SECRET}`
    );
    const accept = score < Number(rule.percent_accept || 0);

    // 4) Counters
    await incCounters({
      date: todayISO(),
      affiliate_id: lead.affiliate_id,
      offer_id: lead.offer_id,
      sub_id: lead.sub_id,
      addTotal: 1,
      addAccepted: accept ? 1 : 0,
    });

    // 5) Postback (alleen clickid meesturen) — optioneel
    if (accept) {
      try {
        await postbackToAffise(lead.clickid);
        return res.status(200).json({
          ok:true, decision:'accept', forwarded:true, rule: {
            id: rule.id, percent_accept: rule.percent_accept, priority: rule.priority, sub_id: rule.sub_id
          }
        });
      } catch (e) {
        return res.status(200).json({
          ok:true, decision:'accept', forwarded:false, error:String(e), rule: {
            id: rule.id, percent_accept: rule.percent_accept, priority: rule.priority, sub_id: rule.sub_id
          }
        });
      }
    } else {
      return res.status(200).json({
        ok:true, decision:'reject', rule: {
          id: rule.id, percent_accept: rule.percent_accept, priority: rule.priority, sub_id: rule.sub_id
        }
      });
    }
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
}
