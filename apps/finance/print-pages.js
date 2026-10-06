// ── Print versions of Finance pages ──────────────────────────────────────────────────────────────
// Andrew, 2026-09-25: print sheets are built by the server, not by page scripts. Any page opened
// with `print=1` renders as a clean letter-size document (church header, title, prepared date,
// forms and buttons hidden, table headers repeated across pages) that staff print or save as PDF
// with the browser's own dialog. The board packet print composes a cover page and any chosen
// reports into one document; each piece is rendered by the normal page route, so it carries that
// page's own permission check and live/synthetic labels. The only script is the toolbar's
// `window.print()` button, which is a convenience, not a builder.
import { escapeHtml } from './render-helpers.js';
import { BALANCE_STYLES } from './balance-pages.js';
import { COUNCIL_REPORT_STYLES } from './council-report-pages.js';
import { PROPERTY_CHART_STYLES } from './property-charts.js';

// The print page's CSP forbids inline script, so the button's handler is served as its own file.
export const PRINT_BUTTON_JS = "document.getElementById('print-now').addEventListener('click', function () { window.print(); });\n";
export const PRINT_PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-src 'self'; frame-ancestors 'none'";

export const PRINT_STYLES = `
  body.print-body { background: #eef0ec; margin: 0; color: #172019; font: 11pt/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .print-toolbar { display: flex; gap: .75rem; align-items: center; justify-content: space-between; max-width: 8.5in; margin: 1rem auto 0; padding: 0 .5rem; }
  .print-toolbar button { background: #1f6b45; color: #fff; border: 0; border-radius: .45rem; padding: .6rem 1rem; font-weight: 700; cursor: pointer; }
  .print-toolbar a { color: #1f6b45; }
  .print-doc { background: #fff; max-width: 8.5in; margin: 1rem auto 2rem; padding: .6in .7in; box-shadow: 0 1px 4px rgba(0,0,0,.12); box-sizing: border-box; }
  .print-masthead { display: flex; align-items: center; gap: .8rem; border-bottom: 2px solid #1f6b45; padding-bottom: .6rem; margin-bottom: 1rem; }
  .print-masthead img { width: 40px; height: 40px; }
  .print-masthead .org { font-weight: 700; font-size: 12pt; }
  .print-masthead .meta { font-size: 9pt; color: #555; }
  .print-title { margin: 0 0 .2rem; font-size: 18pt; }
  .print-eyebrow { text-transform: uppercase; letter-spacing: .06em; font-size: 8.5pt; color: #1f6b45; font-weight: 700; }
  .print-section-head { margin: 0 0 .8rem; }
  .print-newpage { break-before: page; page-break-before: always; }
  .print-cover-note { white-space: pre-wrap; border-left: 3px solid #1f6b45; padding: .4rem .8rem; margin: 1rem 0; background: #f4f7f4; }
  .print-foot { margin-top: 1.4rem; padding-top: .5rem; border-top: 1px solid #d9dfda; font-size: 8.5pt; color: #666; }
  .print-doc table { width: 100%; border-collapse: collapse; margin: .6rem 0 1rem; font-size: 9.5pt; }
  .print-doc th, .print-doc td { border-bottom: 1px solid #d9dfda; padding: .3rem .4rem; text-align: left; vertical-align: top; }
  .print-doc thead { display: table-header-group; }
  .print-doc tr, .print-doc .card { break-inside: avoid; page-break-inside: avoid; }
  .print-doc .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; }
  .print-doc .card { border: 1px solid #d9dfda; border-radius: .4rem; padding: .5rem .6rem; }
  .print-doc .card strong { display: block; font-size: 13pt; }
  .print-doc .card small, .print-doc .card span { display: block; font-size: 8.5pt; color: #555; }
  .print-doc .section-heading { display: flex; justify-content: space-between; align-items: flex-end; gap: .8rem; margin: 1rem 0 .4rem; border-bottom: 1px solid #d9dfda; padding-bottom: .25rem; }
  .print-doc .section-heading .eyebrow { text-transform: uppercase; letter-spacing: .05em; font-size: 8pt; color: #555; font-weight: 700; }
  .print-doc .section-heading h2 { margin: .1rem 0 0; font-size: 13pt; }
  .print-doc .badge { font-size: 8pt; border: 1px solid #b9c6bc; border-radius: 999px; padding: .1rem .5rem; color: #33503e; white-space: nowrap; }
  .print-doc .source-tag { margin: .3rem 0; }
  .print-doc .status-error, .print-doc .unavailable .status { color: #8a2b1e; }
  .print-doc td:last-child:empty, .print-doc th:last-child:empty { display: none; }
  .print-doc form, .print-doc button, .print-doc .no-print, .print-doc .notice,
  .print-doc section:not(.keep-in-print):has(> form), .print-doc a[href*="edit="] { display: none !important; }
  .print-doc a { color: inherit; text-decoration: none; }
  .print-doc td.num, .print-doc th.num { text-align: right; white-space: nowrap; }
  .print-doc tr.total td { border-top: 1.5px solid #555; font-weight: 600; }
  .print-doc tr.muted td { color: #777; }
  .print-doc .comp-basis { border-left: 3px solid #d9dfda; padding: .1rem .7rem; margin: .8rem 0; font-size: 9.5pt; }
  .print-doc .comp-basis table { width: auto; }
  .print-doc .bp-print-hd { display: flex; justify-content: space-between; gap: 1rem; font-size: 8.5pt; color: #555; border-bottom: 1px solid #d9dfda; padding-bottom: .3rem; margin-bottom: .8rem; }
  .print-doc .bp-print-h1 { font-size: 20pt; margin: .2rem 0; }
  .print-doc .bp-print-sub, .print-doc .bp-print-foot { font-size: 9pt; color: #555; }
  .print-doc .bp-print-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .5rem; margin: .8rem 0; }
  .print-doc .bp-print-tile { border: 1px solid #d9dfda; border-radius: .4rem; padding: .5rem .6rem; }
  .print-doc .bp-print-tile small, .print-doc .bp-print-tile span { display: block; font-size: 8pt; color: #555; }
  .print-doc .bp-print-tile strong { display: block; font-size: 13pt; }
  .print-doc .bp-print-table { table-layout: auto; font-size: 8.5pt; }
  .print-doc .bp-print-table th, .print-doc .bp-print-table td { padding: .25rem .3rem; }
  .print-doc .bp-print-table th:first-child, .print-doc .bp-print-table td:first-child { width: 30%; overflow-wrap: anywhere; }
  .print-doc .bp-print-table th.n, .print-doc .bp-print-table td:not(:first-child) { text-align: right; white-space: nowrap; }
  .print-doc .bp-print-table th.n { white-space: normal; }
  .print-doc .bp-print-tiles { overflow-wrap: anywhere; }
  .print-doc { overflow-x: hidden; }
  .print-doc .bp-print-group td { font-weight: 700; padding-top: .5rem; }
  .print-doc .bp-print-total td { font-weight: 700; border-top: 1px solid #999; }
  .print-doc .bp-print-total.is-net td { border-top: 2px solid #172019; }
  .print-doc .bp-up, .print-doc .bp-down-net { color: #8a2b1e; } .print-doc .bp-down, .print-doc .bp-up-net { color: #1f6b45; }
  .print-doc .tone-muted { color: #888; }
  .bp-watermark { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-size: 110pt; font-weight: 800; letter-spacing: .1em; color: rgba(138, 43, 30, .10); transform: rotate(-28deg); pointer-events: none; z-index: 0; }
  .print-picker { background: #fff; max-width: 8.5in; margin: 1rem auto; padding: 1.5rem; box-sizing: border-box; }
  .print-picker fieldset { border: 1px solid #d9dfda; border-radius: .5rem; margin: 0 0 1rem; padding: .6rem 1rem; }
  .print-picker label { display: block; padding: .25rem 0; }
  .print-picker textarea { width: 100%; min-height: 6rem; font: inherit; box-sizing: border-box; }
  .print-picker button { background: #1f6b45; color: #fff; border: 1px solid #1f6b45; border-radius: .45rem; padding: .7rem 1.1rem; font-weight: 700; }
  .print-picker button.secondary { background: #fff; color: #1f6b45; }
  @page { size: letter; margin: .55in .6in; }
  @media print {
    body.print-body { background: #fff; }
    .print-toolbar { display: none; }
    .print-doc { box-shadow: none; margin: 0; padding: 0; max-width: none; }
  }
`;

// The council giving report's own styles read the app's color variables, which a print page does not
// define; these give it the same look on paper (stacked on one column, no screen-only chrome).
const PRINT_COUNCIL_FIT = `
  .print-doc { --line:#d9dfda; --line-soft:#eef1ee; --navy:#243642; --ink:#16213A; --muted:#5B6475; --faint:#8a93a6; --green:#1f6b45; --gold-ink:#8A5A12; --card:#fff; }
  .print-doc .panel { border:1px solid var(--line); border-radius:8px; padding:.7rem .9rem; margin:.6rem 0; break-inside:avoid; }
  .print-doc .panel h2 { font-size:11pt; margin:0 0 .3rem; }
  .print-doc .cr-kpis { grid-template-columns:repeat(4,minmax(0,1fr)); gap:.5rem; margin-top:.5rem; }
  .print-doc .cr-kpi { padding:.5rem .6rem; }
  .print-doc .cr-kpi strong { font-size:15pt; margin:.2rem 0; }
  .print-doc .cr-kpi small, .print-doc .cr-kpi span { font-size:8pt; }
  .print-doc .cr-body { grid-template-columns:minmax(0,1.5fr) minmax(0,1fr); gap:.6rem; margin-top:.6rem; }
  .print-doc .cr-navy { padding:.7rem .9rem; break-inside:avoid; }
  .print-doc .cr-mix div { font-size:9pt; }
  .print-doc .cr-navy-con p { font-size:9pt; }
  .print-doc .muted-line, .print-doc .lede { font-size:9pt; color:#555; }
`;

// Reports the board packet print can include. Each entry is rendered through the normal page route
// (`?section=&page=&print=1&fragment=1`), so a viewer only ever gets what that page allows them.
export const BOARD_PACKET_ITEMS = Object.freeze([
  { key: 'health', label: 'Financial Health', section: 'health', pages: ['overview'] },
  { key: 'giving', label: 'Giving Report to the Council (General Fund summary)', section: 'giving-analytics', pages: ['council'], pageParams: { council: { compact: '1' } } },
  { key: 'church', label: 'Church Report (overview, multi-year trend, budget vs actual)', section: 'church', pages: ['overview', 'trend', 'budget-actual'] },
  { key: 'attendance', label: 'Attendance (this year and multi-year)', section: 'attendance', pages: ['overview', 'trend'] },
  { key: 'balance', label: 'Balance Sheet (position, account detail, and multi-year position)', section: 'balance', pages: ['position', 'account-detail', 'multi-year'] },
  { key: 'daycare', label: 'Daycare Report (overview and budget comparison)', section: 'daycare', pages: ['overview', 'budget-comparison'] },
  { key: 'property', label: 'Commercial Property (board summary: income, expenses, net, reserve, payoff date, projected income)', section: 'property', pages: ['board-summary'] },
  { key: 'budget', label: 'Budget (this year only)', section: 'planning', pages: ['builder'], pageParams: { builder: { print_mode: 'thisyear' } } },
  { key: 'council', label: 'Compensation council report', section: 'compensation', pages: ['council'] },
]);

export const BOARD_PACKET_DEFAULT_KEYS = ['balance', 'budget'];
export const COVER_NOTE_MAX = 2000;
export const COVER_TEMPLATE_KEY = 'board_packet_cover_template';
// Starting letter shown until the first save. Bracketed spots are the parts to change each month.
export const DEFAULT_COVER_TEMPLATE = `Dear Council members,

Enclosed is the [Month Year] financial packet: the Balance Sheet (position, account detail, and multi-year position) and the Budget.

Highlights this month:
- [One sentence on where we stand against budget.]
- [One sentence on cash, reserves, or the mortgage.]
- [Anything the board is asked to decide or discuss.]

Thank you for your faithful care of Timothy's resources.

Grace and peace,
Pastor Andrew`;

// The print link a page head offers: the same page, with print=1.
export function printHref(searchParams, extra = {}) {
  const params = new URLSearchParams(searchParams || '');
  for (const key of ['status', 'reason', 'message', 'edit', 'qb', 'budgets', 'fragment']) params.delete(key);
  params.set('print', '1');
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return `/?${params.toString()}`;
}

function preparedLabel(now) {
  return now.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Chicago' });
}

export function renderPrintFragment({ eyebrow, title, bodyHtml }) {
  return `<article class="print-section">
    <header class="print-section-head"><div class="print-eyebrow">${escapeHtml(eyebrow)}</div><h1 class="print-title">${escapeHtml(title)}</h1></header>
    ${bodyHtml}
  </article>`;
}

export function renderPrintDocument({ documentTitle, backHref, contentHtml, release, production, now = new Date() }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(documentTitle)} · Timothy Finance</title>
  <link rel="icon" href="/assets/finance-mark.png">
  <style>${PRINT_STYLES}${BALANCE_STYLES}${COUNCIL_REPORT_STYLES}${PROPERTY_CHART_STYLES}${PRINT_COUNCIL_FIT}</style>
</head>
<body class="print-body">
  <div class="print-toolbar"><a href="${escapeHtml(backHref)}">← Back to Finance</a><button type="button" id="print-now">Print / Save as PDF</button></div>
  <script src="/print/print.js" defer></script>
  <main class="print-doc">
    <div class="print-masthead"><img src="/assets/finance-mark.png" alt=""><div><div class="org">Timothy Lutheran Church · Finance</div><div class="meta">Prepared ${escapeHtml(preparedLabel(now))}${production ? '' : ' · staging data'}</div></div></div>
    ${contentHtml}
    <div class="print-foot">Figures labeled live come from Connect's records; anything labeled synthetic or unavailable is not a real balance. Timothy Finance ${escapeHtml(release)}.</div>
  </main>
</body>
</html>`;
}

export function renderBoardPacketPicker({ items, release, production, message = '', coverTemplate = DEFAULT_COVER_TEMPLATE, canSaveTemplate = false, templateSaved = false }) {
  const boxes = items.map((item) => `<label><input type="checkbox" name="include" value="${item.key}"${BOARD_PACKET_DEFAULT_KEYS.includes(item.key) ? ' checked' : ''}> ${escapeHtml(item.label)}</label>`).join('');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Board packet · Timothy Finance</title><link rel="icon" href="/assets/finance-mark.png"><style>${PRINT_STYLES}</style></head>
<body class="print-body">
  <div class="print-toolbar"><a href="/?section=packet">← Back to Finance</a></div>
  <main class="print-picker">
    <h1 class="print-title">Print the board packet</h1>
    <p>Choose what to include. The packet opens as one document with a cover page, each report starting on a new page; print it or choose “Save as PDF” in the print dialog.</p>
    ${message ? `<p class="status status-error">${escapeHtml(message)}</p>` : ''}
    <form method="GET" action="/print/board-packet">
      <fieldset><legend>Reports</legend>${boxes || '<p>No reports are available to your role.</p>'}</fieldset>
      ${items.some((item) => item.key === 'budget') ? `<fieldset><legend>Budget</legend>
        <label><input type="radio" name="budget_year" value="thisyear" checked> This year only</label>
        <label><input type="radio" name="budget_year" value="plan"> Next year’s plan, with this year beside it</label>
      </fieldset>` : ''}
      <fieldset><legend>Cover letter</legend>
        ${templateSaved ? '<p class="status">Template saved. It will appear here next month.</p>' : ''}
        <textarea name="note" maxlength="${COVER_NOTE_MAX}" aria-label="Cover letter">${escapeHtml(coverTemplate)}</textarea>
        <p><small>Edit the bracketed parts for this month. Printing uses exactly what is in the box.${canSaveTemplate ? ' “Save as template” keeps this wording as next month’s starting point.' : ''}</small></p>
      </fieldset>
      <button type="submit">Open packet for printing</button>${canSaveTemplate ? ' <button type="submit" formmethod="post" formaction="/print/board-packet/cover" class="secondary">Save as template</button>' : ''}
    </form>
    <p><small>Timothy Finance ${escapeHtml(release)}${production ? '' : ' · staging'}</small></p>
  </main>
</body>
</html>`;
}
