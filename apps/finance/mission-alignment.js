// Mission alignment: Finance-owned, year-scoped planning metadata that reads the budget by the
// church's four Ends (Welcome, Receive, Grow, Go). Budget and compensation amounts stay in their
// existing contracts; this only redistributes the plan's existing expense cents, never adds payroll.
//
// Stored in finance_settings under finance_mission_alignment_<year> (version 2):
//   lines:  { [category]: { method: 'one'|'split'|'spread', shares: [4 basis points], note } }
//   staff:  [{ id, label, hours (hundredths/week or null), sources: [categories], mode: 'quick'|'week',
//             shares: [4 bp], week: [{ activity, hours (hundredths), end: 0..3 | 'spread' }], reviewed }]
//   buildingUse: [4 bp] | null   the church's "by building use" preset for shared costs
//   story: { bullets: [[...], [...], [...], [...]], note }   words for the congregation visual
// Version 1 (this morning's first cut: a split per line, staff time as a percentage of ministry
// lines) is read and converted in memory; the next save stores version 2.
import { FormValidationError } from './form-fields.js';

export const MISSION_GOALS = [['welcome', 'Welcome', 'Acceptance'], ['receive', 'Receive', 'Worship'], ['grow', 'Grow', 'Christian education'], ['go', 'Go', 'Outreach']];
export const GOAL_KEYS = MISSION_GOALS.map(([k]) => k);
export const missionKey = (year) => `finance_mission_alignment_${year}`;
// Editing is admin-only, as before: staff time sits beside compensation.
export const canManageMission = (r) => Boolean(r?.ok && r.role === 'admin');
const FULL = 10000;
const MAX_WEEK_ROWS = 30;
const MAX_NOTE = 600;

const fail = (message) => { throw new FormValidationError(message); };
const sum = (v) => v.reduce((a, b) => a + b, 0);
export const lineCents = (line) => line?.plan?.plannedAmountCents || 0;
export const expenseLines = (builder) => builder.lines.filter((l) => l.classification !== 'Income');
export const emptyMission = () => ({ version: 2, revision: 0, lines: {}, staff: [], buildingUse: null, story: { bullets: [[], [], [], []], note: '' } });

// ── Reading and normalizing ──────────────────────────────────────────────────────────────────

const isShares = (v) => Array.isArray(v) && v.length === 4 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= FULL) && sum(v) <= FULL;
const onlyEnd = (shares) => (shares.filter((n) => n > 0).length === 1 && sum(shares) === FULL ? shares.findIndex((n) => n > 0) : -1);

export function normalizeMission(raw) {
  const out = emptyMission();
  if (!raw || typeof raw !== 'object') return out;
  out.revision = Number.isInteger(raw.revision) ? raw.revision : 0;
  if (raw.updatedBy) out.updatedBy = String(raw.updatedBy);
  const v1Lines = {};
  for (const [category, entry] of Object.entries(raw.lines || {})) {
    if (isShares(entry)) { // version 1: a bare split
      v1Lines[category] = entry;
      out.lines[category] = { method: onlyEnd(entry) >= 0 ? 'one' : 'split', shares: [...entry], note: '' };
    } else if (entry && typeof entry === 'object' && ['one', 'split', 'spread'].includes(entry.method)) {
      out.lines[category] = { method: entry.method, shares: isShares(entry.shares) ? [...entry.shares] : [0, 0, 0, 0], note: String(entry.note || '').slice(0, MAX_NOTE) };
    }
  }
  for (const person of Array.isArray(raw.staff) ? raw.staff : []) {
    if (!person || typeof person !== 'object' || !person.id) continue;
    const base = { id: String(person.id), label: String(person.label || 'Staff role').slice(0, 60), sources: Array.isArray(person.sources) ? person.sources.map(String) : [] };
    if (person.allocations && !person.mode) {
      // Version 1: percentages of the role's time on ministry lines, each line split by End.
      const shares = [0, 0, 0, 0];
      for (const [category, pct] of Object.entries(person.allocations)) {
        const split = v1Lines[category];
        if (!split || !Number.isInteger(pct)) continue;
        split.forEach((s, i) => { shares[i] += (pct * s) / FULL; });
      }
      const rounded = shares.map(Math.floor);
      out.staff.push({ ...base, hours: null, mode: 'quick', shares: rounded, week: [], reviewed: false });
      continue;
    }
    out.staff.push({
      ...base,
      hours: Number.isInteger(person.hours) && person.hours > 0 ? person.hours : null,
      mode: person.mode === 'week' ? 'week' : 'quick',
      shares: isShares(person.shares) ? [...person.shares] : [0, 0, 0, 0],
      week: (Array.isArray(person.week) ? person.week : []).filter((w) => w && Number.isInteger(w.hours) && w.hours >= 0)
        .map((w) => ({ activity: String(w.activity || '').slice(0, 80), hours: w.hours, end: w.end === 'spread' ? 'spread' : (Number.isInteger(w.end) && w.end >= 0 && w.end < 4 ? w.end : 'spread') })),
      reviewed: Boolean(person.reviewed),
    });
  }
  if (isShares(raw.buildingUse) && sum(raw.buildingUse) === FULL) out.buildingUse = [...raw.buildingUse];
  const bullets = raw.story?.bullets;
  if (Array.isArray(bullets) && bullets.length === 4) out.story.bullets = bullets.map((b) => (Array.isArray(b) ? b.map((s) => String(s).slice(0, 80)).filter(Boolean).slice(0, 6) : []));
  out.story.note = String(raw.story?.note || '').slice(0, MAX_NOTE);
  return out;
}

export async function readMission(db, year) {
  const row = await db.prepare('SELECT value FROM finance_settings WHERE key=?').bind(missionKey(year)).first();
  if (!row) return { ...emptyMission(), stored: null };
  const value = JSON.parse(row.value);
  if (!value || typeof value !== 'object' || !Number.isInteger(value.revision)) throw new Error('Invalid mission settings');
  return { ...normalizeMission(value), stored: row.value };
}

// ── Arithmetic ───────────────────────────────────────────────────────────────────────────────

// Largest-remainder apportionment in basis points (weights total at most 10,000, the last entry
// usually the unassigned remainder). Conserves cents, including negative expense credits.
export function apportion(value, weights) {
  return distribute(value, weights);
}

// The same, for any nonnegative weights: the parts always add back to `value` exactly.
export function distribute(value, weights) {
  const total = sum(weights);
  if (!total) return weights.map(() => 0);
  const sign = value < 0 ? -1 : 1;
  const n = Math.abs(value);
  const raw = weights.map((w) => (n * w) / total);
  const parts = raw.map(Math.floor);
  const left = n - sum(parts);
  const order = raw.map((v, i) => ({ i, r: v - parts[i] })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let i = 0; i < left; i += 1) parts[order[i % order.length].i] += 1;
  return parts.map((v) => v * sign);
}

// Basis points of each End for a set of weights (or zeros when there is nothing to weigh).
export const toShares = (values) => (sum(values.map((v) => Math.max(0, v))) ? distribute(FULL, values.map((v) => Math.max(0, v))) : [0, 0, 0, 0]);

// A typical week: hours per End, with "spread across all four" hours given out in the same
// proportion as the rest (or evenly when nothing else is set), so overhead credits no End.
export function weekShares(week) {
  const direct = [0, 0, 0, 0];
  let spread = 0;
  for (const w of week) { if (w.end === 'spread') spread += w.hours; else direct[w.end] += w.hours; }
  const total = sum(direct) + spread;
  if (!total) return { shares: [0, 0, 0, 0], hours: [0, 0, 0, 0], total: 0, spread: 0 };
  const shares = sum(direct) ? toShares(direct) : [2500, 2500, 2500, 2500];
  return { shares, hours: shares.map((s) => (total * s) / FULL), total, spread };
}

export const staffShares = (person) => (person.mode === 'week' ? weekShares(person.week).shares : person.shares);

// ── The model every page reads ───────────────────────────────────────────────────────────────

export function missionModel(builder, data) {
  const lines = expenseLines(builder);
  const byCategory = new Map(lines.map((l) => [l.category, l]));
  const sourceOwner = new Map();
  for (const person of data.staff) for (const c of person.sources) if (byCategory.has(c) && !sourceOwner.has(c)) sourceOwner.set(c, person.id);
  let unassigned = 0;
  const staffTotals = [0, 0, 0, 0];
  const staff = data.staff.map((person) => {
    const pool = sum(person.sources.filter((c) => sourceOwner.get(c) === person.id).map((c) => lineCents(byCategory.get(c))));
    const shares = staffShares(person);
    const parts = apportion(pool, [...shares, FULL - sum(shares)]);
    parts.slice(0, 4).forEach((p, i) => { staffTotals[i] += p; });
    unassigned += parts[4];
    return { ...person, pool, shares, parts: parts.slice(0, 4), unassigned: parts[4], week: person.week, weekResult: weekShares(person.week) };
  });
  const programTotals = [0, 0, 0, 0];
  const rows = lines.map((line) => {
    const cents = lineCents(line);
    if (sourceOwner.has(line.category)) return { line, cents, isSource: true, ownerId: sourceOwner.get(line.category) };
    const entry = data.lines[line.category] || null;
    const method = entry?.method || null;
    const shares = entry && method !== 'spread' ? entry.shares : [0, 0, 0, 0];
    return { line, cents, isSource: false, entry, method, shares, note: entry?.note || '' };
  });
  for (const r of rows) {
    if (r.isSource || r.method === 'spread') continue;
    const parts = apportion(r.cents, [...r.shares, FULL - sum(r.shares)]);
    r.parts = parts.slice(0, 4); r.unassigned = parts[4];
    r.parts.forEach((p, i) => { programTotals[i] += p; });
    unassigned += parts[4];
  }
  // "Spread like the budget" follows everything that is aligned directly, staff time included.
  const basis = programTotals.map((v, i) => v + staffTotals[i]);
  const spreadShares = toShares(basis);
  for (const r of rows) {
    if (r.method !== 'spread') continue;
    r.shares = spreadShares;
    if (sum(spreadShares)) { r.parts = distribute(r.cents, spreadShares); r.unassigned = 0; } else { r.parts = [0, 0, 0, 0]; r.unassigned = r.cents; }
    r.parts.forEach((p, i) => { programTotals[i] += p; });
    unassigned += r.unassigned;
  }
  for (const r of rows) if (!r.isSource) r.status = rowStatus(r);
  const totals = programTotals.map((v, i) => v + staffTotals[i]);
  const programRows = rows.filter((r) => !r.isSource);
  const needs = programRows.filter((r) => r.status === 'needs' || r.status === 'partial');
  const staffPool = sum(staff.map((s) => s.pool));
  return {
    rows, staff, totals, staffTotals, programTotals, unassigned,
    total: sum(lines.map(lineCents)), staffPool, programTotal: sum(programRows.map((r) => r.cents)),
    needsCount: needs.length, needsCents: sum(needs.map((r) => r.unassigned || 0)),
    unlinkedStaff: staff.filter((s) => !s.pool).length,
  };
}

function rowStatus(r) {
  if (!r.entry || (r.method !== 'spread' && sum(r.shares) === 0)) return 'needs';
  if (r.method === 'spread') return 'spread';
  if (sum(r.shares) < FULL) return 'partial';
  return r.method === 'one' ? 'one' : 'split';
}

// ── Form parsing ─────────────────────────────────────────────────────────────────────────────

export function percent(raw) {
  const v = String(raw ?? '').replace(/[%\s]/g, '');
  if (v === '') return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(v) || Number(v) > 100) fail('Enter percentages from 0 to 100, with at most two decimal places.');
  return Math.round(Number(v) * 100);
}
function hoursValue(raw, label) {
  const v = String(raw ?? '').trim();
  if (v === '') return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(v) || Number(v) > 120) fail(`${label} must be a number of hours from 0 to 120.`);
  return Math.round(Number(v) * 100);
}
function sharesFrom(form, prefix = 'share_') {
  const shares = GOAL_KEYS.map((g) => percent(form[`${prefix}${g}`]));
  if (sum(shares) > FULL) fail('The shares add up to more than 100%.');
  return shares;
}
const endIndex = (raw) => { const i = GOAL_KEYS.indexOf(String(raw || '')); return i; };

export function applyLine(data, form, builder) {
  const category = String(form.category || '');
  const line = expenseLines(builder).find((l) => l.category === category);
  if (!line) fail('That budget line is not in this year’s plan. Reload and try again.');
  if (data.staff.some((s) => s.sources.includes(category))) fail('This line is staff compensation. Set it on the Staff time page.');
  const note = String(form.note || '').trim();
  if (note.length > MAX_NOTE) fail(`Keep the reason to ${MAX_NOTE} characters.`);
  const method = String(form.method || '');
  let entry;
  if (method === 'clear') entry = null;
  else if (method === 'one') {
    const i = endIndex(form.end);
    if (i < 0) fail('Choose the End this line serves.');
    entry = { method: 'one', shares: GOAL_KEYS.map((_, j) => (j === i ? FULL : 0)), note };
  } else if (method === 'split') entry = { method: 'split', shares: sharesFrom(form), note };
  else if (method === 'spread') entry = { method: 'spread', shares: [0, 0, 0, 0], note };
  else fail('Choose how this line should be aligned.');
  const lines = { ...data.lines };
  if (entry) lines[category] = entry; else delete lines[category];
  return { data: { ...data, lines }, params: { line: category } };
}

export function applyBuildingUse(data, form) {
  const shares = sharesFrom(form);
  if (sum(shares) !== FULL) fail('The building-use shares must add up to exactly 100%.');
  return { data: { ...data, buildingUse: shares }, params: {} };
}

export function applyStaff(data, form, builder) {
  const index = data.staff.findIndex((s) => s.id === String(form.id || ''));
  if (index < 0) fail('That staff role was not found. Reload and try again.');
  const label = String(form.label || '').trim();
  if (!label || label.length > 60) fail('Give the staff role a name of 1–60 characters.');
  const lines = expenseLines(builder);
  const sources = [];
  for (let i = 0; i < lines.length; i += 1) if (form[`source_${i}`] === lines[i].category) sources.push(lines[i].category);
  if (sources.length > 40) fail('Too many compensation lines for one role.');
  for (const c of sources) {
    if (data.staff.some((s, i) => i !== index && s.sources.includes(c))) fail('A compensation line can belong to only one staff role. Split combined payroll into separate budget lines first.');
    if (data.lines[c]) fail(`${c} already has its own mission split on the Mission alignment page. Clear it there before linking it to a staff role.`);
    if (lineCents(lines.find((l) => l.category === c)) < 0) fail('Compensation lines must have nonnegative planned amounts.');
  }
  const mode = form.mode === 'week' ? 'week' : 'quick';
  const person = { ...data.staff[index], label, sources, mode, hours: hoursValue(form.hours, 'Hours per week'), reviewed: form.reviewed === 'yes' };
  if (mode === 'quick') person.shares = sharesFrom(form);
  else {
    const week = [];
    for (let i = 0; i < MAX_WEEK_ROWS; i += 1) {
      const activity = String(form[`act_${i}`] ?? '').trim();
      const hours = hoursValue(form[`act_hours_${i}`], `Hours for ${activity || 'an activity'}`);
      if (!activity && !hours) continue;
      if (!activity) fail('Name each activity that has hours.');
      if (activity.length > 80) fail('Keep activity names to 80 characters.');
      const end = form[`act_end_${i}`] === 'spread' ? 'spread' : endIndex(form[`act_end_${i}`]);
      if (end === -1) fail(`Choose what “${activity}” counts toward.`);
      week.push({ activity, hours: hours || 0, end });
    }
    if (sum(week.map((w) => w.hours)) > 12000) fail('A typical week cannot be more than 120 hours.');
    person.week = week;
  }
  const staff = data.staff.map((s, i) => (i === index ? person : s));
  return { data: { ...data, staff }, params: { role: person.id, ...(mode === 'week' ? { mode: 'week' } : {}) } };
}

export function addStaff(data, form) {
  const label = String(form.label || '').trim();
  if (!label || label.length > 60) fail('Give the staff role a name of 1–60 characters.');
  if (data.staff.length >= 30) fail('A year can have up to 30 staff roles.');
  const person = { id: crypto.randomUUID(), label, hours: null, sources: [], mode: 'quick', shares: [0, 0, 0, 0], week: [], reviewed: false };
  return { data: { ...data, staff: [...data.staff, person] }, params: { role: person.id } };
}

export function removeStaff(data, form) {
  const id = String(form.id || '');
  if (!data.staff.some((s) => s.id === id)) fail('That staff role was not found. Reload and try again.');
  return { data: { ...data, staff: data.staff.filter((s) => s.id !== id) }, params: {} };
}

export function applyStory(data, form) {
  const bullets = GOAL_KEYS.map((g) => String(form[`bullets_${g}`] || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  if (bullets.some((b) => b.length > 6 || b.some((s) => s.length > 80))) fail('Use up to six lines per End, 80 characters each.');
  const note = String(form.note || '').trim();
  if (note.length > MAX_NOTE) fail(`Keep the closing note to ${MAX_NOTE} characters.`);
  return { data: { ...data, story: { bullets, note } }, params: {} };
}

const ACTIONS = {
  line: { run: applyLine, page: 'mission' },
  building: { run: applyBuildingUse, page: 'mission' },
  staff: { run: applyStaff, page: 'staff-time' },
  'staff-add': { run: addStaff, page: 'staff-time' },
  'staff-remove': { run: removeStaff, page: 'staff-time' },
  story: { run: applyStory, page: 'congregation' },
};

function yearValue(raw) {
  if (!/^20\d{2}$/.test(String(raw))) fail('Choose a fiscal year between 2000 and 2099.');
  return Number(raw);
}

// One change per post, checked against the revision the page was drawn from, then written with an
// atomic compare-and-swap so two people saving at once never lose each other's work.
export async function saveMission(db, form, actor, builder) {
  const action = ACTIONS[form.action];
  if (!action) fail('That change could not be understood. Reload and try again.');
  const year = yearValue(form.target);
  if (builder.targetYear !== year) fail('The requested budget year could not be loaded.');
  const data = await readMission(db, year);
  if (String(data.revision) !== String(form.revision)) fail('Someone else saved mission alignment just now. Reload before editing again.');
  const { stored, ...current } = data;
  const result = action.run(current, form, builder);
  const output = { ...result.data, version: 2, revision: data.revision + 1, updatedBy: String(actor || '') };
  const value = JSON.stringify(output);
  const write = stored === null
    ? await db.prepare('INSERT INTO finance_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING').bind(missionKey(year), value).run()
    : await db.prepare("UPDATE finance_settings SET value=?, updated_at=datetime('now') WHERE key=? AND value=?").bind(value, missionKey(year), stored).run();
  if (write.meta?.changes !== 1) fail('Someone else saved mission alignment just now. Reload before editing again.');
  return { page: action.page, params: { target: String(year), base: String(form.base || year - 1), mission: '1', ...result.params } };
}

// ── Starting points offered in the editors ───────────────────────────────────────────────────

export const WEEK_TEMPLATES = {
  pastor: { label: 'Pastor', rows: [['Sermon & worship preparation', 14, 1], ['Leading worship & sacraments', 4, 1], ['Pastoral care & visitation', 6, 0], ['Guest & new member conversations', 3, 0], ['Bible study & confirmation teaching', 6, 2], ['Mentoring staff & fieldworkers', 4, 2], ['Neighborhood & community partners', 5, 3], ['Council, administration & planning', 8, 'spread']] },
  educator: { label: 'Educator', rows: [['Sunday school & VBS', 12, 2], ['Youth & confirmation', 10, 2], ['Adult classes', 6, 2], ['Family events & guests', 4, 0], ['Helping lead worship', 4, 1], ['Service projects & community', 5, 3], ['Planning & administration', 4, 'spread']] },
  music: { label: 'Musician', rows: [['Rehearsals & choirs', 8, 1], ['Playing for services', 6, 1], ['Choosing & preparing music', 6, 1], ['Teaching music to children', 3, 2], ['Concerts & community events', 2, 3]] },
  office: { label: 'Office', rows: [['Greeting visitors & phones', 10, 0], ['Bulletins & worship preparation', 8, 1], ['Education & event support', 6, 2], ['Newsletters & outreach', 6, 3], ['Bookkeeping & administration', 10, 'spread']] },
  building: { label: 'Building care', rows: [['Sanctuary & worship spaces', 10, 1], ['Education wing', 10, 2], ['Fellowship & guest spaces', 5, 0], ['Community use of the building', 5, 3]] },
};
export const templateWeek = (key) => (WEEK_TEMPLATES[key] ? WEEK_TEMPLATES[key].rows.map(([activity, h, end]) => ({ activity, hours: h * 100, end })) : null);

// ── Live editing script (CSP-compatible, served by this Worker) ──────────────────────────────
// Keeps the totals, bars and dollar previews current while someone types. The server checks again.
export function missionLive() {
  const FULL = 10000;
  const pct = (el) => Math.round((Number(String(el.value).replace('%', '')) || 0) * 100);
  const usd = (c) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(c / 100);
  const paint = (bar, shares) => {
    if (!bar) return;
    bar.querySelectorAll('[data-seg]').forEach((seg, i) => { seg.style.width = (shares[i] / 100) + '%'; });
  };
  const split = (total, shares) => shares.map((s) => Math.round((total * s) / FULL));
  document.querySelectorAll('form[data-ma-shares]').forEach((form) => {
    const cents = Number(form.dataset.cents || 0);
    const inputs = Array.from(form.querySelectorAll('[data-share]'));
    const update = () => {
      const shares = inputs.map(pct);
      const total = shares.reduce((a, b) => a + b, 0);
      split(cents, shares).forEach((c, i) => { const out = form.querySelector('[data-dollars="' + i + '"]'); if (out) out.textContent = usd(c); });
      paint(form.querySelector('[data-ma-bar]'), shares);
      const badge = form.querySelector('[data-ma-total]');
      if (badge) {
        badge.textContent = total === FULL ? 'Totals 100% · ' + usd(cents) : total > FULL ? ((total - FULL) / 100) + '% over 100%' : ((FULL - total) / 100) + '% not yet aligned';
        badge.className = 'ma-badge ' + (total === FULL ? 'ok' : 'warn');
      }
      inputs.forEach((el) => el.setCustomValidity(total > FULL ? 'The shares add up to more than 100%.' : ''));
    };
    form.addEventListener('input', update);
    form.querySelectorAll('[data-preset]').forEach((btn) => btn.addEventListener('click', (event) => {
      event.preventDefault();
      const shares = JSON.parse(btn.dataset.preset);
      inputs.forEach((el, i) => { el.value = String(shares[i] / 100); });
      const radio = form.querySelector('input[name="method"][value="split"]');
      if (radio) radio.checked = true;
      update();
    }));
    update();
  });
  document.querySelectorAll('form[data-ma-week]').forEach((form) => {
    const cents = Number(form.dataset.cents || 0);
    const target = Number(form.dataset.hours || 0);
    const update = () => {
      const direct = [0, 0, 0, 0];
      let spread = 0;
      form.querySelectorAll('[data-week-row]').forEach((row) => {
        const h = Number(row.querySelector('[data-week-hours]').value) || 0;
        const end = row.querySelector('[data-week-end]').value;
        if (end === 'spread') spread += h; else if (['welcome', 'receive', 'grow', 'go'].includes(end)) direct[['welcome', 'receive', 'grow', 'go'].indexOf(end)] += h;
      });
      const d = direct.reduce((a, b) => a + b, 0);
      const total = d + spread;
      const shares = d ? direct.map((h) => Math.round((h / d) * FULL)) : (total ? [2500, 2500, 2500, 2500] : [0, 0, 0, 0]);
      paint(form.querySelector('[data-ma-bar]'), shares);
      shares.forEach((s, i) => {
        const set = (k, v) => { const el = form.querySelector('[data-week-' + k + '="' + i + '"]'); if (el) el.textContent = v; };
        set('h', ((total * s) / FULL).toFixed(1)); set('pct', Math.round(s / 100) + '%'); set('usd', usd((cents * s) / FULL));
      });
      const sumOut = form.querySelector('[data-week-total]');
      if (sumOut) sumOut.textContent = String(Math.round(total * 100) / 100);
      const badge = form.querySelector('[data-week-badge]');
      if (badge) {
        const ok = !target || Math.abs(total - target) < 0.01;
        badge.textContent = !target ? total + ' hours' : ok ? 'Matches ' + target + ' hours' : (total > target ? (total - target).toFixed(2).replace(/\.00$/, '') + ' hours over ' : (target - total).toFixed(2).replace(/\.00$/, '') + ' hours under ') + target;
        badge.className = 'ma-badge ' + (ok ? 'ok' : 'warn');
      }
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    update();
  });
}
export const MISSION_LIVE_JS = '(' + missionLive.toString() + ')();';
