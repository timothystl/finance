import { describe, expect, it } from 'vitest';
import worker from '../apps/finance/shell.js';
import fs from 'node:fs';
import { BOARD_PACKET_ITEMS, PRINT_STYLES, printHref } from '../apps/finance/print-pages.js';

// Server-built print versions (Andrew, 2026-09-25): any page with print=1, and the board packet print.

const LIVE_LEDGERS = {
  contract: 'connect.finance-property-ledgers.v1', dataClassification: 'aggregate',
  sourceProduct: 'connect', consumerProduct: 'finance', currency: 'USD',
  propertyKey: 'ivanhoe', generatedAt: '2026-09-15T12:00:00Z',
  capital: [{ entryDate: '2024-10-07', amountCents: 540000, payee: 'Vail Contracting LLC', description: 'Contracting work', checkRef: '', project: 'Renovation', sortOrder: 1, id: 7 }],
  repairs: [],
  totals: { capitalCents: 540000, repairsCents: 0 },
};

function env({ role = 'admin', permissions = { finance: 'edit', budget: 'edit', compensation: 'view' }, environment = 'staging', roleStatus = 200 } = {}) {
  return {
    ENVIRONMENT: environment, RELEASE_SHA: 't', FINANCE_CONTRACT_API_KEY: 'k',
    CONNECT_SERVICE: {
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === '/api/contracts/staff-role-v1') {
          return roleStatus === 200 ? new Response(JSON.stringify({ role, permissions })) : new Response('{}', { status: roleStatus });
        }
        if (pathname === '/api/contracts/finance-property-ledgers-v1') return new Response(JSON.stringify(LIVE_LEDGERS));
        return new Response('nf', { status: 404 });
      },
    },
  };
}

const get = async (path, e = env()) => {
  const res = await worker.fetch(new Request(`https://finance.test${path}`, { headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt' } }), e);
  return { status: res.status, html: await res.text() };
};

describe('printHref', () => {
  it('keeps the page, adds print=1, and drops one-off status parameters', () => {
    expect(printHref(new URLSearchParams('section=property&page=capital&status=ok&message=Saved&edit=4'))).toBe('/?section=property&page=capital&print=1');
  });
});

describe('print version of a page', () => {
  it('offers a Print link in the page head', async () => {
    const { html } = await get('/?section=property&page=capital');
    expect(html).toContain('class="print-link" href="/?section=property&amp;page=capital&amp;print=1"');
  });

  it('renders the report as a print document without the app chrome, hiding forms', async () => {
    const { status, html } = await get('/?section=property&page=capital&print=1');
    expect(status).toBe(200);
    expect(html).toContain('class="print-doc"');
    expect(html).toContain('Timothy Lutheran Church · Finance');
    expect(html).toContain('<h1 class="print-title">Capital improvements</h1>');
    expect(html).toContain('Vail Contracting LLC');
    expect(html).toContain('id="print-now"');
    expect(html).toContain('<script src="/print/print.js" defer></script>');
    expect(html).toContain('href="/?section=property&amp;page=capital"');
    expect(html).not.toContain('app-sidebar');
    expect(html).toMatch(/\.print-doc form[^{]*\{ display: none !important; \}/);
    expect(html).toContain('thead { display: table-header-group; }');
  });

  it('still applies the section permission check', async () => {
    const { status } = await get('/?section=compensation&page=council&print=1', env({ role: 'finance', permissions: { finance: 'view' } }));
    expect(status).toBe(403);
  });

  it('returns just the titled fragment when composing', async () => {
    const { html } = await get('/?section=property&page=capital&print=1&fragment=1');
    expect(html.startsWith('<article class="print-section">')).toBe(true);
    expect(html).not.toContain('<!doctype html>');
  });
});

function settingsDb(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    prepare(sql) {
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

describe('board packet cover letter template', () => {
  it('shows the starter letter until one is saved, and the saved one afterward', async () => {
    const starter = await get('/print/board-packet', { ...env(), FINANCE_DB: settingsDb() });
    expect(starter.html).toContain('Dear Council members,');
    expect(starter.html).toContain('Save as template');
    const saved = await get('/print/board-packet', { ...env(), FINANCE_DB: settingsDb({ board_packet_cover_template: 'October letter <b>x</b>' }) });
    expect(saved.html).toContain('October letter &lt;b&gt;x&lt;/b&gt;');
    expect(saved.html).not.toContain('Dear Council members,');
  });

  it('saves the template for a finance editor and redirects back to the picker', async () => {
    const db = settingsDb();
    const form = new FormData();
    form.set('note', '  New monthly wording  ');
    const res = await worker.fetch(new Request('https://finance.test/print/board-packet/cover', { method: 'POST', body: form, headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt' } }), { ...env(), FINANCE_DB: db });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/print/board-packet?saved=1');
    expect(db.store.get('board_packet_cover_template')).toBe('New monthly wording');
  });

  it('refuses to save for a view-only role and hides the save button', async () => {
    const db = settingsDb();
    const viewer = env({ role: 'finance', permissions: { finance: 'view' } });
    const form = new FormData();
    form.set('note', 'nope');
    const res = await worker.fetch(new Request('https://finance.test/print/board-packet/cover', { method: 'POST', body: form, headers: { 'Cf-Access-Jwt-Assertion': 'signed.jwt' } }), { ...viewer, FINANCE_DB: db });
    expect(res.status).toBe(403);
    expect(db.store.size).toBe(0);
    const page = await get('/print/board-packet', { ...viewer, FINANCE_DB: db });
    expect(page.html).not.toContain('Save as template');
  });
});

describe('board packet content', () => {
  it('prints the Budget for the current year only, not the proposed next-year plan', () => {
    const item = BOARD_PACKET_ITEMS.find((entry) => entry.key === 'budget');
    expect(item.pageParams.builder).toEqual({ print_mode: 'thisyear' });
  });

  it('lets the picker choose this year only (default) or next year’s plan for the Budget', async () => {
    const { html } = await get('/print/board-packet', env({ role: 'admin', permissions: { finance: 'edit', budget: 'edit' } }));
    expect(html).toContain('name="budget_year" value="thisyear" checked');
    expect(html).toContain('name="budget_year" value="plan"');
  });

  it('keeps Balance Sheet pages in the print even though they hold a year picker form', () => {
    expect(PRINT_STYLES).toContain('section:not(.keep-in-print):has(> form)');
    for (const label of ['Balance Sheet position', 'Balance Sheet account detail', 'Balance Sheet multi-year position']) {
      expect(fs.readFileSync(new URL('../apps/finance/balance-pages.js', import.meta.url), 'utf8')).toContain(`<section class="report keep-in-print" aria-label="${label}">`);
    }
  });
});

describe('board packet print', () => {
  it('shows a picker limited to reports the viewer may see', async () => {
    const { html } = await get('/print/board-packet', env({ role: 'finance', permissions: { finance: 'view' } }));
    expect(html).toContain('Print the board packet');
    expect(html).toContain('value="balance" checked');
    expect(html).not.toContain('value="church" checked');
    expect(html).not.toContain('value="budget"');
    expect(html).not.toContain('value="council"');
    expect(html).toContain('name="note"');
  });

  it('composes a cover page, the escaped cover note, and each chosen report on a new page', async () => {
    const { status, html } = await get(`/print/board-packet?include=property&note=${encodeURIComponent('Council: <b>see Q3</b>')}`);
    expect(status).toBe(200);
    expect(html).toContain('<h1 class="print-title">Board packet</h1>');
    expect(html).toContain('<div class="print-cover-note">Council: &lt;b&gt;see Q3&lt;/b&gt;</div>');
    const item = BOARD_PACKET_ITEMS.find((entry) => entry.key === 'property');
    expect(html.match(/class="print-newpage"/g)).toHaveLength(item.pages.length);
    expect(html).toContain('Commercial Property, board summary');
    expect(html.match(/<!doctype html>/g)).toHaveLength(1);
  });

  it('includes position, account detail, and multi-year position in the balance sheet section', () => {
    const item = BOARD_PACKET_ITEMS.find((entry) => entry.key === 'balance');
    expect(item.pages).toEqual(['position', 'account-detail', 'multi-year']);
  });

  it('ignores reports the viewer may not include', async () => {
    const { html } = await get('/print/board-packet?include=budget', env({ role: 'finance', permissions: { finance: 'view' } }));
    expect(html).toContain('Choose at least one report you have access to.');
  });

  it('refuses when production role verification fails', async () => {
    const { status } = await get('/print/board-packet', env({ environment: 'production', roleStatus: 500 }));
    expect(status).toBe(403);
  });
});

describe('release number on screen', () => {
  it('grows with each release and shows in the page header', async () => {
    const { financeVersion } = await import('../apps/finance/version.js');
    expect(financeVersion({})).toBe('0.1.0-alpha.1');
    expect(financeVersion({ RELEASE_NUMBER: '9' })).toBe('0.1.0-alpha.9');
    expect(financeVersion({ RELEASE_NUMBER: 'not a number' })).toBe('0.1.0-alpha.1');
    const { html } = await get('/?section=attendance&page=overview', { ...env(), RELEASE_NUMBER: '12' });
    expect(html).toContain('>v0.1.0-alpha.12<');
  });
});

describe('board packet content, October review', () => {
  it('prints the Giving report compact (no fund tables), and leaves out the church income and expense detail', () => {
    const giving = BOARD_PACKET_ITEMS.find((entry) => entry.key === 'giving');
    expect(giving.pageParams.council).toEqual({ compact: '1' });
    const church = BOARD_PACKET_ITEMS.find((entry) => entry.key === 'church');
    expect(church.pages).toEqual(['overview', 'trend', 'budget-actual']);
  });
});
