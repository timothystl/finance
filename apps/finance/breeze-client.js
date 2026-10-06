// Read-only client for Breeze's API. Finance holds its own Breeze key as a Worker secret
// (BREEZE_SUBDOMAIN and BREEZE_API_KEY); it is never copied from Connect, never stored in a
// database, and never put in a log or an error message. Only GET requests are made, and only to
// Breeze's own host. Returns null when the secrets are not set.
const TIMEOUT_MS = 20000;

export class BreezeError extends Error {
  constructor(message) { super(message); this.name = 'BreezeError'; }
}

// People paste the whole address more often than just the first part, so "tlc", "tlc.breezechms.com"
// and "https://tlc.breezechms.com/" all mean the same church.
export function normalizeBreezeSubdomain(raw) {
  return String(raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/\.breezechms\.com$/i, '').trim();
}

// What is wrong with the two secrets, in words that never include their values.
export function describeBreezeConfig(env) {
  const subdomain = normalizeBreezeSubdomain(env?.BREEZE_SUBDOMAIN);
  const apiKey = String(env?.BREEZE_API_KEY || '').trim();
  if (!subdomain && !apiKey) return { ok: false, problem: 'Neither BREEZE_SUBDOMAIN nor BREEZE_API_KEY reaches Finance.' };
  if (!subdomain) return { ok: false, problem: 'BREEZE_SUBDOMAIN is missing or empty.' };
  if (!/^[a-z0-9-]{1,63}$/i.test(subdomain)) return { ok: false, problem: 'BREEZE_SUBDOMAIN does not look right: it should be only the part before .breezechms.com, with no spaces or other characters.' };
  if (!apiKey) return { ok: false, problem: 'BREEZE_API_KEY is missing or empty.' };
  return { ok: true, problem: '' };
}

export function makeBreezeClient(env, { fetchImpl = fetch } = {}) {
  if (!describeBreezeConfig(env).ok) return null;
  const subdomain = normalizeBreezeSubdomain(env.BREEZE_SUBDOMAIN);
  const apiKey = String(env.BREEZE_API_KEY).trim();
  const base = `https://${subdomain}.breezechms.com/api`;

  async function getJson(path, params = {}) {
    const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null)).toString();
    let response;
    try {
      response = await fetchImpl(`${base}/${path}${query ? `?${query}` : ''}`, { headers: { 'Api-key': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new BreezeError(error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? `Breeze did not answer in time (${path}).` : `Breeze could not be reached (${path}).`);
    }
    if (!response.ok) throw new BreezeError(`Breeze answered ${response.status} (${path}).`);
    try { return await response.json(); } catch { throw new BreezeError(`Breeze sent something unreadable (${path}).`); }
  }

  return {
    // Contributions for a window, with current amounts and fund splits. details=1 includes the splits.
    givingList: ({ start, end, limit = 10000 }) => getJson('giving/list', { start, end, details: 1, limit }),
    funds: () => getJson('funds'),
  };
}
