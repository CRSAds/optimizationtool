// pages/api/rules/[id].js
// UPDATE (PATCH) + DELETE (DELETE)

const DIRECTUS_URL   = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const ADMIN_UI_TOKEN = process.env.ADMIN_UI_TOKEN;
const COLLECTION     = process.env.DIRECTUS_COLLECTION || 'Optimization_rules';

// ---- CORS helpers ----
function parseAllowed() {
  return (process.env.ADMIN_ALLOWED_ORIGINS || '*')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}
function applyCors(req, res) {
  const allowed = parseAllowed();
  const origin = req.headers.origin;
  if (origin && (allowed.includes('*') || allowed.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

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
  if ('sub_id'         in p) body.sub_id         = p.sub_id === 'null' ? null : (p.sub_id === '' ? null : p.sub_id);
  if ('percent_accept' in p) body.percent_accept = Number(p.percent_accept ?? 0);
  if ('priority'       in p) body.priority       = Number(p.priority ?? 100);
  if ('active'         in p) body.active         = !!p.active;
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
  };
}

// ---- handler ----
export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  // Admin auth
  const hdr = req.headers['x-admin-token'];
  if (!hdr || String(hdr) !== String(ADMIN_UI_TOKEN)) {
    return res.status(403).json({ ok:false, error:'forbidden' });
  }

  const { id } = req.query;

  try {
    if (req.method === 'PATCH') {
      const body = mapIn(req.body || {});
      const r = await dFetch(`/items/${encodeURIComponent(COLLECTION)}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json(j);
      return res.status(200).json({ ok:true, item: mapOut(j.data) });
    }

    if (req.method === 'DELETE') {
      const r = await dFetch(`/items/${encodeURIComponent(COLLECTION)}/${id}`, { method:'DELETE' });
      if (r.status === 204) return res.status(204).end();
      const j = await r.json();
      return res.status(r.status).json(j);
    }

    return res.status(405).json({ ok:false, error:'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
}
