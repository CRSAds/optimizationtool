// server-only helpers
const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const COLLECTION = process.env.DIRECTUS_COLLECTION || 'Optimization_rules';
const ADMIN_UI_TOKEN = process.env.ADMIN_UI_TOKEN; // set in Vercel

export function requireEnv() {
  const miss = [];
  if (!DIRECTUS_URL) miss.push('DIRECTUS_URL');
  if (!DIRECTUS_TOKEN) miss.push('DIRECTUS_TOKEN');
  if (!ADMIN_UI_TOKEN) miss.push('ADMIN_UI_TOKEN');
  if (miss.length) throw new Error('Missing env: ' + miss.join(', '));
}

export function checkAdminAuth(req) {
  const hdr = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
  return hdr && String(hdr) === String(ADMIN_UI_TOKEN);
}

export function dFetch(path, init = {}) {
  const url = `${DIRECTUS_URL}${path}`;
  const headers = {
    ...(init.headers || {}),
    Authorization: `Bearer ${DIRECTUS_TOKEN}`,
    'Content-Type': 'application/json',
  };
  return fetch(url, { ...init, headers });
}

export { COLLECTION };
