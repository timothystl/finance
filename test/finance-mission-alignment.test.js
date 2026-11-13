import { describe, it, expect } from 'vitest';
import { apportion, parseMission, missionModel, saveMission, renderMission, canManageMission } from '../apps/finance/mission-alignment.js';
const line = (category, n) => ({ category, name: category, classification: 'Expenses', plan: { plannedAmountCents: n } });
const builder = { targetYear: 2027, baseYear: 2026, lines: [line('Hospitality', 400000), line('Worship', 600000), line('Salary', 8000000), line('Benefits', 2000000), { ...line('Giving', 50000000), classification: 'Income' }] };
const state = () => ({ revision: 1, lines: { Hospitality: [10000, 0, 0, 0], Worship: [0, 10000, 0, 0] }, staff: [{ id: 'p', label: 'Pastor', sources: ['Salary', 'Benefits'], allocations: { Hospitality: 100, Worship: 9900 } }] });
function formFor(data) {
  const form = { revision: String(data.revision), target: '2027', base: '2026' };
  builder.lines.slice(0, 4).forEach((l, i) => {
    form[`category_${i}`] = l.category;
    ['welcome', 'receive', 'grow', 'go'].forEach((g, j) => { form[`goal_${i}_${g}`] = String((data.lines[l.category]?.[j] || 0) / 100); });
    data.staff.forEach((s, si) => {
      form[`label_${si}`] = s.label;
      form[`staff_${si}_${i}`] = String((s.allocations[l.category] || 0) / 100);
      if (s.sources.includes(l.category)) form[`source_${si}_${i}`] = 'yes';
    });
  });
  return form;
}
describe('mission and staff allocation', () => {
  it('attributes 1% of salary AND benefits to hospitality without adding payroll twice or counting income', () => {
    const m = missionModel(builder, state());
    expect(m.rows[0]).toMatchObject({ direct: 400000, staffCost: 100000, combined: 500000 });
    expect(m.totals).toEqual([500000, 10500000, 0, 0]);
    expect(m.total).toBe(11000000);
    expect(m.totals.reduce((a,b) => a+b, 0) + m.unallocated).toBe(m.total);
  });
  it('keeps unassigned staff time and unsplit expenses visible', () => {
    const data = state(); data.staff[0].allocations = { Hospitality: 100 }; data.lines = {};
    const m = missionModel(builder, data);
    expect(m.staff[0].remaining).toBe(9900);
    expect(m.unallocated).toBe(m.total);
  });
  it('conserves positive and negative cents through rounding', () => {
    for (const value of [1, 2, 101, -1, -101]) expect(apportion(value, [3333,3333,3334]).reduce((a,b) => a+b, 0)).toBe(value);
    const data = state(); data.lines.Hospitality = [5000, 5000, 0, 0];
    const m = missionModel(builder, data);
    expect(m.totals[0]).toBe(250000);
  });
  it('rejects excess, negative and nonfinite percentages and staff time on a compensation line', () => {
    const data = state();
    for (const value of ['-1', 'NaN', 'Infinity', '100.01']) {
      expect(() => parseMission({ ...formFor(data), staff_0_0: value }, data, builder)).toThrow();
    }
    expect(() => parseMission({ ...formFor(data), staff_0_0: '2' }, data, builder)).toThrow(/exceeds/);
    expect(() => parseMission({ ...formFor(data), staff_0_1: '98', staff_0_2: '1' }, data, builder)).toThrow(/compensation/);
    expect(() => parseMission({ ...formFor(data), goal_0_go: '1' }, data, builder)).toThrow(/exceed/);
  });
  it('rejects duplicated compensation sources across roles and changed category order', () => {
    const data = state(); data.staff.push({ ...data.staff[0], id: 'q', label: 'Other' });
    expect(() => parseMission(formFor(data), data, builder)).toThrow(/only one/);
    expect(() => parseMission({ ...formFor(state()), category_0: 'Other' }, state(), builder)).toThrow(/changed/);
  });
  it('keeps yearly saves revision checked and atomically rejects concurrent writes', async () => {
    const data = state(); const stored = JSON.stringify(data);
    const db = { prepare: () => ({ bind: () => ({ first: async () => ({ value: stored }), run: async () => ({ meta: { changes: 0 } }) }) }) };
    await expect(saveMission(db, { ...formFor(data), revision: '0' }, 'admin', builder)).rejects.toThrow(/Someone else/);
    await expect(saveMission(db, formFor(data), 'admin', builder)).rejects.toThrow(/Someone else/);
  });
  it('removes allocation without removing budget lines, and adds a blank staff role', () => {
    const data = state(); const next = parseMission({ ...formFor(data), remove_0: 'yes', new_staff_label: 'Organist' }, data, builder);
    expect(next.staff).toHaveLength(1); expect(next.staff[0].label).toBe('Organist');
    expect(missionModel(builder, next).total).toBe(11000000);
  });
  it('restricts shared staff detail to admins and escapes user content', () => {
    expect(canManageMission({ ok: true, role: 'council', permissions: { budget: 'edit' } })).toBe(false);
    expect(canManageMission({ ok: true, role: 'finance' })).toBe(false);
    expect(canManageMission({ ok: true, role: 'admin' })).toBe(true);
    const data = state(); data.staff[0].label = '<script>x</script>';
    const html = renderMission({ builder, data });
    expect(html).not.toContain('<script>x'); expect(html).toContain('&lt;script&gt;');
  });
});

// The actual Worker boundary must reject council editors and cross-site forms before writes.
import worker from '../apps/finance/shell.js';
describe('mission write authorization', () => {
  const request = (headers = {}) => new Request('https://finance.example/api/v1/planning/mission-save', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cf-Access-Jwt-Assertion': 'test', ...headers }, body: 'target=2027&base=2026&revision=0' });
  const envFor = (role) => ({ ENVIRONMENT: 'staging', FINANCE_CONTRACT_API_KEY: 'test', FINANCE_DB: { prepare: () => { throw new Error('Database should not be touched'); } }, CONNECT_SERVICE: { fetch: async () => new Response(JSON.stringify({ role, username: 'test', permissions: { finance: 'edit', budget: 'edit' } })) } });
  it('refuses a council member with budget edit permission', async () => {
    const response = await worker.fetch(request(), envFor('council'));
    expect(response.status).toBe(303); expect(response.headers.get('Location')).toContain('access_denied');
  });
  it('refuses cross-site posts even for admins', async () => {
    const response = await worker.fetch(request({ Origin: 'https://elsewhere.example' }), envFor('admin'));
    expect(response.headers.get('Location')).toContain('cross_site');
  });
});
