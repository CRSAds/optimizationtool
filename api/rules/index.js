// pages/api/rules/index.js
import { applyCors } from './_cors.js';

const DIRECTUS_URL   = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const ADMIN_UI_TOKEN = process.env.ADMIN_UI_TOKEN;
const COLLECTION     = process.env.DIRECTUS_COLLECTION || 'Optimization_rules';

// ---- Directus fetch ----
function dFetch(path, init = {}) {
  if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
    const miss = [];
    if (!DIRECTUS_URL)  miss.push('DIRECTUS_URL');
    if (!DIRECTUS_TOKEN) miss.push('DIRECTUS_TOKEN');
    throw new Error('Missing env: ' + miss.join(', '));
  }
  const url = `${DIRECTUS_URL}${path}`;
  const headers = {
    ...(init.headers || {}),
    Authorization: `Bearer ${DIRECTUS_TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  return fetch(url, { ...init, headers });
}

// ---- description <-> Omschrijving mapping ----
function mapOut(row) {
  return {
    id: row.id,
    description: row.Omschrijving ?? row.description ?? null,
    affiliate_id: row.affiliate_id ?? null,
    offer_id: row.offer_id ?? null,
    sub_id: row.sub_id ?? null,
    percent_accept: row.percent_accept ?? 0,
    priority: row.priority ?? 100,
    active: !!row.active,
    target_margin: row.target_margin ?? 15,
    min_volume: row.min_volume ?? 20,
    auto_pilot: !!row.auto_pilot,
  };
}
function mapIn(p) {
  const desc =
    p?.description ??
    p?.Omschrijving ??
    p?.omschrijving ??
    p?.Beschrijving ??
    p?.beschrijving ??
    null;

  return {
    Omschrijving: desc ?? null,
    affiliate_id: p.affiliate_id === '' ? null : (p.affiliate_id ?? null),
    offer_id:     p.offer_id     === '' ? null : (p.offer_id     ?? null),
    sub_id:
      String(p.sub_id).toLowerCase() === 'null' ? null :
      (p.sub_id === '' ? null : (p.sub_id ?? null)),
    percent_accept: Number(p.percent_accept ?? 0),
    priority:       Number(p.priority ?? 100),
    active: !!p.active,
    target_margin: row.target_margin ?? 15,
    min_volume: row.min_volume ?? 20,
    auto_pilot: !!row.auto_pilot,
  };
}

// ---- handler ----
export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  // Admin auth
  const hdr = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
  if (!hdr || String(hdr) !== String(ADMIN_UI_TOKEN)) {
    return res.status(403).json({ ok:false, error:'forbidden' });
  }

  try {
    if (req.method === 'GET') {
      const qs = new URLSearchParams({
        fields: 'id,Omschrijving,affiliate_id,offer_id,sub_id,percent_accept,priority,active',
        sort: 'priority',
        limit: '200',
      });
      const r = await dFetch(`/items/${encodeURIComponent(COLLECTION)}?${qs.toString()}`);
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json(j);
      const items = (j?.data || []).map(mapOut);
      return res.status(200).json({ ok:true, items });
    }

    if (req.method === 'POST') {
      const body = mapIn(req.body || {});
      // mini-validaties
      const errs = [];
      if (!body.Omschrijving || !String(body.Omschrijving).trim()) errs.push('Omschrijving verplicht');
      const pct = Number(body.percent_accept);
      if (Number.isNaN(pct) || pct<0 || pct>100) errs.push('percent_accept 0–100');
      const pri = Number(body.priority);
      if (Number.isNaN(pri) || pri<0) errs.push('priority ≥ 0');
      if (errs.length) return res.status(400).json({ ok:false, error: 'Validation: '+errs.join(', ') });

      const r = await dFetch(`/items/${encodeURIComponent(COLLECTION)}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json(j);
      return res.status(201).json({ ok:true, item: mapOut(j.data) });
    }

    return res.status(405).json({ ok:false, error:'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
}
