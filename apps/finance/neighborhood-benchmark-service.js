// Neighborhood benchmarks for Giving › Campaign capacity. A short list of ZIP codes the church
// chooses (kept in finance_settings, set by an admin), and the free U.S. Census Bureau figures
// for them: American Community Survey 5-year estimates, read through Census Reporter, which
// serves the same published tables without a sign-up key. Nothing about a member or a gift is
// ever sent; the only thing that leaves Finance is the list of ZIP codes. The figures describe
// the ZIP codes, never the church's own households. Reads never throw.
import { FormValidationError } from './form-fields.js';

export const BENCHMARK_ZIPS_KEY = 'finance_campaign_benchmark_zips';
export const MAX_BENCHMARK_ZIPS = 12;

const API = 'https://api.censusreporter.org/1.0/data/show/latest';
const TABLES = 'B19013,B11001,B19025,B19001';
const CACHE_SECONDS = 7 * 24 * 60 * 60;
const TIMEOUT_MS = 8000;

// B19001: households by income bracket. 002–010 are under $50,000; 014–017 are $100,000 or more.
const UNDER_50K = ['B19001002', 'B19001003', 'B19001004', 'B19001005', 'B19001006', 'B19001007', 'B19001008', 'B19001009', 'B19001010'];
const OVER_100K = ['B19001014', 'B19001015', 'B19001016', 'B19001017'];

export function parseZips(value) {
  const found = String(value ?? '').match(/\b\d{5}\b/g) || [];
  return [...new Set(found)];
}

export async function readBenchmarkZips(db) {
  try {
    const row = await db.prepare('SELECT value FROM finance_settings WHERE key = ?').bind(BENCHMARK_ZIPS_KEY).first();
    return parseZips(row?.value).slice(0, MAX_BENCHMARK_ZIPS);
  } catch {
    return [];
  }
}

async function saveBenchmarkZips(db, form) {
  const raw = String(form.zips ?? '').trim();
  if (raw.length > 400) throw new FormValidationError('That list is too long.');
  const zips = parseZips(raw);
  if (raw && !zips.length) throw new FormValidationError('Enter 5-digit ZIP codes, like 63119, separated by commas or spaces.');
  if (zips.length > MAX_BENCHMARK_ZIPS) throw new FormValidationError(`Choose ${MAX_BENCHMARK_ZIPS} ZIP codes at most.`);
  if (!zips.length) await db.prepare('DELETE FROM finance_settings WHERE key = ?').bind(BENCHMARK_ZIPS_KEY).run();
  else await db.prepare('INSERT INTO finance_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(BENCHMARK_ZIPS_KEY, zips.join(',')).run();
  return {};
}

export const BENCHMARK_WRITERS = Object.freeze({
  'giving-benchmark-zips-save-v1': { run: saveBenchmarkZips, page: 'campaign' },
});

export function canEditBenchmarks(roleResult) {
  return Boolean(roleResult?.ok && roleResult.role === 'admin');
}

// The Census marks a figure it could not publish with a large negative number.
function figure(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sumOf(estimate, keys) {
  return keys.reduce((sum, key) => sum + (figure(estimate[key]) || 0), 0);
}

// Turns Census Reporter's answer into one row per ZIP code plus a combined row. The mean income
// (all household income ÷ households) is exact when ZIPs are combined; the median is not, so the
// combined median is a household-weighted average of the ZIPs' medians and labeled as such.
export function summarizeBenchmark(payload, zips) {
  const rows = zips.map((zip) => {
    const data = payload?.data?.[`86000US${zip}`];
    const income = data?.B19001?.estimate || data?.B19001 || {};
    const households = figure(income.B19001001) || figure((data?.B11001?.estimate || data?.B11001 || {}).B11001001);
    if (!data || !households) return { zip, missing: true };
    const estimate = (table) => data[table]?.estimate || data[table] || {};
    const aggregate = figure(estimate('B19025').B19025001);
    return {
      zip, households,
      medianIncome: figure(estimate('B19013').B19013001),
      aggregateIncome: aggregate,
      meanIncome: aggregate ? aggregate / households : null,
      over100k: sumOf(income, OVER_100K) / households,
      under50k: sumOf(income, UNDER_50K) / households,
    };
  });
  const found = rows.filter((r) => !r.missing);
  if (!found.length) return { ok: false, message: 'The Census has no household figures for those ZIP codes. Some ZIP codes (post office boxes, for example) are not areas where people live.' };
  const households = found.reduce((s, r) => s + r.households, 0);
  const withMean = found.filter((r) => r.meanIncome);
  const withMedian = found.filter((r) => r.medianIncome);
  const meanHouseholds = withMean.reduce((s, r) => s + r.households, 0);
  const medianHouseholds = withMedian.reduce((s, r) => s + r.households, 0);
  return {
    ok: true,
    release: payload?.release ? { name: String(payload.release.name || ''), years: String(payload.release.years || '') } : null,
    rows,
    total: {
      zips: found.length, households,
      meanIncome: meanHouseholds ? withMean.reduce((s, r) => s + r.aggregateIncome, 0) / meanHouseholds : null,
      medianIncome: medianHouseholds ? withMedian.reduce((s, r) => s + r.medianIncome * r.households, 0) / medianHouseholds : null,
      over100k: found.reduce((s, r) => s + r.over100k * r.households, 0) / households,
      under50k: found.reduce((s, r) => s + r.under50k * r.households, 0) / households,
    },
  };
}

export function benchmarkUrl(zips) {
  return `${API}?table_ids=${TABLES}&geo_ids=${zips.map((z) => `86000US${z}`).join(',')}`;
}

// The Census figures change once a year, so an answer is kept for a week where the Worker has a
// cache. `fetchImpl` and `cache` are injectable for tests.
export async function fetchNeighborhoodBenchmark(zips, { fetchImpl = globalThis.fetch, cache = globalThis.caches?.default } = {}) {
  if (!zips?.length) return { ok: false, message: 'No ZIP codes are set.' };
  const url = benchmarkUrl(zips);
  try {
    let payload = null;
    const key = new Request(url);
    try {
      const hit = cache ? await cache.match(key) : null;
      if (hit) payload = await hit.json();
    } catch { /* a cache miss or error just means asking the Census again */ }
    if (!payload) {
      const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return { ok: false, message: `The Census figures could not be loaded right now (${res.status}).` };
      payload = await res.json();
      try {
        if (cache && payload?.data) await cache.put(key, new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_SECONDS}` } }));
      } catch { /* caching is only a convenience */ }
    }
    return summarizeBenchmark(payload, zips);
  } catch {
    return { ok: false, message: 'The Census figures could not be loaded right now.' };
  }
}
