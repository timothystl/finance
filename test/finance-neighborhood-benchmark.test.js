import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import worker from '../apps/finance/shell.js';
import {
  BENCHMARK_ZIPS_KEY, benchmarkUrl, fetchNeighborhoodBenchmark, parseZips, readBenchmarkZips, summarizeBenchmark,
} from '../apps/finance/neighborhood-benchmark-service.js';

// Published ACS 2020–2024 5-year figures for two St. Louis ZIP codes, as Census Reporter serves them.
const CENSUS = {"release":{"id":"acs2024_5yr","name":"ACS 2024 5-year","years":"2020-2024"},"data":{"86000US63109":{"B11001":{"error":{"B11001001":719.0,"B11001002":481.0,"B11001003":469.0,"B11001004":234.0,"B11001005":173.0,"B11001006":176.0,"B11001007":642.0,"B11001008":613.0,"B11001009":288.0},"estimate":{"B11001001":14080.0,"B11001002":5612.0,"B11001003":4484.0,"B11001004":1128.0,"B11001005":414.0,"B11001006":714.0,"B11001007":8468.0,"B11001008":7269.0,"B11001009":1199.0}},"B19001":{"error":{"B19001001":719.0,"B19001002":208.0,"B19001003":300.0,"B19001004":226.0,"B19001005":136.0,"B19001006":364.0,"B19001007":179.0,"B19001008":205.0,"B19001009":197.0,"B19001010":162.0,"B19001011":306.0,"B19001012":372.0,"B19001013":416.0,"B19001014":303.0,"B19001015":206.0,"B19001016":279.0,"B19001017":216.0},"estimate":{"B19001001":14080.0,"B19001002":557.0,"B19001003":468.0,"B19001004":514.0,"B19001005":297.0,"B19001006":812.0,"B19001007":440.0,"B19001008":824.0,"B19001009":567.0,"B19001010":400.0,"B19001011":1073.0,"B19001012":1661.0,"B19001013":1847.0,"B19001014":1203.0,"B19001015":864.0,"B19001016":1448.0,"B19001017":1105.0}},"B19013":{"error":{"B19013001":5662.0},"estimate":{"B19013001":69938.0}},"B19025":{"error":{"B19025001":81927816.0},"estimate":{"B19025001":1290802000.0}}},"86000US63116":{"B11001":{"error":{"B11001001":1029.0,"B11001002":770.0,"B11001003":534.0,"B11001004":479.0,"B11001005":251.0,"B11001006":475.0,"B11001007":933.0,"B11001008":857.0,"B11001009":473.0},"estimate":{"B11001001":19900.0,"B11001002":9287.0,"B11001003":5965.0,"B11001004":3322.0,"B11001005":872.0,"B11001006":2450.0,"B11001007":10613.0,"B11001008":8246.0,"B11001009":2367.0}},"B19001":{"error":{"B19001001":1029.0,"B19001002":380.0,"B19001003":394.0,"B19001004":191.0,"B19001005":221.0,"B19001006":267.0,"B19001007":287.0,"B19001008":336.0,"B19001009":217.0,"B19001010":213.0,"B19001011":381.0,"B19001012":495.0,"B19001013":370.0,"B19001014":257.0,"B19001015":268.0,"B19001016":434.0,"B19001017":294.0},"estimate":{"B19001001":19900.0,"B19001002":1408.0,"B19001003":970.0,"B19001004":588.0,"B19001005":824.0,"B19001006":764.0,"B19001007":795.0,"B19001008":1083.0,"B19001009":771.0,"B19001010":808.0,"B19001011":1735.0,"B19001012":2164.0,"B19001013":2518.0,"B19001014":1544.0,"B19001015":1265.0,"B19001016":1361.0,"B19001017":1302.0}},"B19013":{"error":{"B19013001":5067.0},"estimate":{"B19013001":61433.0}},"B19025":{"error":{"B19025001":120408810.0},"estimate":{"B19025001":1641590000.0}}}}};

const HOUSEHOLDS = {
  bands: [
    { label: 'Under $500', households: 142, cents: 2840000 }, { label: '$500 – $999', households: 58, cents: 4180000 },
    { label: '$1,000 – $2,499', households: 96, cents: 15830000 }, { label: '$2,500 – $4,999', households: 61, cents: 21460000 },
    { label: '$5,000 – $9,999', households: 31, cents: 20620000 }, { label: '$10,000 and up', households: 10, cents: 26910000 },
  ],
  t12_households: 398, t12_cents: 91840000,
};
const ANALYTICS = { contract: 'connect.giving-analytics.v1', as_of: '2026-09-20', year: 2026, year_elapsed: 0.72, totals: {}, months: [], funds: [], weeks: [], households: HOUSEHOLDS, pledges: {} };

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE finance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')");
  const statement = (sql, args = []) => ({
    sql,
    bind: (...next) => statement(sql, next),
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return { sqlite, prepare: (sql) => statement(sql) };
}

function makeEnv({ role = 'admin' } = {}) {
  const db = makeDb();
  const calls = [];
  const env = {
    ENVIRONMENT: 'staging', RELEASE_SHA: 't', FINANCE_DB: db, FINANCE_CONTRACT_API_KEY: 'k',
    CONNECT_SERVICE: {
      async fetch(req) {
        const url = new URL(req.url);
        calls.push(url.pathname);
        if (url.pathname.endsWith('/staff-role-v1')) return new Response(JSON.stringify({ role, permissions: { finance: 'edit', giving: role === 'admin' ? 'edit' : 'anon' }, identity: 'x@example.org' }));
        if (url.pathname.endsWith('/giving-analytics-v1')) return new Response(JSON.stringify(ANALYTICS));
        return new Response('{}', { status: 404 });
      },
    },
  };
  return { env, db, calls };
}
const page = (env, query = '') => worker.fetch(new Request(`https://finance.test/?section=giving-analytics&page=campaign${query}`, { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } }), env);
const save = (env, fields) => worker.fetch(new Request('https://finance.test/api/v1/giving/benchmark-zips-save', {
  method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'jwt', 'Sec-Fetch-Site': 'same-origin' }, body: new URLSearchParams(fields),
}), env);

let outbound;
beforeEach(() => {
  outbound = [];
  vi.stubGlobal('fetch', async (url) => {
    outbound.push(String(url));
    return new Response(JSON.stringify(CENSUS), { status: 200 });
  });
});

describe('Neighborhood benchmark service', () => {
  it('reads 5-digit ZIP codes from any list, once each', () => {
    expect(parseZips('63116, 63109  63116;abc 1234 631160')).toEqual(['63116', '63109']);
    expect(parseZips('')).toEqual([]);
    expect(benchmarkUrl(['63116', '63109'])).toContain('geo_ids=86000US63116,86000US63109');
  });

  it('summarizes each ZIP and combines them without inventing precision', () => {
    const s = summarizeBenchmark(CENSUS, ['63116', '63109', '99999']);
    expect(s.ok).toBe(true);
    const a = s.rows.find((r) => r.zip === '63116');
    expect(a).toMatchObject({ households: 19900, medianIncome: 61433 });
    expect(a.meanIncome).toBeCloseTo(1641590000 / 19900, 5);
    // $100k+ brackets 014–017: 1544 + 1265 + 1361 + 1302.
    expect(a.over100k).toBeCloseTo((1544 + 1265 + 1361 + 1302) / 19900, 6);
    expect(s.rows.find((r) => r.zip === '99999').missing).toBe(true);
    expect(s.total.households).toBe(19900 + 14080);
    expect(s.total.meanIncome).toBeCloseTo((1641590000 + 1290802000) / (19900 + 14080), 4);
    expect(s.total.medianIncome).toBeCloseTo((61433 * 19900 + 69938 * 14080) / (19900 + 14080), 4);
    expect(s.release.years).toBe('2020-2024');
  });

  it('treats the Census’s “no data” codes as missing and explains an empty answer', () => {
    const blank = { data: { '86000US63116': { B19001: { estimate: { B19001001: 100, B19001014: 10 } }, B19013: { estimate: { B19013001: -666666666 } }, B19025: { estimate: { B19025001: -666666666 } } } } };
    const s = summarizeBenchmark(blank, ['63116']);
    expect(s.rows[0]).toMatchObject({ households: 100, medianIncome: null, meanIncome: null });
    expect(s.total.meanIncome).toBe(null);
    expect(summarizeBenchmark({ data: {} }, ['63116']).ok).toBe(false);
  });

  it('never throws: a failed or slow lookup becomes a message', async () => {
    expect((await fetchNeighborhoodBenchmark([], {})).ok).toBe(false);
    const down = await fetchNeighborhoodBenchmark(['63116'], { fetchImpl: async () => new Response('no', { status: 503 }), cache: null });
    expect(down).toEqual({ ok: false, message: 'The Census figures could not be loaded right now (503).' });
    const broken = await fetchNeighborhoodBenchmark(['63116'], { fetchImpl: async () => { throw new Error('boom'); }, cache: null });
    expect(broken.ok).toBe(false);
  });

  it('asks the Census once and then answers from its cache', async () => {
    const store = new Map();
    const cache = { match: async (req) => (store.has(req.url) ? store.get(req.url).clone() : undefined), put: async (req, res) => { store.set(req.url, res); } };
    const fetchImpl = async () => { outbound.push('asked'); return new Response(JSON.stringify(CENSUS)); };
    const first = await fetchNeighborhoodBenchmark(['63116'], { fetchImpl, cache });
    const second = await fetchNeighborhoodBenchmark(['63116'], { fetchImpl, cache });
    expect(first.ok && second.ok).toBe(true);
    expect(outbound).toEqual(['asked']);
  });
});

describe('Campaign capacity › Neighborhood benchmarks', () => {
  it('asks an administrator to choose ZIP codes, and sends nothing to the Census until they do', async () => {
    const { env } = makeEnv();
    const html = await (await page(env)).text();
    expect(html).toContain('Neighborhood benchmarks');
    expect(html).toContain('name="zips"');
    expect(html).toContain('action="/api/v1/giving/benchmark-zips-save"');
    expect(outbound).toEqual([]);
  });

  it('saves the ZIP codes, shows the Census figures beside the projection, and sends only the ZIP codes', async () => {
    const { env, db } = makeEnv();
    const saved = await save(env, { zips: '63116, 63109' });
    expect(saved.headers.get('Location')).toBe('/?section=giving-analytics&page=campaign&status=ok');
    expect(await readBenchmarkZips(db)).toEqual(['63116', '63109']);
    expect(db.sqlite.prepare('SELECT value FROM finance_settings WHERE key=?').get(BENCHMARK_ZIPS_KEY).value).toBe('63116,63109');

    const html = await (await page(env, '&status=ok')).text();
    expect(html).toContain('<td>63116</td><td>19,900</td><td>$61,433</td>');
    expect(html).toContain('All 2 together');
    expect(html).toContain('What the extra giving means locally');
    expect(html).toContain('American Community Survey 2020-2024 5-year estimates');
    expect(html).toContain('of the average household income in these ZIP codes');
    expect(html).toContain('Saved.');
    // One outbound request, carrying only the ZIP codes: no giving or member information.
    expect(outbound).toHaveLength(1);
    expect(outbound[0]).toBe(benchmarkUrl(['63116', '63109']));
  });

  it('keeps the projection when the Census cannot be reached', async () => {
    const { env } = makeEnv();
    await save(env, { zips: '63116' });
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const html = await (await page(env)).text();
    expect(html).toContain('The Census figures could not be loaded right now.');
    expect(html).toContain('Three views');
    expect(html).toContain('Everything above is from the church’s own giving and is not affected.');
  });

  it('refuses bad lists, lets an administrator clear the list, and keeps everyone else read-only', async () => {
    const { env, db } = makeEnv();
    await save(env, { zips: '63116' });
    const bad = await save(env, { zips: 'St. Louis' });
    expect(bad.headers.get('Location')).toContain('reason=invalid');
    const many = await save(env, { zips: Array.from({ length: 13 }, (_, i) => String(63100 + i)).join(' ') });
    expect(many.headers.get('Location')).toContain('reason=invalid');
    expect(await readBenchmarkZips(db)).toEqual(['63116']);
    await save(env, { zips: '' });
    expect(await readBenchmarkZips(db)).toEqual([]);

    const other = makeEnv({ role: 'finance' });
    const denied = await save(other.env, { zips: '63116' });
    expect(denied.headers.get('Location')).toContain('access_denied');
    expect(await readBenchmarkZips(other.db)).toEqual([]);
    await save(env, { zips: '63116' });
    other.db.sqlite.prepare('INSERT INTO finance_settings (key, value) VALUES (?, ?)').run(BENCHMARK_ZIPS_KEY, '63116');
    const readOnly = await (await page(other.env)).text();
    expect(readOnly).toContain('ZIP codes compared: 63116');
    expect(readOnly).not.toContain('name="zips"');
  });
});
