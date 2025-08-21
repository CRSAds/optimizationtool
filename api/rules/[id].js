// Update + Delete
const DIRECTUS_URL   = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const ADMIN_UI_TOKEN = process.env.ADMIN_UI_TOKEN;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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

  const token = req.headers['x-admin-token'];
  if (!token || token !== ADMIN_UI_TOKEN) {
    return res.status(403).json({ ok:false, error:'forbidden' });
  }

  const { id } = req.query;

  try {
    if (req.method === 'PATCH') {
      const p = req.body || {};
      const body = {};

      if ('description'    in p) body.description    = p.description ?? null;
      if ('affiliate_id'   in p) body.affiliate_id   = p.affiliate_id === '' ? null : p.affiliate_id;
      if ('offer_id'       in p) body.offer_id       = p.offer_id     === '' ? null : p.offer_id;
      if ('sub_id'         in p) body.sub_id         = p.sub_id === 'null' ? null : (p.sub_id === '' ? null : p.sub_id);
      if ('percent_accept' in p) body.percent_accept = Number(p.percent_accept ?? 0);
      if ('priority'       in p) body.priority       = Number(p.priority ?? 100);
      if ('active'         in p) body.active         = !!p.active;

      const r = await dfetch(`/items/Optimization_rules/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json(j);
      return res.status(200).json({ ok:true, item:j.data });
    }

    if (req.method === 'DELETE') {
      const r = await dfetch(`/items/Optimization_rules/${id}`, { method:'DELETE' });
      if (r.status === 204) return res.status(204).end();
      const j = await r.json();
      return res.status(r.status).json(j);
    }

    return res.status(405).json({ ok:false, error:'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e) });
  }
}
