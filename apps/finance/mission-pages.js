// Budget › Line items by End and Budget › Staff time: the two admin editors for mission alignment.
// Everything is server-rendered; one small script from this Worker keeps totals live while typing.
import { escapeHtml as e } from './render-helpers.js';
import { buildBoardSections, normalizeBoardLayout, accountDisplayName } from './board-layout.js';
import { GOAL_KEYS, MISSION_GOALS, WEEK_TEMPLATES, lineCents, missionModel, rescaleWeek, templateWeek, weekTargets } from './mission-alignment.js';
import { personnelPanel, personnelShare } from './mission-visuals.js';
import { END_COLORS, dot, missionChips, money, pageHref, pct0, pct1, sharesLabel, stackBar, sum, yearPicker } from './mission-ui.js';

const FULL = 10000;
const METHOD_BADGES = {
  one: ['info', 'One End'], split: ['ok', 'Split'], spread: ['info', 'Like the budget'],
  partial: ['warn', 'Partly split'], needs: ['warn', 'Needs a split'],
};
const badge = (kind, text) => `<span class="ma-badge ${kind}">${kind === 'warn' ? '<span class="ma-dot" style="background:#B07A00"></span>' : ''}${e(text)}</span>`;
const RETURN_PAGES = { district: 'district', 'admin-rule': 'staff-time', lines: 'mission', line: 'mission', building: 'mission', staff: 'staff-time', 'staff-add': 'staff-time', 'staff-remove': 'staff-time', 'staff-import': 'staff-time', 'staff-benefits': 'staff-time' };
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
  const cards = MISSION_GOALS.map(([, label, sub], i) => `<div class="ma-card"><div style="display:flex;gap:8px;align-items:center;font-weight:600">${dot(i)}${label}</div><div class="ma-muted" style="font-size:13px">${sub}</div><div class="ma-big">${money(model.totals[i])}</div><div class="ma-muted">${pct1(shares[i])} of budget${model.staffTotals[i] ? ` · incl. ${money(model.staffTotals[i])} staff` : ''}</div></div>`).join('');
  const needs = model.unassigned
    ? `<div class="ma-card is-warn"><div style="font-weight:600">Not yet aligned</div><div style="font-size:13px;color:#6E4A00">${model.needsCount} line${model.needsCount === 1 ? '' : 's'} need${model.needsCount === 1 ? 's' : ''} a split${model.staffOpen ? ` · ${money(model.staffOpen)} staff time open` : ''}</div><div class="ma-big">${money(model.unassigned)}</div>${linkNeeds ? `<div style="font-size:14px"><a href="${pageHref('mission', target, { show: 'needs' })}">Show these lines</a></div>` : ''}</div>`
    : '<div class="ma-card"><div style="font-weight:600">Fully aligned</div><div class="ma-muted">Every dollar is counted toward an End.</div></div>';
  return `<section class="ma-section" aria-labelledby="ma-sum">
    <div class="ma-section-head"><h2 id="ma-sum">Total budget by End</h2><span class="ma-muted">${money(t)} in planned expenses · includes staff time · shared costs can follow the rest of the budget</span></div>
    ${stackBar(shares, { height: 28, radius: 8, label: `${sharesLabel(shares)}, unassigned ${Math.round((FULL - sum(shares)) / 100)} percent` })}
    <div class="ma-cards">${cards}${needs}</div>
    ${countedOnce(model, target)}
  </section>`;
}

// Salaries and benefits are budgeted once; this shows where that one amount is counted.
export function countedOnce(model, target) {
  if (!model.staffPool) return '';
  const parts = [model.staffOnLines, model.staffAdmin, model.staffDirect, model.staffOpen];
  const shares = toBp(parts, model.staffPool);
  const colors = ['#386781', '#9DB6C6', '#7A8B99'];
  return `<div class="ma-once">
    <div><strong>Staff compensation is counted once</strong><p class="ma-muted" style="margin:4px 0 0">Salaries and benefits (${money(model.staffPool)}) are budgeted once. They are not added again: each person’s cost is distributed to the lines they work on, then follows each line’s split to the Ends.</p></div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="ma-bar" style="height:18px;border-radius:5px" role="img" aria-label="${e(`Staff cost: ${money(parts[0])} on ministry lines, ${money(parts[1])} shared administration, ${money(parts[2])} straight to an End, ${money(parts[3])} not yet allocated`)}">${shares.slice(0, 3).map((bp, i) => `<div class="ma-seg" style="width:${bp / 100}%;background:${colors[i]}"></div>`).join('')}<div class="ma-seg ma-hatch" style="width:${shares[3] / 100}%"></div></div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13.5px">
        <span><span class="ma-dot" style="background:${colors[0]}"></span> On ministry lines <strong>${money(parts[0])}</strong></span>
        <span><span class="ma-dot" style="background:${colors[1]}"></span> Shared administration, by rule <strong>${money(parts[1])}</strong></span>
        ${parts[2] ? `<span><span class="ma-dot" style="background:${colors[2]}"></span> Straight to an End <strong>${money(parts[2])}</strong></span>` : ''}
        <span><span class="ma-dot ma-hatch" style="border:1px solid #C7D3DB"></span> Not yet allocated <strong>${money(parts[3])}</strong></span>
        <a href="${pageHref('staff-time', target)}">Set in Staff time</a>
      </div>
    </div></div>`;
}
const toBp = (parts, whole) => (whole > 0 ? parts.map((v) => Math.max(0, Math.round((v / whole) * FULL))) : parts.map(() => 0));

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
  const show = ['needs', 'shared', 'staff'].includes(params?.get('show')) ? params.get('show') : 'all';
  const asDollars = params?.get('as') === 'usd';
  const selected = params?.get('line') || '';
  const nameOf = (l) => accountDisplayName(lay, l.category, l.name || l.category);
  // Old lines with nothing planned this year are hidden unless asked for (or selected).
  const showZero = params?.get('zero') === '1';
  const zeroCount = model.rows.filter((r) => !r.isSource && !r.cents).length;
  const keep = (r) => {
    if (!r.cents && !showZero && r.line.category !== selected) return false;
    if (q && !`${nameOf(r.line)} ${r.line.category} ${r.staffBy.map((x) => x.label).join(' ')}`.toLowerCase().includes(q)) return false;
    if (show === 'needs') return r.status === 'needs' || r.status === 'partial';
    if (show === 'shared') return r.status === 'spread' || r.status === 'split';
    if (show === 'staff') return r.staffCost > 0;
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
    const v = asDollars ? r.combinedParts[i] : r.shares[i];
    return `<td class="num">${v ? (asDollars ? money(v) : pct0(v)) : '—'}</td>`;
  };
  const cols = 10;
  const staffNote = (r, link) => {
    const who = r.staffBy.map((x) => `${e(x.label)} ${pct0(x.bp)}`);
    const lead = r.leads.length ? ` · Led by ${r.leads.map((x) => e(x.label)).join(', ')}` : '';
    if (who.length) return `<div class="ma-note">${r.staffBy.length} staff · ${who.slice(0, 2).join(', ')}${who.length > 2 ? ' …' : ''}${lead}</div>`;
    return `<div class="ma-note">${canEdit && data.staff.length ? `<a href="${link}#ma-staff" class="ma-addstaff">+ Add staff time</a>` : ''}${lead}</div>`;
  };
  const rowHtml = (r) => {
    const [kind, text] = METHOD_BADGES[r.status];
    const link = pageHref('mission', target, { line: r.line.category, ...(show !== 'all' ? { show } : {}), ...(asDollars ? { as: 'usd' } : {}), ...(q ? { q } : {}) });
    const sel = r.line.category === selected;
    const n = rowIndex++;
    const hidden = editable ? `<input type="hidden" form="ma-cells" name="row_${n}" value="${e(r.line.category)}"><input type="hidden" form="ma-cells" name="orig_${n}" value="${r.status === 'spread' ? '0,0,0,0' : r.shares.join(',')}">` : '';
    return `<tr${sel ? ' class="is-sel" aria-selected="true"' : ''} data-row="${n}"><td>${hidden}${canEdit ? `<a class="ma-rowlink" href="${link}">${sel ? `<strong>${e(nameOf(r.line))}</strong>` : e(nameOf(r.line))}</a>` : e(nameOf(r.line))}${r.note ? `<div class="ma-note">${e(r.note.length > 90 ? `${r.note.slice(0, 90)}…` : r.note)}</div>` : ''}${staffNote(r, link)}</td><td class="num">${money(r.cents)}</td><td class="num ma-staffcell">${r.staffCost ? money(r.staffCost) : '<span class="ma-muted">—</span>'}</td><td class="num"><strong>${money(r.cents + r.staffCost)}</strong></td>${[0, 1, 2, 3].map((i) => cell(r, i, n)).join('')}<td>${stackBar(r.shares, { live: editable })}</td><td>${badge(kind, r.status === 'spread' ? 'Like the budget' : text)}</td></tr>`;
  };
  let body = '';
  for (const s of sections) {
    const rows = s.items.filter(keep);
    if (!rows.length) continue;
    body += `<tr class="ma-group"><td colspan="${cols}">${e(s.label)}</td></tr>${rows.map(rowHtml).join('')}`;
  }
  if (model.staffPool || model.staff.length) {
    const st = model.staffTotals;
    const shares = model.staffPool ? st.map((c) => Math.round((c / model.staffPool) * FULL)) : [0, 0, 0, 0];
    const people = model.staff.filter((p) => p.pool).length;
    if (show === 'all' && !q) {
      body += `<tr class="ma-group"><td colspan="${cols}">Personnel · counted once</td></tr><tr><td>Staff salaries &amp; benefits<div class="ma-note">Budgeted here once (${people} role${people === 1 ? '' : 's'}). Distributed above: ${money(model.staffOnLines)} to lines · ${money(model.staffAdmin)} shared administration${model.staffDirect ? ` · ${money(model.staffDirect)} straight to an End` : ''}${model.staffOpen ? ` · <strong style="color:#6E4A00">${money(model.staffOpen)} not yet allocated</strong>` : ''}</div></td><td class="num">${money(model.staffPool)}</td><td class="num ma-muted">→ lines</td><td class="num ma-muted">in lines</td>${[0, 1, 2, 3].map((i) => `<td class="num">${asDollars ? money(st[i]) : (shares[i] ? pct0(shares[i]) : '—')}</td>`).join('')}<td>${stackBar(shares)}</td><td>${canEdit ? `<a href="${pageHref('staff-time', target)}" style="font-weight:600;font-size:14px">Set in Staff time →</a>` : ''}</td></tr>`;
    }
  }
  const filters = `<form method="GET" action="/" class="ma-year" style="gap:12px"><input type="hidden" name="section" value="planning"><input type="hidden" name="page" value="mission"><input type="hidden" name="target" value="${target}">
    <label class="field"><span>Search</span><input type="search" name="q" value="${e(q)}" placeholder="Account, name or staff" style="width:190px"></label>
    <label class="field"><span>Show</span><select name="show"><option value="all">All lines</option><option value="needs"${show === 'needs' ? ' selected' : ''}>Needs a split</option><option value="shared"${show === 'shared' ? ' selected' : ''}>Shared costs</option><option value="staff"${show === 'staff' ? ' selected' : ''}>Has staff time</option></select></label>
    <label class="field"><span>View as</span><select name="as"><option value="pct">Percent</option><option value="usd"${asDollars ? ' selected' : ''}>Dollars</option></select></label>
    ${showZero ? '<input type="hidden" name="zero" value="1">' : ''}<button type="submit" class="button-outline">Apply</button></form>`;
  const table = `<div style="display:flex;flex-direction:column;gap:14px;min-width:0">
    <div class="ma-section-head"><h2>Line items</h2>${filters}</div>
    <div class="ma-frame"><table class="ma-table"><thead><tr><th scope="col">Line item</th><th scope="col" class="num">Direct</th><th scope="col" class="num">Staff cost</th><th scope="col" class="num">Combined</th>${MISSION_GOALS.map(([, l]) => `<th scope="col" class="num">${l}</th>`).join('')}<th scope="col">Split</th><th scope="col">Method</th></tr></thead>
    <tbody>${body || `<tr><td colspan="${cols}" class="ma-muted">No lines match.</td></tr>`}</tbody>
    <tfoot><tr><td>All lines</td><td class="num">${money(model.programTotal)}</td><td class="num">${money(model.staffOnLines)}</td><td class="num">${money(model.programTotal + model.staffOnLines)}</td><td colspan="6" class="ma-muted" style="font-weight:400">+ ${money(model.staffAdmin)} shared administration${model.staffDirect ? ` + ${money(model.staffDirect)} straight to an End` : ''}${model.staffOpen ? ` + ${money(model.staffOpen)} open staff time` : ''} = ${money(model.total)}</td></tr></tfoot></table></div>
    <p class="ma-note" style="margin:0">Combined = the line’s own budget plus the staff time assigned to it. The line’s split decides which Ends both receive. In Dollars view the End columns show the combined amount.</p>
    ${editable ? `<form id="ma-cells" method="POST" action="/api/v1/planning/mission-save" class="ma-savebar" data-cells-form>${hiddenYear(builder, data, 'lines')}<span class="ma-muted" data-cells-status>Click any Welcome, Receive, Grow or Go cell to type a percentage. Choose a line’s name for presets, “spread like the budget” and the reason.</span><button type="submit">Save percentages</button></form>` : ''}
    ${zeroCount ? `<p class="ma-note">${showZero ? `Showing ${zeroCount} line${zeroCount === 1 ? '' : 's'} with $0 planned. <a href="${pageHref('mission', target)}">Hide them</a>` : `${zeroCount} old line${zeroCount === 1 ? '' : 's'} with $0 planned ${zeroCount === 1 ? 'is' : 'are'} hidden. <a href="${pageHref('mission', target, { zero: '1' })}">Show $0 lines</a>`}</p>` : ''}
    <p class="ma-note">These are planned resource allocations, not measures of ministry impact. All expense lines in the FY${target} plan are included. Staff salary and benefit lines are aligned on the Staff time page.</p></div>`;
  const row = programRows.find((r) => r.line.category === selected);
  const drawer = canEdit ? (row ? lineDrawer({ builder, data, model, row, prior, params, name: nameOf(row.line) }) : buildingDrawer(builder, data)) : '';
  return `${head}${statusLines(params)}${summary(model, target)}<section class="${canEdit ? 'ma-layout' : ''}">${table}${drawer}</section>${canEdit ? '<script src="/mission-alignment/live.js" defer></script>' : ''}`;
}

function lineDrawer({ builder, data, model, row, prior, params, name }) {
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
    <div><span class="ma-eyebrow">Editing</span><h3 id="ma-ed">${e(name)}</h3><span class="ma-muted">${money(row.cents)} direct${row.staffCost ? ` + ${money(row.staffCost)} staff = <strong style="color:#16213A">${money(row.cents + row.staffCost)} combined</strong>` : ''} · ${e(row.line.category)}</span></div>
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
    ${staffTimeOnLine(model, row)}
    ${leadsOnLine(data, row)}
    <label class="field" style="display:flex;flex-direction:column;gap:6px"><span style="font-weight:600">Why this split</span><textarea name="note" rows="3" maxlength="600">${e(note)}</textarea><span class="ma-note">Shows on the council report so the reasoning travels with the number.</span></label>
    <div class="ma-actions"><a href="${pageHref('mission', target)}">Cancel</a><button type="submit" name="method" value="clear" class="button-outline" formnovalidate>Clear</button><button type="submit">Apply to line</button></div>
    </form></aside>`;
}

// Each person's share of their total time on this line. It moves that part of their pay and
// benefits here (it is never added to the budget), and it then follows this line's split.
function staffTimeOnLine(model, row) {
  if (!model.staff.length) return '';
  const first = row.staffBy[0];
  const person = first && model.staff.find((p) => p.id === first.id);
  const split = row.status === 'spread' ? 'spread like the budget' : MISSION_GOALS.map(([, l], i) => (row.shares[i] ? `${pct0(row.shares[i])} ${l}` : '')).filter(Boolean).join(', ');
  const example = person ? `<div class="ma-flow"><span class="ma-eyebrow" style="color:#6E4A00">How the ${pct0(first.bp)} flows</span>
      <ol style="margin:0;padding-left:20px;font-size:14px;display:flex;flex-direction:column;gap:3px">
        <li>${e(person.label)}’s cost: <strong>${money(person.pool)}</strong> salary + benefits</li>
        <li>× <strong>${pct0(first.bp)}</strong> of time on this line = <strong>${money(first.cents)}</strong></li>
        <li>This line is <strong>${e(split || 'not yet aligned')}</strong></li>
        <li>${row.status === 'needs' ? 'Until the line is aligned, it stays “not yet aligned”.' : `${MISSION_GOALS.map(([, l], i) => { const c = Math.round((first.cents * row.shares[i]) / FULL); return c ? `<strong>${money(c)}</strong> to ${l}` : ''; }).filter(Boolean).join(', ')}, out of their unassigned time`}</li>
      </ol></div>` : '';
  return `<div id="ma-staff" style="display:flex;flex-direction:column;gap:8px;scroll-margin-top:16px;border-top:1px solid #D7E2E9;padding-top:14px"><input type="hidden" name="staff_time" value="1">
    <span style="font-size:14px;font-weight:600">Staff time on this line</span>
    <span class="ma-note">Share of each person’s total time. It moves that part of their pay and benefits here; it is not added to the budget.</span>
    <div class="ma-grid ma-muted" style="grid-template-columns:1fr 70px 80px;font-size:12.5px;font-weight:600"><span>Person</span><span>% time</span><span class="num">Cost</span></div>
    ${model.staff.map((p, i) => { const bp = p.alloc.lines[row.line.category] || 0; const cost = row.staffBy.find((x) => x.id === p.id)?.cents || 0; return `<div class="ma-grid${bp ? ' ma-hit' : ''}" style="grid-template-columns:1fr 70px 80px"><label for="ma-st-${i}" style="font-size:14px">${bp ? `<strong>${e(p.label)}</strong>` : e(p.label)}<br><span style="font-size:12px;${p.over ? 'color:#8A2A1C;font-weight:600' : 'color:#536B79'}">${money(p.pool)} · ${pct0(p.allocBp)} allocated</span></label><input id="ma-st-${i}" name="st_${i}" inputmode="decimal" value="${pctValue(bp)}" placeholder="0"><span class="num">${cost ? money(cost) : ''}</span></div>`; }).join('')}
    ${row.staffCost ? `<div style="display:flex;justify-content:space-between;font-weight:600;font-size:14px"><span>Staff cost on this line</span><span>${money(row.staffCost)}</span></div>` : ''}
    ${example}
  </div>`;
}

// Who leads this line (responsibility only; no pay or time moves).
function leadsOnLine(data, row) {
  if (!data.staff.length) return '';
  const current = (data.leads || {})[row.line.category] || {};
  const set = Object.keys(current).length;
  return `<details${set ? ' open' : ''}><summary style="font-size:14px;font-weight:600">Who leads this line${set ? '' : ' (optional)'}</summary><input type="hidden" name="leads" value="1">
    <p class="ma-note">Responsibility only, as each person’s share of the line. It moves no pay or time.</p>
    ${data.staff.map((p, i) => { const bp = current[p.id] || 0; return `<div class="ma-grid"><label for="ma-ld-${i}">${e(p.label)}</label><input id="ma-ld-${i}" name="lead_${i}" inputmode="decimal" value="${pctValue(bp)}" placeholder="0"><span class="num">${bp ? money(Math.round((row.cents * bp) / FULL)) : ''}</span></div>`; }).join('')}
  </details>`;
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

// ── Staff time by budget line ────────────────────────────────────────────────────────────────

function statusBadge(p) {
  if (p.over) return badge('bad', `${((p.allocBp - FULL) / 100).toFixed(1).replace(/\.0$/, '')}% over`);
  if (p.remainingBp > 0) return badge('warn', `${((p.remainingBp) / 100).toFixed(1).replace(/\.0$/, '')}% open`);
  if (!p.reviewed) return badge('warn', 'Draft · needs review');
  return badge('ok', 'Complete');
}
const pctText = (bp) => `${(bp / 100).toFixed(1).replace(/\.0$/, '')}%`;
function allocBar(p, width = 110) {
  const used = Math.min(FULL, p.allocBp);
  return `<div style="display:flex;align-items:center;gap:8px"><div class="ma-bar" style="width:${width}px;min-width:${width}px;height:10px"><div class="ma-seg" style="width:${(p.over ? FULL - (p.allocBp - FULL) : used) / 100}%;background:#386781"></div>${p.over ? `<div class="ma-seg ma-overhatch" style="width:${(p.allocBp - FULL) / 100}%"></div>` : (p.remainingBp > 0 ? `<div class="ma-seg ma-hatch" style="width:${p.remainingBp / 100}%"></div>` : '')}</div><span class="num"${p.over ? ' style="color:#8A2A1C;font-weight:700"' : ''}>${pctText(p.allocBp)}</span></div>`;
}

export function renderStaffTimePage({ builder, data, layout = null, params, canEdit = false, workers = null, now = new Date() }) {
  const target = builder.targetYear;
  const head = `${missionChips('staff-time', target, { admin: canEdit })}
    <div class="ma-head"><div><span class="ma-eyebrow">Budget · Mission alignment</span><h2>Staff time by budget line</h2><p class="ma-sub">FY${target} budget plan · each person’s time goes to budget lines; the lines carry it to the Ends</p></div>${yearPicker('staff-time', target, now)}</div>`;
  if (!canEdit) return `${head}${unavailable('Staff time', 'Staff time sits beside compensation, so only a Finance administrator can see it.')}`;
  if (!data) return `${head}${unavailable('Staff time', 'Staff time could not be read. Reload to try again; nothing has been changed.')}`;
  const model = missionModel(builder, data);
  const selectedId = params?.get('role') || '';
  const over = model.staff.filter((p) => p.over);
  const alert = over.length ? `<div class="ma-alert" role="alert"><strong>${over.map((p) => `${e(p.label)} is allocated ${pctText(p.allocBp)} of their time, ${pctText(p.allocBp - FULL)} over`).join('; ')}</strong><span>Only 100% of a person’s cost is counted until it is fixed. Lower a line for ${over.map((p) => `<a href="${pageHref('staff-time', target, { role: p.id })}">${e(p.label)}</a>`).join(', ')}.</span></div>` : '';
  const roleRow = (p) => {
    const sel = p.id === selectedId;
    const hours = p.hours || (p.weekResult.total ? p.weekResult.total : null);
    const lines = p.lineAlloc.length;
    const pcts = p.pool ? p.parts.map((c) => (c ? pct0(Math.round((c / p.pool) * FULL)) : '—')) : ['—', '—', '—', '—'];
    return `<tr class="${sel ? 'is-sel' : ''}${p.over ? ' is-over' : ''}"${sel ? ' aria-selected="true"' : ''}><td><a class="ma-rowlink" href="${pageHref('staff-time', target, { role: p.id, ...(p.mode === 'week' ? { mode: 'week' } : {}) })}">${sel ? `<strong>${e(p.label)}</strong>` : e(p.label)}</a><div class="ma-note">${hours ? `${hoursText(hours)} h/wk` : 'hours not set'}${p.planKey ? ` · ${e(p.name)}${workers && !workers.some((w) => w.key === p.planKey) ? ' · no longer in the compensation planner' : ''}` : ''}${p.ledLines.length ? ` · leads ${p.ledLines.length} line${p.ledLines.length === 1 ? '' : 's'}` : ''}</div>${p.pool ? '' : '<div class="ma-note">No compensation lines linked yet</div>'}</td>
      <td class="num">${money(p.pool)}${p.benefitShare ? `<div class="ma-note">${money(p.ownPay)} pay + ${money(p.benefitShare)} benefits</div>` : ''}</td>
      <td>${allocBar(p)}</td><td class="num"${p.over ? ' style="color:#8A2A1C;font-weight:700"' : ''}>${p.over ? `−${pctText(p.allocBp - FULL)}` : pctText(p.remainingBp)}</td>
      <td class="num"${p.over ? ' style="color:#8A2A1C"' : ''}>${p.over ? `${money(Math.round((p.pool * (p.allocBp - FULL)) / FULL))} over` : (p.openCents ? money(p.openCents) : '—')}</td>
      ${pcts.map((v) => `<td class="num">${v}</td>`).join('')}
      <td class="ma-note">${lines ? `${lines} line${lines === 1 ? '' : 's'}` : 'no lines'}${p.adminBp ? ' + admin' : ''}${sum(p.alloc.ends) ? ' + by End' : ''}</td><td>${statusBadge(p)}</td></tr>`;
  };
  const table = `<section class="ma-section" aria-labelledby="st-h">
    <div class="ma-section-head"><h2 id="st-h">Where staff compensation goes</h2><span class="ma-muted">${money(model.staffPool)} salaries &amp; benefits, budgeted once · distributed through budget lines</span></div>
    <div class="ma-frame"><table class="ma-table"><thead><tr><th scope="col">Role</th><th scope="col" class="num">Comp &amp; benefits</th><th scope="col">Time allocated</th><th scope="col" class="num">Remaining</th><th scope="col" class="num">Not yet allocated</th>${MISSION_GOALS.map(([, l]) => `<th scope="col" class="num">${l}</th>`).join('')}<th scope="col">Lines</th><th scope="col">Status</th></tr></thead>
    <tbody>${model.staff.map(roleRow).join('') || '<tr><td colspan="11" class="ma-muted">No staff roles yet. Bring them in from the compensation planner or add one below.</td></tr>'}</tbody>
    ${model.staff.length ? `<tfoot><tr><td>All staff</td><td class="num">${money(model.staffPool)}</td><td colspan="2" class="ma-note" style="font-weight:600">${money(model.staffOnLines)} lines · ${money(model.staffAdmin)} admin</td><td class="num">${money(model.staffOpen)}</td>${model.staffTotals.map((c) => `<td class="num">${money(c)}</td>`).join('')}<td colspan="2" class="ma-note" style="font-weight:600">Over-allocations count only to 100%</td></tr></tfoot>` : ''}</table></div>
    <p class="ma-note" style="margin:0">Welcome · Receive · Grow · Go are each person’s full cost by End, after their lines and their share of administration. Not-yet-allocated dollars show as “Not yet aligned” on Line items by End until they are assigned.</p>
    <form method="POST" action="/api/v1/planning/mission-save" class="ma-year">${hiddenYear(builder, data, 'staff-add')}<label class="field"><span>Add a staff role</span><input name="label" maxlength="60" required placeholder="e.g. Music Director"></label><button type="submit" class="button-outline">Add role</button></form>
  </section>`;
  const person = model.staff.find((p) => p.id === selectedId);
  return `${head}${statusLines(params)}${alert}${params?.get('imported') ? `<p class="status status-ok" role="status">${Number(params.get('imported')) ? `${Number(params.get('imported'))} staff brought in from the compensation planner.` : 'Staff refreshed from the compensation planner.'} Set each person’s time below.</p>` : ''}${table}${person ? staffEditor({ builder, data, model, person, params, layout }) : ''}${plannerPanel({ builder, data, model, workers, layout })}${personnelPanel(personnelShare(builder, data, layout), { year: target, baseYear: builder.baseYear })}<script src="/mission-alignment/live.js" defer></script>`;
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
  const mode = params?.get('mode') === 'week' ? 'week' : (params?.get('mode') === 'percent' ? 'percent' : person.mode === 'week' ? 'week' : 'percent');
  const templateKey = params?.get('template');
  const labelFor = (k) => (k === 'admin' ? 'Shared administration' : k.startsWith('end:') ? `Straight to ${MISSION_GOALS[Number(k.slice(4))][1]}` : (() => { const l = builder.lines.find((x) => x.category === k.slice(5)); return l ? accountDisplayName(layout || normalizeBoardLayout(null), l.category, l.name) : k.slice(5); })());
  // A person set by percentages opens the week view filled from those percentages, so both views match.
  const fromAlloc = !person.week.length && person.allocBp ? rescaleWeek([], person.alloc, person.hours || 4000, labelFor) : [];
  const week = (mode === 'week' && templateWeek(templateKey)) || (person.week.length ? person.week : fromAlloc);
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
  // Ministry lines time can go to, with each line's split.
  const owned = new Set([...data.staff.flatMap((s) => s.sources), ...data.benefitLines]);
  const rowsByCat = new Map(model.rows.filter((r) => !r.isSource).map((r) => [r.line.category, r]));
  const splitText = (r) => (!r || r.status === 'needs' ? 'not yet aligned' : r.status === 'spread' ? 'like the budget' : MISSION_GOALS.map(([, l], j) => (r.shares[j] ? (r.shares[j] === FULL ? l : `${l.charAt(0)}${l === 'Go' ? 'o' : ''} ${Math.round(r.shares[j] / 100)}`) : '')).filter(Boolean).join(' · '));
  const splitCell = (r) => `<div style="display:flex;align-items:center;gap:8px">${stackBar(r && r.status !== 'needs' ? r.shares : [0, 0, 0, 0], { height: 8 })}<span class="ma-note">${e(splitText(r))}</span></div>`;
  const hoursPerWeek = person.hours ? person.hours / 100 : (person.weekResult.total ? person.weekResult.total / 100 : 0);
  const alloc = person.alloc;
  const hrs = (bp) => (hoursPerWeek ? ((bp * hoursPerWeek) / FULL).toFixed(1) : '');
  const cost = (bp) => (bp ? money(Math.round((person.pool * bp) / FULL)) : '');
  const meterParts = [
    ...person.lineAlloc.map((x) => ({ bp: x.bp, color: END_COLORS[(rowsByCat.get(x.category)?.shares || [0, 0, 0, 0]).indexOf(Math.max(...(rowsByCat.get(x.category)?.shares || [1, 0, 0, 0])))] || '#7A8B99' })),
    { bp: alloc.admin, color: '#9DB6C6' },
    ...alloc.ends.map((bp, j) => ({ bp, color: END_COLORS[j] })),
  ].filter((x) => x.bp);
  const meter = `<div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:14px"><strong data-alloc-total>${pctText(person.allocBp)} allocated</strong><span class="ma-badge ${person.over ? 'bad' : person.remainingBp ? 'warn' : 'ok'}" data-alloc-badge>${person.over ? `${pctText(person.allocBp - FULL)} over · ${money(Math.round((person.pool * (person.allocBp - FULL)) / FULL))} not counted` : person.remainingBp ? `${pctText(person.remainingBp)} remaining${hoursPerWeek ? ` · ${hrs(person.remainingBp)} h/wk` : ''} · ${money(person.openCents)} not yet allocated` : 'All of their time is allocated'}</span></div>
      <div class="ma-bar" style="height:20px;border-radius:6px" role="img" aria-label="${e(`${person.label}: ${pctText(person.allocBp)} of time allocated`)}">${meterParts.map((x) => `<div class="ma-seg" style="width:${Math.min(x.bp, FULL) / 100}%;background:${x.color};box-shadow:inset -1px 0 0 #fff"></div>`).join('')}${person.remainingBp > 0 ? `<div class="ma-seg ma-hatch" style="width:${person.remainingBp / 100}%"></div>` : ''}</div>
      <span class="ma-note">Each block is a budget line, in the color of its main End · grey: shared administration · hatched: not yet allocated.</span></div>`;
  const rollup = `<div class="ma-result"><h4>How ${e(person.label)}’s time rolls up to the Ends</h4>
      ${stackBar(person.effShares.map((v) => Math.round((v * (FULL - Math.max(0, person.remainingBp))) / FULL)), { height: 20, radius: 6, label: sharesLabel(person.effShares) })}
      <div style="overflow-x:auto"><table class="ma-table"><thead><tr><th scope="col">End</th><th scope="col" class="num">Lines</th><th scope="col" class="num">Admin</th><th scope="col" class="num">Total</th><th scope="col" class="num">%</th></tr></thead><tbody>
      ${MISSION_GOALS.map(([, l], j) => `<tr><td>${dot(j)} ${l}</td><td class="num">${money(person.fromLines[j])}</td><td class="num">${money(person.adminParts[j])}</td><td class="num"><strong>${money(person.parts[j])}</strong></td><td class="num">${person.pool ? pct1(Math.round((person.parts[j] / person.pool) * FULL)) : '—'}</td></tr>`).join('')}
      <tr><td><span class="ma-dot ma-hatch" style="border:1px solid #C7D3DB"></span> Not yet allocated</td><td class="num">—</td><td class="num">—</td><td class="num">${money(person.unassigned)}</td><td class="num">${person.pool ? pct1(Math.round((person.unassigned / person.pool) * FULL)) : '—'}</td></tr></tbody>
      <tfoot><tr><td>Total</td><td class="num">${money(sum(person.fromLines))}</td><td class="num">${money(person.adminCents)}</td><td class="num">${money(person.pool)}</td><td class="num">100%</td></tr></tfoot></table></div>
      ${person.lineAlloc[0] ? (() => { const x = [...person.lineAlloc].sort((a, b) => a.bp - b.bp)[0]; const r = rowsByCat.get(x.category); return `<p class="ma-note" style="margin:0">Trace · <strong>${e(accountDisplayName(lay, x.category, x.line.name))} ${pctText(x.bp)}</strong> → ${money(x.cents)} → line is ${e(splitText(r))} → ${MISSION_GOALS.map(([, l], j) => { const c = r ? Math.round((x.cents * r.shares[j]) / FULL) : 0; return c ? `<strong>${money(c)} in ${l}</strong>` : ''; }).filter(Boolean).join(', ') || 'not yet aligned'}.</p>`; })() : ''}
      <p class="ma-note" style="margin:0">Shown as saved; apply to update.</p></div>`;
  const rule = person.adminRule;
  const ruleSaved = person.adminRule === data.adminRule || !data.staff.find((p) => p.id === person.id)?.adminRule;
  const ruleShares = rule.method === 'fixed' ? rule.shares : [2500, 2500, 2500, 2500];
  const ruleForm = `<form method="POST" action="/api/v1/planning/mission-save" class="ma-panel" style="padding:16px;gap:10px">${hiddenYear(builder, data, 'admin-rule')}<input type="hidden" name="role" value="${e(person.id)}">
      <strong style="font-size:16px">Shared administration rule</strong>
      <span class="ma-note">Administration (council, planning, supervision, email) supports every End, so it isn’t tied to one line. ${person.adminBp ? `${e(person.label)}’s ${pctText(person.adminBp)} (${money(person.adminCents)}) is spread by this rule:` : 'Time marked as shared administration is spread by this rule:'}</span>
      ${[['lines', 'In proportion to this person’s line time', 'Admin follows the same mix as their other time, so no End is credited or charged for overhead.'], ['budget', 'Like the whole budget', 'The mix of every line aligned directly.'], ['building', 'By building use', data.buildingUse ? `${data.buildingUse.map((v) => Math.round(v / 100)).join(' / ')}, the preset used for shared costs.` : 'Set the building-use preset on Line items by End first.'], ['fixed', 'A fixed split', 'You set the four shares below.']].map(([k, l, help]) => `<label class="ma-radio"><input type="radio" name="method" value="${k}"${rule.method === k ? ' checked' : ''}${k === 'building' && !data.buildingUse ? ' disabled' : ''}><span><strong>${l}</strong>${k === 'lines' ? ' <span class="ma-badge info">Default</span>' : ''}<br><small>${e(help)}</small></span></label>`).join('')}
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding-left:26px">${MISSION_GOALS.map(([k, l], j) => `<label class="ma-note" style="display:flex;flex-direction:column;gap:3px">${l}<input name="share_${k}" inputmode="decimal" value="${ruleShares[j] / 100}" style="text-align:right"></label>`).join('')}</div>
      <label class="field" style="flex-direction:row;align-items:center;gap:10px"><span>Use this rule for</span><select name="scope"><option value="all"${ruleSaved ? ' selected' : ''}>All staff</option><option value="${e(person.id)}"${ruleSaved ? '' : ' selected'}>Only ${e(person.label)}</option></select></label>
      <div class="ma-actions" style="justify-content:flex-start"><button type="submit" class="button-outline">Save rule</button></div></form>`;
  let editor;
  if (mode === 'percent') {
    const set = [...person.lineAlloc].sort((a, b) => b.bp - a.bp).map((x) => x.category);
    const lineIndex = new Map(lines.map((l, i) => [l.category, i]));
    const choices = model.rows.filter((r) => !r.isSource && !owned.has(r.line.category) && (r.cents || set.includes(r.line.category)));
    const row = (r) => { const i = lineIndex.get(r.line.category); const bp = alloc.lines[r.line.category] || 0; return `<tr${bp ? ' class="ma-hit"' : ''}><td>${bp ? `<strong>${e(accountDisplayName(lay, r.line.category, r.line.name))}</strong>` : e(accountDisplayName(lay, r.line.category, r.line.name))}</td><td>${splitCell(r)}</td><td class="num ma-cellwrap"><input class="ma-cell" name="pct_${i}" data-alloc inputmode="decimal" value="${pctValue(bp)}" placeholder="—" aria-label="${e(`${person.label}: percent of time on ${r.line.name}`)}"></td><td class="num ma-note" data-alloc-h>${bp ? hrs(bp) : ''}</td><td class="num" data-alloc-c>${cost(bp)}</td></tr>`; };
    const inUse = choices.filter((r) => set.includes(r.line.category)).sort((a, b) => (alloc.lines[b.line.category] || 0) - (alloc.lines[a.line.category] || 0));
    const rest = choices.filter((r) => !set.includes(r.line.category));
    editor = `<div class="ma-week"><form method="POST" action="/api/v1/planning/mission-save" data-ma-alloc data-cents="${person.pool}" data-hours="${hoursPerWeek}" style="display:flex;flex-direction:column;gap:14px;min-width:0">${hiddenYear(builder, data, 'staff')}<input type="hidden" name="id" value="${e(person.id)}"><input type="hidden" name="mode" value="percent"><input type="hidden" name="alloc" value="1">
      ${common}
      ${meter}
      <div style="overflow-x:auto"><table class="ma-table"><thead><tr><th scope="col">Budget line</th><th scope="col">Line’s split</th><th scope="col" class="num">% of time</th><th scope="col" class="num">h/wk</th><th scope="col" class="num">Cost</th></tr></thead><tbody>
        ${inUse.map(row).join('') || '<tr><td colspan="5" class="ma-muted">No lines yet. Enter a percentage beside any line below.</td></tr>'}
        <tr><td><strong>Shared administration</strong><div class="ma-note">Council, planning, supervision, email</div></td><td class="ma-note">by the rule →</td><td class="num ma-cellwrap"><input class="ma-cell" name="pct_admin" data-alloc inputmode="decimal" value="${pctValue(alloc.admin)}" placeholder="—" aria-label="Percent of time on shared administration"></td><td class="num ma-note" data-alloc-h>${alloc.admin ? hrs(alloc.admin) : ''}</td><td class="num" data-alloc-c>${cost(alloc.admin)}</td></tr>
        ${MISSION_GOALS.map(([k, l], j) => (alloc.ends[j] ? `<tr><td>Straight to ${l}<div class="ma-note">Not tied to a budget line</div></td><td>${dot(j)}</td><td class="num ma-cellwrap"><input class="ma-cell" name="pct_end_${k}" data-alloc inputmode="decimal" value="${pctValue(alloc.ends[j])}" aria-label="Percent of time straight to ${l}"></td><td class="num ma-note" data-alloc-h>${hrs(alloc.ends[j])}</td><td class="num" data-alloc-c>${cost(alloc.ends[j])}</td></tr>` : '')).join('')}
      </tbody><tfoot><tr><td>Allocated</td><td></td><td class="num" data-alloc-sum>${pctText(person.allocBp)}</td><td class="num" data-alloc-hsum>${hoursPerWeek ? hrs(person.allocBp) : ''}</td><td class="num" data-alloc-csum>${money(Math.round((person.pool * Math.min(FULL, person.allocBp)) / FULL))}</td></tr>
      <tr><td>Remaining</td><td></td><td class="num" data-alloc-rest>${pctText(Math.max(0, person.remainingBp))}</td><td></td><td></td></tr></tfoot></table></div>
      ${rest.length ? `<details${inUse.length ? '' : ' open'}><summary>More budget lines (${rest.length})</summary><div style="overflow-x:auto"><table class="ma-table"><tbody>${rest.map(row).join('')}</tbody></table></div></details>` : ''}
      ${!sum(alloc.ends) ? `<details><summary>Time not tied to any line, straight to an End</summary><div class="ma-cards" style="grid-template-columns:repeat(4,minmax(0,1fr))">${MISSION_GOALS.map(([k, l], j) => `<label class="field"><span>${l} %</span><input class="ma-cell" style="width:100%" name="pct_end_${k}" data-alloc inputmode="decimal" value="" placeholder="—"></label>`).join('')}</div></details>` : ''}
      <p class="ma-note" style="margin:0">Percent and hours are one allocation.${hoursPerWeek ? ` 1% of a ${hoursPerWeek}-hour week is ${(hoursPerWeek / 100).toFixed(2).replace(/0$/, '')} hours.` : ''} Saving here updates <a href="${pageHref('staff-time', target, { role: person.id, mode: 'week' })}">Build from a typical week</a> to match, so time is never counted twice.</p>
      <div class="ma-actions"><a href="${pageHref('staff-time', target)}">Cancel</a><button type="submit">Apply to ${e(person.label)}</button></div>
    </form><div style="display:flex;flex-direction:column;gap:16px">${rollup}${ruleForm}</div></div>`;
  } else {
    const rows = [...week, ...Array.from({ length: Math.max(3, 8 - week.length) }, () => ({ activity: '', hours: null, end: null }))].slice(0, 30);
    const lineRows = model.rows.filter((r) => !r.isSource && !owned.has(r.line.category) && (r.cents || week.some((w) => w.end?.line === r.line.category)));
    const lineOptions = (end) => lineRows.map((r) => `<option value="line:${e(r.line.category)}" data-shares="${r.status === 'needs' ? '' : r.shares.join(',')}"${end?.line === r.line.category ? ' selected' : ''}>${e(accountDisplayName(lay, r.line.category, r.line.name))} · ${e(splitText(r))}</option>`).join('');
    const endSelect = (i, end) => `<select name="act_end_${i}" data-week-end aria-label="Budget line for activity ${i + 1}" style="max-width:190px"><option value="">Choose a budget line…</option>${lineRows.length ? `<optgroup label="Budget lines (time follows the line’s split)">${lineOptions(end)}</optgroup>` : ''}<optgroup label="Shared"><option value="spread"${end === 'spread' ? ' selected' : ''}>Shared administration · by rule</option></optgroup><optgroup label="Not tied to a line">${MISSION_GOALS.map(([k, l], j) => `<option value="${k}"${end === j ? ' selected' : ''}>Straight to ${l}</option>`).join('')}</optgroup></select>`;
    const wt = weekTargets(week, person.hours);
    const prefilled = week === fromAlloc && fromAlloc.length;
    const base = wt.base / 100;
    const total = wt.total / 100;
    const targetHours = person.hours ? person.hours / 100 : 0;
    const diff = targetHours ? total - targetHours : 0;
    const okWeek = !targetHours || Math.abs(diff) < 0.05;
    const avg = (w) => (w.hours == null ? null : (w.weeks ? (w.hours * w.weeks) / 52 : w.hours) / 100);
    editor = `<div class="ma-week"><form method="POST" action="/api/v1/planning/mission-save" data-ma-week data-cents="${person.pool}" data-hours="${targetHours}" style="display:flex;flex-direction:column;gap:14px;min-width:0">${hiddenYear(builder, data, 'staff')}<input type="hidden" name="id" value="${e(person.id)}"><input type="hidden" name="mode" value="week">
      ${common}
      ${templateKey && WEEK_TEMPLATES[templateKey] ? `<p class="ma-badge info" style="align-self:flex-start">Filled from the ${e(WEEK_TEMPLATES[templateKey].label.toLowerCase())} template; choose a budget line for each activity, then apply.</p>` : ''}
      ${prefilled ? '<p class="ma-badge info" style="align-self:flex-start">Filled in from the percentages; rename the activities or split them up, then apply.</p>' : ''}
      <p class="ma-note ma-sync" style="margin:0">Same allocation as <a href="${pageHref('staff-time', target, { role: person.id, mode: 'percent' })}">Percent by budget line</a>: hours ÷ ${base || 'the week'} = the percentages there. Saving either one updates the other, and nothing is counted twice.</p>
      <div style="overflow-x:auto"><table class="ma-table"><thead><tr><th scope="col">Activity</th><th scope="col" class="num">Hours</th><th scope="col" class="num">Weeks / yr</th><th scope="col">Budget line</th><th scope="col" class="num">Avg h/wk</th><th scope="col" class="num">= % time</th></tr></thead><tbody>
        ${rows.map((w, i) => { const a = avg(w); return `<tr data-week-row><td><input name="act_${i}" value="${e(w.activity)}" maxlength="80" aria-label="Activity ${i + 1}" style="width:100%;box-sizing:border-box"></td><td class="num"><input name="act_hours_${i}" data-week-hours inputmode="decimal" value="${w.hours == null ? '' : hoursText(w.hours)}" aria-label="Hours for activity ${i + 1}" style="width:64px;text-align:right"></td><td class="num"><input name="act_weeks_${i}" data-week-weeks inputmode="numeric" value="${w.weeks || ''}" placeholder="every" aria-label="Weeks a year for activity ${i + 1} (blank for every week)" style="width:60px;text-align:right"></td><td>${endSelect(i, w.end)}</td><td class="num ma-note" data-week-avg>${a == null ? '—' : a.toFixed(1)}</td><td class="num" data-week-rowpct>${a == null || !base ? '—' : pctText(Math.round((a / base) * FULL))}</td></tr>`; }).join('')}
        </tbody><tfoot><tr><td>Average week</td><td colspan="3"><span class="ma-badge ${okWeek ? 'ok' : diff > 0 ? 'bad' : 'warn'}" data-week-badge>${targetHours ? (okWeek ? `Matches ${targetHours} hours` : diff > 0 ? `${diff.toFixed(1)} h over ${targetHours}: only 100% is counted` : `${(-diff).toFixed(1)} h short of ${targetHours}: stays not yet allocated`) : `${total.toFixed(1)} hours`}</span></td><td class="num" data-week-total>${total.toFixed(1)}</td><td class="num">${base ? pctText(Math.round((wt.total / wt.base) * FULL)) : ''}</td></tr></tfoot></table></div>
      <div class="ma-presets"><span class="ma-muted" style="align-self:center">Start from a template:</span>${Object.entries(WEEK_TEMPLATES).map(([k, t]) => `<a class="button-outline" href="${pageHref('staff-time', target, { role: person.id, mode: 'week', template: k })}">${e(t.label)}</a>`).join('')}</div>
      <p class="ma-note" style="margin:0">Empty rows are ignored; save to add more. Seasonal work counts at its yearly average (VBS: 26 hours × 2 weeks ÷ 52 = 1 hour a week). Several activities can share one line; their hours add up.</p>
      <div class="ma-actions"><a href="${pageHref('staff-time', target)}">Cancel</a><button type="submit">Apply to ${e(person.label)}</button></div>
    </form><div style="display:flex;flex-direction:column;gap:16px">${rollup}${ruleForm}</div></div>`;
  }
  return `<section class="ma-panel" aria-labelledby="st-ed">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
      <div><span class="ma-eyebrow">Editing</span><h3 id="st-ed" style="margin:0;font-size:22px">${e(person.label)}</h3><span class="ma-muted">${money(person.pool)} comp &amp; benefits${hoursPerWeek ? ` · ${hoursPerWeek} hours a week · 1% of time = ${(hoursPerWeek / 100).toFixed(2).replace(/0$/, '')} h/wk = ${money(Math.round(person.pool / 100))}` : ''}</span></div>
      <nav class="ma-tabs" aria-label="Two views of the same allocation">${tab('percent', 'Percent by budget line')}${tab('week', 'Build from a typical week')}</nav>
    </div>
    ${editor}
    <form method="POST" action="/api/v1/planning/mission-save" class="ma-actions" style="justify-content:flex-start">${hiddenYear(builder, data, 'staff-remove')}<input type="hidden" name="id" value="${e(person.id)}"><button type="submit" class="button-outline">Remove this role</button><span class="ma-note" style="align-self:center">Removes only the time allocation; budget lines are not changed.</span></form>
  </section>`;
}
export { GOAL_KEYS, END_COLORS };
