// Budget › For the congregation and Budget › Mission report: presentation pages built from the
// proposed plan and its mission alignment. Read-only for anyone who can see the budget; only the
// words on the congregation slide are edited here (admins). No per-person compensation appears:
// staff time is shown as shares of time and one combined staff total.
import { escapeHtml as e } from './render-helpers.js';
import { buildBoardSections, normalizeBoardLayout, accountDisplayName, boardCategoryFor } from './board-layout.js';
import { MISSION_GOALS, distribute, missionModel } from './mission-alignment.js';
import { PRESENT_COLORS, missionChips, money, pageHref, pct0, pie, sum, yearPicker } from './mission-ui.js';
import { trendHeadline, wholeChart, change } from './budget-trends.js';

const FULL = 10000;
const shareOf = (parts) => (sum(parts) > 0 ? distribute(FULL, parts.map((p) => Math.max(0, p))) : [0, 0, 0, 0]);

const staffBullet = (people) => (!people.length ? 'Staff time' : people.length === 1 ? `${people[0].label}’s time` : `Staff time, most from the ${people[0].label}`);

// Top contributors to each End, used when no words have been written for the slide.
export function autoBullets(model, layout) {
  const lay = layout || normalizeBoardLayout(null);
  return MISSION_GOALS.map((_, i) => {
    const items = [
      ...model.rows.filter((r) => !r.isSource && r.parts?.[i] > 0).map((r) => ({ label: accountDisplayName(lay, r.line.category, r.line.name), cents: r.parts[i] })),
      ...(model.staffTotals[i] > 0 ? [{ label: staffBullet(model.staff.filter((s) => s.parts[i] > 0 && !s.councilHidden).sort((a, b) => b.parts[i] - a.parts[i])), cents: model.staffTotals[i] }] : []),
    ];
    return items.sort((a, b) => b.cents - a.cents).slice(0, 4).map((x) => x.label);
  });
}

function sideGroups(builder, layout, isRevenue) {
  const lay = layout || normalizeBoardLayout(null);
  const lines = builder.lines.filter((l) => (l.classification === 'Income') === isRevenue);
  const sections = buildBoardSections(lines, lay, (l) => ({ path: l.category, name: l.name, isRevenue }));
  const flat = isRevenue ? sections.revenue.flatMap((s) => (s.kind === 'wrapper' ? s.groups : [s])) : sections.expense;
  return flat.map((g) => ({
    key: g.key, label: g.label, items: g.items,
    plan: sum(g.items.map((l) => l.plan?.plannedAmountCents || 0)),
    prior: g.items.some((l) => l.baseBudgetCents != null) ? sum(g.items.map((l) => l.baseBudgetCents || 0)) : null,
  })).filter((g) => g.plan || g.prior).sort((a, b) => b.plan - a.plan);
}

// Mother's Day Out runs on its own tuition, so the donor view sets it aside: its board category (or
// its name) on the expense side, and its tuition on the income side.
const MDO_RE = /\bMDO\b|mother.?s day out/i;
export function splitOutMdo(builder, layout) {
  const lay = layout || normalizeBoardLayout(null);
  const isMdo = (l) => {
    if (MDO_RE.test(`${l.category} ${l.name || ''}`)) return true;
    if (l.classification === 'Income') return false;
    return boardCategoryFor(lay, l.category, l.name, false).key === 'mdo';
  };
  const cents = (l) => l.plan?.plannedAmountCents || 0;
  const mdo = builder.lines.filter(isMdo);
  return {
    church: { ...builder, lines: builder.lines.filter((l) => !isMdo(l)) },
    mdoIncome: sum(mdo.filter((l) => l.classification === 'Income').map(cents)),
    mdoCost: sum(mdo.filter((l) => l.classification !== 'Income').map(cents)),
  };
}
const DONOR_KEYS = ['donor', 'restricted'];

function hbars(groups, color, baseYear) {
  const max = Math.max(1, ...groups.flatMap((g) => [g.plan, g.prior || 0]));
  const total = sum(groups.map((g) => g.plan));
  return `<div class="cv-hbars">${groups.map((g) => {
    const delta = g.prior ? ((g.plan - g.prior) / Math.abs(g.prior)) * 100 : null;
    return `<div class="cv-hbar"><span>${e(g.label)}</span><span class="track" role="img" aria-label="${e(`${g.label}: ${money(g.plan)}${g.prior != null ? `, ${baseYear} budget ${money(g.prior)}` : ''}`)}"><span class="fill" style="width:${Math.max(0, (g.plan / max) * 100).toFixed(1)}%;background:${color}"></span>${g.prior ? `<span class="prior" style="left:${Math.max(0, Math.min(99.5, (g.prior / max) * 100)).toFixed(1)}%" title="${baseYear} budget"></span>` : ''}</span><span style="font-variant-numeric:tabular-nums;white-space:nowrap"><b>${money(g.plan)}</b> <small style="color:#5A6578">${total ? Math.round((g.plan / total) * 100) : 0}%${delta == null ? '' : ` · ${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(0)}%`}</small></span></div>`;
  }).join('')}</div>`;
}

// ── For the congregation ─────────────────────────────────────────────────────────────────────

export function renderCongregationPage({ builder: fullBuilder, data, layout = null, trend = null, params, canEdit = false, now = new Date() }) {
  const target = fullBuilder.targetYear;
  // Both views by default: the whole budget, and donor dollars with Mother's Day Out set aside
  // (its tuition pays for it, and it adds to the congregation's ministry rather than drawing on gifts).
  const view = ['whole', 'donor'].includes(params?.get('view')) ? params.get('view') : 'both';
  const showWhole = view !== 'donor';
  const showDonor = view !== 'whole';
  const mdoSplit = splitOutMdo(fullBuilder, layout);
  const mdoNetAll = mdoSplit.mdoIncome - mdoSplit.mdoCost;
  const builder = fullBuilder;
  const viewSwitch = `<nav class="segmented ma-noprint" aria-label="Which slides" style="margin:0 0 16px;display:inline-flex;gap:4px">${[['both', 'All slides'], ['whole', 'Whole budget'], ['donor', 'Donor dollars']].map(([v, l]) => `<a href="${pageHref('congregation', target, v !== 'both' ? { view: v } : {})}"${v === view ? ' aria-current="page" style="background:#1B2A4A;color:#fff"' : ''}>${l}</a>`).join('')}</nav><p class="ma-note ma-noprint" style="margin:0 0 14px">Donor-dollar slides set Mother’s Day Out aside: its tuition pays for it, and it adds to the congregation’s ministry rather than drawing on gifts.</p>`;
  const income = builder.lines.filter((l) => l.classification === 'Income').reduce((t, l) => t + (l.plan?.plannedAmountCents || 0), 0);
  const expenses = builder.lines.filter((l) => l.classification !== 'Income').reduce((t, l) => t + (l.plan?.plannedAmountCents || 0), 0);
  const head = `<div class="ma-noprint">${missionChips('congregation', target, { admin: canEdit })}
    <div class="ma-head"><div><span class="ma-eyebrow">Budget · For the congregation</span><h2>Presenting the FY${target} budget</h2><p class="ma-sub">Slides for a congregation meeting. Use Print to save them as a PDF, one slide per page.</p></div>${yearPicker('congregation', target, now)}</div>${viewSwitch}
    ${params?.get('status') === 'ok' && params?.get('mission') === '1' ? '<p class="status status-ok" role="status">Saved.</p>' : ''}
    ${params?.get('status') === 'error' ? `<p class="status status-error" role="alert">${e(String(params.get('message') || 'The change could not be saved.').slice(0, 200))} Nothing was saved.</p>` : ''}</div>`;
  const rule = '<div class="cv-rule"></div>';
  const org = '<div class="cv-org">Timothy Lutheran Church<br><span class="cv-serif" style="font-size:17px">From our Neighborhood to the Nations</span></div>';
  const slides = [];

  // The mission dollar: for the whole budget, and for gifts without Mother's Day Out.
  const missionModes = [showWhole ? { b: fullBuilder, donor: false } : null, showDonor && (mdoSplit.mdoCost || mdoSplit.mdoIncome || !showWhole) ? { b: mdoSplit.church, donor: true } : null].filter(Boolean);
  for (const mode of missionModes) {
    if (!data) break;
    const donorView = mode.donor;
    const model = missionModel(mode.b, data);
    const aligned = sum(model.totals);
    if (aligned > 0) {
      const cents = distribute(100, model.totals.map((v) => Math.max(0, v)));
      const auto = autoBullets(model, layout);
      const bullets = MISSION_GOALS.map((_, i) => (data.story.bullets[i]?.length ? data.story.bullets[i] : auto[i]));
      const staffCents = model.total ? Math.round((model.staffPool / model.total) * 100) : 0;
      const strip = MISSION_GOALS.map(([, l], i) => (cents[i] ? `<div style="width:${cents[i]}%;background:${PRESENT_COLORS[i]}"><b>${cents[i]}¢</b>${cents[i] >= 12 ? l : ''}</div>` : '')).join('');
      slides.push(`<section class="cv-slide" aria-label="How your gifts do the mission">${rule}<div class="cv-body">
        <div class="cv-head"><div><span class="cv-eyebrow">${target} ${donorView ? 'ministry budget, without Mother’s Day Out' : 'Budget'} · ${money(model.total)}</span><h2 class="cv-serif">${donorView ? 'How your gifts do the mission' : 'How the whole budget does the mission'}</h2><p class="cv-lede">${donorView ? `Your gifts carry the church’s ministry. Mother’s Day Out pays its own way${mdoNetAll > 0 ? ` and adds ${money(mdoNetAll)} to it` : ''}, so it is set aside here. Here is where a gift dollar goes.` : 'Every line in our budget serves one of four Ends, Mother’s Day Out included. Here is where a dollar goes.'}</p></div>${org}</div>
        <div class="cv-dollar" role="img" aria-label="${e(`Of every dollar: ${MISSION_GOALS.map(([, l], i) => `${l} ${cents[i]} cents`).join(', ')}`)}">${strip}</div>
        <div class="cv-ends">${MISSION_GOALS.map(([, l, sub], i) => `<section class="cv-end" style="background:${PRESENT_COLORS[i]}"><div><h3 class="cv-serif">${l}</h3><span class="cv-eyebrow" style="color:#1E2D4A;font-size:12px">${sub}</span></div>
          <div class="cv-amt"><b>${money(model.totals[i])}</b><span>${cents[i]}¢ of every dollar</span></div>
          <ul>${bullets[i].map((b) => `<li>${e(b)}</li>`).join('')}</ul></section>`).join('')}</div>
        <div class="cv-foot"><p style="margin:0;max-width:80ch">${data.story.note ? e(data.story.note) : `<strong>People are the ministry.</strong> About ${staffCents}¢ of every dollar is staff time, counted in the End where that time is spent. Shared costs like utilities and insurance are spread by how the building is used.`}</p>
          <small>${model.unassigned ? `Draft · ${money(model.unassigned)} not yet aligned and left out of these shares` : 'Proposed budget for discussion'}</small></div>
      </div></section>`);
    }
  }

  // Slide 2 (donor view): where gifts come from and what they carry.
  let donorSlide = '';
  if (showDonor) {
    const builder = mdoSplit.church;
    const incomeGroups = sideGroups(builder, layout, true);
    const lay = layout || normalizeBoardLayout(null);
    const giftLines = incomeGroups.filter((g) => DONOR_KEYS.includes(g.key)).flatMap((g) => g.items)
      .map((l) => ({ label: accountDisplayName(lay, l.category, l.name), plan: l.plan?.plannedAmountCents || 0, prior: l.baseBudgetCents ?? null }))
      .filter((g) => g.plan || g.prior).sort((a, b) => b.plan - a.plan);
    const gifts = sum(giftLines.map((g) => g.plan));
    const other = incomeGroups.filter((g) => !DONOR_KEYS.includes(g.key)).map((g) => ({ label: g.label, plan: g.plan })).filter((g) => g.plan);
    const mdoNet = mdoSplit.mdoIncome - mdoSplit.mdoCost;
    const support = [...other, ...(mdoSplit.mdoIncome || mdoSplit.mdoCost ? [{ label: 'Mother’s Day Out, after its own costs', plan: mdoNet }] : [])];
    const ministryGroups = sideGroups(builder, layout, false);
    const ministry = sum(ministryGroups.map((g) => g.plan));
    const cents = ministry > 0 ? distribute(100, ministryGroups.map((g) => Math.max(0, g.plan))) : ministryGroups.map(() => 0);
    const otherTotal = sum(support.map((x) => x.plan));
    const gap = gifts + otherTotal - ministry;
    const giftShare = ministry > 0 ? Math.round((gifts / ministry) * 100) : 0;
    donorSlide = (`<section class="cv-slide" aria-label="How gifts are used">${rule}<div class="cv-body">
      <div class="cv-head"><div><span class="cv-eyebrow">${target} proposed budget · Donor dollars</span><h2 class="cv-serif">What your gifts carry</h2><p class="cv-lede">Gifts of ${money(gifts)} carry about ${giftShare}% of the ${money(ministry)} we plan to spend on ministry. Mother’s Day Out pays its own way${mdoNet > 0 ? ` and adds ${money(mdoNet)}` : ''}; endowments, rent and fundraisers help with the rest${gap < 0 ? `, leaving a gap of ${money(-gap)} to close together.` : '.'}</p></div>${org}</div>
      <div class="cv-two">
        <div class="cv-panel"><h3>Gifts · ${money(gifts)}</h3>${hbars(giftLines, '#2E7EA6', builder.baseYear)}
          ${support.length ? `<h3 style="margin-top:8px">Also supporting ministry · ${money(otherTotal)}</h3><table class="cv-table"><tbody>${support.map((x) => `<tr><td>${e(x.label)}</td><td class="num">${money(x.plan)}</td></tr>`).join('')}</tbody></table>` : ''}</div>
        <div class="cv-panel"><h3>Where ministry spending goes · ${money(ministry)}</h3>${hbars(ministryGroups, '#C9973A', builder.baseYear)}
          <table class="cv-table"><thead><tr><th scope="col">Of each gift dollar</th><th scope="col" class="num">Cents</th></tr></thead><tbody>${ministryGroups.map((g, i) => `<tr><td>${e(g.label)}</td><td class="num"><b>${cents[i]}¢</b></td></tr>`).join('')}</tbody></table></div>
      </div>
      <div class="cv-foot"><p style="margin:0">Gifts are counted as going where all ministry spending goes, in the same proportions. Mother’s Day Out (${money(mdoSplit.mdoCost)} in costs, ${money(mdoSplit.mdoIncome)} in tuition) is set aside here because tuition pays for it.</p><small>Proposed budget for discussion</small></div>
    </div></section>`);
  }

  // Slide 2: where the money comes from and where it goes.
  const revenueGroups = sideGroups(builder, layout, true);
  const expenseGroups = sideGroups(builder, layout, false);
  const gap = income - expenses;
  if (showWhole) slides.push(`<section class="cv-slide" aria-label="Where the money comes from and where it goes">${rule}<div class="cv-body">
    <div class="cv-head"><div><span class="cv-eyebrow">${target} proposed budget</span><h2 class="cv-serif">Where it comes from, where it goes</h2><p class="cv-lede">${money(income)} expected in, ${money(expenses)} planned out${gap === 0 ? ', balanced.' : gap > 0 ? `, ${money(gap)} to spare.` : `: a gap of ${money(-gap)} to close together.`}</p></div>${org}</div>
    <div class="cv-two">
      <div class="cv-panel"><h3>Where it comes from · ${money(income)}</h3>${hbars(revenueGroups, '#2E7EA6', builder.baseYear)}</div>
      <div class="cv-panel"><h3>Where it goes · ${money(expenses)}</h3>${hbars(expenseGroups, '#C9973A', builder.baseYear)}</div>
    </div>
    <div class="cv-foot"><p style="margin:0">Bars show the ${target} proposal. The dark mark on each bar is the ${builder.baseYear} budget, and the percentage after each amount is the change from it.</p><small>Proposed budget for discussion</small></div>
  </div></section>`);

  if (donorSlide) slides.push(donorSlide);

  // Slide 3: since 2022.
  if (trend) {
    const movers = trend.expense.map((g) => ({ label: g.label, c: change(g.values) })).filter((g) => g.c).sort((a, b) => b.c.cents - a.c.cents);
    const top = movers.slice(0, 3);
    slides.push(`<section class="cv-slide" aria-label="How the budget has changed">${rule}<div class="cv-body">
      <div class="cv-head"><div><span class="cv-eyebrow">Since ${trend.columns[0].year}</span><h2 class="cv-serif">How we got here</h2>${trend.missingYears.length ? `<p class="ma-badge warn ma-noprint">Figures for ${trend.missingYears.join(', ')} could not be read just now.</p>` : ''}<p class="cv-lede">${e(trendHeadline(trend))}</p></div>${org}</div>
      <div class="cv-panel">${wholeChart(trend, { title: 'Income and expenses, year by year' })}</div>
      ${top.length ? `<div class="cv-panel"><h3>Where spending has grown most since ${trend.columns[0].year}</h3><ul style="margin:0;padding-left:20px;font-size:17px;line-height:1.5">${top.map((m) => `<li><b>${e(m.label)}</b>: ${money(m.c.first)} → ${money(m.c.last)} (${m.c.cents >= 0 ? '+' : '−'}${money(Math.abs(m.c.cents))})</li>`).join('')}</ul></div>` : ''}
      <div class="cv-foot"><p style="margin:0">Closed years are actual results. ${builder.baseYear} is projected for the full year; ${target} is the proposal.</p><small><a href="${pageHref('trends', target)}" class="ma-noprint">See every category and line</a></small></div>
    </div></section>`);
  }

  const editor = canEdit && data ? storyEditor(builder, data, layout) : '';
  const noAlignment = data && !slides[0]?.includes('How your gifts') ? `<p class="status ma-noprint">The mission slide appears once lines are aligned on <a href="${pageHref('mission', target)}">Line items by End</a>.</p>` : '';
  return `${head}${noAlignment}${slides.join('')}${editor}`;
}

function storyEditor(builder, data, layout) {
  const model = missionModel(builder, data);
  const auto = autoBullets(model, layout);
  return `<details class="ma-panel ma-noprint"><summary><strong>Edit the words on the mission slide</strong></summary>
    <form method="POST" action="/api/v1/planning/mission-save" style="display:flex;flex-direction:column;gap:14px">
      <input type="hidden" name="target" value="${builder.targetYear}"><input type="hidden" name="base" value="${builder.baseYear}"><input type="hidden" name="revision" value="${data.revision}"><input type="hidden" name="action" value="story"><input type="hidden" name="return_page" value="congregation"><input type="hidden" name="return_target" value="${builder.targetYear}">
      <p class="ma-note">One item per line, up to six for each End. Leave an End blank to list its largest budget lines automatically.</p>
      <div class="cv-two">${MISSION_GOALS.map(([k, l], i) => `<label class="field"><span>${l}</span><textarea name="bullets_${k}" rows="4" placeholder="${e(auto[i].join('\n'))}">${e(data.story.bullets[i].join('\n'))}</textarea></label>`).join('')}</div>
      <label class="field"><span>Closing sentence (optional)</span><textarea name="note" rows="2" maxlength="600" placeholder="People are the ministry. About …¢ of every dollar is staff time…">${e(data.story.note)}</textarea></label>
      <div class="ma-actions"><button type="submit">Save slide words</button></div>
    </form></details>`;
}

// Who leads each line, and the ministry each person oversees, by End. These are line budgets, not
// pay, so every viewer of the report sees them.
function staffLinesPanel(model, lay, canSeePay = false) {
  const rows = model.rows.filter((r) => !r.isSource && r.leads?.length && r.cents).sort((a, b) => b.cents - a.cents);
  const time = model.staff.flatMap((p) => (p.timeOnLines || []).map((x) => ({ ...x, label: p.label }))).sort((a, b) => b.hours - a.hours);
  const timeTable = time.length ? `<section class="cv-panel"><div class="ma-section-head"><h3>Staff time on budget lines</h3><span class="ma-muted">From each person’s typical week; seasonal work averaged over the year. That time follows the line’s value.</span></div>
    <table class="cv-table"><thead><tr><th scope="col">Staff</th><th scope="col">Line</th><th scope="col" class="num">Hours a week</th><th scope="col" class="num">Share of their time</th>${canSeePay ? '<th scope="col" class="num">Cost of that time</th>' : ''}</tr></thead><tbody>
    ${time.map((x) => `<tr><td>${e(x.label)}</td><td>${e(accountDisplayName(lay, x.category, x.line.name))}</td><td class="num">${(x.hours / 100).toFixed(1)}</td><td class="num">${pct0(x.bp)}</td>${canSeePay ? `<td class="num">${money(x.cents)}</td>` : ''}</tr>`).join('')}
    </tbody></table></section>` : '';
  if (!rows.length) return timeTable;
  const endText = (r) => (r.status === 'spread' ? 'Like the rest of the budget' : MISSION_GOALS.map(([, l], i) => (r.shares[i] ? `${l}${r.shares[i] < FULL ? ` ${pct0(r.shares[i])}` : ''}` : '')).filter(Boolean).join(' · ') || 'Not yet aligned');
  const people = model.staff.filter((p) => p.ledCents).sort((a, b) => b.ledCents - a.ledCents);
  return `<section class="cv-panel"><div class="ma-section-head"><h3>Who leads each part of the budget</h3><span class="ma-muted">Responsibility only: each person’s pay still follows their own time.</span></div>
    <table class="cv-table"><thead><tr><th scope="col">Staff</th><th scope="col" class="num">Lines</th><th scope="col" class="num">Budget they lead</th>${MISSION_GOALS.map(([, l]) => `<th scope="col" class="num">${l}</th>`).join('')}</tr></thead><tbody>
    ${people.map((p) => `<tr><td>${e(p.label)}</td><td class="num">${p.ledLines.length}</td><td class="num"><b>${money(p.ledCents)}</b></td>${p.ledParts.map((c) => `<td class="num">${c ? money(c) : '—'}</td>`).join('')}</tr>`).join('')}
    </tbody></table>
    <table class="cv-table"><thead><tr><th scope="col">Line</th><th scope="col" class="num">Budget</th><th scope="col">Led by</th><th scope="col">Counts toward</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${e(accountDisplayName(lay, r.line.category, r.line.name))}</td><td class="num">${money(r.cents)}</td><td>${r.leads.map((x) => `${e(x.label)}${x.bp < FULL ? ` ${pct0(x.bp)}` : ''}`).join(', ')}</td><td>${e(endText(r))}</td></tr>`).join('')}
    </tbody></table></section>${timeTable}`;
}

// ── Mission report for council ───────────────────────────────────────────────────────────────

export function renderMissionReportPage({ builder, data, layout = null, admin = false, canSeePay = admin, now = new Date() }) {
  const target = builder.targetYear;
  const head = `<div class="ma-noprint">${missionChips('mission-report', target, { admin })}<div class="ma-head"><div><span class="ma-eyebrow">Budget · Mission report</span><h2>Mission alignment report</h2><p class="ma-sub">For council: the FY${target} plan by End, with the reasoning behind shared costs. Use Print for a PDF.</p></div>${yearPicker('mission-report', target, now)}</div></div>`;
  if (!data) return `${head}<p class="status status-error">Mission alignment could not be read. Reload to try again.</p>`;
  const model = missionModel(builder, data);
  const lay = layout || normalizeBoardLayout(null);
  const legend = `<div style="display:flex;gap:18px;font-size:15px;font-weight:600;flex-wrap:wrap">${MISSION_GOALS.map(([, l], i) => `<span style="display:flex;gap:8px;align-items:center"><span class="cv-sw" style="background:${PRESENT_COLORS[i]}"></span>${l}</span>`).join('')}</div>`;
  const whole = shareOf(model.totals);
  const staff = shareOf(model.staffTotals);
  const programs = shareOf(model.programTotals);
  const programPool = model.total - model.staffPool;
  const leg = (shares, amounts) => `<div class="cv-leg">${MISSION_GOALS.map(([, l], i) => `<div><span class="cv-sw" style="background:${PRESENT_COLORS[i]}"></span>${l}<span class="num">${amounts ? money(amounts[i]) : ''}</span><strong class="num">${pct0(shares[i])}</strong></div>`).join('')}</div>`;
  const people = model.staff.filter((s) => sum(s.effShares) > 0 && (admin || !s.councilHidden));
  const notes = model.rows.filter((r) => !r.isSource && (r.note || r.status === 'spread' || r.status === 'split'));
  const methodText = (r) => (r.status === 'spread' ? 'Like the rest of the budget' : MISSION_GOALS.map(([, l], i) => (r.shares[i] ? `${l} ${pct0(r.shares[i])}` : '')).filter(Boolean).join(' · '));
  return `${head}<section class="cv-slide" aria-label="Mission alignment report"><div class="cv-rule"></div><div class="cv-body">
    <div class="cv-head"><div><span class="cv-eyebrow">Mission alignment report · ${target} budget plan</span><h2 class="cv-serif" style="font-size:44px">Where the budget does the mission</h2></div>${legend}</div>
    ${model.unassigned ? `<p class="ma-badge warn" style="align-self:flex-start">Draft · ${money(model.unassigned)} (${model.needsCount} line${model.needsCount === 1 ? '' : 's'}${model.staff.some((s) => s.unassigned) ? ' and some staff time' : ''}) not yet aligned; shares below are of the aligned part.</p>` : ''}
    <div class="cv-row">
      <section class="cv-panel"><h3>Whole budget · ${money(model.total)}</h3><div class="cv-pieset">${pie(whole, { size: 220, label: `Whole budget: ${MISSION_GOALS.map(([, l], i) => `${l} ${Math.round(whole[i] / 100)} percent`).join(', ')}` })}${leg(whole, model.totals)}</div></section>
      <section class="cv-panel"><h3>Staff time · ${money(model.staffPool)}</h3>${model.staffPool ? `<div class="cv-pieset">${pie(staff, { size: 150 })}${leg(staff)}</div>` : '<p class="ma-muted">No staff compensation is linked yet.</p>'}</section>
      <section class="cv-panel"><h3>Programs &amp; building · ${money(programPool)}</h3><div class="cv-pieset">${pie(programs, { size: 150 })}${leg(programs)}</div></section>
    </div>
    ${people.length ? `<section class="cv-panel"><div class="ma-section-head"><h3>Each staff role, by End</h3><span class="ma-muted">From a typical week or a quick split · administration spread across all four</span></div>
      <div class="cv-people">${people.map((s) => `<div>${pie(s.effShares, { size: 120, label: `${s.label}: ${MISSION_GOALS.map(([, l], i) => `${l} ${Math.round(s.effShares[i] / 100)}`).join(', ')} percent` })}<strong style="font-size:16px">${e(s.label)}</strong><span style="font-size:13px;color:#3B4A63">${s.effShares.map((v) => Math.round(v / 100)).join(' · ')}</span></div>`).join('')}</div>
      <span class="ma-muted">Numbers under each chart read Welcome · Receive · Grow · Go, in percent.</span></section>` : ''}
    <section class="cv-panel"><h3>The same numbers as a table</h3><table class="cv-table"><thead><tr><th scope="col">Part of the budget</th><th scope="col" class="num">Total</th>${MISSION_GOALS.map(([, l]) => `<th scope="col" class="num">${l}</th>`).join('')}<th scope="col" class="num">Not yet aligned</th></tr></thead>
      <tbody><tr><td>Staff salaries &amp; benefits</td><td class="num">${money(model.staffPool)}</td>${model.staffTotals.map((c) => `<td class="num">${money(c)}</td>`).join('')}<td class="num">${money(model.staffPool - sum(model.staffTotals))}</td></tr>
      <tr><td>Programs &amp; building</td><td class="num">${money(programPool)}</td>${model.programTotals.map((c) => `<td class="num">${money(c)}</td>`).join('')}<td class="num">${money(programPool - sum(model.programTotals))}</td></tr></tbody>
      <tfoot><tr><td>Whole budget</td><td class="num">${money(model.total)}</td>${model.totals.map((c) => `<td class="num">${money(c)}</td>`).join('')}<td class="num">${money(model.unassigned)}</td></tr></tfoot></table></section>
    ${staffLinesPanel(model, lay, canSeePay)}
    ${notes.length ? `<section class="cv-panel"><h3>Shared and split lines, and why</h3><table class="cv-table"><thead><tr><th scope="col">Line</th><th scope="col" class="num">Budget</th><th scope="col">Split</th><th scope="col">Why</th></tr></thead><tbody>
      ${notes.map((r) => `<tr><td>${e(accountDisplayName(lay, r.line.category, r.line.name))}</td><td class="num">${money(r.cents)}</td><td>${e(methodText(r))}</td><td>${e(r.note || '—')}</td></tr>`).join('')}</tbody></table></section>` : ''}
    <div class="cv-foot"><small>Timothy Lutheran Church · From our Neighborhood to the Nations</small><small>${model.unassigned ? 'Draft for discussion' : 'Proposed budget'} · planned resource allocations, not measures of ministry impact</small></div>
  </div></section>`;
}
