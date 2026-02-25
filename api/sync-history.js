import { syncCountersToSupabase } from './cron/run.js';

export default async function handler(req, res) {
  // Beveiliging check
  const incomingToken = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
  if (!incomingToken || String(incomingToken).trim() !== String(process.env.ADMIN_UI_TOKEN).trim()) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    // Haal parameters op: offset (hoeveel dagen terug beginnen) en limit (hoeveel dagen syncen)
    const offset = parseInt(req.query.offset) || 0;
    const limit = parseInt(req.query.limit) || 5; 
    
    console.log(`Start sync vanaf ${offset} dagen terug, totaal ${limit} dagen.`);

    let totalSynced = 0;
    for (let i = offset; i < offset + limit; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      
      console.log(`Bezig met syncen: ${dateStr}`);
      const count = await syncCountersToSupabase(dateStr);
      totalSynced += count;
    }

    return res.json({ 
      success: true, 
      message: `Sync voltooid voor ${limit} dagen (offset ${offset})`,
      total_rows: totalSynced 
    });
  } catch (e) {
    console.error("Sync History Error:", e);
    return res.status(500).json({ error: e.message });
  }
}
