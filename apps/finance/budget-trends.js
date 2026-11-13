// Budget › Trends: how the budget has changed since a starting year (2022 by default), for the
// whole budget and for each board category and line. Completed years are QuickBooks actuals from
// connect.finance-chart-of-accounts.v1 (one read per year); the base year is the Budget planner's
// projection for it and the target year is the proposed plan (connect.finance-budget-builder.v1).
// Aggregate account totals only; nothing is stored.
import { escapeHtml as e } from './render-helpers.js';
import { fetchLiveFinanceChartOfAccounts } from './finance-chart-of-accounts-client.js';
import { CHART_REVENUE_CLASSIFICATIONS } from '../../contracts/validators/finance-chart-of-accounts-consumer.js';
import { accountDisplayName, boardCategoryFor, boardLabelFor, normalizeBoardLayout, BOARD_EXPENSE_ORDER, BOARD_REVENUE_ORDER } from './board-layout.js';
import { renderColumnChart, renderLineChart } from './property-charts.js';
import { missionChips, money, pageHref, sum } from './mission-ui.js';

export const TREND_FIRST_YEAR = 2022;
const CATEGORY_COLORS = ['#386781', '#C9973A', '#5FB57E', '#9B7FD4', '#E8705F', '#2E7EA6', '#8A611C', '#7A8B99', '#C2577F', '#4C9A8A', '#B5412F', '#6B5CA5'];

export function trendStartYear(params, target) {
  const s = Number(params?.get('since'));
  return Number.isInteger(s) && s >= 2015 && s < target ? s : Math.min(TREND_FIRST_YEAR, target - 1);
}

// Reads every completed year from `start` up to (not including) the base year. Never throws: a year
// that cannot be read is listed as missing.
export async function loadTrendYears(env, start, base) {
  const years = [];
  for (let y = start; y < base; y += 1) years.push(y);
  const reads = await Promise.all(years.map((y) => fetchLiveFinanceChartOfAccounts(env, y).catch(() => ({ ok: false }))));
  return years.map((year, i) => {
    const r = reads[i];
    if (!r?.ok || r.chartOfAccounts.fiscalYear !== year) return { year, ok: false };
    return { year, ok: true, accounts: r.chartOfAccounts.accounts.filter((a) => Number.isInteger(a.actualCents)).map((a) => ({ path: a.categoryPath, name: a.displayName || a.accountName, isRevenue: CHART_REVENUE_CLASSIFICATIONS.has(a.classification), actual: a.actualCents, budget: Number.isInteger(a.budgetCents) ? a.budgetCents : null })) };
  });
}

// One model for the page, the congregation slide and the tests: per year, kind ('actual',
// 'projected', 'proposed'), revenue and expense totals; per category and per line, a value per year.
export function buildTrendModel({ builder, years, layout = null }) {
  const lay = layout || normalizeBoardLayout(null);
  const columns = [
    ...years.map((y) => ({ year: y.year, kind: 'actual', ok: y.ok })),
    { year: builder.baseYear, kind: 'projected', ok: true },
    { year: builder.targetYear, kind: 'proposed', ok: true },
  ];
  const lines = new Map();
  const touch = (path, name, isRevenue) => {
    if (!lines.has(path)) lines.set(path, { path, name, isRevenue, values: columns.map(() => null), budgets: columns.map(() => null) });
    return lines.get(path);
  };
  years.forEach((y, ci) => {
    if (!y.ok) return;
    for (const a of y.accounts) {
      const l = touch(a.path, a.name, a.isRevenue);
      l.values[ci] = (l.values[ci] || 0) + a.actual;
      if (a.budget != null) l.budgets[ci] = (l.budgets[ci] || 0) + a.budget;
    }
  });
  const bi = years.length;
  for (const bl of builder.lines) {
    const l = touch(bl.category, bl.name || bl.category, bl.classification === 'Income');
    if (bl.projectedCents != null || bl.baseActualCents != null) l.values[bi] = bl.projectedCents ?? bl.baseActualCents;
    if (bl.baseBudgetCents != null) l.budgets[bi] = bl.baseBudgetCents;
    if (bl.plan) l.values[bi + 1] = bl.plan.plannedAmountCents || 0;
  }
  const all = [...lines.values()].filter((l) => l.values.some((v) => v));
  const totalsFor = (list) => columns.map((c, i) => (c.ok ? sum(list.map((l) => l.values[i] || 0)) : null));
  const groups = (isRevenue) => {
    const order = isRevenue ? BOARD_REVENUE_ORDER : (lay.expenseOrder || BOARD_EXPENSE_ORDER);
    const byKey = new Map();
    for (const l of all.filter((x) => x.isRevenue === isRevenue)) {
      const { key } = boardCategoryFor(lay, l.path, l.name, isRevenue);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(l);
    }
    const keys = [...order.filter((k) => byKey.has(k)), ...[...byKey.keys()].filter((k) => !order.includes(k))];
    return keys.map((key) => {
      const members = byKey.get(key).map((l) => ({ ...l, label: accountDisplayName(lay, l.path, l.name) })).sort((a, b) => Math.abs(b.values.at(-1) || 0) - Math.abs(a.values.at(-1) || 0));
      return { key, label: boardLabelFor(lay, key, isRevenue), lines: members, values: totalsFor(members) };
    });
  };
  const revenue = groups(true);
  const expense = groups(false);
  return {
    columns, revenue, expense,
    revenueTotals: totalsFor(all.filter((l) => l.isRevenue)),
    expenseTotals: totalsFor(all.filter((l) => !l.isRevenue)),
    missingYears: columns.filter((c) => !c.ok).map((c) => c.year),
  };
}

export const columnLabel = (c) => (c.kind === 'actual' ? `${c.year}` : c.kind === 'projected' ? `${c.year} projected` : `${c.year} proposed`);
const shortLabel = (c) => (c.kind === 'actual' ? `${c.year}` : c.kind === 'projected' ? `${c.year} proj.` : `${c.year} plan`);

// Change from the first year with a figure to the proposed year, in dollars, percent and per year.
export function change(values) {
  const firstIndex = values.findIndex((v) => typeof v === 'number' && v !== 0);
  const last = values.at(-1);
  if (firstIndex < 0 || typeof last !== 'number' || firstIndex === values.length - 1) return null;
  const first = values[firstIndex];
  const span = values.length - 1 - firstIndex;
  const pct = ((last - first) / Math.abs(first)) * 100;
  const yearly = first > 0 && last > 0 ? ((last / first) ** (1 / span) - 1) * 100 : null;
  return { first, last, cents: last - first, pct, yearly, span, firstIndex };
}
const changeText = (c, { expense = true } = {}) => {
  if (!c) return '<span class="ma-muted">—</span>';
  const up = c.cents > 0;
  const cls = c.cents === 0 ? '' : (up === expense ? 'tr-up' : 'tr-down');
  return `<span class="${cls}">${up ? '+' : c.cents < 0 ? '−' : ''}${money(Math.abs(c.cents))} · ${c.pct >= 0 ? '+' : '−'}${Math.abs(c.pct).toFixed(0)}%</span>`;
};

export function sparkline(values, color = '#386781') {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => typeof v === 'number');
  if (pts.length < 2) return '';
  const w = 96; const h = 24;
  const vs = pts.map(([, v]) => v);
  const lo = Math.min(...vs); const hi = Math.max(...vs);
  const x = (i) => 2 + (i / Math.max(1, values.length - 1)) * (w - 4);
  const y = (v) => (hi === lo ? h / 2 : 2 + ((hi - v) / (hi - lo)) * (h - 4));
  const path = pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const [li, lv] = pts.at(-1);
  return `<svg class="tr-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${path}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${x(li).toFixed(1)}" cy="${y(lv).toFixed(1)}" r="2.4" fill="${color}"/></svg>`;
}

// Whole budget: income and expenses each year, actual through the last closed year, then the
// projection and the proposed plan (dashed).
export function wholeChart(model, { title = 'Income and expenses by year' } = {}) {
  const rows = model.columns.map((c, i) => ({ label: shortLabel(c), values: [model.revenueTotals[i], model.expenseTotals[i]] }));
  return renderColumnChart({ title, caption: 'Actual for closed years; the current year is projected and next year is the proposed budget.', series: [{ label: 'Income', color: '#2E7EA6' }, { label: 'Expenses', color: '#C9973A' }], rows, height: 240 });
}

function mixChart(groups, columns, title) {
  const series = groups.slice(0, CATEGORY_COLORS.length).map((g, i) => ({ label: g.label, color: CATEGORY_COLORS[i], dashed: false }));
  const rows = columns.map((c, ci) => ({ label: shortLabel(c), values: groups.slice(0, CATEGORY_COLORS.length).map((g) => g.values[ci]) }));
  return renderLineChart({ title, caption: 'Each line is one board category, so you can see which parts of the budget have grown.', series, rows, height: 260 });
}

function categoryTable(groups, columns, { expense, showLines, label }) {
  const head = `<tr><th scope="col">${label}</th>${columns.map((c) => `<th scope="col" class="num${c.kind === 'proposed' ? ' tr-proposed' : ''}">${columnLabel(c)}</th>`).join('')}<th scope="col">Trend</th><th scope="col" class="num">Change since ${columns.find((c) => c.ok).year}</th></tr>`;
  const cells = (values) => values.map((v, i) => `<td class="num${columns[i].kind === 'proposed' ? ' tr-proposed' : ''}">${columns[i].ok ? money(v || 0) : '<span class="ma-muted">n/a</span>'}</td>`).join('');
  const body = groups.map((g, gi) => `<tr class="tr-cat"><td>${e(g.label)}</td>${cells(g.values)}<td>${sparkline(g.values, CATEGORY_COLORS[gi % CATEGORY_COLORS.length])}</td><td class="num">${changeText(change(g.values), { expense })}</td></tr>
    ${showLines ? g.lines.map((l) => `<tr class="tr-line"><td>${e(l.label)}</td>${cells(l.values)}<td>${sparkline(l.values, '#7A8B99')}</td><td class="num">${changeText(change(l.values), { expense })}</td></tr>`).join('') : ''}`).join('');
  return `<div class="ma-frame"><table class="ma-table tr-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

export function trendHeadline(model) {
  const exp = change(model.expenseTotals);
  const rev = change(model.revenueTotals);
  const bits = [];
  if (exp) bits.push(`Expenses ${exp.cents >= 0 ? 'grow' : 'fall'} from ${money(exp.first)} in ${columnLabel(model.columns[exp.firstIndex])} to ${money(exp.last)} proposed for ${model.columns.at(-1).year} (${exp.pct >= 0 ? '+' : '−'}${Math.abs(exp.pct).toFixed(0)}%${exp.yearly != null ? `, about ${exp.yearly.toFixed(1)}% a year` : ''}).`);
  if (rev) bits.push(`Income ${rev.cents >= 0 ? 'grows' : 'falls'} from ${money(rev.first)} to ${money(rev.last)} (${rev.pct >= 0 ? '+' : '−'}${Math.abs(rev.pct).toFixed(0)}%${rev.yearly != null ? `, about ${rev.yearly.toFixed(1)}% a year` : ''}).`);
  return bits.join(' ');
}

export function renderTrendsPage({ builder, model, params, admin = false }) {
  const target = builder.targetYear;
  const start = model.columns[0].year;
  const showLines = params?.get('lines') === '1';
  const since = [];
  for (let y = Math.min(2019, start); y < builder.baseYear; y += 1) since.push(y);
  const controls = `<form method="GET" action="/" class="ma-year"><input type="hidden" name="section" value="planning"><input type="hidden" name="page" value="trends"><input type="hidden" name="target" value="${target}">
    <label class="field"><span>Since</span><select name="since">${since.map((y) => `<option value="${y}"${y === start ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
    <label class="ma-radio" style="align-self:center"><input type="checkbox" name="lines" value="1"${showLines ? ' checked' : ''}><span>Show each line</span></label>
    <button type="submit" class="button-outline">Show</button></form>`;
  const missing = model.missingYears.length ? `<p class="status status-error">QuickBooks figures for ${model.missingYears.join(', ')} could not be read just now, so ${model.missingYears.length === 1 ? 'that year is' : 'those years are'} left out of the totals. Reload to try again.</p>` : '';
  const rows = model.columns.map((c, i) => {
    const r = model.revenueTotals[i]; const x = model.expenseTotals[i];
    const prev = i > 0 ? model.expenseTotals[i - 1] : null;
    const grow = prev && x != null ? ((x - prev) / Math.abs(prev)) * 100 : null;
    return `<tr${c.kind === 'proposed' ? ' class="tr-proposed"' : ''}><td>${columnLabel(c)}</td><td class="num">${r == null ? 'n/a' : money(r)}</td><td class="num">${x == null ? 'n/a' : money(x)}</td><td class="num">${r == null || x == null ? 'n/a' : money(r - x)}</td><td class="num">${grow == null ? '—' : `${grow >= 0 ? '+' : '−'}${Math.abs(grow).toFixed(1)}%`}</td></tr>`;
  }).join('');
  return `${missionChips('trends', target, { admin })}
    <div class="ma-head"><div><span class="ma-eyebrow">Budget · Trends</span><h2>How the budget has changed since ${start}</h2><p class="ma-sub">${e(trendHeadline(model))}</p></div>${controls}</div>
    ${missing}
    <section class="ma-section"><div class="ma-section-head"><h2>The whole budget</h2><a href="${pageHref('congregation', target)}">Use on the congregation slides →</a></div>
      ${wholeChart(model)}
      <div class="ma-frame"><table class="ma-table tr-table"><thead><tr><th scope="col">Year</th><th scope="col" class="num">Income</th><th scope="col" class="num">Expenses</th><th scope="col" class="num">Net</th><th scope="col" class="num">Expense change from the year before</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>
    <section class="ma-section"><div class="ma-section-head"><h2>Expenses by category${showLines ? ' and line' : ''}</h2></div>
      ${mixChart(model.expense, model.columns, 'Expenses by board category')}
      ${categoryTable(model.expense, model.columns, { expense: true, showLines, label: 'Category' })}
    </section>
    <section class="ma-section"><div class="ma-section-head"><h2>Income by category${showLines ? ' and line' : ''}</h2></div>
      ${categoryTable(model.revenue, model.columns, { expense: false, showLines, label: 'Category' })}
    </section>
    <p class="ma-note">Closed years are QuickBooks actuals as Finance reads them today. The ${builder.baseYear} figures are the Budget planner’s projection for the full year, and ${target} is the proposed plan. A line that was renamed or moved in QuickBooks appears under each name it used.</p>`;
}
