// pages/api/debug-rule.js
// Snelle debug om te zien wat de function werkelijk uit Directus haalt

const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
// Let op: bij jou heet de collectie met hoofdletter O:
const COLLECTION = process.env.DIRECTUS_COLLECTION || 'Optimization_rules';

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

export default async function handler(req, res) {
  try {
    // Query params
    const affiliate_id = String(req.query.affiliate_id ?? '');
    const offer_id = String(req.query.offer_id ?? '');
    // sub_id: 'null', undefined of '' => match op NULL-regels
    const rawSub = req.query.sub_id;
    const sub_id =
      rawSub === 'null' || rawSub === undefined || rawSub === '' ? null : String(rawSub);

    if (!affiliate_id || !offer_id) {
      return res
        .status(400)
        .json({ ok: false, error: 'need affiliate_id & offer_id in query' });
    }

    // Strikt & compatibel:
    // - active: _eq=true (geen _in[])
    // - affiliate_id/offer_id: _eq (strings ok)
    // - sub_id: exacte match ÓF null fallback
    const params = new URLSearchParams();
    params.append('fields', '*');
    params.append('limit', '50');
    params.append('sort[]', '-priority');

    // active
    params.append('filter[_and][0][active][_eq]', 'true');

    // affiliate_id / offer_id
    params.append('filter[_and][1][affiliate_id][_eq]', affiliate_id);
    params.append('filter[_and][2][offer_id][_eq]', offer_id);

    if (sub_id !== null) {
      // exact sub + fallback null
      params.append('filter[_and][3][_or][0][sub_id][_eq]', sub_id);
      params.append('filter[_and][3][_or][1][sub_id][_null]', 'true');
    } else {
      // alleen null-regels
      params.append('filter[_and][3][sub_id][_null]', 'true');
    }

    const path = `/items/${encodeURIComponent(COLLECTION)}?${params.toString()}`;
    const r = await dfetch(path);
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { parse_error: true, raw: text?.slice(0, 4000) };
    }

    return res.status(200).json({
      ok: true,
      env: {
        DIRECTUS_URL_set: !!DIRECTUS_URL,
        DIRECTUS_TOKEN_set: !!DIRECTUS_TOKEN,
        COLLECTION,
    },
      query: { affiliate_id, offer_id, sub_id },
      request: {
        method: 'GET',
        url: `${DIRECTUS_URL}${path}`,
      },
      directus_status: r.status,
      data_count: Array.isArray(json?.data) ? json.data.length : 0,
      data: Array.isArray(json?.data) ? json.data : [],
      raw: json?.parse_error ? json.raw : undefined, // alleen bij parse issues
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
