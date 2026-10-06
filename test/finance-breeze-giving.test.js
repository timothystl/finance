import { describe, expect, it, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import worker from '../apps/finance/shell.js';
import { makeBreezeClient } from '../apps/finance/breeze-client.js';
import { resetEnsuredSchemasForTests } from '../apps/finance/finance-owned-schema.js';
import {
  buildReconciliation, monthRange, normalizeBreezeGift, readCopyMonthly, syncBreezeGivingYear,
} from '../apps/finance/breeze-giving-service.js';

function sqliteDb() {
  const sqlite = new DatabaseSync(':memory:');
  const statement = (sql, args = []) => ({
    sql,
    bind: (...next) => statement(sql, next),
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  return {
    sqlite,
    prepare: (sql) => statement(sql),
    async batch(stmts) { const out = []; for (const s of stmts) out.push(/^\s*SELECT/i.test(s.sql) ? await s.all() : await s.run()); return out; },
  };
}

const KEYS = { BREEZE_SUBDOMAIN: 'tlc', BREEZE_API_KEY: 'secret-key-123' };
const NOW = new Date('2026-10-05T12:00:00Z');

// A fake Breeze: giving/list answers by month window from `byMonth` (YYYY-MM -> records).
function fakeBreeze(byMonth, { fail = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    const u = new URL(url);
    if (fail) return new Response('no', { status: fail });
    return new Response(JSON.stringify(byMonth[u.searchParams.get('start').slice(0, 7)] || []), { status: 200 });
  };
  return { fetchImpl, calls };
}

const rec = (id, date, amount, extra = {}) => ({ id, person_id: `p${id}`, paid_on: date, amount, method: 'Check', funds: [{ fund_id: '1', name: 'General Fund', amount }], ...extra });

beforeEach(() => resetEnsuredSchemasForTests());

describe('Breeze client', () => {
  it('is off without the two secrets, reads only from Breeze’s own host, and never puts the key in an error', async () => {
    expect(makeBreezeClient({})).toBeNull();
    expect(makeBreezeClient({ BREEZE_SUBDOMAIN: 'bad host!', BREEZE_API_KEY: 'k' })).toBeNull();
    const { fetchImpl, calls } = fakeBreeze({});
    await makeBreezeClient(KEYS, { fetchImpl }).givingList({ start: '2026-01-01', end: '2026-01-31' });
    expect(calls[0].url.startsWith('https://tlc.breezechms.com/api/giving/list?')).toBe(true);
    const failing = makeBreezeClient(KEYS, { fetchImpl: fakeBreeze({}, { fail: 500 }).fetchImpl });
    await expect(failing.givingList({ start: 'a', end: 'b' })).rejects.toThrow(/Breeze answered 500/);
    await failing.givingList({ start: 'a', end: 'b' }).catch((error) => expect(error.message).not.toContain('secret-key-123'));
  });
});

describe('Breeze gift normalization', () => {
  it('reads cents and fund splits, keeps no names, and drops records without an id, date or amount', () => {
    const g = normalizeBreezeGift({ id: 7, person_id: 9, first_name: 'Jane', paid_on: '2026-03-01 00:00:00', amount: '$1,234.50', funds: [{ fund_id: 1, name: 'General', amount: '1000.00' }, { fund_id: 2, name: 'Building', amount: '234.50' }] });
    expect(g).toMatchObject({ paymentId: '7', paidOn: '2026-03-01', amountCents: 123450, personRef: '9' });
    expect(g.funds.map((f) => f.amountCents)).toEqual([100000, 23450]);
    expect(JSON.stringify(g)).not.toContain('Jane');
    expect(normalizeBreezeGift({ id: 1, paid_on: '2026-03-01' })).toBeNull();
    expect(normalizeBreezeGift({ paid_on: '2026-03-01', amount: '5' })).toBeNull();
    expect(normalizeBreezeGift({ id: 2, date: 'soon', amount: '5' })).toBeNull();
    expect(normalizeBreezeGift({ id: 3, paid_on: '2026-03-01', amount: '10', funds: [{ fund_id: 1 }, { fund_id: 2 }] }).funds.map((f) => f.amountCents)).toEqual([1000, 0]);
  });
});

describe('Breeze giving copy', () => {
  it('copies a year a month at a time, then matches Breeze after gifts are corrected and deleted there', async () => {
    const db = sqliteDb();
    const first = fakeBreeze({
      '2026-01': [rec(1, '2026-01-04', '100.00'), rec(2, '2026-01-11', '50.25')],
      '2026-02': [rec(3, '2026-02-01', '75.00')],
    });
    const run1 = await syncBreezeGivingYear(KEYS, db, { year: 2026, now: NOW, fetchImpl: first.fetchImpl, runBy: 'andrew' });
    expect(run1).toMatchObject({ ok: true, added: 3, updated: 0, removed: 0, totalCents: 22525 });
    expect(first.calls).toHaveLength(10); // January to October
    const copy = await readCopyMonthly(db, 2026);
    expect(copy.cents.slice(0, 3)).toEqual([15025, 7500, 0]);
    expect(copy.gifts.slice(0, 2)).toEqual([2, 1]);

    // Breeze later corrects gift 1 and deletes gift 2; running again makes the copy match.
    const second = fakeBreeze({ '2026-01': [rec(1, '2026-01-04', '120.00')], '2026-02': [rec(3, '2026-02-01', '75.00')] });
    const run2 = await syncBreezeGivingYear(KEYS, db, { year: 2026, now: NOW, fetchImpl: second.fetchImpl });
    expect(run2).toMatchObject({ ok: true, added: 0, updated: 1, removed: 1 });
    expect((await readCopyMonthly(db, 2026)).cents.slice(0, 2)).toEqual([12000, 7500]);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM finance_breeze_gift_funds').get().n).toBe(2);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM finance_breeze_sync_runs').get().n).toBe(2);
  });

  it('is idempotent: running twice with no changes adds nothing', async () => {
    const db = sqliteDb();
    const breeze = fakeBreeze({ '2026-01': [rec(1, '2026-01-04', '100.00')] });
    await syncBreezeGivingYear(KEYS, db, { year: 2026, now: NOW, fetchImpl: breeze.fetchImpl });
    const again = await syncBreezeGivingYear(KEYS, db, { year: 2026, now: NOW, fetchImpl: breeze.fetchImpl });
    expect(again).toMatchObject({ ok: true, added: 0, updated: 0, removed: 0 });
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM finance_breeze_gifts').get().n).toBe(1);
  });

  it('leaves a month alone when Breeze suddenly lists nothing for it, rather than emptying it', async () => {
    const db = sqliteDb();
    await syncBreezeGivingYear(KEYS, db, { year: 2026, now: NOW, fetchImpl: fakeBreeze({ '2026-01': [rec(1, '2026-01-04', '100.00')] }).fetchImpl });
    const run = await syncBreezeGivingYear(KEYS, db, { year: 2026, now: NOW, fetchImpl: fakeBreeze({}).fetchImpl });
    expect(run).toMatchObject({ ok: true, status: 'warnings', removed: 0 });
    expect(run.message).toContain('left unchanged');
    expect((await readCopyMonthly(db, 2026)).cents[0]).toBe(10000);
  });

  it('stops and says so when Breeze fails, a month is too big for one answer, or Breeze is not connected', async () => {
    const db = sqliteDb();
    const failed = await syncBreezeGivingYear(KEYS, db, { year: 2026, now: NOW, fetchImpl: fakeBreeze({}, { fail: 503 }).fetchImpl });
    expect(failed).toMatchObject({ ok: false });
    expect(failed.error).toContain('503');
    expect(failed.error).not.toContain('secret-key-123');
    const big = fakeBreeze({ '2026-01': Array.from({ length: 10000 }, (_, i) => rec(i + 1, '2026-01-04', '1.00')) });
    expect((await syncBreezeGivingYear(KEYS, db, { year: 2026, now: NOW, fetchImpl: big.fetchImpl })).error).toContain('more gifts than one Breeze answer');
    expect((await syncBreezeGivingYear({}, db, { year: 2026, now: NOW })).status).toBe(503);
    expect((await syncBreezeGivingYear(KEYS, db, { year: 1999, now: NOW })).status).toBe(400);
    expect(monthRange(2026, 2).end).toBe('2026-02-28');
  });
});

describe('reconciliation against Connect', () => {
  it('marks a month as matching only when the two agree to the cent', () => {
    const copy = { cents: [15025, 7500, ...new Array(10).fill(0)], gifts: [2, 1, ...new Array(10).fill(0)] };
    const r = buildReconciliation({ copy, connectMonthlyCents: [15025, 7400, ...new Array(10).fill(0)], year: 2025, now: NOW });
    expect(r.months[0].matches).toBe(true);
    expect(r.months[1]).toMatchObject({ matches: false, differenceCents: 100 });
    expect(r.allMatch).toBe(false);
    expect(r.differenceCents).toBe(100);
    expect(buildReconciliation({ copy, connectMonthlyCents: null, year: 2025, now: NOW }).connectCents).toBeNull();
  });
});

describe('Breeze giving page and sync route', () => {
  function appEnv({ role = 'admin', db = sqliteDb(), breeze = KEYS } = {}) {
    return {
      ENVIRONMENT: 'staging', RELEASE_SHA: 't', FINANCE_CONTRACT_API_KEY: 'k', FINANCE_DB: db, ...breeze,
      CONNECT_SERVICE: {
        async fetch(req) {
          const { pathname } = new URL(req.url);
          if (pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role, permissions: { finance: 'edit' }, username: 'andrew' }));
          if (pathname === '/api/contracts/giving-board-v1') {
            return new Response(JSON.stringify({ year: 2026, categories: { all: { monthly: { current: [15025, 7500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], prior: [] } } } }));
          }
          return new Response('nf', { status: 404 });
        },
      },
    };
  }
  const headers = { 'Cf-Access-Jwt-Assertion': 'signed.jwt' };
  const get = async (path, env) => { const res = await worker.fetch(new Request(`https://finance.test${path}`, { headers }), env); return { status: res.status, html: await res.text() }; };

  it('shows an admin the connection steps when Breeze is not connected, and Connect’s totals', async () => {
    const { html } = await get('/?section=data&page=breeze-giving&year=2026', appEnv({ breeze: {} }));
    expect(html).toContain('Breeze is not connected to Finance yet');
    expect(html).toContain('BREEZE_API_KEY');
    expect(html).not.toContain('Copy 2026 from Breeze');
    expect(html).toContain('Connect is still the official record');
    expect(html).toContain('All giving, from Connect');
  });

  it('offers the copy button when connected, and shows a non-admin nothing', async () => {
    const { html } = await get('/?section=data&page=breeze-giving&year=2026', appEnv());
    expect(html).toContain('Copy 2026 from Breeze');
    const viewer = await get('/?section=data&page=breeze-giving&year=2026', appEnv({ role: 'finance' }));
    expect(viewer.html).toContain('Only an admin can see or run the Breeze giving copy');
    expect(viewer.html).not.toContain('Copy 2026 from Breeze');
  });

  it('refuses the sync for a non-admin and explains it', async () => {
    const body = new FormData();
    body.set('year', '2026');
    const res = await worker.fetch(new Request('https://finance.test/api/v1/breeze-giving-sync', { method: 'POST', body, headers }), appEnv({ role: 'finance' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toContain('status=error');
    expect(new URL(res.headers.get('Location'), 'https://finance.test').searchParams.get('message')).toContain('Only an admin');
  });
});
