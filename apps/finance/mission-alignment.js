// Finance-owned, year-scoped planning metadata. Budget and compensation amounts remain in
// their existing contracts; this view redistributes existing expense cents, never adds payroll.
import { FormValidationError } from './form-fields.js';
import { escapeHtml as e } from './render-helpers.js';

export const MISSION_GOALS = [['welcome', 'Welcome', 'acceptance'], ['receive', 'Receive', 'worship'], ['grow', 'Grow', 'Christian education'], ['go', 'Go', 'Outreach']];
export const missionKey = (year) => `finance_mission_alignment_${year}`;
export const canManageMission = (r) => Boolean(r?.ok && r.role === 'admin');
const empty = () => ({ revision: 0, lines: {}, staff: [] });
const expenses = (builder) => builder.lines.filter(l => l.classification !== 'Income');
const cents = (line) => line.plan?.plannedAmountCents || 0;
const fail = (message) => { throw new FormValidationError(message); };
const sum = (v) => v.reduce((a, b) => a + b, 0);
const amount = (c) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(c / 100);

export async function readMission(db, year) {
  const row = await db.prepare('SELECT value FROM finance_settings WHERE key=?').bind(missionKey(year)).first();
  if (!row) return { ...empty(), stored: null };
  const value = JSON.parse(row.value);
  if (!Number.isInteger(value.revision) || !value.lines || !Array.isArray(value.staff)) throw new Error('Invalid mission settings');
  return { ...value, stored: row.value };
}

function percent(raw) {
  const v = String(raw ?? '').trim();
  if (v === '') return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(v) || Number(v) > 100) fail('Enter percentages from 0 to 100, with at most two decimal places.');
  return Math.round(Number(v) * 100); // basis points, avoiding floating point total errors
}
function yearValue(raw) {
  if (!/^20\d{2}$/.test(String(raw))) fail('Choose a fiscal year between 2000 and 2099.');
  return Number(raw);
}

export function parseMission(form, data, builder) {
  const lines = expenses(builder);
  if (lines.length > 2000) fail('Too many budget lines.');
  if (Object.keys(form).filter(k => /^category_\d+$/.test(k)).length !== lines.length) fail('The budget lines changed. Reload and try again.');
  const output = { revision: data.revision + 1, lines: Object.create(null), staff: [] };
  for (let i = 0; i < lines.length; i++) {
    // Authoritative category order is checked against the submitted one, including new/deleted lines.
    if (form[`category_${i}`] !== lines[i].category) fail('The budget lines changed. Reload and try again.');
    const split = MISSION_GOALS.map(([g]) => percent(form[`goal_${i}_${g}`]));
    if (sum(split) > 10000) fail(`Mission percentages for ${lines[i].name} exceed 100%.`);
    if (sum(split)) output.lines[lines[i].category] = split;
  }
  const categories = new Set(lines.map(l => l.category));
  const sourceOwner = new Set();
  for (const [s, person] of data.staff.entries()) {
    if (form[`remove_${s}`] === 'yes') continue;
    const label = String(form[`label_${s}`] || '').trim();
    if (!label || label.length > 60) fail('Give each staff role a label of 1–60 characters.');
    const sources = lines.filter((_, i) => form[`source_${s}_${i}`] === 'yes').map(l => l.category);
    for (const source of sources) {
      if (sourceOwner.has(source)) fail('A compensation line can belong to only one staff role. Split combined payroll into separate budget lines first.');
      if (cents(lines.find(l => l.category === source)) < 0) fail('Compensation source lines must have nonnegative planned amounts.');
      sourceOwner.add(source);
    }
    const allocations = Object.create(null);
    for (let i = 0; i < lines.length; i++) {
      const pct = percent(form[`staff_${s}_${i}`]);
      if (pct) allocations[lines[i].category] = pct;
    }
    if (sum(Object.values(allocations)) > 10000) fail(`${label}'s time exceeds 100%.`);
    output.staff.push({ id: person.id, label, sources, allocations });
  }
  for (const person of output.staff) for (const category of Object.keys(person.allocations)) {
    if (!categories.has(category) || sourceOwner.has(category)) fail('Allocate staff time to ministry expense lines, not linked compensation lines.');
  }
  const label = String(form.new_staff_label || '').trim();
  if (label.length > 60) fail('Staff labels may contain at most 60 characters.');
  if (label) {
    if (output.staff.length >= 20) fail('A year can have up to 20 staff roles.');
    output.staff.push({ id: crypto.randomUUID(), label, sources: [], allocations: {} });
  }
  return output;
}

export async function saveMission(db, form, actor, builder) {
  const year = yearValue(form.target);
  const base = yearValue(form.base);
  if (builder.targetYear !== year) fail('The requested budget year could not be loaded.');
  const data = await readMission(db, year);
  if (String(data.revision) !== String(form.revision)) fail('Someone else saved this allocation. Reload before editing again.');
  const output = { ...parseMission(form, data, builder), updatedBy: String(actor || '') };
  const value = JSON.stringify(output);
  const result = data.stored === null
    ? await db.prepare('INSERT INTO finance_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING').bind(missionKey(year), value).run()
    : await db.prepare("UPDATE finance_settings SET value=?, updated_at=datetime('now') WHERE key=? AND value=?").bind(value, missionKey(year), data.stored).run();
  if (result.meta?.changes !== 1) fail('Someone else saved this allocation. Reload before editing again.');
  return { params: { target: String(year), base: String(base), mission: '1' } };
}

// Largest-remainder apportionment conserves cents, including negative expense credits.
export function apportion(value, weights) {
  const sign = value < 0 ? -1 : 1;
  const n = Math.abs(value);
  const raw = weights.map(w => n * w / 10000);
  const parts = raw.map(Math.floor);
  let left = n - sum(parts);
  const order = raw.map((v, i) => ({ i, remainder: v - parts[i] })).sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (let i = 0; i < left; i++) parts[order[i].i]++;
  return parts.map(v => v * sign);
}

export function missionModel(builder, data) {
  const lines = expenses(builder);
  const byCategory = new Map(lines.map(l => [l.category, l]));
  const sources = new Set(data.staff.flatMap(s => s.sources).filter(c => byCategory.has(c)));
  const attributed = new Map();
  let unallocated = 0;
  const staff = data.staff.map(s => {
    const pool = sum(s.sources.map(c => cents(byCategory.get(c) || {})));
    const entries = Object.entries(s.allocations).filter(([c]) => byCategory.has(c) && !sources.has(c));
    const total = sum(entries.map(([, p]) => p));
    const parts = apportion(pool, [...entries.map(([, p]) => p), 10000 - total]);
    entries.forEach(([c], i) => attributed.set(c, (attributed.get(c) || 0) + parts[i]));
    unallocated += parts.at(-1);
    return { ...s, pool, total, remaining: 10000 - total };
  });
  const totals = [0, 0, 0, 0];
  const rows = lines.map(l => {
    const isSource = sources.has(l.category);
    const direct = isSource ? 0 : cents(l);
    const staffCost = attributed.get(l.category) || 0;
    const combined = direct + staffCost;
    const split = data.lines[l.category] || [0, 0, 0, 0];
    const parts = apportion(combined, [...split, 10000 - sum(split)]);
    totals.forEach((_, i) => { totals[i] += parts[i]; });
    unallocated += parts[4];
    return { line: l, isSource, direct, staffCost, combined, split, remaining: 10000 - sum(split) };
  });
  return { rows, staff, totals, unallocated, total: sum(lines.map(cents)) };
}

export function renderMission({ builder, data, params }) {
  if (!data) return '<p class="status status-error">Mission allocations could not be read. Reload to try again; existing allocations have not been changed.</p>';
  const model = missionModel(builder, data);
  const percentInput = (name, v, label, disabled = false) => `<input style="width:75px" type="number" min="0" max="100" step="0.01" name="${name}" value="${v / 100}" aria-label="${e(label)}"${disabled ? ' disabled' : ''}>`;
  const status = params?.get('mission') === '1' && params?.get('status') === 'ok' ? '<p role="status">Mission allocations saved.</p>' : '';
  const error = params?.get('reason') ? `<p class="status status-error" role="alert">${e(params.get('message') || 'The allocation could not be saved. Reload and try again.')}</p>` : '';
  return `<section id="mission" class="panel panel-spaced"><h2>Mission alignment · FY${builder.targetYear}</h2>
  <p>Assign each expense to Welcome, Receive, Grow and Go. Divide shared lines by percentage. Staff time follows the mission split of the ministry line it supports.</p>
  ${status}${error}
  <p><small>Saved mission totals · updated when you save allocations or reload budget amounts</small></p>
  <div style="display:flex;gap:24px;flex-wrap:wrap;margin:24px 0">${MISSION_GOALS.map(([, label, subtitle], i) => `<div><h3>${label}</h3><small>${subtitle}</small><p><b>${amount(model.totals[i])}</b></p></div>`).join('')}<div><h3>Unallocated</h3><p><b>${amount(model.unallocated)}</b></p></div><div><h3>Total expenses</h3><p><b>${amount(model.total)}</b></p></div></div>
  <p>These are planned resource allocations, not measures of ministry impact. All expense lines are included, regardless of the budget worksheet's row filters.</p>
  <form method="POST" action="/api/v1/planning/mission-save">
  <input type="hidden" name="target" value="${builder.targetYear}"><input type="hidden" name="base" value="${builder.baseYear}"><input type="hidden" name="revision" value="${data.revision}">
  <div class="table-scroll"><table class="pm-table"><caption>Line-item mission splits and percentage of each staff role’s total time</caption><thead><tr><th>Expense line</th><th>Direct budget</th>${MISSION_GOALS.map(([, l]) => `<th>${l} %</th>`).join('')}${data.staff.map(s => `<th>${e(s.label)} time %</th>`).join('')}<th>Staff cost</th><th>Combined</th><th>Mission split remaining</th></tr></thead><tbody>
  ${model.rows.map((r, i) => `<tr><th scope="row">${e(r.line.name || r.line.category)}<small style="display:block">${e(r.line.category)}</small><input type="hidden" name="category_${i}" value="${e(r.line.category)}">${r.isSource ? '<small>Compensation redistributed to ministry lines</small>' : ''}</th><td>${r.isSource ? `${amount(cents(r.line))} linked` : amount(r.direct)}</td>${MISSION_GOALS.map(([g, l], j) => `<td>${percentInput(`goal_${i}_${g}`, r.split[j], `${r.line.name}: ${l}`, r.isSource)}</td>`).join('')}${data.staff.map((s, si) => `<td>${percentInput(`staff_${si}_${i}`, s.allocations[r.line.category] || 0, `${s.label}: ${r.line.name} time`, r.isSource)}</td>`).join('')}<td>${amount(r.staffCost)}</td><td>${r.isSource ? 'Redistributed' : amount(r.combined)}</td><td data-mission-remaining="${i}">${r.isSource ? '—' : `${r.remaining / 100}%`}</td></tr>`).join('')}
  </tbody></table></div>
  <p>For example, 1 in a Pastor time column assigns 1% of the Pastor’s total time to that line. Each staff column can total at most 100%. Save to recalculate dollars and remaining time.</p>
  <h3>Staff roles and linked compensation</h3><p>Link existing salary and benefit lines for each role. A compensation line may belong to one role only. Unassigned staff time stays in Unallocated; staff costs are counted once.</p>
  ${model.staff.map((s, si) => `<details><summary>${e(s.label)} · <span data-staff-remaining="${si}">${s.total / 100}% allocated · ${s.remaining / 100}% remaining</span> · ${amount(s.pool)} linked</summary><label>Staff role <input name="label_${si}" value="${e(s.label)}" maxlength="60" required></label><fieldset><legend>Existing compensation lines for ${e(s.label)}</legend>${model.rows.map((r, i) => `<label style="display:block"><input type="checkbox" name="source_${si}_${i}" value="yes"${s.sources.includes(r.line.category) ? ' checked' : ''}> ${e(r.line.category)} · ${amount(cents(r.line))}</label>`).join('')}</fieldset><label><input type="checkbox" name="remove_${si}" value="yes"> Remove this role’s allocation (keeps budget lines)</label></details>`).join('')}
  <label class="field"><span>Add staff role</span><input name="new_staff_label" maxlength="60" placeholder="e.g. Pastor"></label>
  <p role="status" aria-live="polite" data-mission-status></p>
  <script src="/mission-alignment/live.js" defer></script>
  <button type="submit">Save mission and staff allocations</button>
  </form></section>`;
}


// External, CSP-compatible enhancement. Server validation remains authoritative.
export function missionLive() {
  const form = document.querySelector('#mission form');
  if (!form) return;
  const fields = Array.from(form.querySelectorAll('input[type="number"]'));
  const status = form.querySelector('[data-mission-status]');
  const total = (inputs) => inputs.reduce((n, el) => n + Math.round((Number(el.value) || 0) * 100), 0);
  const update = () => {
    fields.forEach(el => el.setCustomValidity(''));
    let invalid = false;
    form.querySelectorAll('[data-mission-remaining]').forEach(output => {
      const i = output.dataset.missionRemaining;
      const inputs = fields.filter(el => el.name.startsWith('goal_' + i + '_') && !el.disabled);
      if (!inputs.length) return;
      const remaining = 10000 - total(inputs);
      output.textContent = remaining >= 0 ? (remaining / 100) + '% unallocated' : (-remaining / 100) + '% over';
      if (remaining < 0) { inputs[0].setCustomValidity('This mission split exceeds 100%.'); invalid = true; }
    });
    form.querySelectorAll('[data-staff-remaining]').forEach(output => {
      const i = output.dataset.staffRemaining;
      const removed = form.elements['remove_' + i]?.checked;
      const inputs = fields.filter(el => el.name.startsWith('staff_' + i + '_') && !el.disabled);
      const allocated = total(inputs);
      output.textContent = removed ? 'Will remove allocation' : (allocated / 100) + '% allocated · ' + (allocated > 10000 ? ((allocated - 10000) / 100) + '% over' : ((10000 - allocated) / 100) + '% remaining');
      if (allocated > 10000 && !removed && inputs.length) { inputs[0].setCustomValidity('This staff role’s time exceeds 100%.'); invalid = true; }
    });
    status.textContent = invalid ? 'Check percentages over 100% before saving.' : 'Unsaved changes. Save to update mission dollar totals.';
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', event => { update(); if (!form.reportValidity()) event.preventDefault(); });
}
export const MISSION_LIVE_JS = '(' + missionLive.toString() + ')();';
