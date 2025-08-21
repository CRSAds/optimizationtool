import { dFetch, COLLECTION, requireEnv, checkAdminAuth } from '../_utils';

export default async function handler(req, res) {
  try {
    requireEnv();
    if (!checkAdminAuth(req)) return res.status(401).json({ ok:false, error:'unauthorized' });

    const { id } = req.query;
    if (!id) return res.status(400).json({ ok:false, error:'missing id' });

    if (req.method === 'PATCH') {
      const b = req.body || {};
      const payload = {};
      ['description','affiliate_id','offer_id','sub_id','cap_per_day'].forEach(k=>{
        if (k in b) payload[k] = b[k] === '' ? null : b[k];
      });
      if ('percent_accept' in b) payload.percent_accept = Number(b.percent_accept);
      if ('priority'        in b) payload.priority        = Number(b.priority);
      if ('active'          in b) payload.active          = !!b.active;

      const r = await dFetch(`/items/${encodeURIComponent(COLLECTION)}/${id}`, {
        method: 'PATCH', body: JSON.stringify(payload)
      });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json({ ok:false, error:j });
      return res.status(200).json({ ok:true, item: j.data });
    }

    if (req.method === 'DELETE') {
      const r = await dFetch(`/items/${encodeURIComponent(COLLECTION)}/${id}`, { method:'DELETE' });
      if (!r.ok) return res.status(r.status).json({ ok:false, error: await r.text() });
      return res.status(204).end();
    }

    return res.status(405).json({ ok:false, error:'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e) });
  }
}
