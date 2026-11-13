import { describe, it, expect } from 'vitest';
import {
  apportion, applyLine, applyLines, applyStaff, addStaff, applyStory, missionModel, normalizeMission, saveMission, weekShares, emptyMission, canManageMission,
  importStaff, plannerWorkers, applyBenefitLines,
} from '../apps/finance/mission-alignment.js';
import { renderMissionPage, renderStaffTimePage } from '../apps/finance/mission-pages.js';
import { renderCongregationPage, renderMissionReportPage } from '../apps/finance/mission-visuals.js';
import { buildTrendModel, change } from '../apps/finance/budget-trends.js';
import worker from '../apps/finance/shell.js';

const line = (category, n, classification = 'Expenses') => ({ category, name: category.split(':').pop(), classification, baseBudgetCents: Math.round(n * 0.9), projectedCents: Math.round(n * 0.95), plan: { plannedAmountCents: n } });
const builder = {
  targetYear: 2027, baseYear: 2026,
  lines: [line('Expenses:Hospitality', 400000), line('Expenses:Worship', 600000), line('Expenses:Utilities', 1000000), line('Expenses:Salary', 8000000), line('Expenses:Benefits', 2000000), line('Income:Giving', 13000000, 'Income')],
};
const state = () => ({
  ...emptyMission(), revision: 1,
  lines: { 'Expenses:Hospitality': { method: 'one', shares: [10000, 0, 0, 0], note: '' }, 'Expenses:Worship': { method: 'one', shares: [0, 10000, 0, 0], note: '' } },
  staff: [{ id: 'p', label: 'Pastor', hours: 5000, sources: ['Expenses:Salary', 'Expenses:Benefits'], mode: 'quick', shares: [2000, 4000, 3000, 1000], week: [], reviewed: true }],
});
const total = (m) => m.totals.reduce((a, b) => a + b, 0) + m.unassigned;

describe('mission model', () => {
  it('counts staff compensation once, by the person’s time, and never counts income', () => {
    const m = missionModel(builder, state());
    expect(m.total).toBe(12000000);
    expect(m.staffPool).toBe(10000000);
    expect(m.staffTotals).toEqual([2000000, 4000000, 3000000, 1000000]);
    expect(m.totals).toEqual([2400000, 4600000, 3000000, 1000000]);
    expect(m.unassigned).toBe(1000000); // utilities not yet aligned
    expect(m.needsCount).toBe(1);
    expect(total(m)).toBe(m.total);
  });
  it('spreads a shared line like everything else that is aligned', () => {
    const data = state(); data.lines['Expenses:Utilities'] = { method: 'spread', shares: [0, 0, 0, 0], note: 'Follows the budget' };
    const m = missionModel(builder, data);
    expect(m.unassigned).toBe(0);
    expect(total(m)).toBe(m.total);
    const util = m.rows.find((r) => r.line.category === 'Expenses:Utilities');
    expect(util.status).toBe('spread');
    // Basis: 2.4M / 4.6M / 3.0M / 1.0M of 11M aligned.
    expect(util.parts[1]).toBeGreaterThan(util.parts[2]);
    expect(util.parts.reduce((a, b) => a + b, 0)).toBe(1000000);
  });
  it('leaves partial splits and open staff time visible as not yet aligned', () => {
    const data = state(); data.lines['Expenses:Utilities'] = { method: 'split', shares: [1500, 3500, 0, 0], note: '' };
    data.staff[0].shares = [5000, 0, 0, 0];
    const m = missionModel(builder, data);
    expect(m.rows.find((r) => r.line.category === 'Expenses:Utilities').status).toBe('partial');
    expect(m.staff[0].unassigned).toBe(5000000);
    expect(total(m)).toBe(m.total);
  });
  it('conserves positive and negative cents through rounding', () => {
    for (const value of [1, 2, 101, -1, -101]) expect(apportion(value, [3333, 3333, 3334]).reduce((a, b) => a + b, 0)).toBe(value);
  });
  it('builds a typical week, spreading administration in proportion to the rest', () => {
    const r = weekShares([{ activity: 'Sermon', hours: 2100, end: 1 }, { activity: 'Care', hours: 900, end: 0 }, { activity: 'Admin', hours: 1000, end: 'spread' }]);
    expect(r.shares).toEqual([3000, 7000, 0, 0]);
    expect(r.total).toBe(4000);
    expect(r.hours[1]).toBe(2800);
    expect(weekShares([{ activity: 'Admin', hours: 100, end: 'spread' }]).shares).toEqual([2500, 2500, 2500, 2500]);
  });
  it('reads this morning’s first version: staff time on lines becomes a quick split to review', () => {
    const v1 = { revision: 3, lines: { 'Expenses:Hospitality': [10000, 0, 0, 0], 'Expenses:Worship': [0, 5000, 5000, 0] }, staff: [{ id: 'p', label: 'Pastor', sources: ['Expenses:Salary'], allocations: { 'Expenses:Hospitality': 2000, 'Expenses:Worship': 8000 } }] };
    const data = normalizeMission(v1);
    expect(data.lines['Expenses:Hospitality'].method).toBe('one');
    expect(data.lines['Expenses:Worship']).toMatchObject({ method: 'split', shares: [0, 5000, 5000, 0] });
    expect(data.staff[0]).toMatchObject({ mode: 'quick', shares: [2000, 4000, 4000, 0], reviewed: false });
  });
});

describe('mission edits', () => {
  it('validates line splits and keeps staff lines on the Staff time page', () => {
    const data = state();
    expect(applyLine(data, { category: 'Expenses:Utilities', method: 'split', share_welcome: '15', share_receive: '35', share_grow: '35', share_go: '15', note: 'By building use' }, builder).data.lines['Expenses:Utilities']).toEqual({ method: 'split', shares: [1500, 3500, 3500, 1500], note: 'By building use' });
    expect(() => applyLine(data, { category: 'Expenses:Utilities', method: 'split', share_welcome: '60', share_receive: '50' }, builder)).toThrow(/more than 100/);
    for (const bad of ['-1', 'NaN', 'Infinity', '100.01']) expect(() => applyLine(data, { category: 'Expenses:Utilities', method: 'split', share_go: bad }, builder)).toThrow();
    expect(() => applyLine(data, { category: 'Expenses:Salary', method: 'one', end: 'grow' }, builder)).toThrow(/Staff time/);
    expect(() => applyLine(data, { category: 'Income:Giving', method: 'one', end: 'grow' }, builder)).toThrow(/not in this year/);
    expect(applyLine(data, { category: 'Expenses:Worship', method: 'clear' }, builder).data.lines['Expenses:Worship']).toBeUndefined();
  });
  it('saves a typical week and refuses compensation lines owned by another role or already split', () => {
    const data = addStaff(state(), { label: 'Organist' }).data;
    const id = data.staff[1].id;
    const form = { id, label: 'Organist', mode: 'week', hours: '20', act_0: 'Rehearsal', act_hours_0: '12', act_end_0: 'receive', act_1: 'Kids choir', act_hours_1: '8', act_end_1: 'grow', act_2: '', act_hours_2: '' };
    const saved = applyStaff(data, form, builder).data.staff[1];
    expect(saved.week).toHaveLength(2);
    expect(weekShares(saved.week).shares).toEqual([0, 6000, 4000, 0]);
    expect(() => applyStaff(data, { ...form, source_3: 'Expenses:Salary' }, builder)).toThrow(/only one staff role/);
    expect(() => applyStaff(data, { ...form, source_1: 'Expenses:Worship' }, builder)).toThrow(/already has its own mission split/);
    expect(() => applyStaff(data, { ...form, act_end_1: '' }, builder)).toThrow(/counts toward/);
  });
  it('keeps the congregation slide words short', () => {
    expect(applyStory(state(), { bullets_welcome: 'Hospitality\nGuests', note: 'People are the ministry.' }).data.story.bullets[0]).toEqual(['Hospitality', 'Guests']);
    expect(() => applyStory(state(), { bullets_go: 'x'.repeat(81) })).toThrow();
  });
  it('checks the revision and writes atomically', async () => {
    const stored = JSON.stringify({ ...state(), version: 2 });
    const db = { prepare: () => ({ bind: () => ({ first: async () => ({ value: stored }), run: async () => ({ meta: { changes: 0 } }) }) }) };
    const form = { action: 'line', target: '2027', base: '2026', revision: '1', category: 'Expenses:Utilities', method: 'spread' };
    await expect(saveMission(db, { ...form, revision: '0' }, 'admin', builder)).rejects.toThrow(/Someone else/);
    await expect(saveMission(db, form, 'admin', builder)).rejects.toThrow(/Someone else/);
    let written;
    const ok = { prepare: () => ({ bind: (...args) => ({ first: async () => ({ value: stored }), run: async () => { written = args[0]; return { meta: { changes: 1 } }; } }) }) };
    const result = await saveMission(ok, form, 'admin', builder);
    expect(result).toMatchObject({ page: 'mission', params: { target: '2027', line: 'Expenses:Utilities' } });
    expect(JSON.parse(written)).toMatchObject({ version: 2, revision: 2 });
    await expect(saveMission(ok, { ...form, action: 'drop' }, 'admin', builder)).rejects.toThrow(/could not be understood/);
  });
  it('allows only admins to edit', () => {
    expect(canManageMission({ ok: true, role: 'admin' })).toBe(true);
    expect(canManageMission({ ok: true, role: 'council' })).toBe(false);
  });
});

describe('typing percentages into the table', () => {
  it('changes only edited rows, keeps their reason, clears blanked rows and refuses staff lines', () => {
    const data = state(); data.lines['Expenses:Worship'].note = 'Sunday';
    const form = { row_0: 'Expenses:Hospitality', orig_0: '10000,0,0,0', cell_0_welcome: '100', row_1: 'Expenses:Worship', orig_1: '0,10000,0,0', cell_1_receive: '80', cell_1_grow: '20', row_2: 'Expenses:Utilities', orig_2: '0,0,0,0', cell_2_go: '100' };
    const next = applyLines(data, form, builder);
    expect(next.params.changed).toBe('2');
    expect(next.data.lines['Expenses:Worship']).toEqual({ method: 'split', shares: [0, 8000, 2000, 0], note: 'Sunday' });
    expect(next.data.lines['Expenses:Utilities']).toEqual({ method: 'one', shares: [0, 0, 0, 10000], note: '' });
    expect(applyLines(data, { row_0: 'Expenses:Hospitality', orig_0: '10000,0,0,0' }, builder).data.lines['Expenses:Hospitality']).toBeUndefined();
    expect(() => applyLines(data, { row_0: 'Expenses:Utilities', orig_0: '0,0,0,0', cell_0_welcome: '70', cell_0_go: '40' }, builder)).toThrow(/more than 100/);
    expect(() => applyLines(data, { row_0: 'Expenses:Salary', orig_0: '0,0,0,0', cell_0_go: '10' }, builder)).toThrow(/Staff time/);
  });
});

describe('staff from the compensation planner', () => {
  const plan = {
    roster: [{ name: 'Dinger', position: 'Senior Pastor', accountCode: '58001', ftePct: 100 }, { name: 'Knapp', position: 'Director of Christian Education', accountCode: '58002', ftePct: 50, hideFromCouncil: true }, { name: 'Away', position: 'Preschool', externallyFunded: true }],
    computed: [{ churchCostCents: 9000000, benefits: { totalCents: 3000000 } }, { churchCostCents: 4000000, benefits: { totalCents: 1000000 } }, { churchCostCents: 1, benefits: { totalCents: 1 } }],
  };
  const b = { targetYear: 2027, baseYear: 2026, lines: [line('Expenses:Salaries:58001 Pastor Salary', 6000000), line('Expenses:Salaries:58002 DCE Salary', 3000000), line('Expenses:Staff:Health Insurance', 2400000), line('Expenses:Staff:Pension', 1600000), line('Expenses:Worship', 500000)] };
  it('reads the roster without anyone paid from another budget', () => {
    const workers = plannerWorkers(plan);
    expect(workers.map((w) => w.position)).toEqual(['Senior Pastor', 'Director of Christian Education']);
    expect(workers[1]).toMatchObject({ hours: 2000, councilHidden: true });
    expect(plannerWorkers({})).toBeNull();
  });
  it('adds a role per person, links their pay line, finds the shared benefit lines, and refreshes without losing splits', () => {
    const workers = plannerWorkers(plan);
    const first = importStaff(emptyMission(), {}, b, { workers });
    expect(first.params.imported).toBe('2');
    const [pastor, dce] = first.data.staff;
    expect(pastor).toMatchObject({ label: 'Senior Pastor', name: 'Dinger', sources: ['Expenses:Salaries:58001 Pastor Salary'], hours: 4000, benefitWeight: 7500 });
    expect(dce.benefitWeight).toBe(2500);
    expect(first.data.benefitLines).toEqual(['Expenses:Staff:Health Insurance', 'Expenses:Staff:Pension']);
    const m = missionModel(b, first.data);
    expect(m.staff.map((s) => s.pool)).toEqual([6000000 + 3000000, 3000000 + 1000000]);
    expect(m.staffPool).toBe(13000000);
    expect(m.rows.filter((r) => !r.isSource).map((r) => r.line.category)).toEqual(['Expenses:Worship']);
    const edited = { ...first.data, staff: first.data.staff.map((s, i) => (i === 0 ? { ...s, shares: [2000, 4000, 3000, 1000], reviewed: true } : s)) };
    const again = importStaff(edited, {}, b, { workers });
    expect(again.params.imported).toBe('0');
    expect(again.data.staff[0]).toMatchObject({ shares: [2000, 4000, 3000, 1000], reviewed: true });
    expect(() => importStaff(emptyMission(), {}, b, { workers: null })).toThrow(/could not be read/);
    expect(applyBenefitLines(first.data, { benefit_2: 'Expenses:Staff:Health Insurance' }, b).data.benefitLines).toEqual(['Expenses:Staff:Health Insurance']);
    expect(() => applyLine(first.data, { category: 'Expenses:Staff:Pension', method: 'one', end: 'go' }, b)).toThrow(/Staff time/);
  });
  it('shows the planner panel on Staff time', () => {
    const data = importStaff(emptyMission(), {}, b, { workers: plannerWorkers(plan) }).data;
    const html = renderStaffTimePage({ builder: b, data, params: new URLSearchParams(), canEdit: true, workers: plannerWorkers(plan) });
    expect(html).toContain('Refresh staff from the compensation planner');
    expect(html).toContain('all brought in');
    expect(renderStaffTimePage({ builder: b, data: emptyMission(), params: new URLSearchParams(), canEdit: true, workers: plannerWorkers(plan) })).toContain('Bring in staff from the compensation planner');
  });
});

describe('mission pages', () => {
  const params = (q = '') => new URLSearchParams(q);
  it('lists lines by End with a drawer and escapes names and notes', () => {
    const data = state(); data.lines['Expenses:Worship'].note = '<script>x</script>';
    const html = renderMissionPage({ builder, data, params: params('line=Expenses%3AUtilities&preset=even'), canEdit: true });
    expect(html).toContain('Total budget by End');
    expect(html).toContain('Not yet aligned');
    expect(html).toContain('Staff salaries &amp; benefits');
    expect(html).toContain('Apply to line');
    expect(html).toContain('name="cell_0_welcome" form="ma-cells"');
    expect(html).toContain('Save percentages');
    expect(renderMissionPage({ builder, data, params: params('as=usd'), canEdit: true })).not.toContain('Save percentages');
    expect(html).toContain('name="share_welcome" data-share inputmode="decimal" value="25"');
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
  });
  it('shows staff time with the week builder and templates, admin only', () => {
    const data = state();
    const html = renderStaffTimePage({ builder, data, params: params('role=p&mode=week&template=pastor'), canEdit: true });
    expect(html).toContain('Where staff compensation goes');
    expect(html).toContain('What this week adds up to');
    expect(html).toContain('value="Sermon &amp; worship preparation"');
    expect(renderStaffTimePage({ builder, data, params: params(), canEdit: false })).toContain('only a Finance administrator');
  });
  it('turns the plan into cents of every dollar for the congregation, without staff pay by person', () => {
    const data = state(); data.lines['Expenses:Utilities'] = { method: 'spread', shares: [0, 0, 0, 0], note: '' };
    const html = renderCongregationPage({ builder, data, params: params(), canEdit: false });
    const cents = [...html.matchAll(/<b>(\d+)¢<\/b>/g)].map((m) => Number(m[1]));
    expect(cents.reduce((a, b) => a + b, 0)).toBe(100);
    expect(html).toContain('How your gifts do the mission');
    expect(html).toContain('Where it comes from, where it goes');
    const report = renderMissionReportPage({ builder, data });
    expect(report).toContain('Each staff role, by End');
    expect(report).toContain('Shared and split lines, and why');
    expect(report).not.toContain('$80,000'); // the Pastor's own salary line never appears
  });
});

describe('budget trends', () => {
  const years = [
    { year: 2024, ok: true, accounts: [{ path: 'Expenses:Utilities', name: 'Utilities', isRevenue: false, actual: 800000, budget: 850000 }, { path: 'Income:Giving', name: 'Giving', isRevenue: true, actual: 11000000, budget: null }] },
    { year: 2025, ok: false },
  ];
  it('lines up actual years, the projection and the proposed plan', () => {
    const m = buildTrendModel({ builder, years });
    expect(m.columns.map((c) => `${c.year}:${c.kind}`)).toEqual(['2024:actual', '2025:actual', '2026:projected', '2027:proposed']);
    expect(m.expenseTotals[0]).toBe(800000);
    expect(m.expenseTotals[1]).toBeNull();
    expect(m.expenseTotals[3]).toBe(12000000);
    expect(m.missingYears).toEqual([2025]);
    const util = m.expense.flatMap((g) => g.lines).find((l) => l.path === 'Expenses:Utilities');
    expect(util.values).toEqual([800000, null, 950000, 1000000]);
    expect(change(util.values)).toMatchObject({ first: 800000, last: 1000000, cents: 200000 });
  });
});

// The Worker boundary: council members and cross-site forms are refused before any write; the
// editors stay admin-only while the report and trends render for anyone who sees the budget.
describe('mission routes', () => {
  const FY = new Date().getUTCFullYear() + 1;
  const plan = { ...builder, contract: 'connect.finance-budget-builder.v1', targetYear: FY, baseYear: FY - 1 };
  const envFor = (role, db = null) => ({
    ENVIRONMENT: 'staging', FINANCE_CONTRACT_API_KEY: 'test', RELEASE_SHA: 't',
    FINANCE_DB: db || { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({ meta: { changes: 1 } }) }) }) },
    CONNECT_SERVICE: { fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/finance-budget-builder-v1')) return new Response(JSON.stringify(plan));
      if (url.pathname.endsWith('/staff-role-v1') || url.pathname.includes('role')) return new Response(JSON.stringify({ role, username: 'test', permissions: { finance: 'edit', budget: 'edit' } }));
      return new Response('{}', { status: 404 });
    } },
  });
  const post = (headers = {}) => new Request('https://finance.example/api/v1/planning/mission-save', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cf-Access-Jwt-Assertion': 'test', ...headers }, body: `action=line&target=${FY}&base=${FY - 1}&revision=0&return_target=${FY}` });
  const get = (page, role) => worker.fetch(new Request(`https://finance.example/?section=planning&page=${page}&target=${FY}`, { headers: { 'Cf-Access-Jwt-Assertion': 'test' } }), envFor(role));
  it('refuses a council member with budget edit permission', async () => {
    const response = await worker.fetch(post(), envFor('council', { prepare: () => { throw new Error('Database should not be touched'); } }));
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toContain('access_denied');
  });
  it('refuses cross-site posts even for admins', async () => {
    const response = await worker.fetch(post({ Origin: 'https://elsewhere.example' }), envFor('admin'));
    expect(response.headers.get('Location')).toContain('cross_site');
  });
  it('keeps the year on a refused save', async () => {
    const response = await worker.fetch(post({ 'Sec-Fetch-Site': 'same-origin' }), envFor('admin'));
    expect(response.headers.get('Location')).toContain(`target=${FY}`);
    expect(response.headers.get('Location')).toContain('page=mission');
  });
  it('shows the editors to admins only, and the report to council', async () => {
    const adminHtml = await (await get('mission', 'admin')).text();
    expect(adminHtml).toContain('How the budget does the mission');
    const res = await get('staff-time', 'admin');
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    expect(await (await get('mission', 'council')).text()).toContain('Only a Finance administrator');
    expect(await (await get('staff-time', 'council')).text()).toContain('only a Finance administrator');
    expect(await (await get('mission-report', 'council')).text()).toContain('Where the budget does the mission');
    expect(await (await get('congregation', 'council')).text()).toContain('Where it comes from, where it goes');
    expect(await (await get('trends', 'council')).text()).toContain('How the budget has changed since');
  });
});
