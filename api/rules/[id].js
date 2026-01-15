// pages/api/rules/[id].js
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

// ---- mapping ----
function mapIn(p) {
  const desc =
    p?.description ??
    p?.Omschrijving ??
    p?.omschrijving ??
    p?.Beschrijving ??
    p?.beschrijving ??
    null;

  const body = {};
  if ('description' in p || 'Omschrijving' in p || 'omschrijving' in p || 'Beschrijving' in p || 'beschrijving' in p) {
    body.Omschrijving = desc;
  }
  if ('affiliate_id'   in p) body.affiliate_id   = p.affiliate_id === '' ? null : p.affiliate_id;
  if ('offer_id'       in p) body.offer_id       = p.offer_id     === '' ? null : p.offer_id;
  if ('sub_id'         in p) {
    const sv = p.sub_id;
    body.sub_id = (sv === '' || String(sv).toLowerCase()==='null') ? null : sv;
  }
  if ('percent_accept' in p) body.percent_accept = Number(p.percent_accept ?? 0);
  if ('priority'       in p) body.priority       = Number(p.priority ?? 100);
  if ('active'         in p) body.active         = !!p.active;
  if ('target_margin'    in p) body.target_margin    = Number(p.target_margin ?? 15);
  if ('min_volume'       in p) body.min_volume       = Number(p.min_volume ?? 20);
  if ('auto_pilot'       in p) body.auto_pilot       = !!p.auto_pilot;
  return body;
}

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

// ---- handler ----
export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  // Admin auth
  const hdr = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
  if (!hdr || String(hdr) !== String(ADMIN_UI_TOKEN)) {
    return res.status(403).json({ ok:false, error:'forbidden' });
  }

  const { id } = req.query;

  try {
    if (req.method === 'PATCH') {
      const body = mapIn(req.body || {});
      // mini-validatie indien meegegeven
      const errs = [];
      if ('percent_accept' in body) {
        const pct = Number(body.percent_accept);
        if (Number.isNaN(pct) || pct<0 || pct>100) errs.push('percent_accept 0–100');
      }
      if ('priority' in body) {
        const pri = Number(body.priority);
        if (Number.isNaN(pri) || pri<0) errs.push('priority ≥ 0');
      }
      if (errs.length) return res.status(400).json({ ok:false, error: 'Validation: '+errs.join(', ') });

      const r = await dFetch(`/items/${encodeURIComponent(COLLECTION)}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json(j);
      return res.status(200).json({ ok:true, item: mapOut(j.data) });
    }

    if (req.method === 'DELETE') {
      const r = await dFetch(`/items/${encodeURIComponent(COLLECTION)}/${encodeURIComponent(id)}`, { method:'DELETE' });
      if (r.status === 204) return res.status(204).end();
      const j = await r.json();
      return res.status(r.status).json(j);
    }

    return res.status(405).json({ ok:false, error:'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
}
