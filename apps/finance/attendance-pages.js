// Attendance: anonymous worship attendance from connect.attendance-summary.v1 (counts only). Two
// pages: this year (each weekend, monthly average against last year, by service time) and the
// multi-year view (monthly average, one line per fiscal year). Server-rendered SVG with every mark
// titled and every chart backed by a table of the same figures; a month with no counts is left out
// of a chart rather than drawn as zero. Christmas and Easter weekends are shown but kept out of the
// averages, exactly as Connect computes them.
import { escapeHtml as e, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';
import { CHART_COLORS } from './property-charts.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YEAR_COLORS = [CHART_COLORS.muted, '#2E8B6E', '#8A4FB3', CHART_COLORS.secondary, CHART_COLORS.primary];
const OCCASION_LABELS = { none: '', christmas: 'Christmas', easter: 'Easter', funeral: 'Funeral', other: 'Special' };
const W = 640;
const PAD = { left: 44, right: 12, top: 14, bottom: 30 };

const count = (n) => (typeof n === 'number' ? Math.round(n).toLocaleString('en-US') : '—');
const average = (n) => (typeof n === 'number' ? (Math.round(n * 10) / 10).toLocaleString('en-US') : '—');
const dayLabel = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};

function niceTop(max) {
  const raw = Math.max(max, 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
  return { step, top: Math.ceil(max / step) * step };
}

function frame(height, top, step, labels, bandW) {
  const plotH = height - PAD.top - PAD.bottom;
  const y = (v) => PAD.top + plotH - (v / top) * plotH;
  let grid = '';
  for (let t = 0; t <= top + step / 2; t += step) {
    grid += `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${CHART_COLORS.grid}" stroke-width="1"></line>`
      + `<text x="${PAD.left - 6}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${CHART_COLORS.muted}">${Math.round(t)}</text>`;
  }
  const every = Math.ceil(labels.length / 12);
  const xl = labels.map((l, i) => (i % every ? '' : `<text x="${(PAD.left + i * bandW + bandW / 2).toFixed(1)}" y="${height - 10}" text-anchor="middle" font-size="10.5" fill="${CHART_COLORS.muted}">${e(l)}</text>`)).join('');
  return { y, axes: grid + xl };
}

function legendHtml(series) {
  if (series.length < 2) return '';
  return `<ul style="list-style:none;display:flex;flex-wrap:wrap;gap:16px;margin:0 0 4px;padding:0;font-size:12.5px">${series.map((s) => `<li style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;display:inline-block;background:${s.color}"></span>${e(s.label)}</li>`).join('')}</ul>`;
}

function figure(title, caption, series, svg, aria) {
  return `<figure class="pc-chart" style="margin:14px 0 18px;padding:14px 16px 8px;border:1px solid ${CHART_COLORS.grid};border-radius:12px;overflow-x:auto"><figcaption><b>${e(title)}</b>${caption ? `<br><small>${e(caption)}</small>` : ''}</figcaption>${legendHtml(series)}<svg viewBox="0 0 ${W} 220" width="100%" role="img" aria-label="${e(aria)}" style="display:block;min-width:520px">${svg}</svg></figure>`;
}

// rows: [{ label, values: [number|null per series], colors?: [color per series] }]
export function renderCountColumns({ title, caption = '', series, rows }) {
  const nums = rows.flatMap((r) => r.values).filter((v) => typeof v === 'number');
  if (!rows.length || !nums.length) return '';
  const { top, step } = niceTop(Math.max(...nums));
  const bandW = (W - PAD.left - PAD.right) / rows.length;
  const { y, axes } = frame(220, top, step, rows.map((r) => r.label), bandW);
  const n = series.length;
  const barW = Math.min(26, (bandW * 0.75 - (n - 1) * 2) / n);
  const groupW = n * barW + (n - 1) * 2;
  const marks = rows.map((r, i) => r.values.map((v, s) => {
    if (typeof v !== 'number') return '';
    const x = PAD.left + i * bandW + (bandW - groupW) / 2 + s * (barW + 2);
    const color = (r.colors && r.colors[s]) || series[s].color;
    const h = Math.max(1, y(0) - y(v));
    return `<rect x="${x.toFixed(1)}" y="${(y(0) - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${color}"><title>${e(`${r.label} · ${series[s].label}: ${count(v)}`)}</title></rect>`;
  }).join('')).join('');
  const aria = `${title}. ${rows.map((r) => `${r.label}: ${r.values.map((v, s) => `${series[s].label} ${typeof v === 'number' ? count(v) : 'not recorded'}`).join(', ')}`).join('; ')}`;
  return figure(title, caption, series, axes + marks, aria);
}

export function renderCountLines({ title, caption = '', series, labels }) {
  const nums = series.flatMap((s) => s.values).filter((v) => typeof v === 'number');
  if (!nums.length) return '';
  const { top, step } = niceTop(Math.max(...nums));
  const bandW = (W - PAD.left - PAD.right) / labels.length;
  const { y, axes } = frame(220, top, step, labels, bandW);
  const lines = series.map((s) => {
    const pts = s.values.map((v, i) => (typeof v === 'number' ? [PAD.left + i * bandW + bandW / 2, y(v), i, v] : null)).filter(Boolean);
    if (!pts.length) return '';
    const dots = pts.map(([px, py, i, v]) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${pts.length === 1 ? 4 : 3}" fill="${s.color}"><title>${e(`${labels[i]} · ${s.label}: ${average(v)}`)}</title></circle>`).join('');
    const path = pts.length > 1 ? `<polyline points="${pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>` : '';
    return path + dots;
  }).join('');
  const aria = `${title}. ${series.map((s) => `${s.label}: ${s.values.map((v, i) => `${labels[i]} ${typeof v === 'number' ? average(v) : 'not recorded'}`).join(', ')}`).join('. ')}`;
  return figure(title, caption, series, axes + lines, aria);
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

const countNote = (a) => `<p><small>Attendance is the staff-entered total for each service; it is anonymous (counts only, no names). Averages are per weekend and leave out Christmas and Easter weekends, which are shown separately. Fiscal year ${e(a.fiscalYear)} (${e(a.fiscalYearStart)} to ${e(a.fiscalYearEnd)}); prepared from Connect ${e(a.generatedAt.slice(0, 10))}.</small></p>`;

function renderOverview(a) {
  const weekends = a.weekends;
  const counted = weekends.filter((w) => w.countsTowardAverages);
  const latest = weekends.at(-1);
  const ytdAvg = counted.length ? counted.reduce((s, w) => s + w.total, 0) / counted.length : null;
  const comparable = counted.filter((w) => typeof w.priorYearTotal === 'number');
  const priorAvg = comparable.length ? comparable.reduce((s, w) => s + w.priorYearTotal, 0) / comparable.length : null;
  const thisAvgComparable = comparable.length ? comparable.reduce((s, w) => s + w.total, 0) / comparable.length : null;
  const change = thisAvgComparable != null && priorAvg != null ? thisAvgComparable - priorAvg : null;
  const kpis = renderKpiCards([
    { label: 'Latest weekend', value: latest ? count(latest.total) : '—', hint: latest ? e(`${dayLabel(latest.weekendDate)}${OCCASION_LABELS[latest.occasion] ? ` · ${OCCASION_LABELS[latest.occasion]}` : ''}`) : 'No counts yet' },
    { label: 'Average per weekend', value: average(ytdAvg), hint: `${counted.length} weekend${counted.length === 1 ? '' : 's'} counted this year` },
    { label: 'Compared with last year', value: change == null ? '—' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${average(Math.abs(change))}`, hint: change == null ? 'No matching weekends last year' : `Same ${comparable.length} weekend${comparable.length === 1 ? '' : 's'}, average per weekend` },
  ]);
  const weekChart = renderCountColumns({
    title: `Attendance by weekend, ${a.fiscalYear}`,
    caption: 'Christmas, Easter and other special weekends are marked and not counted in averages.',
    series: [{ label: 'Regular weekend', color: CHART_COLORS.primary }, { label: 'Special weekend', color: CHART_COLORS.secondary }],
    rows: weekends.map((w) => ({ label: dayLabel(w.weekendDate), values: [w.total], colors: [w.countsTowardAverages ? CHART_COLORS.primary : CHART_COLORS.secondary] })),
  });
  const monthRows = a.monthly.map((m) => ({ label: MONTHS[m.month - 1], values: [m.priorYearAveragePerWeekend, m.averagePerWeekend] }));
  const monthChart = renderCountColumns({
    title: 'Average attendance per weekend, by month',
    caption: `${a.fiscalYear} against ${a.fiscalYear - 1}`,
    series: [{ label: String(a.fiscalYear - 1), color: CHART_COLORS.muted }, { label: String(a.fiscalYear), color: CHART_COLORS.primary }],
    rows: monthRows,
  });
  const weekendTable = renderTable({
    head: ['Weekend', 'Attendance', 'Last year (same weekend)', 'Note'],
    rows: weekends.map((w) => `<tr><td>${e(dayLabel(w.weekendDate))}</td><td>${count(w.total)}</td><td>${w.priorYearTotal == null ? '—' : `${e(dayLabel(w.priorYearWeekendDate))}: ${count(w.priorYearTotal)}`}</td><td>${e(OCCASION_LABELS[w.occasion] || '')}${w.countsTowardAverages ? '' : ' (not in averages)'}</td></tr>`).join('') || '<tr><td colspan="4">No counts yet this year.</td></tr>',
  });
  const monthTable = renderTable({
    head: ['Month', 'Weekends counted', 'Average per weekend', `Average ${a.fiscalYear - 1}`, 'By service time (average)'],
    rows: a.monthly.filter((m) => m.weekendCount > 0).map((m) => `<tr><td>${MONTHS[m.month - 1]}</td><td>${m.countedWeekendCount} of ${m.weekendCount}</td><td>${average(m.averagePerWeekend)}</td><td>${average(m.priorYearAveragePerWeekend)}</td><td>${m.byService.map((s) => `${e(s.serviceTime || 'Other')}: ${average(s.average)}`).join(' · ') || '—'}</td></tr>`).join('') || '<tr><td colspan="5">No counts yet this year.</td></tr>',
  });
  return `<section class="report" aria-label="Attendance">
    ${renderSectionHeading({ eyebrow: 'Attendance', heading: `Worship attendance, FY${a.fiscalYear}`, badge: a.reconciliation.totalsMatch ? 'Reconciled' : 'Review required' })}
    ${kpis}${weekChart}${monthChart}
    <details open><summary>Each weekend</summary>${weekendTable}</details>
    <details><summary>By month and service time</summary>${monthTable}</details>
    ${countNote(a)}
  </section>`;
}

function renderTrend(a) {
  const years = [...a.history].sort((x, y) => x.fiscalYear - y.fiscalYear).slice(-5);
  const series = years.map((h, i) => ({ label: String(h.fiscalYear), color: YEAR_COLORS[YEAR_COLORS.length - years.length + i], values: h.averagePerWeekendByMonth }));
  const chart = renderCountLines({ title: 'Average attendance per weekend, by month', caption: `Each line is one fiscal year (${years[0]?.fiscalYear ?? ''}–${years.at(-1)?.fiscalYear ?? ''}); months with no counts are left blank.`, series, labels: MONTHS });
  const table = renderTable({
    head: ['Month', ...years.map((h) => String(h.fiscalYear))],
    rows: MONTHS.map((m, i) => `<tr><td>${m}</td>${years.map((h) => `<td>${average(h.averagePerWeekendByMonth[i])}</td>`).join('')}</tr>`).join(''),
  });
  const yearAvg = years.map((h) => {
    const vals = h.averagePerWeekendByMonth.filter((v) => typeof v === 'number');
    return { year: h.fiscalYear, avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null, months: vals.length };
  });
  const yearChart = renderCountColumns({
    title: 'Average of the monthly averages, by year',
    caption: 'Only months with counts are included, so a partial year is not directly comparable.',
    series: [{ label: 'Average attendance per weekend', color: CHART_COLORS.primary }],
    rows: yearAvg.map((y) => ({ label: `${y.year} (${y.months} mo.)`, values: [y.avg] })),
  });
  return `<section class="report" aria-label="Attendance multi-year">
    ${renderSectionHeading({ eyebrow: 'Attendance', heading: 'Attendance, multi-year', badge: `${years.length} fiscal year${years.length === 1 ? '' : 's'}` })}
    ${chart || '<p>No monthly history is on file yet.</p>'}${yearChart}
    <details open><summary>Monthly averages by year</summary>${table}</details>
    ${countNote(a)}
  </section>`;
}

export function renderAttendancePage(pageId, { result } = {}) {
  if (!result?.ok) return unavailable(describeFailure(result));
  return pageId === 'trend' ? renderTrend(result.attendance) : renderOverview(result.attendance);
}
