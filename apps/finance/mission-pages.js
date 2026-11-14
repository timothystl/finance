// Budget › Line items by End and Budget › Staff time: the two admin editors for mission alignment.
// Everything is server-rendered; one small script from this Worker keeps totals live while typing.
import { escapeHtml as e } from './render-helpers.js';
import { buildBoardSections, normalizeBoardLayout, accountDisplayName } from './board-layout.js';
import { GOAL_KEYS, MISSION_GOALS, WEEK_TEMPLATES, lineCents, missionModel, templateWeek, weekShares } from './mission-alignment.js';
import { END_COLORS, dot, missionChips, money, pageHref, pct0, pct1, sharesLabel, stackBar, sum, yearPicker } from './mission-ui.js';

const FULL = 10000;
const METHOD_BADGES = {
  one: ['info', 'One End'], split: ['ok', 'Split'], spread: ['info', 'Like the budget'],
  partial: ['warn', 'Partly split'], needs: ['warn', 'Needs a split'],
};
const badge = (kind, text) => `<span class="ma-badge ${kind}">${kind === 'warn' ? '<span class="ma-dot" style="background:#B07A00"></span>' : ''}${e(text)}</span>`;
const RETURN_PAGES = { 'staff-shares': 'staff-time', lines: 'mission', line: 'mission', building: 'mission', staff: 'staff-time', 'staff-add': 'staff-time', 'staff-remove': 'staff-time', 'staff-import': 'staff-time', 'staff-benefits': 'staff-time' };
const hiddenYear = (builder, data, action) => `<input type="hidden" name="return_page" value="${RETURN_PAGES[action]}"><input type="hidden" name="return_target" value="${builder.targetYear}"><input type="hidden" name="target" value="${builder.targetYear}"><input type="hidden" name="base" value="${builder.baseYear}"><input type="hidden" name="revision" value="${data.revision}"><input type="hidden" name="action" value="${action}">`;
const pctValue = (bp) => (bp ? String(bp / 100) : '');
const hoursText = (h) => (h == null ? '' : String(h / 100));

function statusLines(params) {
  if (!params) return '';
  if (params.get('status') === 'ok' && params.get('mission') === '1') return '<p class="status status-ok" role="status">Saved.</p>';
  if (params.get('status') === 'error') {
    const reason = params.get('reason');
    const msg = reason === 'invalid' ? String(params.get('message') || 'Check the form and try again.').slice(0, 220)
      : reason === 'access_denied' ? 'Only a Finance administrator can change mission alignment.'
        : reason === 'cross_site' ? 'That form did not come from Timothy Finance.' : 'The change could not be saved. Reload and try again.';
    return `<p class="status status-error" role="alert">${e(msg)} Nothing was saved.</p>`;
  }
  return '';
}

export function unavailable(heading, message) {
  return `<section class="panel panel-spaced"><h2>${e(heading)}</h2><p class="status status-error">${e(message)}</p></section>`;
}

function summary(model, target, { linkNeeds = true } = {}) {
  const t = model.total;
  const shares = model.totals.map((c) => (t > 0 ? Math.round((c / t) * FULL) : 0));
  const cards = MISSION_GOALS.map(([, label, sub], i) => `<div class="ma-card"><div style="display:flex;gap:8px;align-items:center;font-weight:600">${dot(i)}${label}</div><div class="ma-muted" style="font-size:13px">${sub}</div><div class="ma-big">${money(model.totals[i])}</div><div class="ma-muted">${pct1(shares[i])} of budget</div></div>`).join('');
  const needs = model.unassigned
    ? `<div class="ma-card is-warn"><div style="font-weight:600">Not yet aligned</div><div style="font-size:13px;color:#6E4A00">${model.needsCount} line${model.needsCount === 1 ? '' : 's'} need${model.needsCount === 1 ? 's' : ''} a split${model.staff.some((s) => s.unassigned) ? ' · some staff time open' : ''}</div><div class="ma-big">${money(model.unassigned)}</div>${linkNeeds ? `<div style="font-size:14px"><a href="${pageHref('mission', target, { show: 'needs' })}">Show these lines</a></div>` : ''}</div>`
    : '<div class="ma-card"><div style="font-weight:600">Fully aligned</div><div class="ma-muted">Every dollar is counted toward an End.</div></div>';
  return `<section class="ma-section" aria-labelledby="ma-sum">
    <div class="ma-section-head"><h2 id="ma-sum">Total budget by End</h2><span class="ma-muted">${money(t)} in planned expenses · includes staff time · shared costs can follow the rest of the budget</span></div>
    ${stackBar(shares, { height: 28, radius: 8, label: `${sharesLabel(shares)}, unassigned ${Math.round((FULL - sum(shares)) / 100)} percent` })}
    <div class="ma-cards">${cards}${needs}</div>
  </section>`;
}

// ── Line items by End ────────────────────────────────────────────────────────────────────────

export function renderMissionPage({ builder, data, prior = null, layout = null, params, canEdit = false, now = new Date() }) {
  const target = builder.targetYear;
  const head = `${missionChips('mission', target, { admin: canEdit })}
    <div class="ma-head"><div><span class="ma-eyebrow">Budget · Mission alignment</span><h2>How the budget does the mission</h2><p class="ma-sub">FY${target} budget plan · every expense line toward Welcome, Receive, Grow and Go</p></div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">${yearPicker('mission', target, now)}<a class="button-outline" href="${pageHref('mission-report', target)}">Report for council</a></div></div>`;
  if (!data) return `${head}${unavailable('Mission alignment', 'Mission alignment could not be read. Reload to try again; nothing has been changed.')}`;
  const model = missionModel(builder, data);
  const lay = layout || normalizeBoardLayout(null);
  const q = String(params?.get('q') || '').trim().toLowerCase().slice(0, 80);
  const show = ['needs', 'shared'].includes(params?.get('show')) ? params.get('show') : 'all';
  const asDollars = params?.get('as') === 'usd';
  const selected = params?.get('line') || '';
  const nameOf = (l) => accountDisplayName(lay, l.category, l.name || l.category);
  // Old lines with nothing planned this year are hidden unless asked for (or selected).
  const showZero = params?.get('zero') === '1';
  const zeroCount = model.rows.filter((r) => !r.isSource && !r.cents).length;
  const keep = (r) => {
    if (!r.cents && !showZero && r.line.category !== selected) return false;
    if (q && !`${nameOf(r.line)} ${r.line.category}`.toLowerCase().includes(q)) return false;
    if (show === 'needs') return r.status === 'needs' || r.status === 'partial';
    if (show === 'shared') return r.status === 'spread' || r.status === 'split';
    return true;
  };
  const programRows = model.rows.filter((r) => !r.isSource);
  const sections = buildBoardSections(programRows, lay, (r) => ({ path: r.line.category, name: r.line.name, isRevenue: false })).expense;
  // In Percent view an admin types straight into the four End cells; one Save covers every row.
  const editable = canEdit && !asDollars;
  let rowIndex = 0;
  const cell = (r, i, n) => {
    if (editable) {
      const spread = r.status === 'spread';
      const v = spread ? '' : pctValue(r.shares[i]);
      return `<td class="num ma-cellwrap"><input class="ma-cell" name="cell_${n}_${GOAL_KEYS[i]}" form="ma-cells" inputmode="decimal" value="${v}" placeholder="${spread ? pct0(r.shares[i]).replace('%', '') : '—'}" aria-label="${e(`${nameOf(r.line)}: ${MISSION_GOALS[i][1]} percent`)}" data-cell-row="${n}"></td>`;
    }
    const v = asDollars ? r.parts[i] : r.shares[i];
    return `<td class="num">${v ? (asDollars ? money(v) : pct0(v)) : '—'}</td>`;
  };
  const hasStaff = canEdit && data.staff.length > 0;
  const staffCol = (r, link) => (hasStaff
    ? `<td>${r.leads.length ? `<a href="${link}#ma-staff">${r.leads.map((x) => `${e(x.label)}${x.bp < FULL ? ` ${pct0(x.bp)}` : ''}`).join(', ')}</a>` : `<a href="${link}#ma-staff" class="ma-addstaff">+ Assign</a>`}</td>`
    : '');
  const rowHtml = (r) => {
    const [kind, text] = METHOD_BADGES[r.status];
    const link = pageHref('mission', target, { line: r.line.category, ...(show !== 'all' ? { show } : {}), ...(asDollars ? { as: 'usd' } : {}), ...(q ? { q } : {}) });
    const sel = r.line.category === selected;
    const n = rowIndex++;
    const hidden = editable ? `<input type="hidden" form="ma-cells" name="row_${n}" value="${e(r.line.category)}"><input type="hidden" form="ma-cells" name="orig_${n}" value="${r.status === 'spread' ? '0,0,0,0' : r.shares.join(',')}">` : '';
    return `<tr${sel ? ' class="is-sel" aria-selected="true"' : ''} data-row="${n}"><td>${hidden}${canEdit ? `<a class="ma-rowlink" href="${link}">${sel ? `<strong>${e(nameOf(r.line))}</strong>` : e(nameOf(r.line))}</a>` : e(nameOf(r.line))}${r.note ? `<div class="ma-note">${e(r.note.length > 90 ? `${r.note.slice(0, 90)}…` : r.note)}</div>` : ''}</td><td class="num">${money(r.cents)}</td>${[0, 1, 2, 3].map((i) => cell(r, i, n)).join('')}<td>${stackBar(r.shares, { live: editable })}</td><td>${badge(kind, r.status === 'spread' ? 'Like the budget' : text)}</td>${staffCol(r, link)}</tr>`;
  };
  let body = '';
  for (const s of sections) {
    const rows = s.items.filter(keep);
    if (!rows.length) continue;
    body += `<tr class="ma-group"><td colspan="${hasStaff ? 9 : 8}">${e(s.label)}</td></tr>${rows.map(rowHtml).join('')}`;
  }
  if (model.staffPool || model.staff.length) {
    const st = model.staffTotals;
    const shares = model.staffPool ? st.map((c) => Math.round((c / model.staffPool) * FULL)) : [0, 0, 0, 0];
    const people = model.staff.filter((p) => p.pool).length;
    if (show === 'all' && !q) {
      body += `<tr class="ma-group"><td colspan="${hasStaff ? 9 : 8}">Personnel</td></tr><tr><td>Staff salaries &amp; benefits<div class="ma-note">From staff time · ${people} role${people === 1 ? '' : 's'} linked</div></td><td class="num">${money(model.staffPool)}</td>${[0, 1, 2, 3].map((i) => `<td class="num">${asDollars ? money(st[i]) : (shares[i] ? pct0(shares[i]) : '—')}</td>`).join('')}<td>${stackBar(shares)}</td><td>${canEdit ? `<a href="${pageHref('staff-time', target)}" style="font-weight:600;font-size:14px">Set in Staff time →</a>` : ''}</td>${hasStaff ? '<td></td>' : ''}</tr>`;
    }
  }
  const filters = `<form method="GET" action="/" class="ma-year" style="gap:12px"><input type="hidden" name="section" value="planning"><input type="hidden" name="page" value="mission"><input type="hidden" name="target" value="${target}">
    <label class="field"><span>Search</span><input type="search" name="q" value="${e(q)}" placeholder="Account or name" style="width:190px"></label>
    <label class="field"><span>Show</span><select name="show"><option value="all">All lines</option><option value="needs"${show === 'needs' ? ' selected' : ''}>Needs a split</option><option value="shared"${show === 'shared' ? ' selected' : ''}>Shared costs</option></select></label>
    <label class="field"><span>View as</span><select name="as"><option value="pct">Percent</option><option value="usd"${asDollars ? ' selected' : ''}>Dollars</option></select></label>
    ${showZero ? '<input type="hidden" name="zero" value="1">' : ''}<button type="submit" class="button-outline">Apply</button></form>`;
  const table = `<div style="display:flex;flex-direction:column;gap:14px;min-width:0">
    <div class="ma-section-head"><h2>Line items</h2>${filters}</div>
    <div class="ma-frame"><table class="ma-table"><thead><tr><th scope="col">Line item</th><th scope="col" class="num">Budget</th>${MISSION_GOALS.map(([, l]) => `<th scope="col" class="num">${l}</th>`).join('')}<th scope="col">Split</th><th scope="col">Method</th>${hasStaff ? '<th scope="col">Led by</th>' : ''}</tr></thead>
    <tbody>${body || `<tr><td colspan="${hasStaff ? 9 : 8}" class="ma-muted">No lines match.</td></tr>`}</tbody></table></div>
    ${editable ? `<form id="ma-cells" method="POST" action="/api/v1/planning/mission-save" class="ma-savebar" data-cells-form>${hiddenYear(builder, data, 'lines')}<span class="ma-muted" data-cells-status>Click any Welcome, Receive, Grow or Go cell to type a percentage. Choose a line’s name for presets, “spread like the budget” and the reason.</span><button type="submit">Save percentages</button></form>` : ''}
    ${zeroCount ? `<p class="ma-note">${showZero ? `Showing ${zeroCount} line${zeroCount === 1 ? '' : 's'} with $0 planned. <a href="${pageHref('mission', target)}">Hide them</a>` : `${zeroCount} old line${zeroCount === 1 ? '' : 's'} with $0 planned ${zeroCount === 1 ? 'is' : 'are'} hidden. <a href="${pageHref('mission', target, { zero: '1' })}">Show $0 lines</a>`}</p>` : ''}
    <p class="ma-note">These are planned resource allocations, not measures of ministry impact. All expense lines in the FY${target} plan are included. Staff salary and benefit lines are aligned on the Staff time page.</p></div>`;
  const row = programRows.find((r) => r.line.category === selected);
  const drawer = canEdit ? (row ? lineDrawer({ builder, data, row, prior, params, name: nameOf(row.line) }) : buildingDrawer(builder, data)) : '';
  return `${head}${statusLines(params)}${summary(model, target)}<section class="${canEdit ? 'ma-layout' : ''}">${table}${drawer}</section>${canEdit ? '<script src="/mission-alignment/live.js" defer></script>' : ''}`;
}

function lineDrawer({ builder, data, row, prior, params, name }) {
  const target = builder.targetYear;
  const preset = params?.get('preset');
  let method = row.entry?.method || 'split';
  let shares = row.entry && row.entry.method !== 'spread' ? row.entry.shares : [0, 0, 0, 0];
  let note = row.entry?.note || '';
  const lastYear = prior?.lines?.[row.line.category] || null;
  if (preset === 'even') { method = 'split'; shares = [2500, 2500, 2500, 2500]; }
  if (preset === 'building' && data.buildingUse) { method = 'split'; shares = data.buildingUse; }
  if (preset === 'last' && lastYear) { method = lastYear.method; shares = lastYear.method === 'spread' ? [0, 0, 0, 0] : lastYear.shares; note = note || lastYear.note || ''; }
  const one = shares.filter((s) => s > 0).length === 1 && sum(shares) === FULL ? shares.findIndex((s) => s > 0) : 0;
  const presetLink = (key, label, value, enabled = true, why = '') => (enabled
    ? `<a class="button-outline" href="${pageHref('mission', target, { line: row.line.category, preset: key })}" data-preset="${e(JSON.stringify(value))}">${e(label)}</a>`
    : `<span class="button-outline" aria-disabled="true" title="${e(why)}" style="opacity:.5">${e(label)}</span>`);
  return `<aside class="ma-drawer" aria-labelledby="ma-ed">
    <form method="POST" action="/api/v1/planning/mission-save" data-ma-shares data-cents="${row.cents}">${hiddenYear(builder, data, 'line')}<input type="hidden" name="category" value="${e(row.line.category)}">
    <div><span class="ma-eyebrow">Editing</span><h3 id="ma-ed">${e(name)}</h3><span class="ma-muted">${money(row.cents)} · ${e(row.line.category)}</span></div>
    ${preset === 'last' && !lastYear ? '<p class="ma-badge warn">Last year has no alignment for this line.</p>' : ''}
    <fieldset><legend>How should this line be aligned?</legend>
      <label class="ma-radio"><input type="radio" name="method" value="one"${method === 'one' ? ' checked' : ''}><span>One End <small>· the whole line serves one goal</small></span></label>
      <label class="field" style="margin-left:26px"><span class="sr-only">End for this line</span><select name="end">${MISSION_GOALS.map(([k, l], i) => `<option value="${k}"${i === one ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="ma-radio"><input type="radio" name="method" value="split"${method === 'split' ? ' checked' : ''}><span>Split by percent <small>· you set the shares</small></span></label>
      <label class="ma-radio"><input type="radio" name="method" value="spread"${method === 'spread' ? ' checked' : ''}><span>Spread like the budget <small>· follows everything else</small></span></label>
    </fieldset>
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="ma-grid ma-muted" style="font-size:13px;font-weight:600"><span>End</span><span>Share %</span><span class="num">Dollars</span></div>
      ${MISSION_GOALS.map(([k, l], i) => `<div class="ma-grid"><label for="ma-s-${k}" style="display:flex;gap:8px;align-items:center">${dot(i)}${l}</label><input id="ma-s-${k}" name="share_${k}" data-share inputmode="decimal" value="${pctValue(shares[i])}" placeholder="0"><span class="num" data-dollars="${i}">${money(Math.round((row.cents * shares[i]) / FULL))}</span></div>`).join('')}
      ${stackBar(shares, { height: 14, radius: 4, live: true })}
      <span class="ma-badge ${sum(shares) === FULL ? 'ok' : 'warn'}" data-ma-total style="align-self:flex-start">${sum(shares) === FULL ? `Totals 100% · ${money(row.cents)}` : `${(FULL - sum(shares)) / 100}% not yet aligned`}</span>
      <span class="ma-note">The shares apply when “Split by percent” is chosen. A split under 100% leaves the rest as not yet aligned.</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px"><span style="font-size:14px;font-weight:600">Start from a preset</span><div class="ma-presets">
      ${presetLink('building', 'By building use', data.buildingUse || [0, 0, 0, 0], Boolean(data.buildingUse), 'Set the building-use preset first (choose no line to see it).')}
      ${presetLink('even', 'Even 25 / 25 / 25 / 25', [2500, 2500, 2500, 2500])}
      ${presetLink('last', 'Copy from last year', lastYear && lastYear.method !== 'spread' ? lastYear.shares : [0, 0, 0, 0], Boolean(lastYear), `FY${target - 1} has no alignment for this line.`)}
    </div></div>
    ${staffOnLine(data, row)}
    <label class="field" style="display:flex;flex-direction:column;gap:6px"><span style="font-weight:600">Why this split</span><textarea name="note" rows="3" maxlength="600">${e(note)}</textarea><span class="ma-note">Shows on the council report so the reasoning travels with the number.</span></label>
    <div class="ma-actions"><a href="${pageHref('mission', target)}">Cancel</a><button type="submit" name="method" value="clear" class="button-outline" formnovalidate>Clear</button><button type="submit">Apply to line</button></div>
    </form></aside>`;
}

// Who leads this line, as each person's share of the line. Responsibility only: the line keeps its
// own Ends and dollars, and each person's pay still follows their own time.
function staffOnLine(data, row) {
  if (!data.staff.length) return '';
  const current = (data.leads || {})[row.line.category] || {};
  return `<div id="ma-staff" style="display:flex;flex-direction:column;gap:8px;scroll-margin-top:16px"><input type="hidden" name="leads" value="1">
    <span style="font-size:14px;font-weight:600">Who leads this line</span>
    <span class="ma-note">The share of this line each person is responsible for. Concerts might be Music Director 100%; a shared line could be 50 and 50. It doesn’t move any of their pay or time.</span>
    ${data.staff.map((p, i) => { const bp = current[p.id] || 0; return `<div class="ma-grid"><label for="ma-st-${i}">${e(p.label)}</label><input id="ma-st-${i}" name="lead_${i}" inputmode="decimal" value="${pctValue(bp)}" placeholder="0"><span class="num">${bp ? money(Math.round((row.cents * bp) / FULL)) : ''}</span></div>`; }).join('')}
  </div>`;
}

function buildingDrawer(builder, data) {
  const shares = data.buildingUse || [0, 0, 0, 0];
  return `<aside class="ma-drawer" aria-labelledby="ma-bu">
    <div><span class="ma-eyebrow">Choose a line</span><h3 id="ma-bu">Align a line item</h3><p class="ma-muted" style="margin:6px 0 0">Choose a line on the left to set its End, a split, or to let it follow the rest of the budget. Shared costs like utilities usually split by how the building is used.</p></div>
    <form method="POST" action="/api/v1/planning/mission-save" data-ma-shares data-cents="0" style="display:flex;flex-direction:column;gap:10px">${hiddenYear(builder, data, 'building')}
      <span style="font-size:14px;font-weight:600">Building-use preset</span>
      <span class="ma-note">How the building’s hours divide among the Ends. Offered as “By building use” for any shared line.</span>
      ${MISSION_GOALS.map(([k, l], i) => `<div class="ma-grid" style="grid-template-columns:1fr 84px"><label for="ma-b-${k}" style="display:flex;gap:8px;align-items:center">${dot(i)}${l}</label><input id="ma-b-${k}" name="share_${k}" data-share inputmode="decimal" value="${pctValue(shares[i])}" placeholder="0"></div>`).join('')}
      ${stackBar(shares, { height: 14, radius: 4, live: true })}
      <span class="ma-badge ${sum(shares) === FULL ? 'ok' : 'warn'}" data-ma-total style="align-self:flex-start">${sum(shares) === FULL ? 'Totals 100%' : 'Must total 100%'}</span>
      <div class="ma-actions"><button type="submit">Save preset</button></div>
    </form></aside>`;
}

// ── Staff time by End ────────────────────────────────────────────────────────────────────────

function setBy(person) {
  if (!person.reviewed) return badge('warn', 'Draft · needs review');
  return person.mode === 'week' ? badge('ok', 'Typical week') : badge('info', 'Quick split');
}

export function renderStaffTimePage({ builder, data, layout = null, params, canEdit = false, workers = null, now = new Date() }) {
  const target = builder.targetYear;
  const head = `${missionChips('staff-time', target, { admin: canEdit })}
    <div class="ma-head"><div><span class="ma-eyebrow">Budget · Mission alignment</span><h2>Staff time by End</h2><p class="ma-sub">FY${target} budget plan · a typical week, not a timesheet</p></div>${yearPicker('staff-time', target, now)}</div>`;
  if (!canEdit) return `${head}${unavailable('Staff time', 'Staff time sits beside compensation, so only a Finance administrator can see it.')}`;
  if (!data) return `${head}${unavailable('Staff time', 'Staff time could not be read. Reload to try again; nothing has been changed.')}`;
  const model = missionModel(builder, data);
  const selectedId = params?.get('role') || '';
  let staffRow = 0;
  const roleRow = (p) => {
    const sel = p.id === selectedId;
    const n = staffRow++;
    const quick = p.mode !== 'week';
    const cells = quick
      ? `<input type="hidden" form="ma-staff-cells" name="srole_${n}" value="${e(p.id)}"><input type="hidden" form="ma-staff-cells" name="sorig_${n}" value="${p.shares.join(',')}">`
      : '';
    const shareCells = p.shares.map((v, i) => (quick
      ? `<td class="num ma-cellwrap">${i === 0 ? cells : ''}<input class="ma-cell" name="scell_${n}_${GOAL_KEYS[i]}" form="ma-staff-cells" inputmode="decimal" value="${pctValue(v)}" placeholder="—" aria-label="${e(`${p.label}: ${MISSION_GOALS[i][1]} percent`)}" data-cell-row="s${n}"></td>`
      : `<td class="num">${v ? pct0(v) : '—'}</td>`)).join('');
    const lineNote = p.ledLines.length ? `<div class="ma-note">Leads ${p.ledLines.length} line${p.ledLines.length === 1 ? '' : 's'} · ${money(p.ledCents)}</div>` : '';
    const hours = p.mode === 'week' && p.weekResult.total ? p.weekResult.total : p.hours;
    return `<tr${sel ? ' class="is-sel" aria-selected="true"' : ''}><td><a class="ma-rowlink" href="${pageHref('staff-time', target, { role: p.id, ...(p.mode === 'week' ? { mode: 'week' } : {}) })}">${sel ? `<strong>${e(p.label)}</strong>` : e(p.label)}</a>${p.planKey ? `<div class="ma-note">${e(p.name)}${workers && !workers.some((w) => w.key === p.planKey) ? ' · no longer in the compensation planner' : ' · from the compensation planner'}</div>` : ''}${p.pool ? '' : '<div class="ma-note">No compensation lines linked yet</div>'}${lineNote}</td><td class="num">${hours ? hoursText(hours) : '—'}</td><td class="num">${money(p.pool)}${p.benefitShare ? `<div class="ma-note">${money(p.ownPay)} pay + ${money(p.benefitShare)} benefits</div>` : ''}</td>${shareCells}<td>${stackBar(p.effShares)}</td><td>${setBy(p)}</td></tr>`;
  };
  const totalHours = sum(model.staff.map((p) => (p.mode === 'week' && p.weekResult.total ? p.weekResult.total : p.hours || 0)));
  const allShares = model.staffPool ? model.staffTotals.map((c) => Math.round((c / model.staffPool) * FULL)) : [0, 0, 0, 0];
  const table = `<section class="ma-section" aria-labelledby="st-h">
    <div class="ma-section-head"><h2 id="st-h">Where staff compensation goes</h2><span class="ma-muted">${money(model.staffPool)} salaries &amp; benefits · counted under Personnel on <a href="${pageHref('mission', target)}">Line items by End</a></span></div>
    <div class="ma-frame"><table class="ma-table"><thead><tr><th scope="col">Role</th><th scope="col" class="num">Hours / week</th><th scope="col" class="num">Comp &amp; benefits</th>${MISSION_GOALS.map(([, l]) => `<th scope="col" class="num">${l}</th>`).join('')}<th scope="col">Split</th><th scope="col">Set by</th></tr></thead>
    <tbody>${model.staff.map(roleRow).join('') || '<tr><td colspan="9" class="ma-muted">No staff roles yet. Add one below.</td></tr>'}</tbody>
    ${model.staff.length ? `<tfoot><tr><td>All staff</td><td class="num">${totalHours ? hoursText(totalHours) : '—'}</td><td class="num">${money(model.staffPool)}</td>${model.staffTotals.map((c) => `<td class="num">${money(c)}</td>`).join('')}<td>${stackBar(allShares)}</td><td></td></tr></tfoot>` : ''}</table></div>
    ${model.staff.length ? `<form id="ma-staff-cells" method="POST" action="/api/v1/planning/mission-save" class="ma-savebar" data-cells-form>${hiddenYear(builder, data, 'staff-shares')}<span class="ma-muted" data-cells-status>Click a Welcome, Receive, Grow or Go cell to type a percentage, or a name for a typical week, pay lines and time on specific budget lines.</span><button type="submit">Save percentages</button></form>` : ''}
    <form method="POST" action="/api/v1/planning/mission-save" class="ma-year">${hiddenYear(builder, data, 'staff-add')}<label class="field"><span>Add a staff role</span><input name="label" maxlength="60" required placeholder="e.g. Music Director"></label><button type="submit" class="button-outline">Add role</button></form>
  </section>`;
  const person = model.staff.find((p) => p.id === selectedId);
  return `${head}${statusLines(params)}${params?.get('imported') ? `<p class="status status-ok" role="status">${Number(params.get('imported')) ? `${Number(params.get('imported'))} staff brought in from the compensation planner.` : 'Staff refreshed from the compensation planner.'} Set each person’s time below.</p>` : ''}${plannerPanel({ builder, data, model, workers, layout })}${table}${person ? staffEditor({ builder, data, model, person, params, layout }) : ''}<script src="/mission-alignment/live.js" defer></script>`;
}

// The compensation planner's staff, and the shared benefit lines they draw on.
function plannerPanel({ builder, data, model, workers, layout }) {
  const lay = layout || normalizeBoardLayout(null);
  const lines = builder.lines.filter((l) => l.classification !== 'Income');
  const linkedKeys = new Set(data.staff.map((s) => s.planKey).filter(Boolean));
  const missing = (workers || []).filter((w) => !linkedKeys.has(w.key));
  const plannerCost = sum((workers || []).map((w) => w.churchCostCents));
  let status;
  if (workers == null) status = '<p class="ma-badge warn" style="align-self:flex-start">The compensation planner could not be read just now. Staff already brought in are unchanged.</p>';
  else if (!workers.length) status = '<p class="ma-muted" style="margin:0">The compensation planner has no staff paid from this budget yet.</p>';
  else status = `<p class="ma-muted" style="margin:0">${workers.length} staff in the compensation planner, projected at ${money(plannerCost)} for FY${builder.targetYear}${missing.length ? ` · <strong>${missing.length} not yet here</strong>: ${missing.map((w) => e(w.position || w.name)).join(', ')}` : ' · all brought in'}. The budget’s staff lines hold ${money(model.staffPool)}${plannerCost && Math.abs(plannerCost - model.staffPool) >= 100000 ? `, so the budget and the planner differ by ${money(Math.abs(plannerCost - model.staffPool))}. Update the budget lines on the Budget planner if they should match` : ''}.</p>`;
  const others = new Set(data.staff.flatMap((s) => s.sources));
  const benefitChoices = lines.map((l, i) => ({ l, i })).filter(({ l }) => !others.has(l.category) && !data.lines[l.category]);
  const likely = (l) => /health|medical|dental|vision|disabilit|pension|retire|fica|social security|payroll|benefit|mileage|professional development|workers?.? ?comp/i.test(`${l.category} ${l.name}`) && !/\bMDO\b/i.test(l.category);
  const shown = benefitChoices.filter(({ l }) => data.benefitLines.includes(l.category) || likely(l));
  return `<section class="ma-panel ma-section" aria-labelledby="st-plan">
    <div class="ma-section-head"><h2 id="st-plan">From the compensation planner</h2>${workers && workers.length ? `<form method="POST" action="/api/v1/planning/mission-save">${hiddenYear(builder, data, 'staff-import')}<button type="submit">${linkedKeys.size ? 'Refresh staff from the compensation planner' : 'Bring in staff from the compensation planner'}</button></form>` : ''}</div>
    ${status}
    <p class="ma-note" style="margin:0">Bringing staff in adds a role for each person paid from this budget, with their position and usual hours, and links the budget line their pay is charged to. Refreshing keeps the time splits you have set. Dollars always come from the budget plan, never from the planner; the planner only decides how the shared benefit lines below are divided among staff.</p>
    <details${data.benefitLines.length ? '' : ' open'}><summary>Shared staff benefit lines · ${money(model.benefitPool)}</summary>
      <form method="POST" action="/api/v1/planning/mission-save" style="display:flex;flex-direction:column;gap:10px">${hiddenYear(builder, data, 'staff-benefits')}
        <p class="ma-note">Benefit and payroll-cost lines that cover all staff together (health, pension, payroll taxes, mileage, professional development). Each person’s share is added to their pay, so their full cost is split by their time. Shares follow each person’s benefits in the compensation planner, or their pay when there is no planner share.</p>
        <div class="ma-sources">${shown.map(({ l, i }) => `<label><input type="checkbox" name="benefit_${i}" value="${e(l.category)}"${data.benefitLines.includes(l.category) ? ' checked' : ''}> ${e(accountDisplayName(lay, l.category, l.name))} · ${money(lineCents(l))}</label>`).join('') || '<span class="ma-muted">No benefit lines found in this plan.</span>'}</div>
        <div class="ma-actions" style="justify-content:flex-start"><button type="submit" class="button-outline">Save benefit lines</button></div>
      </form></details>
  </section>`;
}

// The ministry lines this person leads, as their share of each line.
function ledLinesSection(builder, data, model, person, lay) {
  const all = builder.lines.filter((l) => l.classification !== 'Income');
  const owned = new Set([...data.staff.flatMap((s) => s.sources), ...data.benefitLines]);
  const leadOf = (c) => ((data.leads || {})[c] || {})[person.id] || 0;
  const rows = all.map((l, i) => ({ l, i })).filter(({ l }) => !owned.has(l.category) && (lineCents(l) || leadOf(l.category)));
  const set = rows.filter(({ l }) => leadOf(l.category));
  const endText = (r) => {
    const row = model.rows.find((x) => x.line.category === r.l.category);
    if (!row || row.status === 'needs') return 'not yet aligned';
    if (row.status === 'spread') return 'like the budget';
    return MISSION_GOALS.map(([, label], j) => (row.shares[j] ? `${label}${row.shares[j] < FULL ? ` ${pct0(row.shares[j])}` : ''}` : '')).filter(Boolean).join(', ');
  };
  return `<details${set.length ? ' open' : ''}><summary>Lines ${e(person.label)} leads · ${person.ledLines.length ? `${person.ledLines.length} · ${money(person.ledCents)}` : 'none yet'}</summary>
    <input type="hidden" name="led_lines" value="1">
    <p class="ma-note">Enter this person’s share of each line they are responsible for: 100 if it is theirs alone. This does not move any of their pay or time; it shows which parts of the budget they oversee.</p>
    <div style="max-height:360px;overflow:auto;border:1px solid #D7E2E9;border-radius:8px"><table class="ma-table"><thead><tr><th scope="col">Budget line</th><th scope="col">Counts toward</th><th scope="col" class="num">Their share</th><th scope="col" class="num">Dollars</th></tr></thead><tbody>
    ${[...set, ...rows.filter((r) => !set.includes(r))].map(({ l, i }) => { const bp = leadOf(l.category); return `<tr><td>${e(accountDisplayName(lay, l.category, l.name))}</td><td class="ma-note">${e(endText({ l }))}</td><td class="num ma-cellwrap"><input class="ma-cell" name="led_${i}" inputmode="decimal" value="${pctValue(bp)}" placeholder="—" aria-label="${e(`${person.label}: share of ${l.name}`)}"></td><td class="num">${bp ? money(Math.round((lineCents(l) * bp) / FULL)) : ''}</td></tr>`; }).join('')}
    </tbody></table></div></details>`;
}

function staffEditor({ builder, data, model, person, params, layout }) {
  const target = builder.targetYear;
  const mode = params?.get('mode') === 'week' ? 'week' : (params?.get('mode') === 'quick' ? 'quick' : person.mode);
  const templateKey = params?.get('template');
  const week = (mode === 'week' && templateWeek(templateKey)) || person.week;
  const lay = layout || normalizeBoardLayout(null);
  const tab = (key, label) => `<a href="${pageHref('staff-time', target, { role: person.id, mode: key })}"${mode === key ? ' aria-current="page"' : ''}>${label}</a>`;
  const others = new Set(data.staff.filter((s) => s.id !== person.id).flatMap((s) => s.sources));
  const lines = builder.lines.filter((l) => l.classification !== 'Income');
  const sources = lines.map((l, i) => ({ l, i })).filter(({ l }) => !others.has(l.category) && !data.lines[l.category] && !data.benefitLines.includes(l.category));
  const likely = (l) => /salar|wage|benefit|pension|health|housing|fica|payroll|social security|insurance - staff/i.test(`${l.category} ${l.name}`);
  const sorted = [...sources.filter(({ l }) => person.sources.includes(l.category)), ...sources.filter(({ l }) => !person.sources.includes(l.category) && likely(l)), ...sources.filter(({ l }) => !person.sources.includes(l.category) && !likely(l))];
  const sourceBox = ({ l, i }) => `<label><input type="checkbox" name="source_${i}" value="${e(l.category)}"${person.sources.includes(l.category) ? ' checked' : ''}> ${e(accountDisplayName(lay, l.category, l.name))} · ${money(lineCents(l))}</label>`;
  const common = `<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end">
      <label class="field"><span>Role</span><input name="label" value="${e(person.label)}" maxlength="60" required></label>
      <label class="field"><span>Hours per week</span><input name="hours" inputmode="decimal" value="${hoursText(person.hours)}" style="width:90px"></label>
      <label class="ma-radio" style="align-self:center"><input type="checkbox" name="reviewed" value="yes"${person.reviewed ? ' checked' : ''}><span>Reviewed with this person</span></label>
    </div>
    <details${person.sources.length ? '' : ' open'}><summary>Compensation lines for ${e(person.label)} · ${money(person.pool)}</summary>
      <p class="ma-note">Tick this role’s salary and benefit lines in the FY${target} plan. Their dollars are counted by this person’s time instead of their own line, so nothing is counted twice. Lines already linked to another role, or already split on Line items by End, are not listed.</p>
      <div class="ma-sources">${sorted.map(sourceBox).join('') || '<span class="ma-muted">No expense lines are available.</span>'}</div></details>
    ${ledLinesSection(builder, data, model, person, lay)}`;
  let editor;
  if (mode === 'quick') {
    const restCents = person.pool;
    editor = `<form method="POST" action="/api/v1/planning/mission-save" data-ma-shares data-cents="${restCents}" style="display:flex;flex-direction:column;gap:16px">${hiddenYear(builder, data, 'staff')}<input type="hidden" name="id" value="${e(person.id)}"><input type="hidden" name="mode" value="quick">
      ${common}
      <div style="max-width:420px;display:flex;flex-direction:column;gap:10px">
        <div class="ma-grid ma-muted" style="font-size:13px;font-weight:600"><span>End</span><span>Share %</span><span class="num">Dollars</span></div>
        ${MISSION_GOALS.map(([k, l], i) => `<div class="ma-grid"><label for="ma-q-${k}" style="display:flex;gap:8px;align-items:center">${dot(i)}${l}</label><input id="ma-q-${k}" name="share_${k}" data-share inputmode="decimal" value="${pctValue(person.shares[i])}" placeholder="0"><span class="num" data-dollars="${i}">${money(Math.round((restCents * person.shares[i]) / FULL))}</span></div>`).join('')}
        ${stackBar(person.shares, { height: 14, radius: 4, live: true })}
        <span class="ma-badge ${sum(person.shares) === FULL ? 'ok' : 'warn'}" data-ma-total style="align-self:flex-start">${sum(person.shares) === FULL ? `Totals 100% · ${money(restCents)}` : `${(FULL - sum(person.shares)) / 100}% not yet aligned`}</span>
      </div>
      <div class="ma-actions"><a href="${pageHref('staff-time', target)}">Cancel</a><button type="submit">Apply to ${e(person.label)}</button></div></form>`;
  } else {
    const rows = [...week, ...Array.from({ length: Math.max(3, 8 - week.length) }, () => ({ activity: '', hours: null, end: null }))].slice(0, 30);
    const result = weekShares(week);
    const endSelect = (i, end) => `<select name="act_end_${i}" data-week-end aria-label="Counts toward"><option value="">Choose…</option>${MISSION_GOALS.map(([k, l], j) => `<option value="${k}"${end === j ? ' selected' : ''}>${l}</option>`).join('')}<option value="spread"${end === 'spread' ? ' selected' : ''}>Spread across all four</option></select>`;
    const targetHours = person.hours ? person.hours / 100 : 0;
    const total = result.total / 100;
    const ok = !targetHours || Math.abs(total - targetHours) < 0.01;
    editor = `<form method="POST" action="/api/v1/planning/mission-save" data-ma-week data-cents="${person.pool}" data-hours="${targetHours}" style="display:flex;flex-direction:column;gap:16px">${hiddenYear(builder, data, 'staff')}<input type="hidden" name="id" value="${e(person.id)}"><input type="hidden" name="mode" value="week">
      ${common}
      ${templateKey && WEEK_TEMPLATES[templateKey] ? `<p class="ma-badge info" style="align-self:flex-start">Filled from the ${e(WEEK_TEMPLATES[templateKey].label.toLowerCase())} template — adjust the hours, then apply.</p>` : ''}
      <div class="ma-week"><div style="display:flex;flex-direction:column;gap:12px;min-width:0"><div style="overflow-x:auto"><table class="ma-table"><thead><tr><th scope="col">Activity</th><th scope="col" class="num">Hours</th><th scope="col">Counts toward</th></tr></thead><tbody>
        ${rows.map((w, i) => `<tr data-week-row><td><input name="act_${i}" value="${e(w.activity)}" maxlength="80" aria-label="Activity ${i + 1}" style="width:100%;box-sizing:border-box"></td><td class="num"><input name="act_hours_${i}" data-week-hours inputmode="decimal" value="${w.hours == null ? '' : hoursText(w.hours)}" aria-label="Hours for activity ${i + 1}" style="width:72px;text-align:right"></td><td>${endSelect(i, w.end)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td>Total</td><td class="num" data-week-total>${total}</td><td><span class="ma-badge ${ok ? 'ok' : 'warn'}" data-week-badge>${targetHours ? (ok ? `Matches ${targetHours} hours` : `${targetHours} hours expected`) : `${total} hours`}</span></td></tr></tfoot></table></div>
        <div class="ma-presets"><span class="ma-muted" style="align-self:center">Start from a template:</span>${Object.entries(WEEK_TEMPLATES).map(([k, t]) => `<a class="button-outline" href="${pageHref('staff-time', target, { role: person.id, mode: 'week', template: k })}">${e(t.label)}</a>`).join('')}</div>
        <p class="ma-note">Empty rows are ignored. Save to add more rows. “Spread across all four” is for overhead such as administration.</p></div>
      <div class="ma-result"><h4>What this week adds up to</h4>${stackBar(result.shares, { height: 20, radius: 6, live: true })}
        <table class="ma-table"><thead><tr><th scope="col">End</th><th scope="col" class="num">Hours</th><th scope="col" class="num">Share</th><th scope="col" class="num">Dollars</th></tr></thead><tbody>
        ${MISSION_GOALS.map(([, l], i) => `<tr><td>${dot(i)} ${l}</td><td class="num" data-week-h="${i}">${(result.hours[i] / 100).toFixed(1)}</td><td class="num" data-week-pct="${i}">${pct0(result.shares[i])}</td><td class="num" data-week-usd="${i}">${money(Math.round((person.pool * result.shares[i]) / FULL))}</td></tr>`).join('')}</tbody></table>
        <p class="ma-note" style="margin:0">Hours marked “spread across all four” are shared in the same proportion as the rest, so no End is credited or charged for the overhead.</p>
        <div class="ma-actions"><a href="${pageHref('staff-time', target)}">Cancel</a><button type="submit">Apply to ${e(person.label)}</button></div></div></div></form>`;
  }
  return `<section class="ma-panel" aria-labelledby="st-ed">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
      <div><span class="ma-eyebrow">Editing</span><h3 id="st-ed" style="margin:0;font-size:20px">${e(person.label)} · a typical week</h3><span class="ma-muted">${money(person.pool)} comp &amp; benefits${person.hours ? ` · ${hoursText(person.hours)} hours` : ''}</span></div>
      <nav class="ma-tabs" aria-label="How to set this person’s time">${tab('quick', 'Quick split')}${tab('week', 'Build from a typical week')}</nav>
    </div>
    ${editor}
    <form method="POST" action="/api/v1/planning/mission-save" class="ma-actions" style="justify-content:flex-start">${hiddenYear(builder, data, 'staff-remove')}<input type="hidden" name="id" value="${e(person.id)}"><button type="submit" class="button-outline">Remove this role</button><span class="ma-note" style="align-self:center">Removes only the time split; budget lines are not changed.</span></form>
  </section>`;
}
export { GOAL_KEYS, END_COLORS };
