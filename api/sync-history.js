import { syncCountersToSupabase } from './cron/run.js'; // Hergebruik de functie

export default async function handler(req, res) {
  const incomingToken = req.headers['x-admin-token'];
  if (incomingToken !== process.env.ADMIN_UI_TOKEN) return res.status(403).end();

  const days = 5; 
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    await syncCountersToSupabase(d.toISOString().split('T')[0]);
  }
  return res.json({ message: `History for ${days} days synced.` });
}
