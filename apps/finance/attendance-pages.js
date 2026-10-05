// Attendance: anonymous worship attendance from connect.attendance-summary.v1 (counts only). Two
// pages. "This year": the latest weekend and running averages, every Sunday of the year stacked by
// service, a rolling twelve-month rhythm with the church-year season under each month, this year
// beside the last two, the 8:00/10:45 mix by quarter, and the most recent Sundays. "Multi-year":
// one line per fiscal year of monthly averages. Server-rendered SVG with every mark titled and a
// table of the same figures wherever a chart stands alone; a month with no counts is left out of a
// chart rather than drawn as zero. Christmas, Easter and other special weekends are shown but kept
// out of the averages, exactly as Connect computes them. The previous year is read too (when
// Connect has it) so rolling views can cross the new year.
import { escapeHtml as e, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEASONS = ['Epiphany', 'Epiphany', 'Lent', 'Lent', 'Easter', 'summer', 'summer', 'summer', 'fall', 'fall', 'Advent', 'Advent'];
const OCCASION_LABELS = { none: '', christmas: 'Christmas', easter: 'Easter', funeral: 'Funeral', other: 'Special' };
const INK = '#16213A';
const MUTED = '#5B6475';
const GRID = '#E3E6EC';
const DARK = '#243642';
const LIGHT = '#97BCD0';
const GOLD = '#C48A3A';
const TEAL = '#2D5F7A';
const SERVICE_COLORS = [GOLD, TEAL, '#8A93A6'];
const YEAR_COLORS = ['#2B7BA3', '#C48A3A', '#4E9468', '#8A4FB3', '#D6453D'];
const PAD = { left: 40, right: 12, top: 22, bottom: 30 };
const EXACT = 'print-color-adjust:exact;-webkit-print-color-adjust:exact';

const count = (n) => (typeof n === 'number' ? Math.round(n).toLocaleString('en-US') : '—');
const average = (n) => (typeof n === 'number' ? (Math.round(n * 10) / 10).toLocaleString('en-US') : '—');
const signed = (n) => (n > 0 ? `+${count(n)}` : n < 0 ? `−${count(Math.abs(n))}` : '0');
const dayLabel = (iso) => {
  const [, m, d] = String(iso).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};
const timeLabel = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  return m ? `${Number(m[1])}:${m[2]}` : (t || 'Other');
};
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

function niceTop(max) {
  const raw = Math.max(max, 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
  return { step, top: Math.ceil(max / step) * step };
}

function card(title, caption, inner, { wide = false } = {}) {
  return `<figure class="pc-chart" style="margin:14px 0 18px;padding:14px 16px 10px;border:1px solid ${GRID};border-radius:12px;overflow-x:auto${wide ? '' : ''}"><figcaption><b>${e(title)}</b>${caption ? `<br><small>${e(caption)}</small>` : ''}</figcaption>${inner}</figure>`;
}

function legend(items) {
  return `<ul style="list-style:none;display:flex;flex-wrap:wrap;gap:16px;margin:6px 0 4px;padding:0;font-size:12.5px">${items.map((s) => `<li style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;display:inline-block;background:${s.color};${EXACT}"></span>${e(s.label)}</li>`).join('')}</ul>`;
}

function axes(W, H, top, step, labels, bandW) {
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v) => PAD.top + plotH - (v / top) * plotH;
  let out = '';
  for (let t = 0; t <= top + step / 2; t += step) {
    out += `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${GRID}"></line><text x="${PAD.left - 6}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${MUTED}">${Math.round(t)}</text>`;
  }
  const every = Math.ceil(labels.length / 14);
  out += labels.map((l, i) => {
    if (i % every) return '';
    const lines = String(l).split('\n');
    return `<text x="${(PAD.left + i * bandW + bandW / 2).toFixed(1)}" y="${H - 14}" text-anchor="middle" font-size="10.5" fill="${INK}" font-weight="700">${e(lines[0])}</text>${lines[1] ? `<text x="${(PAD.left + i * bandW + bandW / 2).toFixed(1)}" y="${H - 2}" text-anchor="middle" font-size="9.5" fill="${MUTED}">${e(lines[1])}</text>` : ''}`;
  }).join('');
  return { y, out };
}

function svgOf(W, H, aria, inner, minWidth = 520) {
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${e(aria)}" style="display:block;min-width:${minWidth}px">${inner}</svg>`;
}

// rows: [{ label, parts: [{ value, color, title }], total, flagged? }] — stacked columns, total on top.
function renderStackedColumns({ title, caption, series, rows, minBand = 20 }) {
  const totals = rows.map((r) => r.total).filter((v) => typeof v === 'number');
  if (!rows.length || !totals.length) return '';
  const { top, step } = niceTop(Math.max(...totals));
  const W = Math.max(640, PAD.left + PAD.right + rows.length * minBand);
  const bandW = (W - PAD.left - PAD.right) / rows.length;
  const H = 230;
  const { y, out } = axes(W, H, top, step, rows.map((r) => r.label), bandW);
  const barW = Math.min(30, bandW * 0.72);
  const showAll = bandW >= 26;
  const marks = rows.map((r, i) => {
    const x = PAD.left + i * bandW + (bandW - barW) / 2;
    let acc = 0;
    const segs = r.parts.map((p) => {
      if (!(p.value > 0)) return '';
      const y1 = y(acc + p.value);
      const h = y(acc) - y1;
      acc += p.value;
      return `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 0.5).toFixed(1)}" fill="${p.color}"><title>${e(p.title)}</title></rect>`;
    }).join('');
    const label = showAll || i % 2 === 0 || i === rows.length - 1 ? `<text x="${(x + barW / 2).toFixed(1)}" y="${(y(r.total) - 4).toFixed(1)}" text-anchor="middle" font-size="${showAll ? 10 : 8.5}" font-weight="700" fill="${INK}">${r.flagged ? '★' : ''}${count(r.total)}</text>` : '';
    return segs + label;
  }).join('');
  const aria = `${title}. ${rows.map((r) => `${r.label}: ${count(r.total)}`).join('; ')}`;
  return card(title, caption, legend(series) + svgOf(W, H, aria, out + marks, Math.min(W, 560)));
}

// rows: [{ label, value, color, title }] — single-series columns with a value above each.
function renderValueColumns({ title, caption, rows, legendItems }) {
  const vals = rows.map((r) => r.value).filter((v) => typeof v === 'number');
  if (!vals.length) return '';
  const { top, step } = niceTop(Math.max(...vals));
  const W = 640;
  const H = 230;
  const bandW = (W - PAD.left - PAD.right) / rows.length;
  const { y, out } = axes(W, H, top, step, rows.map((r) => r.label), bandW);
  const barW = Math.min(46, bandW * 0.72);
  const marks = rows.map((r, i) => {
    if (typeof r.value !== 'number') return '';
    const x = PAD.left + i * bandW + (bandW - barW) / 2;
    const h = Math.max(1, y(0) - y(r.value));
    return `<rect x="${x.toFixed(1)}" y="${(y(0) - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${r.color}"><title>${e(r.title)}</title></rect><text x="${(x + barW / 2).toFixed(1)}" y="${(y(r.value) - 5).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="${INK}">${count(r.value)}</text>`;
  }).join('');
  const aria = `${title}. ${rows.map((r) => `${r.label.replace('\n', ' ')}: ${typeof r.value === 'number' ? count(r.value) : 'not recorded'}`).join('; ')}`;
  return card(title, caption, (legendItems ? legend(legendItems) : '') + svgOf(W, H, aria, out + marks));
}

function renderLines({ title, caption, series }) {
  const nums = series.flatMap((s) => s.values).filter((v) => typeof v === 'number');
  if (!nums.length) return '';
  const { top, step } = niceTop(Math.max(...nums));
  const W = 640;
  const H = 240;
  const bandW = (W - PAD.left - PAD.right) / 12;
  const { y, out } = axes(W, H, top, step, MONTHS, bandW);
  const lines = series.map((s) => {
    const pts = s.values.map((v, i) => (typeof v === 'number' ? [PAD.left + i * bandW + bandW / 2, y(v), i, v] : null)).filter(Boolean);
    if (!pts.length) return '';
    const path = pts.length > 1 ? `<polyline points="${pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>` : '';
    return path + pts.map(([px, py, i, v]) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.2" fill="${s.color}"><title>${e(`${MONTHS[i]} · ${s.label}: ${average(v)}`)}</title></circle>`).join('');
  }).join('');
  const aria = `${title}. ${series.map((s) => `${s.label}: ${s.values.map((v, i) => `${MONTHS[i]} ${typeof v === 'number' ? average(v) : 'not recorded'}`).join(', ')}`).join('. ')}`;
  return card(title, caption, legend(series.map((s) => ({ label: s.label, color: s.color }))) + svgOf(W, H, aria, out + lines));
}

function unavailable(reason) {
  return `<section class="report" aria-label="Attendance">${renderSectionHeading({ eyebrow: 'Attendance', heading: 'Attendance', badge: 'Unavailable' })}<p class="status status-error">Attendance could not be read from Connect right now (${e(reason)}). Nothing is shown rather than guessing.</p></section>`;
}

function describeFailure(result) {
  if (!result) return 'not requested';
  if (result.reason === 'not_configured') return 'the connection to Connect is not set up in this environment';
  if (result.reason === 'http_error') return `Connect answered ${result.status}`;
  if (result.reason === 'contract_validation_failed') return 'Connect’s answer did not match the expected format';
  return 'Connect did not respond';
}

const countNote = (a) => `<p><small>Attendance is the staff-entered total for each service, anonymous (counts only, no names). Averages are per weekend and leave out Christmas, Easter and other special weekends, marked ★ where shown. Fiscal year ${e(a.fiscalYear)} (${e(a.fiscalYearStart)} to ${e(a.fiscalYearEnd)}); prepared from Connect ${e(a.generatedAt.slice(0, 10))}.</small></p>`;

// ── helpers over the one or two years Connect sent ───────────────────────────────────────────
function allWeekends(a, prior) {
  const seen = new Set();
  return [...(prior?.weekends || []), ...a.weekends].filter((w) => (seen.has(w.weekendDate) ? false : seen.add(w.weekendDate)))
    .sort((x, y) => x.weekendDate.localeCompare(y.weekendDate));
}

function servicesByDate(a, prior) {
  const map = new Map();
  for (const s of [...(prior?.services || []), ...a.services]) {
    if (s.kind !== 'regular') continue;
    if (!map.has(s.date)) map.set(s.date, new Map());
    const day = map.get(s.date);
    day.set(s.serviceTime, (day.get(s.serviceTime) || 0) + s.attendance);
  }
  return map;
}

function serviceTimes(a, prior) {
  const set = new Set();
  for (const s of [...(prior?.services || []), ...a.services]) if (s.kind === 'regular' && s.serviceTime) set.add(s.serviceTime);
  return [...set].sort();
}

function dayDiff(isoA, isoB) {
  return Math.round((Date.parse(`${isoB}T00:00:00Z`) - Date.parse(`${isoA}T00:00:00Z`)) / 86400000);
}

function renderKpis(a, prior) {
  const all = allWeekends(a, prior);
  const latest = a.weekends.at(-1);
  if (!latest) return '<p class="status status-pending">No attendance has been recorded yet this year.</p>';
  const before = all.filter((w) => w.weekendDate < latest.weekendDate).at(-1);
  const vsPrior = before ? latest.total - before.total : null;
  const counted = all.filter((w) => w.countsTowardAverages);
  const last4 = counted.filter((w) => w.weekendDate <= latest.weekendDate).slice(-4);
  const last52 = counted.filter((w) => w.weekendDate <= latest.weekendDate && dayDiff(w.weekendDate, latest.weekendDate) < 364);
  // This year against last: months where both years have an average, so a short year is not
  // compared with a whole one.
  const both = a.monthly.filter((m) => typeof m.averagePerWeekend === 'number' && typeof m.priorYearAveragePerWeekend === 'number');
  const ytd = both.length ? (mean(both.map((m) => m.averagePerWeekend)) / mean(both.map((m) => m.priorYearAveragePerWeekend)) - 1) * 100 : null;
  return renderKpis_(latest, vsPrior, last4, last52, ytd, a);
}

function renderKpis_(latest, vsPrior, last4, last52, ytd, a) {
  const occ = OCCASION_LABELS[latest.occasion];
  const delta = vsPrior == null ? '' : ` <span style="font-size:13px;color:${vsPrior < 0 ? '#8A2B1E' : '#1F6B45'}">${vsPrior === 0 ? 'same as prior week' : `${signed(vsPrior)} vs prior week`}</span>`;
  return renderKpiCards([
    { label: 'Latest weekend', value: `${count(latest.total)}${delta}`, hint: e(`${dayLabel(latest.weekendDate)}${occ ? ` · ${occ}` : ''}`) },
    { label: '4-week average', value: average(mean(last4.map((w) => w.total))), hint: 'Regular weekends' },
    { label: '52-week average', value: average(mean(last52.map((w) => w.total))), hint: `${last52.length} regular weekends` },
    { label: `This year vs ${a.fiscalYear - 1}`, value: ytd == null ? '—' : `${ytd > 0 ? '+' : ytd < 0 ? '−' : ''}${Math.abs(Math.round(ytd))}%`, hint: 'Average per weekend, matching months' },
    { label: 'Sundays recorded', value: String(a.weekends.length), hint: `FY${a.fiscalYear}` },
  ]);
}

function renderSundaysChart(a, prior) {
  const times = serviceTimes(a, prior);
  const byDate = servicesByDate(a, prior);
  const series = times.map((t, i) => ({ label: `${timeLabel(t)} service`, color: SERVICE_COLORS[Math.min(i, SERVICE_COLORS.length - 1)] }));
  const rows = a.weekends.map((w) => {
    const day = byDate.get(w.weekendDate) || new Map();
    const parts = times.map((t, i) => ({ value: day.get(t) || 0, color: SERVICE_COLORS[Math.min(i, SERVICE_COLORS.length - 1)], title: `${dayLabel(w.weekendDate)} · ${timeLabel(t)}: ${count(day.get(t) || 0)}` }));
    const known = parts.reduce((s, p) => s + p.value, 0);
    // A weekend whose total is more than its regular services (a special service that day) shows the
    // rest in a neutral segment so the column still reaches the weekend's total.
    if (w.total > known) parts.push({ value: w.total - known, color: '#B9C0CC', title: `${dayLabel(w.weekendDate)} · other services: ${count(w.total - known)}` });
    return { label: dayLabel(w.weekendDate), parts, total: w.total, flagged: !w.countsTowardAverages };
  });
  return renderStackedColumns({
    title: `Sundays this year, FY${a.fiscalYear}`,
    caption: 'Each column is one weekend, split by service. ★ marks Christmas, Easter and other special weekends, which are left out of averages.',
    series, rows,
  });
}

function rollingMonths(a, prior) {
  const entries = [];
  for (const [src, year] of [[prior, a.fiscalYear - 1], [a, a.fiscalYear]]) {
    if (!src) continue;
    for (const m of src.monthly) entries.push({ year, month: m.month, value: m.averagePerWeekend });
  }
  const filled = entries.filter((x) => typeof x.value === 'number');
  return filled.slice(-12);
}

function renderRhythm(a, prior) {
  const months = rollingMonths(a, prior);
  if (!months.length) return '';
  const avg = mean(months.map((m) => m.value));
  const first = months[0];
  const last = months.at(-1);
  return renderValueColumns({
    title: 'Monthly rhythm',
    caption: `Average Sunday attendance per month · ${MONTHS[first.month - 1]} ’${String(first.year).slice(2)} – ${MONTHS[last.month - 1]} ’${String(last.year).slice(2)}. Darker bars are above the period’s average (${average(avg)}).`,
    rows: months.map((m) => ({
      label: `${MONTHS[m.month - 1]}\n${SEASONS[m.month - 1]}`,
      value: m.value, color: m.value > avg ? DARK : LIGHT,
      title: `${MONTHS[m.month - 1]} ${m.year}: ${average(m.value)}`,
    })),
  });
}

function renderYearOverYear(a) {
  const years = [...a.history].sort((x, y) => x.fiscalYear - y.fiscalYear).slice(-3);
  if (years.length < 2) return '';
  const all = years.flatMap((h) => h.averagePerWeekendByMonth).filter((v) => typeof v === 'number');
  if (!all.length) return '';
  const max = Math.max(...all);
  const shades = ['#DCE6EC', '#97BCD0', '#2D5F7A'].slice(-years.length);
  const cur = years.at(-1);
  const prev = years.at(-2);
  const rows = MONTHS.map((m, i) => {
    const vals = years.map((h) => h.averagePerWeekendByMonth[i]);
    if (!vals.some((v) => typeof v === 'number')) return '';
    const d = typeof cur.averagePerWeekendByMonth[i] === 'number' && typeof prev.averagePerWeekendByMonth[i] === 'number'
      ? cur.averagePerWeekendByMonth[i] - prev.averagePerWeekendByMonth[i] : null;
    const cells = vals.map((v, k) => `<td style="white-space:nowrap">${typeof v === 'number' ? `<span style="display:inline-block;height:9px;border-radius:2px;width:${Math.max(2, (v / max) * 90).toFixed(0)}px;background:${shades[k]};${EXACT};vertical-align:middle"></span> ${count(v)}` : '—'}</td>`).join('');
    return `<tr><td><b>${m}</b></td>${cells}<td style="text-align:right;font-weight:700;color:${d == null ? MUTED : d < 0 ? '#8A2B1E' : '#1F6B45'}">${d == null ? '—' : signed(Math.round(d))}</td></tr>`;
  }).join('');
  const table = `<div class="table-wrap"><table><thead><tr><th>Month</th>${years.map((h) => `<th>${h.fiscalYear}</th>`).join('')}<th style="text-align:right">Δ ${cur.fiscalYear} vs ${prev.fiscalYear}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  return card('Year over year', 'Average Sunday attendance by month', table);
}

function renderServiceMix(a, prior, times) {
  if (times.length < 2) return '';
  const quarters = new Map();
  for (const [src, year] of [[prior, a.fiscalYear - 1], [a, a.fiscalYear]]) {
    if (!src) continue;
    for (const m of src.monthly) {
      if (!m.byService.length) continue;
      const key = `${year}-Q${Math.ceil(m.month / 3)}`;
      if (!quarters.has(key)) quarters.set(key, new Map());
      const q = quarters.get(key);
      for (const s of m.byService) q.set(s.serviceTime, (q.get(s.serviceTime) || 0) + s.total);
    }
  }
  const keys = [...quarters.keys()].sort().slice(-5);
  if (!keys.length) return '';
  const early = times[0];
  const late = times.at(-1);
  const rows = keys.map((k) => {
    const q = quarters.get(k);
    const a1 = q.get(early) || 0;
    const b1 = q.get(late) || 0;
    const total = a1 + b1;
    const share = total ? (b1 / total) * 100 : 0;
    return `<div style="margin:0 0 12px"><div style="display:flex;justify-content:space-between;font-size:13px"><b>${e(k)}</b><span><span style="color:${GOLD};font-weight:700">${count(a1)}</span> · <span style="color:${TEAL};font-weight:700">${count(b1)}</span> · ${Math.round(share)}% at ${e(timeLabel(late))}</span></div>
      <div style="display:flex;height:14px;border-radius:7px;overflow:hidden;margin-top:3px"><span style="width:${(100 - share).toFixed(1)}%;background:${GOLD};${EXACT}"></span><span style="width:${share.toFixed(1)}%;background:${TEAL};${EXACT}"></span></div></div>`;
  }).join('');
  return card('Service mix', `${timeLabel(early)} vs. ${timeLabel(late)}, by quarter`, rows);
}

function renderRecent(a, prior, times) {
  const byDate = servicesByDate(a, prior);
  const recent = allWeekends(a, prior).slice(-8).reverse();
  if (!recent.length) return '';
  return renderTable({
    head: ['Sunday', ...times.map(timeLabel), 'Total', 'Note'],
    rows: recent.map((w) => {
      const day = byDate.get(w.weekendDate) || new Map();
      return `<tr><td>${e(dayLabel(w.weekendDate))}</td>${times.map((t) => `<td>${day.has(t) ? count(day.get(t)) : '—'}</td>`).join('')}<td><b>${count(w.total)}</b></td><td>${e(OCCASION_LABELS[w.occasion] || '')}${w.countsTowardAverages ? '' : ' (not in averages)'}</td></tr>`;
    }).join(''),
  });
}

function renderOverview(a, prior) {
  const times = serviceTimes(a, prior);
  return `<section class="report" aria-label="Attendance">
    ${renderSectionHeading({ eyebrow: 'Attendance', heading: `Worship attendance, FY${a.fiscalYear}`, badge: a.reconciliation.totalsMatch ? 'Reconciled' : 'Review required' })}
    ${renderKpis(a, prior)}
    ${renderSundaysChart(a, prior)}
    ${renderRhythm(a, prior)}
    ${renderYearOverYear(a)}
    ${renderServiceMix(a, prior, times)}
    <h3>Recent Sundays</h3>
    ${renderRecent(a, prior, times)}
    ${countNote(a)}
  </section>`;
}

function renderTrend(a) {
  const years = [...a.history].sort((x, y) => y.fiscalYear - x.fiscalYear).slice(0, 5);
  const series = years.map((h, i) => ({ label: String(h.fiscalYear), color: YEAR_COLORS[i], values: h.averagePerWeekendByMonth }));
  const chart = renderLines({ title: 'Year-over-year trend', caption: `Average Sunday attendance per month, ${years.at(-1)?.fiscalYear ?? ''}–${years[0]?.fiscalYear ?? ''}. A month with no counts is left blank.`, series });
  const ordered = [...years].reverse();
  const table = renderTable({
    head: ['Month', ...ordered.map((h) => String(h.fiscalYear))],
    rows: MONTHS.map((m, i) => `<tr><td>${m}</td>${ordered.map((h) => `<td>${average(h.averagePerWeekendByMonth[i])}</td>`).join('')}</tr>`).join(''),
  });
  return `<section class="report" aria-label="Attendance multi-year">
    ${renderSectionHeading({ eyebrow: 'Attendance', heading: 'Attendance, multi-year', badge: `${years.length} fiscal year${years.length === 1 ? '' : 's'}` })}
    ${chart || '<p>No monthly history is on file yet.</p>'}
    <details open><summary>Monthly averages by year</summary>${table}</details>
    ${countNote(a)}
  </section>`;
}

export function renderAttendancePage(pageId, { result } = {}) {
  if (!result?.ok) return unavailable(describeFailure(result));
  return pageId === 'trend' ? renderTrend(result.attendance) : renderOverview(result.attendance, result.prior || null);
}
