// Shared pieces for the mission-alignment, congregation, report and trends pages: the four End
// colors, stacked bars, SVG pies, money formatting, the year picker and the page chips.
import { escapeHtml as e } from './render-helpers.js';
import { MISSION_GOALS } from './mission-alignment.js';

// Working colors (the editors) and the warmer presentation colors (congregation and report).
export const END_COLORS = ['#E9A93C', '#9B7FD4', '#5FB57E', '#E8705F'];
export const PRESENT_COLORS = ['#F2B84B', '#B9A3E3', '#84C99A', '#EE8A78'];
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const money = (cents) => (cents == null ? '—' : `${cents < 0 ? '−' : ''}${USD.format(Math.abs(Math.round(cents / 100)))}`);
export const pctOf = (part, whole) => (whole ? (part / whole) * 100 : 0);
export const pct1 = (bp) => `${(Math.round(bp / 10) / 10).toFixed(1)}%`;
export const pct0 = (bp) => `${Math.round(bp / 100)}%`;
export const sum = (v) => v.reduce((a, b) => a + b, 0);

// Shares in basis points → a stacked bar. `rest` shows any unassigned part as hatching.
export function stackBar(shares, { height = 10, radius = 2, label = '', rest = true, colors = END_COLORS, live = false } = {}) {
  const parts = shares.map((s, i) => `<div class="ma-seg" ${live ? `data-seg="${i}" ` : ''}style="width:${s / 100}%;background:${colors[i]}"></div>`).join('');
  const left = 10000 - sum(shares);
  const aria = label ? ` role="img" aria-label="${e(label)}"` : ' aria-hidden="true"';
  return `<div class="ma-bar" style="height:${height}px;border-radius:${radius}px"${aria}>${parts}${rest && left > 0 && !live ? `<div class="ma-seg ma-hatch" style="width:${left / 100}%"></div>` : ''}</div>`;
}

export const sharesLabel = (shares, unit = 'percent') => MISSION_GOALS.map(([, l], i) => `${l} ${Math.round(shares[i] / 100)} ${unit}`).join(', ');

// An SVG pie from shares (basis points). Unassigned stays a pale slice.
export function pie(shares, { size = 170, colors = PRESENT_COLORS, label = '' } = {}) {
  const r = size / 2;
  const parts = [...shares, Math.max(0, 10000 - sum(shares))];
  const fills = [...colors, '#E4DCCD'];
  let angle = -Math.PI / 2;
  const slices = parts.map((bp, i) => {
    if (bp <= 0) return '';
    if (bp >= 10000) return `<circle cx="${r}" cy="${r}" r="${r}" fill="${fills[i]}"/>`;
    const a2 = angle + (bp / 10000) * 2 * Math.PI;
    const p = (a) => `${(r + r * Math.cos(a)).toFixed(2)},${(r + r * Math.sin(a)).toFixed(2)}`;
    const d = `M${r},${r} L${p(angle)} A${r},${r} 0 ${bp > 5000 ? 1 : 0} 1 ${p(a2)} Z`;
    angle = a2;
    return `<path d="${d}" fill="${fills[i]}" stroke="#fff" stroke-width="1.5"/>`;
  }).join('');
  return `<svg class="ma-pie" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${e(label || sharesLabel(shares))}">${sum(shares) ? slices : `<circle cx="${r}" cy="${r}" r="${r}" fill="#E4DCCD"/>`}</svg>`;
}

export const dot = (i, colors = END_COLORS) => `<span class="ma-dot" style="background:${colors[i]}"></span>`;

// The mission pages, in order, as chips that keep the chosen year.
export const MISSION_PAGES = [['mission', 'Line items by End'], ['staff-time', 'Staff time'], ['mission-report', 'Mission report'], ['congregation', 'For the congregation'], ['trends', 'Trends']];
export function pageHref(page, target, extra = {}) {
  const q = new URLSearchParams({ section: 'planning', page, target: String(target), ...extra });
  return `/?${q.toString().replace(/&/g, '&amp;')}`;
}
export function missionChips(current, target, { admin = false } = {}) {
  const pages = MISSION_PAGES.filter(([id]) => admin || !['mission', 'staff-time'].includes(id));
  return `<nav class="ma-chips" aria-label="Mission and budget views">${pages.map(([id, label]) => `<a class="chip${id === current ? ' is-on' : ''}" href="${pageHref(id, target)}"${id === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')}<a class="chip" href="${pageHref('builder', target)}">Budget planner</a></nav>`;
}
export function yearPicker(page, target, now = new Date()) {
  const thisYear = now.getUTCFullYear();
  const years = [];
  for (let y = Math.min(target, thisYear - 2); y <= Math.max(target, thisYear + 2); y += 1) years.push(y);
  return `<form method="GET" action="/" class="ma-year"><input type="hidden" name="section" value="planning"><input type="hidden" name="page" value="${e(page)}">
    <label class="field"><span>Budget year</span><select name="target">${years.map((y) => `<option value="${y}"${y === target ? ' selected' : ''}>${y}</option>`).join('')}</select></label><button type="submit" class="button-outline">Show</button></form>`;
}

export const MISSION_STYLES = `
  .ma-chips { display:flex !important; flex-direction:row !important; flex-wrap:wrap; gap:8px; margin:0 0 18px; }
  .ma-chips a.chip { flex:0 0 auto; width:auto; padding:6px 12px; border:1px solid #D7E2E9; border-radius:999px; background:#fff; color:#16213A; font-size:13px; text-decoration:none; }
  .ma-chips .chip { display:inline-flex; width:auto; }
  .ma-chips .chip.is-on { background:#DFEBF2; color:#2B5065; font-weight:700; }
  .ma-year { display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; }
  .ma-head { display:flex; flex-wrap:wrap; gap:16px; align-items:flex-end; justify-content:space-between; margin-bottom:18px; }
  .ma-head h2 { margin:0; font-size:28px; }
  .ma-sub { margin:4px 0 0; color:#536B79; font-size:15px; }
  .ma-eyebrow { font-size:12px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:#536B79; }
  .ma-bar { display:flex; overflow:hidden; background:#EEF2F5; min-width:110px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .ma-seg { height:100%; }
  .ma-hatch { background:repeating-linear-gradient(45deg,#fff 0 4px,#C7D3DB 4px 8px); }
  .ma-dot { width:9px; height:9px; border-radius:999px; display:inline-block; flex-shrink:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .ma-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; }
  .ma-card { border:1px solid #D7E2E9; border-radius:12px; padding:18px; display:flex; flex-direction:column; gap:5px; background:#fff; }
  .ma-card .ma-big { font-size:26px; font-weight:700; font-variant-numeric:tabular-nums; color:#16213A; }
  .ma-card.is-warn { border-color:#E8C77A; background:#FFF9EC; }
  .ma-muted { color:#536B79; font-size:14px; }
  .ma-badge { display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:600; padding:3px 8px; border-radius:8px; white-space:nowrap; }
  .ma-badge.ok { background:#E6F2EA; color:#22593A; } .ma-badge.warn { background:#FFF3DC; color:#6E4A00; } .ma-badge.info { background:#DFEBF2; color:#2B5065; }
  .ma-layout { display:grid; grid-template-columns:minmax(0,1fr) 380px; gap:24px; align-items:start; }
  @media (max-width: 1100px) { .ma-layout { grid-template-columns:1fr; } }
  .ma-table { width:100%; border-collapse:collapse; font-size:14px; }
  .ma-table th { font-size:12.5px; font-weight:600; color:#536B79; text-align:left; padding:9px 10px; border-bottom:1px solid #718694; white-space:nowrap; }
  .ma-table td { padding:9px 10px; border-bottom:1px solid #D7E2E9; vertical-align:middle; }
  .ma-table .num { text-align:right; font-variant-numeric:tabular-nums; }
  .ma-table tr.ma-group td { background:#F3F7FA; font-weight:600; font-size:13px; color:#293D49; padding:7px 10px; }
  .ma-table tr.is-sel td { background:#DFEBF2; }
  .ma-table tfoot td { font-weight:700; border-bottom:0; border-top:1px solid #718694; }
  .ma-table a.ma-rowlink { color:inherit; text-decoration:none; } .ma-table a.ma-rowlink:hover { text-decoration:underline; }
  .ma-frame { overflow-x:auto; border:1px solid #D7E2E9; border-radius:12px; background:#fff; }
  .ma-drawer { border:1px solid #D7E2E9; border-radius:12px; padding:22px; display:flex; flex-direction:column; gap:16px; background:#fff; position:sticky; top:16px; }
  .ma-drawer h3 { margin:0; font-size:20px; }
  .ma-drawer fieldset { border:0; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
  .ma-drawer legend { font-size:14px; font-weight:600; margin-bottom:6px; }
  .ma-radio { display:flex; gap:8px; align-items:flex-start; font-size:15px; }
  .ma-radio small { color:#536B79; }
  .ma-grid { display:grid; grid-template-columns:1fr 84px 92px; gap:8px; align-items:center; }
  .ma-grid input { width:100%; box-sizing:border-box; text-align:right; }
  .ma-grid .num { text-align:right; font-variant-numeric:tabular-nums; }
  .ma-presets { display:flex; flex-wrap:wrap; gap:8px; }
  .ma-presets .button-outline, .ma-presets a { min-height:34px; font-size:14px; padding:6px 12px; }
  .ma-actions a { align-self:center; }
  .ma-table td:first-child { min-width:200px; }
  .ma-actions { display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap; }
  .ma-panel { border:1px solid #D7E2E9; border-radius:12px; padding:22px; background:#fff; display:flex; flex-direction:column; gap:16px; }
  .ma-tabs { display:flex; gap:4px; border-bottom:1px solid #D7E2E9; }
  .ma-tabs a { padding:9px 12px; color:#536B79; text-decoration:none; border-bottom:3px solid transparent; }
  .ma-tabs a[aria-current="page"] { color:#2B5065; font-weight:600; border-bottom-color:#386781; }
  .ma-week { display:grid; grid-template-columns:minmax(0,1.6fr) minmax(260px,1fr); gap:28px; align-items:start; }
  @media (max-width: 1000px) { .ma-week { grid-template-columns:1fr; } }
  .ma-result { background:#F3F7FA; border-radius:12px; padding:20px; display:flex; flex-direction:column; gap:14px; }
  .ma-result h4 { margin:0; font-size:17px; }
  .ma-sources { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:4px 16px; font-size:14px; }
  .ma-note { font-size:13px; color:#536B79; }
  .ma-section { display:flex; flex-direction:column; gap:14px; margin-bottom:28px; }
  .ma-section > h2, .ma-section-head h2 { margin:0; font-size:22px; }
  .ma-section-head { display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px; }
  /* Presentation pages */
  .cv-slide { background:#FBF8F2; color:#1E2D4A; border-radius:14px; overflow:hidden; margin:0 0 28px; border:1px solid #E4DCCD; -webkit-print-color-adjust:exact; print-color-adjust:exact; break-inside:avoid; page-break-inside:avoid; }
  .cv-slide + .cv-slide { break-before:page; page-break-before:always; }
  .cv-rule { height:8px; background:#1E2D4A; border-bottom:4px solid #C9973A; }
  .cv-body { padding:36px 44px 30px; display:flex; flex-direction:column; gap:26px; }
  .cv-serif { font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif; font-style:italic; }
  .cv-eyebrow { font-size:13px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:#8A6420; }
  .cv-head { display:flex; justify-content:space-between; align-items:flex-end; gap:24px; flex-wrap:wrap; }
  .cv-head h2 { margin:6px 0 0; font-size:52px; line-height:1.05; font-weight:600; color:#1E2D4A; }
  .cv-lede { margin:8px 0 0; font-size:19px; color:#3B4A63; max-width:60ch; }
  .cv-org { text-align:right; font-size:15px; color:#3B4A63; }
  .cv-dollar { display:flex; height:76px; border-radius:14px; overflow:hidden; font-weight:700; font-size:20px; }
  .cv-dollar > div { display:flex; align-items:center; gap:8px; padding:0 14px; white-space:nowrap; overflow:hidden; border-left:3px solid #FBF8F2; }
  .cv-dollar > div:first-child { border-left:0; }
  .cv-dollar b { font-size:30px; }
  .cv-ends { display:grid; grid-template-columns:repeat(4,1fr); gap:18px; }
  @media (max-width: 1000px) { .cv-ends { grid-template-columns:repeat(2,1fr); } .cv-head h2 { font-size:40px; } }
  .cv-end { border-radius:18px; padding:22px; display:flex; flex-direction:column; gap:12px; }
  .cv-end h3 { margin:0; font-size:40px; line-height:1; font-weight:600; color:#1E2D4A; }
  .cv-end .cv-amt { border-top:2px solid #1E2D4A; padding-top:12px; }
  .cv-end .cv-amt b { display:block; font-size:34px; font-variant-numeric:tabular-nums; }
  .cv-end ul { margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:6px; font-size:16px; line-height:1.35; }
  .cv-end li { padding-left:14px; position:relative; }
  .cv-end li::before { content:""; position:absolute; left:0; top:8px; width:6px; height:6px; border-radius:999px; background:#1E2D4A; }
  .cv-foot { display:flex; justify-content:space-between; align-items:center; gap:24px; border-top:1px solid #D9CFBE; padding-top:16px; font-size:16px; flex-wrap:wrap; }
  .cv-foot small { color:#5A6578; font-size:13px; }
  .cv-panel { background:#fff; border:1px solid #E4DCCD; border-radius:18px; padding:24px; display:flex; flex-direction:column; gap:16px; }
  .cv-panel h3 { margin:0; font-size:20px; color:#1E2D4A; }
  .cv-row { display:grid; grid-template-columns:1.25fr 1fr 1fr; gap:20px; }
  .cv-two { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
  @media (max-width: 1000px) { .cv-row, .cv-two { grid-template-columns:1fr; } }
  .cv-pieset { display:flex; gap:22px; align-items:center; flex-wrap:wrap; }
  .cv-leg { display:flex; flex-direction:column; gap:8px; font-size:16px; flex:1; min-width:180px; }
  .cv-leg > div { display:grid; grid-template-columns:14px 1fr auto auto; gap:10px; align-items:center; }
  .cv-sw { width:14px; height:14px; border-radius:4px; display:inline-block; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .cv-people { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:18px; }
  .cv-people > div { display:flex; flex-direction:column; align-items:center; gap:8px; text-align:center; }
  .cv-table { width:100%; border-collapse:collapse; font-size:15px; }
  .cv-table th { text-align:left; font-size:13px; color:#5A6578; font-weight:600; padding:8px 10px; border-bottom:1px solid #8A93A3; }
  .cv-table td { padding:8px 10px; border-bottom:1px solid #EEE7DA; text-align:left; }
  .cv-table th.num, .cv-table td.num { text-align:right; font-variant-numeric:tabular-nums; }
  .cv-table tfoot td { font-weight:700; border-bottom:0; border-top:1px solid #8A93A3; }
  .cv-hbar { display:grid; grid-template-columns:minmax(120px,210px) 1fr auto; gap:12px; align-items:center; font-size:15px; }
  .cv-hbar .track { height:22px; background:#F1ECE2; border-radius:6px; position:relative; overflow:hidden; }
  .cv-hbar .fill { position:absolute; left:0; top:0; bottom:0; border-radius:6px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .cv-hbar .prior { position:absolute; top:-2px; bottom:-2px; width:3px; background:#1E2D4A; }
  .cv-hbars { display:flex; flex-direction:column; gap:10px; }
  .cv-chart { width:100%; height:auto; }
  .tr-spark { vertical-align:middle; }
  .tr-up { color:#8A3B2E; } .tr-down { color:#22593A; }
  .tr-table td.num, .tr-table th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .tr-table tr.tr-cat td { background:#F3F7FA; font-weight:700; }
  .tr-table tr.tr-line td:first-child { padding-left:26px; }
  .tr-table .tr-proposed { background:#FFF9EC; }
  @media print { .ma-noprint, .ma-chips, .ma-year { display:none !important; } .cv-slide { border:0; } }
`;
