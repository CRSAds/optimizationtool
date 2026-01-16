// pages/api/rules/index.js

const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const ADMIN_UI_TOKEN = process.env.ADMIN_UI_TOKEN;

// --- 1. CORS LOGICA (Gelijk aan Counters API) ---
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

  // BELANGRIJK: Hier voegen we PATCH, POST en DELETE toe
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

export default async function handler(req, res) {
  // 1. CORS Check
  if (applyCors(req, res)) return;

  // 2. Auth Check
  const hdr = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
  if (!hdr || String(hdr) !== String(ADMIN_UI_TOKEN)) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  try {
    // --- GET: Regels ophalen ---
    if (req.method === 'GET') {
      const qs = new URLSearchParams({
        // Hier zorgen we dat alle benodigde velden worden opgehaald
        fields: 'id,Omschrijving,description,affiliate_id,offer_id,sub_id,percent_accept,priority,active,auto_pilot,target_margin,min_volume',
        sort: 'priority',
        limit: '500', // Ruime limiet
      });
      
      const r = await dFetch(`/items/Optimization_rules?${qs.toString()}`);
      const j = await r.json();
      
      if (!r.ok) throw new Error(JSON.stringify(j));
      return res.status(200).json({ ok: true, items: j.data || [] });
    }

    // --- PATCH: Regels updaten (Auto Pilot aan/uit, percentages etc) ---
    if (req.method === 'PATCH') {
      const { keys, data } = req.body; // Frontend stuurt { keys: [id], data: {...} }
      
      if (!keys || !Array.isArray(keys) || !data) {
        return res.status(400).json({ ok: false, error: 'Invalid body' });
      }

      // Directus Bulk Update Endpoint
      const r = await dFetch(`/items/Optimization_rules`, {
        method: 'PATCH',
        body: JSON.stringify({ keys, data })
      });
      const j = await r.json();

      if (!r.ok) throw new Error(JSON.stringify(j));
      return res.status(200).json({ ok: true, data: j.data });
    }

    // --- POST: Nieuwe regel aanmaken ---
    if (req.method === 'POST') {
      const payload = req.body;
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
      const ids = req.body; // Frontend stuurt array van ID's: [12, 15]
      if (!Array.isArray(ids)) return res.status(400).json({ error: 'Body must be array of IDs' });

      const r = await dFetch(`/items/Optimization_rules`, {
        method: 'DELETE',
        body: JSON.stringify(ids)
      });
      
      if (!r.ok) {
        // Directus delete geeft soms lege body bij succes, dus check status
        if (r.status === 204) return res.status(200).json({ ok: true });
        const j = await r.json();
        throw new Error(JSON.stringify(j));
      }
      return res.status(200).json({ ok: true });
    }

    // Als methode niet herkend wordt
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  } catch (e) {
    console.error("Rules API Error:", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
