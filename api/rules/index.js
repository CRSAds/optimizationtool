// pages/api/rules/index.js

const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const ADMIN_UI_TOKEN = process.env.ADMIN_UI_TOKEN;

// --- 1. CORS LOGICA ---
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
  } else if (allowed.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

// Helper voor calls naar Directus
function dFetch(path, options = {}) {
  const url = `${DIRECTUS_URL}${path}`;
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${DIRECTUS_TOKEN}`,
    'Content-Type': 'application/json',
  };
  return fetch(url, { ...options, headers });
}

// --- MAPPING FUNCTIE (Nieuw toegevoegd voor POST) ---
function mapIn(p) {
  // Zoek naar description of Omschrijving in de input
  const desc =
    p?.description ??
    p?.Omschrijving ??
    p?.omschrijving ??
    p?.Beschrijving ??
    p?.beschrijving ??
    null;

  const body = {};
  
  // Als er een beschrijving is gevonden, map deze naar 'Omschrijving' (voor Directus)
  if (desc !== undefined) {
    body.Omschrijving = desc;
  }

  // Map de overige velden direct
  if ('affiliate_id'   in p) body.affiliate_id   = p.affiliate_id === '' ? null : p.affiliate_id;
  if ('offer_id'       in p) body.offer_id       = p.offer_id     === '' ? null : p.offer_id;
  if ('sub_id'         in p) {
    const sv = p.sub_id;
    body.sub_id = (sv === '' || String(sv).toLowerCase()==='null') ? null : sv;
  }
  if ('percent_accept' in p) body.percent_accept = Number(p.percent_accept ?? 0);
  if ('priority'       in p) body.priority       = Number(p.priority ?? 100);
  if ('active'         in p) body.active         = !!p.active;
  if ('target_margin'  in p) body.target_margin  = Number(p.target_margin ?? 15);
  if ('min_volume'     in p) body.min_volume     = Number(p.min_volume ?? 20);
  if ('auto_pilot'     in p) body.auto_pilot     = !!p.auto_pilot;
  
  // NIEUW: We voegen hier min_cpc toe (Doel EPC)
  if ('min_cpc'        in p) body.min_cpc        = Number(p.min_cpc ?? 0);
  
  return body;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  // Auth Check
  const hdr = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
  if (!hdr || String(hdr) !== String(ADMIN_UI_TOKEN)) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  try {
    // --- GET: Regels ophalen ---
    if (req.method === 'GET') {
      const qs = new URLSearchParams({
        // AANGEPAST: min_cpc toegevoegd aan de fields lijst
        fields: 'id,Omschrijving,description,affiliate_id,offer_id,sub_id,percent_accept,priority,active,auto_pilot,target_margin,min_volume,min_cpc',
        sort: 'priority',
        limit: '500',
      });
      
      const r = await dFetch(`/items/Optimization_rules?${qs.toString()}`);
      const j = await r.json();
      
      if (!r.ok) throw new Error(JSON.stringify(j));
      return res.status(200).json({ ok: true, items: j.data || [] });
    }

    // --- PATCH: Regels updaten ---
    if (req.method === 'PATCH') {
      const { keys, data } = req.body;
      if (!keys || !Array.isArray(keys) || !data) {
        return res.status(400).json({ ok: false, error: 'Invalid body' });
      }
      
      // We gebruiken hier mapIn niet omdat PATCH vaak partiële updates zijn, 
      // maar voor consistentie zou dat in de toekomst wel kunnen. 
      // Voor nu laten we PATCH zoals hij was omdat die werkte via de bulk update logic.

      const r = await dFetch(`/items/Optimization_rules`, {
        method: 'PATCH',
        body: JSON.stringify({ keys, data })
      });
      const j = await r.json();

      if (!r.ok) throw new Error(JSON.stringify(j));
      return res.status(200).json({ ok: true, data: j.data });
    }

    // --- POST: Nieuwe regel aanmaken (HIER ZAT HET PROBLEEM) ---
    if (req.method === 'POST') {
      // Gebruik mapIn om de velden (vooral description) goed te zetten
      const payload = mapIn(req.body);
      
      const r = await dFetch(`/items/Optimization_rules`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      
      if (!r.ok) throw new Error(JSON.stringify(j));
      return res.status(200).json({ ok: true, data: j.data });
    }

    // --- DELETE: Regels verwijderen ---
    if (req.method === 'DELETE') {
      const ids = req.body;
      if (!Array.isArray(ids)) return res.status(400).json({ error: 'Body must be array of IDs' });

      const r = await dFetch(`/items/Optimization_rules`, {
        method: 'DELETE',
        body: JSON.stringify(ids)
      });
      
      if (!r.ok) {
        if (r.status === 204) return res.status(200).json({ ok: true });
        const j = await r.json();
        throw new Error(JSON.stringify(j));
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  } catch (e) {
    console.error("Rules API Error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
