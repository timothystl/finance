// Budget › Reserves and Giving scenarios: the council dashboard's reserve and giving views, from
// live figures only. Reserves starts from the balance sheet's lay position (the same figures as
// Balance Sheet › Position and the Council brief) and walks it through the budget year's plan and
// any what-ifs typed into the page; Giving scenarios tests the plan's offering line against this
// year's giving (the giving report's general fund view, totals only). The what-if inputs are a GET
// form: nothing on these pages is saved, and the settings they share (reserve target, offering
// line) are the Council brief's.
import { escapeHtml as e } from './render-helpers.js';
import { normalizeBoardLayout } from './board-layout.js';
import { missionChips, money, pageHref, sum, yearPicker } from './mission-ui.js';
import { splitOutMdo } from './mission-visuals.js';
import { briefModel } from './council-brief.js';
import { monthChart } from './council-report-pages.js';

const plan = (l) => l?.plan?.plannedAmountCents || 0;
const months1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const signed = (c) => (c > 0 ? `+${money(c)}` : money(c));
const neg = (c) => (c < 0 ? ' class="cb-neg"' : '');

// A dollar or percent typed into a what-if box: blank is 0; anything else must be a plain number.
export function whatIfNumber(raw, { min = -1e9, max = 1e9 } = {}) {
  const v = String(raw ?? '').replace(/[$,%\s]/g, '');
  if (v === '' || !/^-?\d{1,9}(\.\d{1,2})?$/.test(v)) return 0;
  return Math.min(max, Math.max(min, Number(v)));
}
export function whatIfParams(params) {
  const g = (k, o) => whatIfNumber(params?.get(k), o);
  return {
    q4: Math.round(g('q4') * 100), mdoShort: g('mdo_short', { min: 0, max: 100 }), mdoOffset: g('mdo_offset', { min: 0, max: 100 }),
    oneTime: Math.round(g('one_time', { min: 0 }) * 100), gift: Math.round(g('gift') * 100),
    pct: params?.has('pct') && params.get('pct') !== '' ? g('pct', { min: -50, max: 50 }) : 3,
  };
}

function head(page, title, sub, builder, admin, now) {
  return `<div class="ma-noprint">${missionChips(page, builder.targetYear, { admin })}</div>
    <div class="ma-head"><div><span class="ma-eyebrow">Budget · Council</span><h2>${title}</h2><p class="ma-sub">${sub}</p></div><div class="ma-noprint">${yearPicker(page, builder.targetYear, now)}</div></div>`;
}
function kpi(value, label, sub, tone = '') {
  return `<div><b${tone ? ` class="cb-${tone}"` : ''}>${value}</b><span>${label}</span>${sub ? `<span>${sub}</span>` : ''}</div>`;
}
const tone = (months, target) => (months >= target ? 'pos' : 'neg');
function waterfall(rows) {
  let run = 0;
  const pts = rows.map((r) => {
    if (r.total) { run = r.cents; return { ...r, lo: Math.min(0, r.cents), hi: Math.max(0, r.cents) }; }
    const a = run; run += r.cents; return { ...r, lo: Math.min(a, run), hi: Math.max(a, run) };
  });
  const lo = Math.min(0, ...pts.map((p) => p.lo));
  const hi = Math.max(0, ...pts.map((p) => p.hi));
  const range = Math.max(1, hi - lo);
  const at = (v) => (((v - lo) / range) * 100).toFixed(1);
  return `<table class="cb-bars"><tbody>${pts.map((p) => `<tr><td>${p.total ? `<b>${p.label}</b>` : p.label}</td><td class="num"><b${neg(p.cents)}>${p.total ? money(p.cents) : signed(p.cents)}</b></td><td class="cb-track"><span style="left:${at(p.lo)}%;width:${Math.max(0.5, ((p.hi - p.lo) / range) * 100).toFixed(1)}%;background:${p.total ? (p.cents < 0 ? '#B5412F' : '#1F3B2E') : p.cents >= 0 ? '#7AA38A' : '#C2452D'}"></span>${lo < 0 ? `<i style="left:${at(0)}%;background:#8A93A5"></i>` : ''}</td></tr>`).join('')}</tbody></table>`;
}

// ── Reserves ─────────────────────────────────────────────────────────────────────────────────

export function reservesModel({ builder, data, layout = null, giving = null, lay, balanceAsOf = null, params = null, now = new Date() }) {
  const m = briefModel({ builder, data, layout, giving, lay, balanceAsOf, now });
  const w = whatIfParams(params);
  const { mdoCost } = splitOutMdo(builder, layout || normalizeBoardLayout(null));
  const tuition = sum(builder.lines.filter((l) => l.classification === 'Income' && /tuition|mdo|mother/i.test(`${l.category} ${l.name || ''}`)).map(plan));
  const monthlyAll = m.expenses / 12;
  const monthlyChurch = (m.expenses - mdoCost) / 12;
  const mdoLoss = Math.round((tuition * w.mdoShort) / 100);
  const mdoCut = Math.round((mdoLoss * w.mdoOffset) / 100);
  const givingBelow = m.q1.netIfHolds != null ? m.q1.netIfHolds - m.q1.netProposed : 0;
  const steps = [
    { label: 'Free for the council today', cents: m.q2.free, total: true },
    { label: `Rest of FY${builder.targetYear - 1} (your estimate)`, cents: w.q4 },
    { label: `FY${builder.targetYear} planned net`, cents: m.q1.netProposed },
    { label: 'Giving below plan, if this year’s pace holds', cents: givingBelow },
    { label: 'Mother’s Day Out tuition shortfall, net of cuts', cents: -(mdoLoss - mdoCut) },
    { label: 'One-time use of funds', cents: -w.oneTime },
  ];
  const end = sum(steps.map((s) => s.cents));
  steps.push({ label: `Projected end of FY${builder.targetYear}`, cents: end, total: true });
  const months = (c, per) => (per ? c / per : 0);
  const measures = [
    { label: 'Cash after bills &amp; designated funds', cents: m.q2.cashAfter },
    { label: 'Bank accounts only', cents: m.q2.cash },
    { label: 'Free for the council', cents: m.q2.free },
    { label: `Projected end of FY${builder.targetYear}`, cents: end },
  ].map((r) => ({ ...r, all: months(r.cents, monthlyAll), church: months(r.cents, monthlyChurch) }));
  const debt = lay.owe.totalCents ?? (lay.owe.shortTermCents + (lay.property?.mortgageCents || 0));
  const assets = lay.own.totalCents ?? null;
  return { m, w, steps, end, measures, monthlyAll, monthlyChurch, mdoCost, tuition, debt, assets, target: m.brief.reserveMonths };
}

export function renderReservesPage({ builder, data, layout = null, giving = null, lay = null, balanceAsOf = null, params = null, admin = false, now = new Date() }) {
  const top = head('reserves', 'Reserves &amp; balance sheet', `What we really have, how it compares with policy, and what the FY${builder.targetYear} plan does to it`, builder, admin, now);
  if (!data) return `${top}<p class="status status-error">Mission alignment could not be read. Reload to try again.</p>`;
  if (!lay) return `${top}<p class="cb-missing">The balance sheet could not be read from QuickBooks just now, so reserves cannot be measured. <a href="/?section=balance&amp;page=position">Open the balance sheet</a>.</p>`;
  const r = reservesModel({ builder, data, layout, giving, lay, balanceAsOf, params, now });
  const { m, w, target } = r;
  const q2 = m.q2;
  const composition = [{ label: 'Bank accounts', cents: q2.cash, color: '#2E8C87' }, ...(q2.investmentGroups || []).map((g, i) => ({ label: g.label, cents: g.cents, color: ['#8FA4CC', '#5B3A8C', '#B9A3E3', '#C9973A'][i % 4] }))];
  const compTotal = sum(composition.map((c) => Math.max(0, c.cents))) || 1;
  const debtShare = r.assets ? (r.debt / r.assets) * 100 : null;
  const kpis = `<div class="cb-kpis">
    ${kpi(money(q2.free), 'Free for the council', `as of ${e(q2.asOf || 'the latest import')}`, q2.free >= 0 ? '' : 'neg')}
    ${kpi(money(q2.cashAfter), 'Cash after bills &amp; designated funds', 'bank accounts less what is owed or set aside', q2.cashAfter < 0 ? 'neg' : '')}
    ${kpi(`${months1(r.measures[2].all)} months`, 'Free funds, all expenses', `target ${target}`, tone(r.measures[2].all, target))}
    ${kpi(`${months1(r.measures[2].church)} months`, 'Free funds, without Mother’s Day Out', `target ${target}`, tone(r.measures[2].church, target))}
    ${kpi(money(r.end), `Projected end of FY${builder.targetYear}`, `${months1(r.measures[3].all)} months (all expenses)`, tone(r.measures[3].all, target))}
    ${debtShare != null ? kpi(`${debtShare.toFixed(1)}%`, 'Debt ÷ total assets', 'including the mortgage') : ''}
  </div>`;
  const funnel = `<table class="ma-table"><thead><tr><th scope="col">From all our money to “free for the council”</th><th scope="col" class="num">Amount</th></tr></thead><tbody>
    <tr><td><b>Bank accounts and investments</b></td><td class="num"><b>${money(q2.cash + q2.investments)}</b></td></tr>
    <tr><td>Less bills, payroll and credit cards due</td><td class="num">${money(-q2.bills)}</td></tr>
    <tr><td>Less designated funds</td><td class="num">${money(-q2.designated)}</td></tr>
    <tr><td>Less the permanent endowment (never spent)</td><td class="num">${money(-q2.endowment)}</td></tr>
    <tr><td><b>Free for the council</b></td><td class="num"><b${neg(q2.free)}>${money(q2.free)}</b></td></tr></tbody></table>
    <p class="ma-note">${q2.cashAfter < 0 ? `<b class="cb-neg">Bank accounts are short by ${money(-q2.cashAfter)}</b> after paying bills and covering designated funds, so the council’s free money sits in investments. ` : ''}Unrestricted bequests counted here are one-time gifts, not an operating reserve: using them for everyday budget gaps spends the legacy.</p>`;
  const coverage = `<p class="ma-note">Target: ${target} months of planned expenses = ${money(r.monthlyAll * target)} (all expenses, ${money(r.monthlyAll)} a month) or ${money(r.monthlyChurch * target)} without Mother’s Day Out (${money(r.monthlyChurch)} a month).</p>
    <table class="ma-table"><thead><tr><th scope="col">Measure</th><th scope="col" class="num">Amount</th><th scope="col" class="num">Months (all)</th><th scope="col" class="num">Months (without MDO)</th></tr></thead><tbody>
    ${r.measures.map((x) => `<tr><td>${x.label}</td><td class="num"${neg(x.cents)}>${money(x.cents)}</td><td class="num"><b class="cb-${tone(x.all, target)}">${months1(x.all)}</b></td><td class="num"><b class="cb-${tone(x.church, target)}">${months1(x.church)}</b></td></tr>`).join('')}
    </tbody></table><p class="ma-note">Green meets the ${target}-month target; red falls short.</p>
    <p class="ma-note">${r.measures[2].all >= target ? `Free funds exceed the target by ${money(r.measures[2].cents - r.monthlyAll * target)} on an all-expense basis.` : `On an all-expense basis free funds are ${money(r.monthlyAll * target - r.measures[2].cents)} short of the target.`} ${r.measures[2].church >= target ? `Without Mother’s Day Out they exceed it by ${money(r.measures[2].cents - r.monthlyChurch * target)}.` : `Without Mother’s Day Out they are ${money(r.monthlyChurch * target - r.measures[2].cents)} short.`} Bank accounts alone cover about ${months1(r.measures[1].all)} months, the figure that matters for day-to-day cash flow.</p>`;
  const whatIf = `<form method="GET" action="/" class="cb-whatif ma-noprint"><input type="hidden" name="section" value="planning"><input type="hidden" name="page" value="reserves"><input type="hidden" name="target" value="${builder.targetYear}">
    <label class="field"><span>Rest of FY${builder.targetYear - 1}, net $</span><input name="q4" inputmode="decimal" value="${w.q4 ? w.q4 / 100 : ''}" placeholder="0"></label>
    <label class="field"><span>MDO tuition shortfall %</span><input name="mdo_short" inputmode="decimal" value="${w.mdoShort || ''}" placeholder="0"></label>
    <label class="field"><span>…offset by MDO cost cuts %</span><input name="mdo_offset" inputmode="decimal" value="${w.mdoOffset || ''}" placeholder="0"></label>
    <label class="field"><span>One-time use of funds $</span><input name="one_time" inputmode="decimal" value="${w.oneTime ? w.oneTime / 100 : ''}" placeholder="0"></label>
    <button type="submit" class="button-outline">Show</button></form>`;
  const property = `<table class="ma-table"><tbody>
    <tr><td>Mortgage left</td><td class="num"><b>${money(q2.mortgage)}</b></td></tr>
    <tr><td>Property at book value</td><td class="num">${money(q2.property)}</td></tr>
    <tr><td>Equity at book</td><td class="num">${money(q2.property - q2.mortgage)}</td></tr>
    ${q2.property ? `<tr><td>Mortgage ÷ property at book</td><td class="num">${((q2.mortgage / q2.property) * 100).toFixed(1)}%</td></tr>` : ''}
    </tbody></table><p class="ma-note">Book value is what was paid, less depreciation; the current valuation, payment schedule and what the property sends the church are on <a href="/?section=property">Commercial property</a>.</p>`;
  return `${top}${kpis}
    <div class="cb-two">
      <section class="ma-panel"><h3 style="margin:0">1 · What we really have</h3>
        <div class="ma-bar" style="height:22px;border-radius:6px" role="img" aria-label="${e(composition.map((c) => `${c.label} ${money(c.cents)}`).join(', '))}">${composition.map((c) => `<div class="ma-seg" style="width:${((Math.max(0, c.cents) / compTotal) * 100).toFixed(1)}%;background:${c.color}"></div>`).join('')}</div>
        <table class="ma-table"><tbody>${composition.map((c) => `<tr><td><span class="ma-dot" style="background:${c.color}"></span> ${e(c.label)}</td><td class="num">${money(c.cents)}</td><td class="num">${((Math.max(0, c.cents) / compTotal) * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table>
        ${funnel}<p class="ma-note"><a href="/?section=balance&amp;page=position">Show the accounts behind this</a></p></section>
      <section class="ma-panel"><h3 style="margin:0">2 · Reserve coverage (Policy §3.6)</h3>${coverage}</section>
    </div>
    <div class="cb-two">
      <section class="ma-panel"><h3 style="margin:0">3 · What the FY${builder.targetYear} plan does to reserves</h3>
        <p class="ma-note">Starts from today’s free funds, adds the plan’s net, the giving gap if this year’s pace holds, and any what-ifs below. Nothing here is saved.</p>
        ${waterfall(r.steps)}${whatIf}
        <p class="ma-note">That is <b class="cb-${tone(r.measures[3].all, target)}">${months1(r.measures[3].all)} months</b> of all-expense coverage (${months1(r.measures[3].church)} without Mother’s Day Out).${r.tuition ? ` Each 1% of Mother’s Day Out tuition is about ${money(r.tuition / 100)}.` : ''}</p></section>
      <section class="ma-panel"><h3 style="margin:0">4 · Debt &amp; property</h3>${property}</section>
    </div>`;
}

// ── Giving scenarios ─────────────────────────────────────────────────────────────────────────

export function givingScenarios({ builder, data, layout = null, giving, lay = null, balanceAsOf = null, params = null, now = new Date() }) {
  const m = briefModel({ builder, data, layout, giving, lay, balanceAsOf, now });
  const w = whatIfParams(params);
  const planOffering = m.q1.offeringPlan;
  const priorTotal = sum(giving?.monthly?.prior || []);
  const priorShare = priorTotal && giving?.given_ytd_prior_cents ? giving.given_ytd_prior_cents / priorTotal : 0;
  const rows = [{ key: 'plan', label: 'As proposed (budget line)', offering: planOffering }];
  if (giving?.projection_cents != null) rows.push({ key: 'projection', label: 'This year’s giving projection', offering: giving.projection_cents + w.gift, focus: true });
  if (priorShare > 0.05) rows.push({ key: 'pattern', label: 'Giving so far at last year’s pattern', offering: Math.round(giving.given_ytd_cents / priorShare) + w.gift });
  if (giving?.projection_cents != null) rows.push({ key: 'yours', label: `Your scenario (${w.pct >= 0 ? '+' : ''}${w.pct}% on this year)`, offering: Math.round((giving.projection_cents + w.gift) * (1 + w.pct / 100)) });
  const free = m.q2 ? m.q2.free : null;
  const monthly = m.expenses / 12;
  for (const r of rows) {
    r.vsPlan = r.offering - planOffering;
    r.net = m.q1.netProposed + r.vsPlan;
    r.freeAfter = free != null ? free + r.net : null;
    r.months = r.freeAfter != null && monthly ? r.freeAfter / monthly : null;
  }
  const focus = rows.find((r) => r.focus) || rows[0];
  const gap = Math.max(0, -focus.net);
  const hh = giving?.households || 0;
  const avg = hh ? giving.given_ytd_cents / hh : 0;
  const { church } = splitOutMdo(builder, layout || normalizeBoardLayout(null));
  const churchExpenses = sum(church.lines.filter((l) => l.classification !== 'Income').map(plan));
  const topOne = giving?.concentration?.top10_pct != null && giving.projection_cents != null ? Math.round((giving.projection_cents * giving.concentration.top10_pct) / 100 / 10) : null;
  const close = gap ? {
    perHousehold: hh ? gap / hh : null, perWeek: hh ? gap / hh / 52 : null, avg,
    households: avg ? gap / avg : null, cutPct: churchExpenses ? (gap / churchExpenses) * 100 : null, topOne,
  } : null;
  return { m, w, rows, focus, gap, close, free, monthly };
}

export function renderGivingScenariosPage({ builder, data, layout = null, giving = null, givingData = null, lay = null, balanceAsOf = null, params = null, admin = false, now = new Date() }) {
  const top = head('giving-outlook', 'Giving scenarios', `Tests the FY${builder.targetYear} offering line against this year’s giving. Nothing here is saved.`, builder, admin, now);
  if (!data) return `${top}<p class="status status-error">Mission alignment could not be read. Reload to try again.</p>`;
  const s = givingScenarios({ builder, data, layout, giving, lay, balanceAsOf, params, now });
  const { m, w } = s;
  if (!m.q1.offering) return `${top}<p class="cb-missing">No offering line was found in the FY${builder.targetYear} plan. Choose it in the settings on the <a href="${pageHref('brief', builder.targetYear)}">Council brief</a>.</p>`;
  if (!giving) return `${top}<p class="cb-missing">This year’s giving report could not be read from Connect just now, so there is nothing to test the plan against. <a href="/?section=giving-analytics&amp;page=council">Open the giving report</a>.</p>`;
  const maxNet = Math.max(1, ...s.rows.map((r) => Math.abs(r.net)));
  const table = `<div class="ma-frame"><table class="ma-table"><thead><tr><th scope="col">Scenario</th><th scope="col" class="num">FY${builder.targetYear} offering</th><th scope="col" class="num">Against plan</th><th scope="col" class="num">FY${builder.targetYear} net</th><th scope="col" class="num">Free funds after the year</th><th scope="col" class="num">Months</th><th scope="col">Net result</th></tr></thead><tbody>
    ${s.rows.map((r) => `<tr${r.focus ? ' class="ma-hit"' : ''}><td>${r.focus ? `<b>${r.label}</b>` : r.label}</td><td class="num">${money(r.offering)}</td><td class="num"${neg(r.vsPlan)}>${signed(r.vsPlan)}</td><td class="num"><b${neg(r.net)}>${money(r.net)}</b></td><td class="num">${r.freeAfter == null ? '—' : money(r.freeAfter)}</td><td class="num">${r.months == null ? '—' : `<b class="cb-${r.months >= m.brief.reserveMonths ? 'pos' : 'neg'}">${months1(r.months)}</b>`}</td><td class="cb-track" style="min-width:120px"><span style="width:${((Math.abs(r.net) / maxNet) * 100).toFixed(1)}%;background:${r.net < 0 ? '#B5412F' : '#2B6E4F'}"></span></td></tr>`).join('')}
    </tbody></table></div>`;
  const form = `<form method="GET" action="/" class="cb-whatif ma-noprint"><input type="hidden" name="section" value="planning"><input type="hidden" name="page" value="giving-outlook"><input type="hidden" name="target" value="${builder.targetYear}">
    <label class="field"><span>Your scenario, % on this year</span><input name="pct" inputmode="decimal" value="${w.pct}"></label>
    <label class="field"><span>Expected extra gifts $ (added to each projection)</span><input name="gift" inputmode="decimal" value="${w.gift ? w.gift / 100 : ''}" placeholder="0"></label>
    <button type="submit" class="button-outline">Show</button></form>`;
  const f = s.focus;
  const reality = `<section class="ma-panel"><h3 style="margin:0">From the plan to the possible reality</h3><p class="ma-note">Focus: ${f.label.toLowerCase()}</p>
    ${waterfall([{ label: 'Net as proposed', cents: m.q1.netProposed, total: true }, { label: f.vsPlan < 0 ? 'Offering below plan' : 'Offering above plan', cents: f.vsPlan }, { label: 'Net in this scenario', cents: f.net, total: true }])}
    ${f.freeAfter != null ? `<p class="ma-note">Free funds would be about <b>${money(f.freeAfter)}</b> after FY${builder.targetYear}${f.net < 0 && f.freeAfter > 0 ? `, and last roughly <b>${(f.freeAfter / -f.net).toFixed(1)} years</b> at this rate of drawdown` : ''}. They are bequest money, not an operating reserve.</p>` : ''}</section>`;
  const c = s.close;
  const closeGap = `<section class="ma-panel"><h3 style="margin:0">What would it take to close the gap?</h3>
    ${c ? `<p class="ma-note">Gap in this scenario: <b>${money(s.gap)}</b></p><table class="ma-table"><tbody>
      ${c.perHousehold != null ? `<tr><td>Per giving household, per year (${giving.households} households)</td><td class="num"><b>${money(c.perHousehold)}</b></td></tr><tr><td>…per week</td><td class="num">$${(c.perWeek / 100).toFixed(2)}</td></tr>` : ''}
      ${c.avg ? `<tr><td>Average gift per household so far this year</td><td class="num">${money(c.avg)}</td></tr><tr><td>Additional households giving that average</td><td class="num"><b>${c.households.toFixed(1)}</b></td></tr>` : ''}
      ${c.cutPct != null ? `<tr><td>Or cutting church expenses (without Mother’s Day Out) by</td><td class="num">${c.cutPct.toFixed(1)}%</td></tr>` : ''}
      ${c.topOne != null ? `<tr><td>For scale: one top-ten household gives about</td><td class="num">${money(c.topOne)}</td></tr>` : ''}
      </tbody></table>` : `<p class="cb-lead">There is no gap: in this scenario the FY${builder.targetYear} plan breaks even or better.</p>`}</section>`;
  const mix = (giving.method_mix || []).filter((x) => x.pct).map((x) => `${e(x.label)} ${x.pct}%`).join(' · ');
  const deltaYtd = giving.given_ytd_cents - (giving.given_ytd_prior_cents || 0);
  const health = `<section class="ma-panel"><h3 style="margin:0">Giving health${givingData?.through_label ? ` <span class="ma-muted" style="font-weight:400;font-size:14px">${e(givingData.through_label)}</span>` : ''}</h3>
    <div class="cb-kpis">
      ${kpi(money(giving.given_ytd_cents), 'General fund so far this year', giving.given_ytd_prior_cents ? `${signed(deltaYtd)} against last year at this point` : '', deltaYtd < 0 ? 'neg' : '')}
      ${giving.budget_variance_cents != null ? kpi(signed(giving.budget_variance_cents), 'Against this year’s budget so far', giving.budget_ytd_cents ? `of a ${money(giving.budget_ytd_cents)} plan to date` : '', giving.budget_variance_cents < 0 ? 'neg' : 'pos') : ''}
      ${kpi(money(giving.projection_cents), 'Year-end projection', giving.annual_budget_cents ? `${signed(giving.projection_cents - giving.annual_budget_cents)} against the ${money(giving.annual_budget_cents)} budget` : '', giving.annual_budget_cents && giving.projection_cents < giving.annual_budget_cents ? 'neg' : '')}
      ${kpi(String(giving.households || 0), 'Giving households', giving.households_prior ? `${giving.households - giving.households_prior >= 0 ? '+' : ''}${giving.households - giving.households_prior} against last year` : '')}
    </div>
    <p class="ma-note">Giving by month: light blue = last year, blue = this year${giving.has_budget ? ', gold = this year’s budget' : ''}.</p>
    ${monthChart(givingData || {}, giving)}
    <div class="cb-two">${mix ? `<p class="ma-note"><b>How gifts arrive:</b> ${mix}.</p>` : ''}${giving.concentration?.top10_pct != null ? `<p class="ma-note"><b>Concentration:</b> the ten largest households give ${giving.concentration.top10_pct}% of the general fund${giving.concentration.half_households ? `; half comes from ${giving.concentration.half_households} households` : ''}. One household leaving is a visible hole.</p>` : ''}</div>
    <p class="ma-note">Totals only; no giver is named. <a href="/?section=giving-analytics&amp;page=council">Open the giving report</a></p></section>`;
  return `${top}
    <section class="ma-panel"><h3 style="margin:0">What if giving closes this year here and holds next year?</h3>
      <p class="ma-note">The plan counts on ${money(m.q1.offeringPlan)} for ${e(m.q1.offering.name || m.q1.offering.category)}. Each scenario puts that figure in its place and leaves every other line as planned.</p>
      ${table}${form}
      <details class="cb-why"><summary>How to read these projections</summary><div><ul>
        <li><b>This year’s giving projection</b> is the giving report’s: last year’s remaining Sundays carried forward at the pace giving is running this year.</li>
        <li><b>Giving so far at last year’s pattern</b> divides this year’s giving to date by the share of last year’s total that had come in by the same point.</li>
        <li><b>Your scenario</b> moves this year’s projection by the percent you choose, for a stewardship push or a harder year.</li>
        <li>Free funds after the year start from today’s balance sheet${s.free == null ? ' (unavailable just now)' : ''} and add each scenario’s net; months are of all planned expenses.</li></ul></div></details>
    </section>
    <div class="cb-two">${reality}${closeGap}</div>
    ${health}`;
}

export const COUNCIL_RESERVES_STYLES = `
  .cb-whatif { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; margin-top:10px; padding-top:10px; border-top:1px dashed #D7E2E9; }
  .cb-whatif input { width:110px; }
  .cb-whatif .field { display:flex; flex-direction:column; gap:3px; font-size:13px; }
  .cb-two > .ma-panel { min-width:0; }
`;
