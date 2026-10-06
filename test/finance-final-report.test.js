import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import worker from '../apps/finance/shell.js';
import { changeSelection, normalizeItem, readSelection, SELECTION_MAX } from '../apps/finance/packet-selection-service.js';

const EXAMPLE = JSON.parse(fs.readFileSync(new URL('../contracts/examples/attendance-summary-v1.synthetic.json', import.meta.url), 'utf8'));

function memoryDb() {
  const store = new Map();
  return {
    store,
    prepare() {
      return {
        bind(...args) {
          return {
            async first() { return store.has(args[0]) ? { value: store.get(args[0]) } : null; },
            async run() { store.set(args[0], args[1]); return { success: true }; },
          };
        },
      };
    },
  };
}

function env({ db = memoryDb(), role = 'admin', permissions = { finance: 'edit', budget: 'edit' }, username = 'andrew' } = {}) {
  return {
    ENVIRONMENT: 'staging', RELEASE_SHA: 't', FINANCE_CONTRACT_API_KEY: 'k', FINANCE_DB: db,
    CONNECT_SERVICE: {
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === '/api/contracts/staff-role-v1') return new Response(JSON.stringify({ role, permissions, username }));
        if (pathname === '/api/contracts/attendance-summary-v1') return new Response(JSON.stringify(EXAMPLE));
        return new Response('nf', { status: 404 });
      },
    },
  };
}
const headers = { 'Cf-Access-Jwt-Assertion': 'signed.jwt' };
const get = async (path, e) => {
  const res = await worker.fetch(new Request(`https://finance.test${path}`, { headers }), e);
  return { status: res.status, html: await res.text() };
};
const post = async (fields, e) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return worker.fetch(new Request('https://finance.test/api/v1/packet-selection', { method: 'POST', body, headers }), e);
};

describe('final report list (service)', () => {
  it('keeps only known reports and view settings, and defaults the Budget to this year only', () => {
    expect(normalizeItem({ section: 'balance', page: 'position', query: 'fiscal_year=2026&status=ok&evil=1&section=x' })).toEqual({ section: 'balance', page: 'position', query: 'fiscal_year=2026' });
    expect(normalizeItem({ section: 'planning', page: 'builder', query: '' }).query).toBe('print_mode=thisyear');
    expect(normalizeItem({ section: 'payroll', page: 'run', query: '' })).toBeNull();
    expect(normalizeItem({ section: 'planning', page: 'scenarios', query: '' })).toBeNull();
    expect(normalizeItem({ section: 'attendance', page: 'nope', query: '' })).toBeNull();
  });

  it('adds without duplicates, reorders, removes, clears, caps the size, and keeps each person’s list separate', async () => {
    const db = memoryDb();
    const add = (owner, section, page, query = '') => changeSelection(db, owner, { action: 'add', section, page, query });
    await add('andrew', 'attendance', 'overview');
    await add('andrew', 'attendance', 'overview');
    await add('andrew', 'balance', 'position', 'fiscal_year=2026');
    await add('bea', 'church', 'overview');
    expect((await readSelection(db, 'andrew')).map((x) => x.section)).toEqual(['attendance', 'balance']);
    expect((await readSelection(db, 'bea')).map((x) => x.section)).toEqual(['church']);
    const first = (await readSelection(db, 'andrew'))[0];
    const id = `${first.section}|${first.page}|${first.query}`;
    await changeSelection(db, 'andrew', { action: 'down', id });
    expect((await readSelection(db, 'andrew')).map((x) => x.section)).toEqual(['balance', 'attendance']);
    await changeSelection(db, 'andrew', { action: 'remove', id });
    expect((await readSelection(db, 'andrew')).map((x) => x.section)).toEqual(['balance']);
    await changeSelection(db, 'andrew', { action: 'clear' });
    expect(await readSelection(db, 'andrew')).toEqual([]);
    for (let y = 2000; y < 2000 + SELECTION_MAX; y += 1) await add('cap', 'balance', 'position', `fiscal_year=${y}`);
    const over = await add('cap', 'balance', 'position', 'fiscal_year=2099');
    expect(over.ok).toBe(false);
  });

  it('refuses a report the person cannot open, and a person with no name to keep a list under', async () => {
    const db = memoryDb();
    expect((await changeSelection(db, 'andrew', { action: 'add', section: 'balance', page: 'position' }, () => false)).status).toBe(403);
    expect((await changeSelection(db, '', { action: 'add', section: 'balance', page: 'position' })).status).toBe(403);
  });
});

describe('final report in the app', () => {
  it('offers Add on a report, remembers it, lists it on the Board packet page, and prints it with the cover letter', async () => {
    const e = env();
    let page = await get('/?section=attendance&page=overview', e);
    expect(page.html).toContain('+ Add to final report');
    expect(page.html).toContain('Final report (0)');

    const res = await post({ action: 'add', section: 'attendance', page: 'overview', query: '', back: '/?section=attendance&page=overview' }, e);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/?section=attendance&page=overview');

    page = await get('/?section=attendance&page=overview', e);
    expect(page.html).toContain('✓ In final report · Remove');
    expect(page.html).toContain('Final report (1)');

    const packet = await get('/?section=packet', e);
    expect(packet.html).toContain('Your final report');
    expect(packet.html).toContain('Attendance: This year');
    expect(packet.html).toContain('name="final" value="1"');
    expect(packet.html).toContain('Dear Council members,');

    const printed = await get('/print/board-packet?final=1&note=Hello+board', e);
    expect(printed.status).toBe(200);
    expect(printed.html).toContain('Worship attendance, FY2026');
    expect(printed.html).toContain('Hello board');
    expect(printed.html.match(/class="print-newpage"/g)).toHaveLength(1);
  });

  it('tells the person the list is empty rather than printing a blank packet, and ignores an unsafe return address', async () => {
    const e = env();
    const empty = await get('/print/board-packet?final=1', e);
    expect(empty.html).toContain('Your final report is empty');
    const res = await post({ action: 'add', section: 'attendance', page: 'overview', back: '//evil.example' }, e);
    expect(res.headers.get('Location')).toBe('/?section=packet');
  });

  it('does not let a person add a report their role cannot open', async () => {
    const e = env({ role: 'staff', permissions: { finance: 'none' } });
    const res = await post({ action: 'add', section: 'attendance', page: 'overview' }, e);
    expect(res.status).toBe(403);
  });

  it('shows no Add button on print pages or when there is no database to keep the list in', async () => {
    const printed = await get('/?section=attendance&page=overview&print=1', env());
    expect(printed.html).not.toContain('Add to final report');
    const none = await get('/?section=attendance&page=overview', { ...env(), FINANCE_DB: undefined });
    expect(none.html).not.toContain('Add to final report');
  });
});
