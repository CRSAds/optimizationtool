// Kleine CORS helper voor Vercel Node runtimes
const parseAllowed = () =>
  (process.env.ADMIN_ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

export function applyCors(req, res) {
  const allowed = parseAllowed();
  const origin = req.headers.origin;

  // Origin toestaan (exact match) of wildcard via '*'
  if (origin && (allowed.includes('*') || allowed.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  // Sta methoden/headers toe die we gebruiken
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  // Geen cookies nodig
  res.setHeader('Access-Control-Allow-Credentials', 'false');

  // Preflight direct beantwoorden
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true; // afgehandeld
  }
  return false; // ga door
}
