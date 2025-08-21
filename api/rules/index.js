// List + Create
const DIRECTUS_URL   = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const ADMIN_UI_TOKEN = process.env.ADMIN_UI_TOKEN;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // evt. vervangen door jouw domein
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}

async function dfetch(path, init = {}) {
  const url = `${DIRECTUS_URL}${path}`;
  const headers = {
    ...(init.headers || {}),
    Authorization: `Bearer ${DIRECTUS_TOKEN}`,
    'Content-Type': 'application/json',
  };
  return fetch(url, { ...init, headers });
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Auth voor UI
  const token = req.headers['x-admin-token'];
  if (!token || token !== ADMIN_UI_TOKEN) {
    return res.status(403).json({ ok:false, error:'forbidden' });
  }

  try {
    if (req.method === 'GET') {
      const qs = new URLSearchParams({
        fields: 'id,description,affiliate_id,offer_id,sub_id,percent_accept,priority,active',
        sort: 'priority',
        limit: '200',
      });
      const r = await dfetch(`/items/Optimization_rules?${qs.toString()}`);
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json(j);
      return res.status(200).json({ ok:true, items: j.data || [] });
    }

    if (req.method === 'POST') {
      const p = req.body || {};
      const body = {
        description: p.description ?? null,
        affiliate_id: p.affiliate_id === '' ? null : p.affiliate_id ?? null,
        offer_id:     p.offer_id     === '' ? null : p.offer_id     ?? null,
        sub_id:       p.sub_id === 'null' ? null : (p.sub_id === '' ? null : p.sub_id ?? null),
        percent_accept: Number(p.percent_accept ?? 0),
        priority:       Number(p.priority ?? 100),
        active: !!p.active,
      };
      const r = await dfetch('/items/Optimization_rules', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json(j);
      return res.status(201).json({ ok:true, item:j.data });
    }

    return res.status(405).json({ ok:false, error:'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
}
