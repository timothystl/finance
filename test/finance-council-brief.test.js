import { describe, it, expect } from 'vitest';
import { applyBrief, briefFrom, briefModel, policyChecks, renderCouncilBriefPage, renderPolicyChecklistPage, offeringLine } from '../apps/finance/council-brief.js';
import { emptyMission, normalizeMission } from '../apps/finance/mission-alignment.js';
import { lensBlock } from '../apps/finance/council-report-pages.js';
import { resolveFinancePage, FINANCE_PARITY_SECTIONS } from '../apps/finance/parity-manifest.js';

const line = (category, n, classification = 'Expenses', base = null) => ({ category, name: category.split(':').pop(), classification, baseBudgetCents: base, plan: { plannedAmountCents: n } });
const builder = {
  targetYear: 2027, baseYear: 2026,
  lines: [
    line('Income:40085 Sunday Offering', 44000000, 'Income'), line('Income:42006 Endowment', 6000000, 'Income'), line('Income:MDO Tuition', 30000000, 'Income'),
    line('Expenses:Hospitality', 400000), line('Expenses:Worship', 2000000), line('Expenses:Capital Improvements', 0, 'Expenses', 2500000),
    line('Expenses:Utilities', 3000000), line('Expenses:Salary', 30000000), line('Expenses:Benefits', 6000000), line('Expenses:MDO Wages', 10000000),
  ],
};
const data = () => ({
  ...emptyMission(), revision: 4,
  lines: { 'Expenses:Hospitality': { method: 'one', shares: [10000, 0, 0, 0], note: '' }, 'Expenses:Worship': { method: 'one', shares: [0, 10000, 0, 0], note: '' }, 'Expenses:Utilities': { method: 'spread', shares: [0, 0, 0, 0], note: '' }, 'Expenses:MDO Wages': { method: 'split', shares: [7000, 0, 0, 3000], note: '' } },
  benefitLines: ['Expenses:Benefits'],
  staff: [{ id: 'p', label: 'Pastor', hours: 5000, sources: ['Expenses:Salary'], mode: 'percent', alloc: { lines: { 'Expenses:Worship': 6000 }, admin: 2000, ends: [0, 0, 2000, 0] }, week: [], reviewed: true }],
});
const giving = { given_ytd_cents: 28892200, given_ytd_prior_cents: 32380300, annual_budget_cents: 42500000, projection_cents: 40500000, households: 116, households_prior: 123, has_budget: true,
  concentration: { top10_pct: 37, half_households: 16 }, monthly: { current: new Array(12).fill(3000000), prior: new Array(12).fill(3200000) } };
const lay = { money: { freeCents: 24417600, designatedCents: 9000000, endowmentCents: 22347500 }, own: { cashCents: 5478100, investmentsCents: 60327900 }, owe: { shortTermCents: 1337600 }, investmentGroups: [{ label: 'Endowment funds', cents: 22347500 }], property: { mortgageCents: 29519500, bookCents: 90000000 } };

describe('council brief', () => {
  it('answers the four questions from live figures', () => {
    const m = briefModel({ builder, data: data(), giving, lay, now: new Date('2026-11-17T12:00:00Z') });
    expect(m.q1.income).toBe(80000000);
    expect(m.q1.expenses).toBe(51400000);
    expect(m.q1.offering.category).toBe('Income:40085 Sunday Offering');
    expect(m.q1.givingGap).toBe(-3500000);
    expect(m.q1.netIfHolds).toBe(m.q1.netProposed - 3500000);
    expect(m.q2.months).toBeCloseTo(24417600 / (51400000 / 12), 5);
    expect(m.q2.cashAfter).toBe(5478100 - 1337600 - 9000000);
    expect(m.q3.compPct).toBeCloseTo((36000000 / 51400000) * 100, 5);
    expect(m.q3.status).toBe('concern'); // 70% of expenses is over the 40% cap
    expect(m.q4.status).toBe('watch');
  });
  it('never counts giving above the plan, and says when evidence is missing', () => {
    const m = briefModel({ builder, data: data(), giving: { ...giving, projection_cents: 50000000 }, lay: null });
    expect(m.q1.netIfHolds).toBe(m.q1.netProposed);
    const html = renderCouncilBriefPage({ builder, data: data(), giving: null, lay: null });
    expect(html).toContain('balance sheet could not be read');
    expect(html).toContain('giving report could not be read');
  });
  it('renders the brief with decisions and admin-only settings, and no one’s pay', () => {
    const board = { year: 2026, prior_year: 2025, through_month: 10, through_label: 'Through October 31, 2026', categories: { general: giving } };
    const html = renderCouncilBriefPage({ builder, data: data(), giving: lensBlock(board, 'general'), givingData: board, lay, admin: true });
    expect(html).toContain('Will the budget work?');
    expect(html).toContain('Do we have a cushion?');
    expect(html).toContain('Decisions for the council');
    expect(html).toContain('Use of bequests');
    expect(html).toContain('name="action" value="brief"');
    expect(html).not.toContain('Pastor');
    const council = renderCouncilBriefPage({ builder, data: data(), giving: null, lay, admin: false });
    expect(council).not.toContain('Save settings');
  });
  it('saves settings and validates them', () => {
    const form = { reserve_months: '3', cap: '40', target_welcome: '25', target_receive: '30', target_grow: '25', target_go: '20', giving_line: 'Income:40085 Sunday Offering', due: '11-30', dec_topic_0: 'Balanced budget', dec_text_0: 'Decide.', dec_topic_1: '', dec_text_1: '' };
    const saved = applyBrief(data(), form, builder).data;
    expect(saved.brief).toMatchObject({ reserveMonths: 3, capBp: 4000, targets: [2500, 3000, 2500, 2000], decisions: [{ topic: 'Balanced budget', text: 'Decide.' }] });
    expect(normalizeMission(saved).brief.targets).toEqual([2500, 3000, 2500, 2000]);
    expect(() => applyBrief(data(), { ...form, target_go: '30' }, builder)).toThrow(/exactly 100/);
    expect(() => applyBrief(data(), { ...form, giving_line: 'Expenses:Worship' }, builder)).toThrow(/income line/);
    expect(() => applyBrief(data(), { ...form, reserve_months: '0' }, builder)).toThrow(/1 to 12/);
    expect(offeringLine(builder, briefFrom({ givingLine: 'Income:42006 Endowment' })).category).toBe('Income:42006 Endowment');
  });
  it('checks the Policy Manual', () => {
    const m = briefModel({ builder, data: data(), giving, lay, now: new Date('2026-11-17T12:00:00Z') });
    const rows = policyChecks(m);
    expect(rows.find((r) => r.ref === '§3.1').result).toBe('13 days left');
    expect(rows.find((r) => r.ref === '§3.5').status).toBe('watch'); // capital line unfunded
    expect(rows.find((r) => r.ref === '§3.4').detail.map(([n]) => n)).toContain('MDO Wages');
    expect(rows.find((r) => r.ref === '§3.4').detail.map(([n]) => n)).not.toContain('Salary');
    const html = renderPolicyChecklistPage({ builder, data: data(), giving, lay, now: new Date('2026-11-17T12:00:00Z') });
    expect(html).toContain('Policy checklist');
    expect(html).toContain('Operating reserve');
  });
  it('registers the budget pages, including District support', () => {
    const planning = FINANCE_PARITY_SECTIONS.find((s) => s.id === 'planning');
    for (const id of ['brief', 'policy', 'district']) expect(resolveFinancePage(planning, id).id).toBe(id);
  });
});

describe('reserves and giving scenarios', async () => {
  const { reservesModel, renderReservesPage, givingScenarios, renderGivingScenariosPage, whatIfNumber } = await import('../apps/finance/council-reserves.js');
  const fullLay = { ...lay, own: { ...lay.own, totalCents: 160000000 }, owe: { ...lay.owe, totalCents: 30857100 } };
  it('walks free funds through the plan and the what-ifs', () => {
    const r = reservesModel({ builder, data: data(), giving, lay: fullLay, params: new URLSearchParams('q4=-10000&mdo_short=10&mdo_offset=50&one_time=5000') });
    const m = r.m;
    // MDO tuition $300,000: 10% short = $30,000, half offset = $15,000 net.
    expect(r.steps.find((s) => /tuition/.test(s.label)).cents).toBe(-1500000);
    expect(r.end).toBe(m.q2.free - 1000000 + m.q1.netProposed - 3500000 - 1500000 - 500000);
    expect(r.measures[2].church).toBeGreaterThan(r.measures[2].all);
    const html = renderReservesPage({ builder, data: data(), giving, lay: fullLay, params: new URLSearchParams() });
    expect(html).toContain('What we really have');
    expect(html).toContain('Reserve coverage');
    expect(html).toContain('Debt ÷ total assets');
    expect(renderReservesPage({ builder, data: data(), lay: null })).toContain('balance sheet could not be read');
  });
  it('tests the offering line against this year’s giving', () => {
    const s = givingScenarios({ builder, data: data(), giving, lay, params: new URLSearchParams('pct=5&gift=1000') });
    const proj = s.rows.find((r) => r.key === 'projection');
    expect(proj.offering).toBe(40500000 + 100000);
    expect(proj.net).toBe(s.m.q1.netProposed + proj.offering - 44000000);
    expect(s.rows.find((r) => r.key === 'yours').offering).toBe(Math.round(40600000 * 1.05));
    expect(s.rows.find((r) => r.key === 'pattern').offering).toBe(Math.round(28892200 / (32380300 / 38400000)) + 100000);
    const html = renderGivingScenariosPage({ builder, data: data(), giving, givingData: { through_label: 'Through October 31, 2026' }, lay });
    expect(html).toContain('What if giving closes this year here');
    expect(html).toContain('Giving health');
    expect(renderGivingScenariosPage({ builder, data: data(), giving: null, lay })).toContain('giving report could not be read');
    expect(whatIfNumber('abc')).toBe(0);
    expect(whatIfNumber('$1,250.50')).toBe(1250.5);
  });
});
