// Budget › Council brief and Policy checklist: the council's four questions about a budget year
// (will it work, do we have a cushion, are we spending as intended, how healthy is the
// congregation) and the Policy Manual checks, built from live figures only: the budget plan
// (Connect), this year's giving report (Connect, aggregate only), the balance sheet (QuickBooks,
// read through Finance) and mission alignment. The council's settings (reserve target,
// compensation cap, target mix by End, the offering line, the decisions list) are saved with the
// year's mission alignment record (`brief`), admin-only like the rest of it. Nothing here names a
// person or shows anyone's pay: compensation is one aggregate share of the budget.
import { escapeHtml as e } from './render-helpers.js';
import { normalizeBoardLayout, accountDisplayName } from './board-layout.js';
import { MISSION_GOALS, missionModel, percent } from './mission-alignment.js';
import { missionChips, money, pageHref, sum, yearPicker, END_COLORS, dot } from './mission-ui.js';
import { personnelShare } from './mission-visuals.js';
import { monthChart } from './council-report-pages.js';

import { FormValidationError } from './form-fields.js';

const FULL = 10000;
const fail = (message) => { throw new FormValidationError(message); };

export const DEFAULT_DECISIONS = [
  ['Balanced budget', 'Decide whether a planned deficit is acceptable, how large, and which funds may cover it. The Policy Manual is silent.'],
  ['Giving assumption', 'Confirm or revise the offering line against where giving is closing this year.'],
  ['Use of bequests', 'Set a policy for spending unrestricted bequests on operations versus holding them as a reserve or legacy.'],
  ['Reserve definition', 'Define “operating reserve” so §3.6 can be tested without counting bequest money.'],
  ['Compensation guidance', 'Settle what counts as compensation and which expenses form the base before adopting a cap, and how to treat raises off the COLA.'],
  ['Mother’s Day Out', 'Agree how much Mother’s Day Out net the church may rely on, and what scales back first if enrollment dips.'],
].map(([topic, text]) => ({ topic, text }));

export function defaultBrief() {
  return { reserveMonths: 3, capBp: 4000, targets: [2500, 2500, 2500, 2500], givingLine: '', due: '11-30', decisions: DEFAULT_DECISIONS.map((d) => ({ ...d })) };
}

export function briefFrom(raw) {
  const out = defaultBrief();
  if (!raw || typeof raw !== 'object') return out;
  if (Number.isInteger(raw.reserveMonths) && raw.reserveMonths >= 1 && raw.reserveMonths <= 12) out.reserveMonths = raw.reserveMonths;
  if (Number.isInteger(raw.capBp) && raw.capBp >= 100 && raw.capBp <= FULL) out.capBp = raw.capBp;
  if (Array.isArray(raw.targets) && raw.targets.length === 4 && raw.targets.every((v) => Number.isInteger(v) && v >= 0) && sum(raw.targets) === FULL) out.targets = [...raw.targets];
  if (typeof raw.givingLine === 'string') out.givingLine = raw.givingLine.slice(0, 300);
  if (/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(raw.due || ''))) out.due = raw.due;
  if (Array.isArray(raw.decisions)) out.decisions = raw.decisions.filter((d) => d && String(d.topic || '').trim()).slice(0, 10).map((d) => ({ topic: String(d.topic).slice(0, 60), text: String(d.text || '').slice(0, 400) }));
  return out;
}

// The 'brief' action on the mission alignment save route.
export function applyBrief(data, form, builder) {
  const brief = briefFrom(data.brief);
  const months = Number(form.reserve_months);
  if (!Number.isInteger(months) || months < 1 || months > 12) fail('The reserve target must be 1 to 12 months.');
  const cap = percent(form.cap);
  if (cap < 100) fail('The compensation cap must be at least 1%.');
  const targets = MISSION_GOALS.map(([k]) => percent(form[`target_${k}`]));
  if (sum(targets) !== FULL) fail('The target mix by End must add up to exactly 100%.');
  const givingLine = String(form.giving_line || '');
  if (givingLine && !builder.lines.some((l) => l.classification === 'Income' && l.category === givingLine)) fail('Choose an income line from this year’s plan for the offering.');
  const due = String(form.due || '').trim();
  if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(due)) fail('Enter the proposal due date as month-day, like 11-30.');
  const decisions = [];
  for (let i = 0; i < 10; i += 1) {
    const topic = String(form[`dec_topic_${i}`] || '').trim();
    const text = String(form[`dec_text_${i}`] || '').trim();
    if (!topic && !text) continue;
    if (!topic) fail('Give each decision a short topic.');
    if (topic.length > 60 || text.length > 400) fail('Keep each decision to a 60-character topic and 400 characters of detail.');
    decisions.push({ topic, text });
  }
  return { data: { ...data, brief: { ...brief, reserveMonths: months, capBp: cap, targets, givingLine, due, decisions } }, params: {} };
}

// ── Model ────────────────────────────────────────────────────────────────────────────────────

const incomeLines = (builder) => builder.lines.filter((l) => l.classification === 'Income');
const plan = (l) => l?.plan?.plannedAmountCents || 0;
const OFFERING_RE = /offering|general fund giving|plate|envelope|pledge/i;
export function offeringLine(builder, brief) {
  const inc = incomeLines(builder);
  if (brief.givingLine) return inc.find((l) => l.category === brief.givingLine) || null;
  return inc.filter((l) => OFFERING_RE.test(`${l.category} ${l.name || ''}`) && !/tuition|mdo|daycare/i.test(`${l.category} ${l.name || ''}`))
    .sort((a, b) => plan(b) - plan(a))[0] || null;
}

const grade = (ok, watch) => (ok ? 'good' : watch ? 'watch' : 'concern');

// `giving` is the giving board's general-fund lens (aggregate only) or null; `lay` is the balance
// sheet's lay position (buildLayPosition) or null. Each answer says when its evidence is missing.
export function briefModel({ builder, data, layout = null, giving = null, lay = null, balanceAsOf = null, now = new Date() }) {
  const brief = briefFrom(data?.brief);
  const income = sum(incomeLines(builder).map(plan));
  const model = missionModel(builder, data);
  const expenses = model.total;
  const netProposed = income - expenses;
  const offering = offeringLine(builder, brief);
  const offeringPlan = plan(offering);
  const projection = giving && giving.projection_cents != null ? giving.projection_cents : null;
  const givingGap = projection != null && offering ? projection - offeringPlan : null;
  const netIfHolds = givingGap != null ? netProposed + Math.min(0, givingGap) : null;
  const behindPct = giving?.annual_budget_cents && giving.projection_cents != null ? ((giving.annual_budget_cents - giving.projection_cents) / giving.annual_budget_cents) * 100 : null;
  const worstNet = netIfHolds != null ? Math.min(netProposed, netIfHolds) : netProposed;
  const q1 = { netProposed, netIfHolds, givingGap, offeringPlan, offering, projection, behindPct, income, expenses, status: grade(worstNet >= 0, worstNet > -expenses * 0.02) };

  const monthly = expenses / 12;
  const target = monthly * brief.reserveMonths;
  let q2 = null;
  if (lay) {
    const free = lay.money.freeCents;
    const cashAfter = lay.own.cashCents - lay.owe.shortTermCents - lay.money.designatedCents;
    const months = monthly ? free / monthly : 0;
    const endOfYear = free + (netIfHolds ?? netProposed);
    const endMonths = monthly ? endOfYear / monthly : 0;
    q2 = { free, cashAfter, months, endOfYear, endMonths, target, designated: lay.money.designatedCents, endowment: lay.money.endowmentCents, bills: lay.owe.shortTermCents, cash: lay.own.cashCents, investments: lay.own.investmentsCents, investmentGroups: lay.investmentGroups, mortgage: lay.property.mortgageCents, property: lay.property.bookCents, asOf: balanceAsOf,
      status: grade(months >= brief.reserveMonths && endMonths >= brief.reserveMonths && cashAfter >= 0, months >= brief.reserveMonths * 0.75) };
  }

  const shares = sum(model.totals) ? model.totals.map((v) => (v / sum(model.totals)) * 100) : [0, 0, 0, 0];
  const targetPct = brief.targets.map((v) => v / 100);
  const gaps = shares.map((v, i) => v - targetPct[i]);
  const maxGap = Math.max(...gaps.map(Math.abs));
  const people = data ? personnelShare(builder, data, layout) : null;
  const compPct = people && people.total ? (people.staff / people.total) * 100 : null;
  const capPct = brief.capBp / 100;
  const q3 = { shares, targetPct, gaps, maxGap, unaligned: model.unassigned, aligned: sum(model.totals), compPct, capPct, staff: people?.staff || 0, headroom: people ? Math.round((people.total * brief.capBp) / FULL) - people.staff : null,
    status: grade(maxGap <= 5 && (compPct == null || compPct <= capPct), maxGap <= 10 && (compPct == null || compPct <= capPct)) };

  const q4 = giving ? {
    households: giving.households || 0, householdsPrior: giving.households_prior || 0,
    top10: giving.concentration?.top10_pct ?? null, half: giving.concentration?.half_households ?? null,
    ytd: giving.given_ytd_cents || 0, ytdPrior: giving.given_ytd_prior_cents || 0,
    status: (giving.households || 0) >= (giving.households_prior || 0) && (giving.given_ytd_cents || 0) >= (giving.given_ytd_prior_cents || 0) ? 'good' : 'watch',
  } : null;
  return { brief, builder, model, q1, q2, q3, q4, giving, expenses, income, people, now };
}

// The Policy Manual checks, each with its section, result and status.
export function policyChecks(m, layout = null) {
  const lay = layout || normalizeBoardLayout(null);
  const { brief, builder, q1, q2, q3, expenses, now } = m;
  const [mm, dd] = brief.due.split('-').map(Number);
  const dueDate = new Date(Date.UTC(builder.targetYear - 1, mm - 1, dd));
  const days = Math.ceil((dueDate - now) / 864e5);
  const staffCats = new Set(m.model.rows.filter((r) => r.isSource).map((r) => r.line.category));
  const big = builder.lines.filter((l) => l.classification !== 'Income' && !staffCats.has(l.category) && plan(l) >= 1000000).sort((a, b) => plan(b) - plan(a));
  const capital = builder.lines.filter((l) => l.classification !== 'Income' && /capital/i.test(`${l.category} ${l.name || ''}`));
  const capitalCents = sum(capital.map(plan));
  const passive = incomeLines(builder).filter((l) => /invest|endow|interest|dividend|rent|bequest/i.test(`${l.category} ${l.name || ''}`));
  const passiveCents = sum(passive.map(plan));
  const months = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const rows = [
    { ref: '§3.1', check: `Budget proposed to the Voters Assembly by ${dueDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`, result: days >= 0 ? `${days} day${days === 1 ? '' : 's'} left` : `${-days} day${days === -1 ? '' : 's'} past`, status: days < 0 ? 'info' : days < 14 ? 'watch' : 'good' },
    { ref: '§3.1', check: 'Balanced budget (no explicit rule in the manual)', result: `${money(q1.netProposed)} as proposed${q1.netIfHolds != null ? ` · ${money(q1.netIfHolds)} if giving holds` : ''}`, status: q1.netProposed >= 0 && (q1.netIfHolds == null || q1.netIfHolds >= 0) ? 'good' : 'concern', note: 'A policy gap worth discussing.' },
    { ref: '§3.2 / §3.3', check: 'Spending authority', result: `1% = ${money(expenses * 0.01)} · 5% = ${money(expenses * 0.05)}`, status: 'info', note: 'Council above 1% of expenses; Voters Assembly above 5%.' },
    { ref: '§3.4', check: 'Lines of $10,000 or more to review for contracts', result: `${big.length} line${big.length === 1 ? '' : 's'}`, status: 'info', note: '$25,000 or more suggests legal review.', detail: big.map((l) => [accountDisplayName(lay, l.category, l.name), plan(l)]) },
    { ref: '§3.5', check: 'Capital improvement line', result: capital.length ? money(capitalCents) : 'No capital line in the plan', status: capital.length && capitalCents > 0 ? 'good' : 'watch', note: capital.length && l0(capital, builder) },
    { ref: '§3.6', check: `Operating reserve: free funds against ${brief.reserveMonths} months`, result: q2 ? `${months(q2.months)} months (${money(q2.free)})` : 'Balance sheet unavailable', status: q2 ? (q2.months >= brief.reserveMonths ? 'good' : q2.months >= brief.reserveMonths * 0.75 ? 'watch' : 'concern') : 'info', note: 'Free funds are cash and investments after bills, designated funds and the endowment.' },
    { ref: '§3.6', check: 'Cash after bills and designated funds', result: q2 ? money(q2.cashAfter) : 'Balance sheet unavailable', status: q2 ? (q2.cashAfter >= 0 ? 'good' : 'concern') : 'info', note: 'Bank accounts only, not investments.' },
    { ref: '§3.7', check: 'Investment and rent income relied on', result: `${money(passiveCents)}${m.income ? ` (${((passiveCents / m.income) * 100).toFixed(1)}% of income)` : ''}`, status: 'info', note: 'Prudent investing per donor intent.' },
    { ref: '§2.2', check: 'Ends alignment against the target mix (largest gap)', result: `${Math.round(q3.maxGap)} points`, status: q3.maxGap > 10 ? 'concern' : q3.maxGap > 5 ? 'watch' : 'good', note: `Target ${brief.targets.map((v) => Math.round(v / 100)).join(' / ')} for Welcome / Receive / Grow / Go.` },
    { ref: 'Draft', check: `Compensation at or below ${q3.capPct}% of expenses`, result: q3.compPct != null ? `${q3.compPct.toFixed(1)}%` : 'Staff not linked yet', status: q3.compPct == null ? 'info' : q3.compPct > q3.capPct ? 'concern' : q3.headroom < expenses * 0.01 ? 'watch' : 'good', note: 'Church staff salaries and benefits linked on Staff time, of all planned expenses. Definition still open.' },
  ];
  return rows;
}
function l0(capital, builder) {
  const base = sum(capital.map((l) => l.baseBudgetCents || 0));
  return base ? `FY${builder.baseYear} budgeted ${money(base)}.` : '';
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────────

const LABEL = { good: 'On track', watch: 'Watch', concern: 'Concern', info: 'Info' };
const tag = (s) => `<span class="cb-tag cb-${s}">${LABEL[s]}</span>`;
const months1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
function bars(rows, { scale = null } = {}) {
  const max = scale || Math.max(1, ...rows.map((r) => Math.abs(r.cents)));
  return `<table class="cb-bars"><tbody>${rows.map((r) => `<tr><td>${r.label}</td><td class="num"><b${r.cents < 0 ? ' class="cb-neg"' : ''}>${money(r.cents)}</b></td><td class="cb-track"><span style="width:${Math.min(100, (Math.abs(r.cents) / max) * 100).toFixed(1)}%;background:${r.color || (r.cents < 0 ? '#B5412F' : '#2B6E4F')}"></span>${r.tick != null ? `<i style="left:${Math.min(100, (r.tick / max) * 100).toFixed(1)}%"></i>` : ''}</td></tr>`).join('')}</tbody></table>`;
}
const why = (body) => `<details class="cb-why"><summary>Why we say this: the evidence</summary><div>${body}</div></details>`;
const missing = (what, fix) => `<p class="cb-missing">${e(what)}${fix ? ` ${fix}` : ''}</p>`;

function questionOne(m) {
  const { q1, builder } = m;
  const rows = [{ label: 'Budget as proposed', cents: q1.netProposed }];
  if (q1.netIfHolds != null) rows.push({ label: `If giving holds: this year’s giving projection`, cents: q1.netIfHolds });
  const lead = q1.netIfHolds == null
    ? `The plan shows <b>${money(q1.netProposed)}</b>. ${q1.offering ? 'This year’s giving report could not be read, so there is no “if giving holds” estimate yet.' : 'Choose the offering line in the settings below to compare it with this year’s giving.'}`
    : q1.givingGap >= 0
      ? `The plan shows <b>${money(q1.netProposed)}</b>, and it counts on ${money(q1.offeringPlan)} of giving, which this year’s pace already reaches (projected ${money(q1.projection)}).`
      : `${q1.netProposed >= 0 && q1.netIfHolds >= 0 ? 'Yes, with less room than it shows.' : 'Not as written.'} The plan shows <b>${money(q1.netProposed)}</b>, but it counts on ${money(q1.offeringPlan)} of giving and this year is closing near ${money(q1.projection)}. If giving holds, expect <b class="${q1.netIfHolds < 0 ? 'cb-neg' : ''}">${money(q1.netIfHolds)}</b>.`;
  return `<p class="cb-lead">${lead}</p>${bars(rows)}
    ${why(`<ul><li>Planned income ${money(q1.income)} and planned expenses ${money(q1.expenses)} in the FY${builder.targetYear} plan.</li>
      ${q1.offering ? `<li>Offering line: ${e(q1.offering.name || q1.offering.category)}, ${money(q1.offeringPlan)} planned.</li>` : ''}
      ${q1.projection != null ? `<li>Giving report projection for this year: ${money(q1.projection)}${q1.behindPct != null ? `, ${Math.abs(q1.behindPct).toFixed(0)}% ${q1.behindPct > 0 ? 'behind' : 'ahead of'} this year’s budget` : ''}. It carries last year’s remaining Sundays forward at this year’s pace.</li>` : ''}
      <li>“If giving holds” lowers only the offering line to this year’s projection; every other line stays as planned. Giving above the plan is not counted.</li></ul>
      <p><a href="${pageHref('builder', builder.targetYear)}">Open the budget planner</a> · <a href="/?section=giving-analytics&amp;page=council">Giving report</a></p>`)}`;
}

function questionTwo(m) {
  const { q2, brief } = m;
  if (!q2) return missing('The balance sheet could not be read from QuickBooks just now, so the cushion cannot be measured.', '<a href="/?section=balance&amp;page=position">Open the balance sheet</a>.');
  const lead = `Free funds are <b>${money(q2.free)}</b>, or ${months1(q2.months)} months of expenses against a ${brief.reserveMonths}-month policy target. Cash alone is <b class="${q2.cashAfter < 0 ? 'cb-neg' : ''}">${money(q2.cashAfter)}</b> after bills and designated funds. ${m.q1.netIfHolds != null ? 'On the realistic giving path' : 'With the budget as proposed'} they reach about <b>${money(q2.endOfYear)}</b> (${months1(q2.endMonths)} months) by the end of FY${m.builder.targetYear}.`;
  const scale = Math.max(Math.abs(q2.cashAfter), q2.free, q2.endOfYear, q2.target, 1);
  return `<p class="cb-lead">${lead}</p>${bars([
    { label: 'Cash after bills &amp; designated funds', cents: q2.cashAfter },
    { label: 'Free for the council', cents: q2.free, tick: q2.target, color: q2.free >= q2.target ? '#2B6E4F' : '#B5412F' },
    { label: `Projected end of FY${m.builder.targetYear}`, cents: q2.endOfYear, tick: q2.target, color: q2.endOfYear >= q2.target ? '#2B6E4F' : '#B5412F' },
    { label: `Policy target (${brief.reserveMonths} months)`, cents: Math.round(q2.target), color: '#6B7480' },
  ], { scale })}
  ${why(`<table class="cb-plain"><tbody>
    <tr><td>Bank accounts</td><td class="num">${money(q2.cash)}</td></tr>
    <tr><td>Investments${q2.investmentGroups?.length ? ` (${q2.investmentGroups.map((g) => `${e(g.label)} ${money(g.cents)}`).join(', ')})` : ''}</td><td class="num">${money(q2.investments)}</td></tr>
    <tr><td>Less bills, payroll and credit cards due</td><td class="num">−${money(q2.bills)}</td></tr>
    <tr><td>Less designated funds</td><td class="num">−${money(q2.designated)}</td></tr>
    <tr><td>Less the permanent endowment</td><td class="num">−${money(q2.endowment)}</td></tr>
    <tr><td><b>Free for the council</b></td><td class="num"><b>${money(q2.free)}</b></td></tr></tbody></table>
    <p>One month of FY${m.builder.targetYear} expenses is ${money(m.expenses / 12)}. Balances as of ${e(q2.asOf || 'the latest QuickBooks import')}. Free funds include any unrestricted bequests: they are one-time money, not an operating reserve.</p>
    <p><a href="/?section=balance&amp;page=position">Open the balance sheet</a></p>`)}`;
}

function questionThree(m) {
  const { q3, builder } = m;
  const goal = MISSION_GOALS.map(([, l, sub], i) => `<tr><td>${dot(i)} <b>${l}</b> <span class="ma-muted">${sub}</span></td><td class="num">${Math.round(q3.shares[i])}%</td><td class="cb-track"><span style="width:${Math.min(100, q3.shares[i] * 2).toFixed(1)}%;background:${END_COLORS[i]}"></span><i style="left:${Math.min(100, q3.targetPct[i] * 2).toFixed(1)}%"></i></td><td class="num ma-muted">${q3.gaps[i] >= 0 ? '+' : ''}${Math.round(q3.gaps[i])}</td></tr>`).join('');
  const comp = q3.compPct == null
    ? missing('No staff are linked to their salary lines yet, so compensation cannot be measured.', `<a href="${pageHref('staff-time', builder.targetYear)}">Link them on Staff time</a>.`)
    : `<div class="cb-kpis"><div><b class="${q3.compPct > q3.capPct ? 'cb-neg' : 'cb-pos'}">${q3.compPct.toFixed(1)}%</b><span>FY${builder.targetYear} plan · compensation ÷ expenses</span></div><div><b>${money(q3.staff)}</b><span>compensation counted</span></div><div><b class="${q3.headroom < 0 ? 'cb-neg' : 'cb-pos'}">${q3.headroom >= 0 ? '+' : ''}${money(q3.headroom)}</b><span>${q3.headroom >= 0 ? 'headroom under' : 'over'} the ${q3.capPct}% cap</span></div></div>
      <div class="cb-track cb-wide"><span style="width:${Math.min(100, q3.compPct / 0.6).toFixed(1)}%;background:#2B6E4F"></span><i style="left:${Math.min(100, q3.capPct / 0.6).toFixed(1)}%"></i></div><p class="ma-note">Black tick: the ${q3.capPct}% cap. Scale to 60%.</p>`;
  return `<p class="cb-lead">Spending across the four Ends is within <b>${Math.round(q3.maxGap)} points</b> of the target mix.${q3.compPct != null ? ` Compensation is <b>${q3.compPct.toFixed(1)}%</b> of the budget against the draft ${q3.capPct}% cap.` : ''}</p>
    <div class="cb-two"><div><p class="ma-note">Share of spending by End (tick = target)</p><table class="cb-bars"><tbody>${goal}</tbody></table>${q3.unaligned ? `<p class="ma-note">${money(q3.unaligned)} is not yet aligned and is left out of the shares.</p>` : ''}</div>
    <div><p class="ma-note">Compensation against the draft cap</p>${comp}</div></div>
    ${why(`<ul><li>Shares come from Line items by End: every expense line’s split, with staff salaries and benefits following each person’s time. The whole budget, including Mother’s Day Out.</li>
      <li>Compensation is church staff salaries and benefits linked on Staff time, divided by all planned expenses. What counts is still a council decision.</li></ul>
      <p><a href="${pageHref('mission-report', builder.targetYear)}">Mission report</a> · <a href="${pageHref('staff-time', builder.targetYear)}">Staff time</a></p>`)}`;
}

function questionFour(m) {
  const { q4, giving, q2 } = m;
  if (!q4) return missing('This year’s giving report could not be read from Connect just now.', '<a href="/?section=giving-analytics&amp;page=council">Open the giving report</a>.');
  const hh = q4.households - q4.householdsPrior;
  const ytdDelta = q4.ytd - q4.ytdPrior;
  const lead = `${q4.households} households have given this year (${hh === 0 ? 'the same as' : `${Math.abs(hh)} ${hh < 0 ? 'fewer than' : 'more than'}`} last year at this point). Giving so far is ${money(Math.abs(ytdDelta))} ${ytdDelta >= 0 ? 'ahead of' : 'behind'} last year.${q4.half ? ` Half of all giving comes from ${q4.half} households.` : ''}${q2?.mortgage ? ` The mortgage stands at ${money(q2.mortgage)}.` : ''}`;
  return `<p class="cb-lead">${lead}</p>
    <p class="ma-note">Giving by month: light blue = last year, blue = this year${giving.has_budget ? ', gold = this year’s budget' : ''}.</p>
    ${monthChart(m.givingData, giving)}
    ${why(`<ul><li>From the giving report’s general fund view, ${e(m.givingData.through_label ? m.givingData.through_label.toLowerCase() : 'this year so far')}. Totals only; no giver is named.</li>${q4.top10 != null ? `<li>The ten largest giving households give ${q4.top10}% of the total.</li>` : ''}</ul><p><a href="/?section=giving-analytics&amp;page=council">Open the giving report</a></p>`)}`;
}

function question(n, title, status, body) {
  return `<section class="cb-q cb-q-${status}" aria-labelledby="cb-q${n}"><div class="cb-qhead"><span class="cb-n">${n}</span><h3 id="cb-q${n}">${title}</h3>${tag(status)}</div>${body}</section>`;
}

function settingsForm(m, data) {
  const { brief, builder } = m;
  const inc = incomeLines(builder).filter((l) => plan(l) || l.category === brief.givingLine).sort((a, b) => plan(b) - plan(a));
  const auto = offeringLine(builder, { ...brief, givingLine: '' });
  const rows = [...brief.decisions, ...Array.from({ length: Math.max(2, 10 - brief.decisions.length) }, () => ({ topic: '', text: '' }))].slice(0, 10);
  return `<details class="ma-panel cb-settings"><summary><b>Settings for this brief</b> <span class="ma-muted">reserve target, compensation cap, target mix, offering line, decisions</span></summary>
    <form method="POST" action="/api/v1/planning/mission-save" style="display:flex;flex-direction:column;gap:14px;margin-top:12px">
      <input type="hidden" name="target" value="${builder.targetYear}"><input type="hidden" name="base" value="${builder.baseYear}"><input type="hidden" name="revision" value="${data.revision}"><input type="hidden" name="action" value="brief"><input type="hidden" name="return_page" value="brief"><input type="hidden" name="return_target" value="${builder.targetYear}">
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end">
        <label class="field"><span>Reserve target (months, §3.6)</span><input name="reserve_months" inputmode="numeric" value="${brief.reserveMonths}" style="width:80px"></label>
        <label class="field"><span>Compensation cap (% of expenses)</span><input name="cap" inputmode="decimal" value="${brief.capBp / 100}" style="width:80px"></label>
        <label class="field"><span>Proposal due (month-day, §3.1)</span><input name="due" value="${e(brief.due)}" style="width:90px"></label>
        <label class="field"><span>Offering line</span><select name="giving_line"><option value="">Automatic${auto ? ` (${e(auto.name || auto.category)})` : ''}</option>${inc.map((l) => `<option value="${e(l.category)}"${l.category === brief.givingLine ? ' selected' : ''}>${e(l.name || l.category)} · ${money(plan(l))}</option>`).join('')}</select></label>
      </div>
      <fieldset class="cb-fs"><legend>Target mix by End (adds to 100%)</legend><div style="display:flex;gap:12px;flex-wrap:wrap">${MISSION_GOALS.map(([k, l], i) => `<label class="field"><span>${l}</span><input name="target_${k}" inputmode="decimal" value="${brief.targets[i] / 100}" style="width:70px"></label>`).join('')}</div></fieldset>
      <fieldset class="cb-fs"><legend>Decisions for the council (empty rows are dropped)</legend>
        ${rows.map((d, i) => `<div class="cb-dec"><input name="dec_topic_${i}" value="${e(d.topic)}" maxlength="60" placeholder="Topic" aria-label="Decision ${i + 1} topic"><textarea name="dec_text_${i}" rows="2" maxlength="400" placeholder="What needs deciding" aria-label="Decision ${i + 1} detail">${e(d.text)}</textarea></div>`).join('')}</fieldset>
      <div class="ma-actions"><button type="submit">Save settings</button></div>
    </form></details>`;
}

function statusLine(params) {
  if (!params) return '';
  if (params.get('status') === 'ok' && params.get('mission') === '1') return '<p class="status status-ok" role="status">Saved.</p>';
  if (params.get('status') === 'error') return `<p class="status status-error" role="alert">${e(params.get('message') || 'That change could not be saved. Nothing was changed.')}</p>`;
  return '';
}

export function renderCouncilBriefPage({ builder, data, layout = null, giving = null, givingData = null, lay = null, balanceAsOf = null, params = null, admin = false, now = new Date() }) {
  const target = builder.targetYear;
  const head = `<div class="ma-noprint">${missionChips('brief', target, { admin })}</div>
    <div class="ma-head"><div><span class="ma-eyebrow">Budget · Council</span><h2>Council brief</h2><p class="ma-sub">FY${target} proposed budget · four questions, each with its evidence one click away. Live figures; use Print for a PDF.</p></div><div class="ma-noprint">${yearPicker('brief', target, now)}</div></div>`;
  if (!data) return `${head}<p class="status status-error">Mission alignment could not be read. Reload to try again.</p>`;
  const m = briefModel({ builder, data, layout, giving, lay, balanceAsOf, now });
  m.givingData = givingData || {};
  const bottom = [
    `The FY${target} plan is <b>${money(m.q1.netProposed)}</b> as proposed${m.q1.netIfHolds != null && m.q1.netIfHolds !== m.q1.netProposed ? `, and more likely <b>${money(m.q1.netIfHolds)}</b> if giving holds where it is` : ''}.`,
    m.q2 ? `Any shortfall is paid from <b>${money(m.q2.free)}</b> of free funds: ${months1(m.q2.months)} months of expenses; policy asks for ${m.brief.reserveMonths}.` : 'The cushion could not be measured: the balance sheet is unavailable.',
    m.q3.compPct != null ? `Compensation is ${m.q3.compPct.toFixed(1)}% of planned expenses; the largest gap from the target mix by End is ${Math.round(m.q3.maxGap)} points.` : `The largest gap from the target mix by End is ${Math.round(m.q3.maxGap)} points.`,
  ];
  const decisions = m.brief.decisions.length ? `<section class="ma-panel" aria-labelledby="cb-dec"><h3 id="cb-dec" style="margin:0">Decisions for the council</h3>
    <table class="ma-table"><thead><tr><th scope="col">#</th><th scope="col">Topic</th><th scope="col">What needs deciding</th></tr></thead><tbody>${m.brief.decisions.map((d, i) => `<tr><td>${i + 1}</td><td><b>${e(d.topic)}</b></td><td>${e(d.text)}</td></tr>`).join('')}</tbody></table></section>` : '';
  return `${head}${statusLine(params)}
    <section class="cb-bottom" aria-label="The bottom line"><span class="ma-eyebrow">The bottom line</span><ul>${bottom.map((b) => `<li>${b}</li>`).join('')}</ul></section>
    ${question(1, 'Will the budget work?', m.q1.status, questionOne(m))}
    ${question(2, 'Do we have a cushion?', m.q2 ? m.q2.status : 'info', questionTwo(m))}
    ${question(3, 'Are we spending as intended?', m.q3.status, questionThree(m))}
    ${question(4, 'How healthy is the congregation?', m.q4 ? m.q4.status : 'info', questionFour(m))}
    ${decisions}
    <p class="ma-note">See also the <a href="${pageHref('policy', target)}">Policy checklist</a>. Planned resource figures, not measures of ministry impact.</p>
    ${admin ? `<div class="ma-noprint">${settingsForm(m, data)}</div>` : ''}`;
}

export function renderPolicyChecklistPage({ builder, data, layout = null, giving = null, lay = null, balanceAsOf = null, admin = false, now = new Date() }) {
  const target = builder.targetYear;
  const head = `<div class="ma-noprint">${missionChips('policy', target, { admin })}</div>
    <div class="ma-head"><div><span class="ma-eyebrow">Budget · Council</span><h2>Policy checklist</h2><p class="ma-sub">FY${target} proposed budget against the Policy Manual, from live figures</p></div><div class="ma-noprint">${yearPicker('policy', target, now)}</div></div>`;
  if (!data) return `${head}<p class="status status-error">Mission alignment could not be read. Reload to try again.</p>`;
  const m = briefModel({ builder, data, layout, giving, lay, balanceAsOf, now });
  const rows = policyChecks(m, layout);
  const counts = ['good', 'watch', 'concern'].map((s) => [s, rows.filter((r) => r.status === s).length]);
  const big = rows.find((r) => r.detail)?.detail || [];
  return `${head}
    <div class="cb-kpis">${counts.map(([s, n]) => `<div><b>${n}</b><span>${tag(s)}</span></div>`).join('')}</div>
    <div class="ma-frame"><table class="ma-table"><thead><tr><th scope="col">Policy</th><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Status</th><th scope="col">Note</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><b>${e(r.ref)}</b></td><td>${e(r.check)}</td><td>${e(r.result)}</td><td>${tag(r.status)}</td><td class="ma-note">${e(r.note || '')}</td></tr>`).join('')}
    </tbody></table></div>
    ${big.length ? `<details class="ma-panel"><summary><b>Lines of $10,000 or more</b> <span class="ma-muted">(excluding staff compensation) to check for contracts needing council review</span></summary><table class="ma-table"><tbody>${big.map(([n, c]) => `<tr><td>${e(n)}</td><td class="num">${money(c)}</td><td>${c >= 2500000 ? tag('watch') : ''}</td></tr>`).join('')}</tbody></table></details>` : ''}
    <p class="ma-note">Settings (reserve target, cap, target mix, due date) are on the <a href="${pageHref('brief', target)}">Council brief</a>.</p>`;
}

export const COUNCIL_BRIEF_STYLES = `
  .cb-bottom { background:#1F3B2E; color:#fff; border-radius:12px; padding:18px 22px; margin-bottom:18px; }
  .cb-bottom .ma-eyebrow { color:#B9D3C3; }
  .cb-bottom ul { margin:8px 0 0; padding-left:20px; display:flex; flex-direction:column; gap:6px; font-size:16px; line-height:1.45; }
  .cb-q { background:#fff; border:1px solid #D7E2E9; border-left:6px solid #7A8B99; border-radius:12px; padding:18px 22px; margin-bottom:16px; }
  .cb-q-good { border-left-color:#2B6E4F; } .cb-q-watch { border-left-color:#C9973A; } .cb-q-concern { border-left-color:#B5412F; }
  .cb-qhead { display:flex; align-items:center; gap:12px; margin-bottom:8px; }
  .cb-qhead h3 { margin:0; font-size:21px; }
  .cb-n { width:28px; height:28px; border-radius:50%; background:#1F3B2E; color:#fff; display:inline-flex; align-items:center; justify-content:center; font-weight:700; }
  .cb-tag { display:inline-block; padding:2px 10px; border-radius:999px; font-size:12px; font-weight:700; color:#fff; background:#6B7480; }
  .cb-good { background:#2B6E4F; } .cb-watch { background:#B07A00; } .cb-concern { background:#B5412F; }
  .cb-lead { font-size:16px; line-height:1.5; margin:4px 0 12px; }
  .cb-neg { color:#A3321F; } .cb-pos { color:#2B6E4F; }
  .cb-bars { width:100%; border-collapse:collapse; font-size:14px; }
  .cb-bars td { padding:7px 8px; border-bottom:1px solid #E6ECF0; }
  .cb-bars td:first-child { width:38%; } .cb-bars td.num { width:14%; text-align:right; font-variant-numeric:tabular-nums; }
  .cb-track { position:relative; height:16px; background:#EEF2F5; border-radius:3px; padding:0 !important; }
  .cb-bars .cb-track { display:table-cell; }
  .cb-track span { position:absolute; left:0; top:0; bottom:0; border-radius:3px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .cb-track i { position:absolute; top:-3px; bottom:-3px; width:2px; background:#16213A; }
  .cb-wide { display:block; height:16px; margin-top:10px; }
  .cb-why { margin-top:10px; border-top:1px dashed #D7E2E9; padding-top:8px; font-size:14px; }
  .cb-why summary { cursor:pointer; color:#2B5065; font-weight:600; }
  .cb-why ul { margin:8px 0; padding-left:20px; }
  .cb-plain td { padding:4px 10px 4px 0; } .cb-plain .num { text-align:right; font-variant-numeric:tabular-nums; }
  .cb-two { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:24px; }
  .cb-kpis { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px; }
  .cb-kpis > div { border:1px solid #D7E2E9; border-radius:8px; padding:10px 14px; display:flex; flex-direction:column; gap:4px; min-width:140px; background:#fff; }
  .cb-kpis b { font-size:22px; } .cb-kpis > div > span:not(.cb-tag) { font-size:12.5px; color:#536B79; }
  .cb-missing { background:#FFF7E6; border:1px solid #F0D9A8; border-radius:8px; padding:10px 14px; margin:0; }
  .cb-fs { border:1px solid #D7E2E9; border-radius:8px; padding:10px 14px; }
  .cb-dec { display:grid; grid-template-columns:220px 1fr; gap:8px; margin-bottom:6px; }
  @media (max-width: 700px) { .cb-dec { grid-template-columns:1fr; } .cb-bars td:first-child { width:auto; } }
  @media print { .ma-noprint, .cb-settings { display:none !important; } .cb-why[open] div, .cb-why div { display:block; } .cb-q { break-inside:avoid; } }
`;

