import { fetchGivingBoard } from './connect-giving-analytics-client.js';
import { describeBreezeConfig } from './breeze-client.js';
import { buildReconciliation, readCopyMonthly, readLastBreezeRuns } from './breeze-giving-service.js';
import { escapeHtml as e, formatCents, formatSignedCents, renderKpiCards, renderSectionHeading, renderTable } from './render-helpers.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Everything the page needs, read once. Never throws: a piece that cannot be read is reported as such.
export async function loadBreezeGivingView(env, db, accessJwt, year, now = new Date()) {
  const [runs, copy, board] = await Promise.all([
    readLastBreezeRuns(db), readCopyMonthly(db, year), fetchGivingBoard(env, accessJwt, { period: String(year) }),
  ]);
  const data = board.ok ? board.result : null;
  const monthly = data && data.year === year ? (data.categories?.all?.monthly?.current || data.monthly?.current) : null;
  const connectOk = Array.isArray(monthly) && monthly.length === 12;
  return {
    configured: describeBreezeConfig(env).ok, configProblem: describeBreezeConfig(env).problem, year, runs, copyHasData: copy.hasData, connectOk,
    reconciliation: buildReconciliation({ copy, connectMonthlyCents: connectOk ? monthly : null, year, now }),
  };
}

function statusLine(status, message) {
  if (status === 'ok') return `<p class="status">${e(message || 'Copied from Breeze.')}</p>`;
  if (status === 'error') return `<p class="status status-error">Not copied: ${e(message || 'unknown error')}</p>`;
  return '';
}

export function renderBreezeGivingPage({ isAdmin, view, status = null, message = null }) {
  const heading = renderSectionHeading({ eyebrow: 'Data & Imports', heading: 'Breeze giving: Finance’s side-by-side copy', badge: 'Admin only' });
  if (!isAdmin) return `<section class="report" aria-label="Breeze giving copy">${heading}<p>Only an admin can see or run the Breeze giving copy.</p></section>`;
  const { year, configured, configProblem, runs, reconciliation: r, connectOk } = view;
  const now = new Date();
  const years = [];
  for (let y = now.getUTCFullYear(); y >= now.getUTCFullYear() - 5; y -= 1) years.push(y);
  const yearForm = `<form method="GET" action="/" class="inline-form"><input type="hidden" name="section" value="data"><input type="hidden" name="page" value="breeze-giving">
    <label for="bz-year">Year</label> <select id="bz-year" name="year">${years.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select> <button type="submit" class="button-outline">Show</button></form>`;
  const connectionCard = configured
    ? '<p>Breeze is connected to Finance. Syncing only reads from Breeze; nothing is changed in Breeze or in Connect.</p>'
    : `<p class="status status-pending">Breeze is not connected to Finance yet. <b>What Finance sees:</b> ${e(configProblem || 'nothing set')} If you just added the secrets, give it a minute and reload; a secret added to a different Worker than <b>timothy-finance-app</b> will not reach Finance. In Cloudflare, open the Workers & Pages entry <b>timothy-finance-app</b>, then Settings, then Variables and Secrets, and add two secrets: <b>BREEZE_SUBDOMAIN</b> (the part before <code>.breezechms.com</code>) and <b>BREEZE_API_KEY</b>. Finance keeps its own key and never copies Connect’s.</p>`;
  const syncForm = configured
    ? `<form method="POST" action="/api/v1/breeze-giving-sync" class="inline-form"><input type="hidden" name="year" value="${year}"><button type="submit">Copy ${year} from Breeze</button> <small>Reads the whole year, one month at a time. It can take a minute.</small></form>`
    : '';
  const kpis = renderKpiCards([
    { label: `Finance’s copy, ${year}`, value: formatCents(r.financeCents), hint: `${r.gifts.toLocaleString('en-US')} gifts` },
    { label: `Connect, ${year}`, value: r.connectCents === null ? 'Unavailable' : formatCents(r.connectCents), hint: connectOk ? 'All giving, from Connect' : 'Connect’s totals could not be read' },
    { label: 'Difference', value: r.differenceCents === null ? '—' : formatSignedCents(r.differenceCents), hint: r.allMatch ? 'Every month matches to the cent' : 'Finance’s copy minus Connect' },
  ]);
  const rows = r.months.map((m) => `<tr><td>${MONTHS[m.month - 1]}</td><td class="num">${m.gifts.toLocaleString('en-US')}</td><td class="num">${formatCents(m.financeCents)}</td><td class="num">${m.connectCents === null ? '—' : formatCents(m.connectCents)}</td><td class="num">${m.differenceCents === null ? '—' : formatSignedCents(m.differenceCents)}</td><td>${m.matches ? '✓ matches' : (m.connectCents === null ? '' : 'differs')}</td></tr>`).join('');
  const table = renderTable({ head: ['Month', 'Gifts', 'Finance’s copy', 'Connect', 'Difference', ''], rows });
  const runRows = runs.map((run) => `<tr><td>${e(String(run.finished_at || run.started_at).slice(0, 16).replace('T', ' '))} UTC</td><td>${e(run.range_start)} to ${e(run.range_end)}</td><td class="num">${run.added} added · ${run.updated} corrected · ${run.removed} removed</td><td>${e(run.status)}${run.message ? ` — ${e(run.message)}` : ''}</td></tr>`).join('');
  const history = runs.length ? renderTable({ head: ['When', 'Range', 'Changes', 'Result'], rows: runRows }) : '<p>No copy has been run yet.</p>';
  return `<section class="report" aria-label="Breeze giving copy">
    ${heading}
    <p>Step 1 of moving giving into Finance: Finance reads Breeze’s giving into its own tables and checks the totals against Connect’s. <b>Connect is still the official record</b>; nothing here changes what Finance or Connect show anywhere else. The copy holds no names, only Breeze’s person number, date, amount, method and funds.</p>
    ${statusLine(status, message)}
    ${connectionCard}
    ${syncForm}
    ${yearForm}
    ${kpis}
    ${table}
    <p><small>A difference is expected for gifts entered directly in Connect (not from Breeze), and for gifts Connect has voided or corrected since. Anything large or unexplained is worth looking at before the switch.</small></p>
    <h3>Recent copies</h3>
    ${history}
  </section>`;
}
