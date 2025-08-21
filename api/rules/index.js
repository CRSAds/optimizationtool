// pages/api/rules/index.js
// LIST (GET) + CREATE (POST)

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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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

// ---- description <-> Omschrijving mapping ----
function mapOut(row) {
  // Directus row -> UI (normalizeer naar "description")
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
function mapIn(p) {
  // UI payload -> Directus body (schrijf altijd "Omschrijving")
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
      p.sub_id === 'null' ? null :
      (p.sub_id === '' ? null : (p.sub_id ?? null)),
    percent_accept: Number(p.percent_accept ?? 0),
    priority:       Number(p.priority ?? 100),
    active: !!p.active,
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

  try {
    if (req.method === 'GET') {
      const qs = new URLSearchParams({
        // vraag "Omschrijving" op i.p.v. description
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
      const r = await dFetch(`/items/${encodeURIComponent(COLLECTION)}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        // vaak 403 = rol/perm issue
        return res.status(r.status).json(j);
      }
      return res.status(201).json({ ok:true, item: mapOut(j.data) });
    }

    return res.status(405).json({ ok:false, error:'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
}
