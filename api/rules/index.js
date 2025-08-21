import { dFetch, COLLECTION, requireEnv, checkAdminAuth } from './_utils';

export default async function handler(req, res) {
  try {
    requireEnv();
    if (!checkAdminAuth(req)) return res.status(401).json({ ok:false, error:'unauthorized' });

    if (req.method === 'GET') {
      // Optional filters: affiliate_id, offer_id, sub_id, active
      const { affiliate_id, offer_id, sub_id, active } = req.query;
      const filter = { _and: [] };
      if (active !== undefined) filter._and.push({ active: { _eq: String(active) !== 'false' } });
      if (affiliate_id) filter._and.push({ affiliate_id: { _eq: String(affiliate_id) } });
      if (offer_id) filter._and.push({ offer_id: { _eq: String(offer_id) } });
      if (sub_id === 'null')      filter._and.push({ sub_id: { _null: true } });
      else if (sub_id)            filter._and.push({ sub_id: { _eq: String(sub_id) } });

      const qs = new URLSearchParams({
        fields: '*',
        filter: JSON.stringify(filter._and.length ? filter : { }),
        sort: 'priority', // we tonen oplopend; jij hebt 1=specifiek ... 100=globaal
        limit: '500'
      });

      const r = await dFetch(`/items/${encodeURIComponent(COLLECTION)}?${qs.toString()}`);
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json({ ok:false, error:j });
      return res.status(200).json({ ok:true, items: j.data || [] });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const payload = {
        description: body.description ?? null,
        affiliate_id: body.affiliate_id ?? null,
        offer_id: body.offer_id ?? null,
        sub_id: body.sub_id ?? null,
        percent_accept: Number(body.percent_accept ?? 0),
        priority: Number(body.priority ?? 100),
        active: body.active !== false,
        cap_per_day: body.cap_per_day ?? null,
      };
      const r = await dFetch(`/items/${encodeURIComponent(COLLECTION)}`, {
        method: 'POST', body: JSON.stringify(payload)
      });
      const j = await r.json();
      if (!r.ok) return res.status(r.status).json({ ok:false, error:j });
      return res.status(201).json({ ok:true, item: j.data });
    }

    return res.status(405).json({ ok:false, error:'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e) });
  }
}
