// Budget › District support: Timothy's planned mission support to the Missouri District and Synod
// beside the benchmark averages, per congregation and per baptized / confirmed member. The support
// is the plan's District & Synod board category (or lines named for the district or synod); member
// counts are totals an admin enters each year, never individual records.
import { escapeHtml as e } from './render-helpers.js';
import { boardCategoryFor, normalizeBoardLayout, accountDisplayName } from './board-layout.js';
import { districtFrom, DISTRICT_TOTALS } from './mission-alignment.js';
import { missionChips, money, yearPicker, sum } from './mission-ui.js';

const exact = (c) => (c == null ? '—' : `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const plan = (l) => l.plan?.plannedAmountCents || 0;

export function districtLines(builder, layout) {
  const lay = layout || normalizeBoardLayout(null);
  return builder.lines.filter((l) => l.classification !== 'Income' && (boardCategoryFor(lay, l.category, l.name, false).key === 'district_synod' || /district|synod/i.test(`${l.category} ${l.name || ''}`)));
}

export function districtComparison(builder, district, layout) {
  const d = district || districtFrom(null);
  const lines = districtLines(builder, layout);
  const total = sum(lines.map(plan));
  const prior = lines.some((l) => l.baseBudgetCents != null) ? sum(lines.map((l) => l.baseBudgetCents || 0)) : null;
  const per = (n) => (n ? Math.round(total / n) : null);
  const timothy = { perCongregation: total, perBaptized: per(d.baptized), perConfirmed: per(d.confirmed) };
  const measures = [
    { key: 'perCongregation', label: 'Per congregation', count: 1 },
    { key: 'perBaptized', label: 'Per baptized member', count: d.baptized },
    { key: 'perConfirmed', label: 'Per confirmed member', count: d.confirmed },
  ];
  // What Timothy would give at each benchmark's rate, for its own size.
  const atRate = (b, m) => (m.count ? b[m.key] * m.count : null);
  return { lines, total, prior, timothy, measures, benchmarks: d.benchmarks, district: d, atRate };
}

// One bar per measure, from the lowest district to the highest, with Timothy, Missouri and the
// median marked. Timothy can sit beyond either end.
function rangeBars(c) {
  const by = (k) => c.benchmarks.find((b) => b.key === k);
  const low = by('low'); const high = by('high'); const mo = by('mo'); const median = by('median');
  if (!low || !high) return '';
  const fmt = (m, v) => (m.key === 'perCongregation' ? money(v) : exact(v));
  return `<div class="ds-bars">${c.measures.map((m) => {
    const t = c.timothy[m.key];
    const lo = Math.min(low[m.key], t ?? Infinity); const hi = Math.max(high[m.key], t ?? 0);
    const pos = (v) => `${(((v - lo) / Math.max(1, hi - lo)) * 100).toFixed(1)}%`;
    const marks = [
      t != null ? { v: t, label: 'Timothy', cls: 'is-us' } : null,
      mo ? { v: mo[m.key], label: 'Missouri', cls: 'is-mo' } : null,
      median ? { v: median[m.key], label: 'Median', cls: 'is-med' } : null,
    ].filter(Boolean);
    const note = t == null ? 'Enter member counts below to place Timothy.'
      : t > high[m.key] ? `Timothy is above the highest district average (${high.where?.[m.key] || 'highest'}).`
        : t < low[m.key] ? `Timothy is below the lowest district average (${low.where?.[m.key] || 'lowest'}).`
          : `Timothy is ${t >= (median?.[m.key] ?? 0) ? 'above' : 'below'} the median district.`;
    return `<div class="ds-group"><strong>${e(m.label)}</strong>
      <div class="ds-range" role="img" aria-label="${e(`${m.label}: districts range from ${fmt(m, low[m.key])} to ${fmt(m, high[m.key])}; ${marks.map((x) => `${x.label} ${fmt(m, x.v)}`).join(', ')}`)}">
        <span class="ds-span" style="left:${pos(low[m.key])};width:calc(${pos(high[m.key])} - ${pos(low[m.key])})"></span>
        ${marks.map((x) => `<span class="ds-mark ${x.cls}" style="left:${pos(x.v)}" title="${e(`${x.label} ${fmt(m, x.v)}`)}"></span>`).join('')}
      </div>
      <div class="ds-ends"><span>${fmt(m, low[m.key])}<br><small>${e(low.where?.[m.key] || 'Lowest')}</small></span><span style="text-align:right">${fmt(m, high[m.key])}<br><small>${e(high.where?.[m.key] || 'Highest')}</small></span></div>
      <div class="ds-legend">${marks.map((x) => `<span><i class="ds-key ${x.cls}"></i>${e(x.label)} ${fmt(m, x.v)}</span>`).join('')}</div>
      <span class="ma-note">${e(note)}</span></div>`;
  }).join('')}</div>`;
}

export function renderDistrictSupportPage({ builder, data, layout = null, params, canEdit = false, now = new Date() }) {
  const target = builder.targetYear;
  const c = districtComparison(builder, data?.district, layout);
  const lay = layout || normalizeBoardLayout(null);
  const d = c.district;
  const status = params?.get('status') === 'ok' && params?.get('mission') === '1' ? '<p class="status status-ok" role="status">Saved.</p>'
    : params?.get('status') === 'error' ? `<p class="status status-error" role="alert">${e(String(params.get('message') || 'The change could not be saved.').slice(0, 200))} Nothing was saved.</p>` : '';
  const cols = c.benchmarks.filter((b) => !b.range);
  const lowB = c.benchmarks.find((b) => b.key === 'low'); const highB = c.benchmarks.find((b) => b.key === 'high');
  const fmtM = (m, v) => (m.key === 'perCongregation' ? money(v) : exact(v));
  const diff = (t, b) => (t == null || !b ? '—' : `${t >= b ? '+' : '−'}${Math.abs(((t - b) / b) * 100).toFixed(0)}%`);
  const table = `<div class="ma-frame"><table class="ma-table"><thead><tr><th scope="col">Measure</th><th scope="col" class="num">Timothy FY${target}</th>${cols.map((b) => `<th scope="col" class="num">${e(b.label)}</th>`).join('')}<th scope="col" class="num">Range across districts</th><th scope="col" class="num">Timothy vs Missouri</th></tr></thead><tbody>
    ${c.measures.map((m) => { const t = c.timothy[m.key]; const mo = c.benchmarks.find((b) => b.key === 'mo'); return `<tr><td>${e(m.label)}</td><td class="num"><b>${t == null ? '<span class="ma-muted">enter members below</span>' : (m.key === 'perCongregation' ? money(t) : exact(t))}</b></td>${cols.map((b) => `<td class="num">${fmtM(m, b[m.key])}</td>`).join('')}<td class="num">${lowB && highB ? `${fmtM(m, lowB[m.key])} – ${fmtM(m, highB[m.key])}` : '—'}</td><td class="num">${diff(t, mo?.[m.key])}</td></tr>`; }).join('')}
  </tbody></table></div>`;
  const gaps = c.measures.filter((m) => m.key !== 'perCongregation' && m.count).flatMap((m) => c.benchmarks.filter((b) => ['mo', 'median', 'all'].includes(b.key)).map((b) => ({ m, b, at: c.atRate(b, m) })));
  const gapTable = gaps.length ? `<div class="ma-frame"><table class="ma-table"><thead><tr><th scope="col">If Timothy gave at…</th><th scope="col" class="num">Total</th><th scope="col" class="num">Difference from the plan</th></tr></thead><tbody>
    ${gaps.map(({ m, b, at }) => `<tr><td>${e(b.label)} ${e(m.label.toLowerCase())} × ${m.count.toLocaleString('en-US')}</td><td class="num">${money(at)}</td><td class="num">${at - c.total >= 0 ? `${money(at - c.total)} more` : `${money(c.total - at)} less`}</td></tr>`).join('')}
  </tbody></table></div>` : '';
  const form = canEdit && data ? `<details class="ma-panel ma-noprint"${d.baptized && d.confirmed ? '' : ' open'}><summary><strong>Member counts and benchmark figures</strong></summary>
    <form method="POST" action="/api/v1/planning/mission-save" style="display:flex;flex-direction:column;gap:14px">
      <input type="hidden" name="target" value="${target}"><input type="hidden" name="base" value="${builder.baseYear}"><input type="hidden" name="revision" value="${data.revision}"><input type="hidden" name="action" value="district"><input type="hidden" name="return_page" value="district"><input type="hidden" name="return_target" value="${target}">
      <div style="display:flex;gap:16px;flex-wrap:wrap"><label class="field"><span>Baptized members</span><input name="baptized" inputmode="numeric" value="${d.baptized ?? ''}" style="width:120px"></label><label class="field"><span>Confirmed members</span><input name="confirmed" inputmode="numeric" value="${d.confirmed ?? ''}" style="width:120px"></label></div>
      <p class="ma-note" style="margin:0">Totals only, as reported for the year. Update the benchmark figures when new averages are published.</p>
      <div class="ma-frame"><table class="ma-table"><thead><tr><th scope="col">Benchmark</th><th scope="col">Per congregation</th><th scope="col">Per baptized</th><th scope="col">Per confirmed</th></tr></thead><tbody>
      ${d.benchmarks.map((b) => `<tr><td>${e(b.label)}</td>${[['congregation', 'perCongregation'], ['baptized', 'perBaptized'], ['confirmed', 'perConfirmed']].map(([f, k]) => `<td><input name="${b.key}_${f}" inputmode="decimal" value="${(b[k] / 100).toFixed(2)}" style="width:110px;text-align:right" aria-label="${e(`${b.label} ${f}`)}"></td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <div class="ma-actions" style="justify-content:flex-start"><button type="submit">Save</button></div>
    </form></details>` : '';
  return `${missionChips('district', target, { admin: canEdit })}
    <div class="ma-head"><div><span class="ma-eyebrow">Budget · District support</span><h2>Mission support to the District and Synod</h2><p class="ma-sub">FY${target} plan: ${money(c.total)}${c.prior != null ? ` (FY${builder.baseYear} budget ${money(c.prior)})` : ''}${d.baptized ? ` · ${d.baptized} baptized, ${d.confirmed ?? '—'} confirmed members` : ''}</p></div>${yearPicker('district', target, now)}</div>
    ${status}
    <section class="ma-section"><h2>How Timothy compares</h2>${table}${rangeBars(c)}</section>
    <p class="ma-note">For context, a district’s total support received in a year ranges from ${money(DISTRICT_TOTALS.low.cents)} (${DISTRICT_TOTALS.low.where}) to ${money(DISTRICT_TOTALS.high.cents)} (${DISTRICT_TOTALS.high.where}); the average is ${money(DISTRICT_TOTALS.mean)} and the median ${money(DISTRICT_TOTALS.median)}. Those are whole districts, so they are not compared with Timothy above.</p>
    ${gapTable ? `<section class="ma-section"><h2>At each average</h2>${gapTable}</section>` : ''}
    <section class="ma-section"><h2>Lines counted</h2><div class="ma-frame"><table class="ma-table"><thead><tr><th scope="col">Budget line</th><th scope="col" class="num">FY${builder.baseYear} budget</th><th scope="col" class="num">FY${target} plan</th></tr></thead><tbody>
      ${c.lines.map((l) => `<tr><td>${e(accountDisplayName(lay, l.category, l.name))}</td><td class="num">${l.baseBudgetCents == null ? '—' : money(l.baseBudgetCents)}</td><td class="num">${money(plan(l))}</td></tr>`).join('') || '<tr><td colspan="3" class="ma-muted">No District &amp; Synod lines in this plan.</td></tr>'}
      </tbody><tfoot><tr><td>Total</td><td class="num">${c.prior == null ? '—' : money(c.prior)}</td><td class="num">${money(c.total)}</td></tr></tfoot></table></div>
      <p class="ma-note">Counts the plan’s District &amp; Synod Support category (or lines named for the district or synod). Benchmarks are the averages entered above.</p></section>
    ${form}`;
}

export const DISTRICT_STYLES = `
  .ds-bars { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:18px; }
  .ds-group { display:flex; flex-direction:column; gap:8px; border:1px solid #D7E2E9; border-radius:12px; padding:16px; background:#fff; }
  .ds-range { position:relative; height:22px; margin:14px 8px 0; background:#EEF2F5; border-radius:11px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .ds-span { position:absolute; top:0; bottom:0; background:#C7D3DB; border-radius:11px; }
  .ds-mark { position:absolute; top:-5px; width:6px; height:32px; margin-left:-3px; border-radius:3px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .ds-ends { display:flex; justify-content:space-between; font-size:13px; font-variant-numeric:tabular-nums; }
  .ds-ends small { color:#536B79; }
  .ds-legend { display:flex; flex-wrap:wrap; gap:12px; font-size:13px; }
  .ds-key { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:5px; vertical-align:-1px; }
  .is-us { background:#1B2A4A; } .is-mo { background:#C9973A; } .is-med { background:#7A8B99; }
`;
