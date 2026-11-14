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
export const emptyMission = () => ({ version: 2, revision: 0, lines: {}, staff: [], leads: {}, benefitLines: [], buildingUse: null, story: { bullets: [[], [], [], []], note: '' } });

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
        .map((w) => ({ activity: String(w.activity || '').slice(0, 80), hours: w.hours, end: weekEnd(w.end), ...(Number.isInteger(w.weeks) && w.weeks >= 1 && w.weeks < 52 ? { weeks: w.weeks } : {}) })),
      reviewed: Boolean(person.reviewed),
      lineTime: lineTimeFrom(person.lineTime),
      ...plannerFields(person),
    });
  }
  out.leads = leadsFrom(raw.leads, new Set(out.staff.map((p) => p.id)));
  out.benefitLines = Array.isArray(raw.benefitLines) ? [...new Set(raw.benefitLines.map(String))].slice(0, 200) : [];
  if (isShares(raw.buildingUse) && sum(raw.buildingUse) === FULL) out.buildingUse = [...raw.buildingUse];
  const bullets = raw.story?.bullets;
  if (Array.isArray(bullets) && bullets.length === 4) out.story.bullets = bullets.map((b) => (Array.isArray(b) ? b.map((s) => String(s).slice(0, 80)).filter(Boolean).slice(0, 6) : []));
  out.story.note = String(raw.story?.note || '').slice(0, MAX_NOTE);
  out.district = districtFrom(raw.district);
  return out;
}

export async function readMission(db, year) {
  const row = await db.prepare('SELECT value FROM finance_settings WHERE key=?').bind(missionKey(year)).first();
  if (!row) return { ...emptyMission(), stored: null };
  const value = JSON.parse(row.value);
  if (!value || typeof value !== 'object' || !Number.isInteger(value.revision)) throw new Error('Invalid mission settings');
  return { ...normalizeMission(value), stored: row.value };
}

// Who leads each budget line: { [category]: { [staffId]: basis points of the line } }, at most 100%
// per line. It names responsibility only; no money moves between the line and the person.
function leadsFrom(raw, ids) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [c, byStaff] of Object.entries(raw)) {
    if (!byStaff || typeof byStaff !== 'object') continue;
    const entry = {};
    let total = 0;
    for (const [id, bp] of Object.entries(byStaff)) {
      if (!ids.has(id) || !Number.isInteger(bp) || bp <= 0 || total + bp > FULL) continue;
      entry[id] = bp; total += bp;
    }
    if (Object.keys(entry).length) out[String(c)] = entry;
  }
  return out;
}

// District support comparison: Timothy's member counts for the year (totals only) and the
// benchmark averages, in cents per congregation / baptized member / confirmed member.
// `where` names the district behind a lowest/highest figure, per measure.
export const DISTRICT_BENCHMARKS = [
  { key: 'mo', label: 'Missouri District', perCongregation: 899900, perBaptized: 2426, perConfirmed: 3061 },
  { key: 'all', label: 'Combined 29-district average', perCongregation: 921000, perBaptized: 3051, perConfirmed: 3858 },
  { key: 'median', label: 'Median district', perCongregation: 899900, perBaptized: 3173, perConfirmed: 4045 },
  { key: 'mean', label: 'Average of the districts', perCongregation: 896400, perBaptized: 3470, perConfirmed: 4345 },
  { key: 'low', label: 'Lowest district', range: true, perCongregation: 430300, perBaptized: 1832, perConfirmed: 2349, where: { perCongregation: 'Eastern', perBaptized: 'Northern Illinois', perConfirmed: 'Northern Illinois' } },
  { key: 'high', label: 'Highest district', range: true, perCongregation: 1342600, perBaptized: 6956, perConfirmed: 8710, where: { perCongregation: 'Michigan', perBaptized: 'Wyoming', perConfirmed: 'Wyoming' } },
];
// Total support a district receives in a year, for context only (not comparable to one congregation).
export const DISTRICT_TOTALS = { low: { cents: 28050500, where: 'New Jersey' }, high: { cents: 467232100, where: 'Michigan' }, mean: 158541400, median: 142986600 };
const count = (v) => (Number.isInteger(v) && v > 0 && v < 100000 ? v : null);
const centsOk = (v) => Number.isInteger(v) && v >= 0 && v < 1e10;
export function districtFrom(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const benchmarks = DISTRICT_BENCHMARKS.map((b) => {
    const saved = (Array.isArray(r.benchmarks) ? r.benchmarks : []).find((x) => x && x.key === b.key) || {};
    return { ...b, ...Object.fromEntries(['perCongregation', 'perBaptized', 'perConfirmed'].filter((k) => centsOk(saved[k])).map((k) => [k, saved[k]])) };
  });
  return { baptized: count(r.baptized), confirmed: count(r.confirmed), benchmarks };
}

// Earlier "time on this line" entries are kept as they were saved but no longer counted.
// What a typical-week activity counts toward: an End (0-3), 'spread' across all four, or a budget
// line ({ line: category }) whose own Ends it then follows.
function weekEnd(end) {
  if (end === 'spread') return 'spread';
  if (Number.isInteger(end) && end >= 0 && end < 4) return end;
  if (end && typeof end === 'object' && typeof end.line === 'string' && end.line) return { line: end.line.slice(0, 300) };
  return 'spread';
}

function lineTimeFrom(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  let total = 0;
  for (const [c, bp] of Object.entries(raw)) {
    if (!Number.isInteger(bp) || bp <= 0 || total + bp > FULL) continue;
    out[String(c)] = bp; total += bp;
  }
  return out;
}

// A role brought in from the compensation planner keeps who it is there (name and position, for
// matching on the next refresh) and its share of the staff benefit lines, in basis points. No pay
// amount is stored: the dollars always come from the budget plan's own lines.
function plannerFields(person) {
  if (typeof person.planKey !== 'string' || !person.planKey) return {};
  return {
    planKey: person.planKey.slice(0, 80), name: String(person.name || '').slice(0, 80), position: String(person.position || '').slice(0, 80),
    benefitWeight: Number.isInteger(person.benefitWeight) && person.benefitWeight >= 0 ? Math.min(FULL, person.benefitWeight) : 0,
    councilHidden: Boolean(person.councilHidden),
  };
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
// Hours on a budget line follow that line's Ends (`lineShares(category)` returns them, or null for a
// line not yet aligned, whose hours are then spread like overhead). `lines` totals hours per line.
export function weekShares(week, lineShares = () => null) {
  const direct = [0, 0, 0, 0];
  let spread = 0;
  const lines = {};
  for (const w of week) {
    // Seasonal work (VBS, the Christmas Market) is entered as hours in the weeks it happens and the
    // number of such weeks; it counts as its average over the 52-week year.
    const hours = w.weeks ? (w.hours * w.weeks) / 52 : w.hours;
    if (w.end === 'spread') { spread += hours; continue; }
    if (typeof w.end === 'number') { direct[w.end] += hours; continue; }
    const c = w.end?.line;
    if (!c) { spread += hours; continue; }
    lines[c] = (lines[c] || 0) + hours;
    const ls = lineShares(c);
    if (!ls || !sum(ls)) { spread += hours; continue; }
    ls.forEach((bp, i) => { direct[i] += (hours * bp) / FULL; });
    spread += (hours * (FULL - sum(ls))) / FULL;
  }
  const total = sum(direct) + spread;
  if (!total) return { shares: [0, 0, 0, 0], hours: [0, 0, 0, 0], total: 0, spread: 0, lines };
  const shares = sum(direct) ? toShares(direct) : [2500, 2500, 2500, 2500];
  return { shares, hours: shares.map((s) => (total * s) / FULL), total, spread, lines };
}

export const staffShares = (person, lineShares) => (person.mode === 'week' ? weekShares(person.week, lineShares).shares : person.shares);

// ── The model every page reads ───────────────────────────────────────────────────────────────

const BENEFITS_OWNER = '__benefits__';

export function missionModel(builder, data) {
  const lines = expenseLines(builder);
  const byCategory = new Map(lines.map((l) => [l.category, l]));
  const sourceOwner = new Map();
  for (const person of data.staff) for (const c of person.sources) if (byCategory.has(c) && !sourceOwner.has(c)) sourceOwner.set(c, person.id);
  // Staff benefit lines (health, pension, FICA...) are pooled in the budget, not kept per person:
  // they are shared among the roles by each one's benefit share from the compensation planner, or,
  // without planner shares, in proportion to each role's own linked pay.
  const benefitLines = (data.benefitLines || []).filter((c) => byCategory.has(c) && !sourceOwner.has(c));
  for (const c of benefitLines) sourceOwner.set(c, BENEFITS_OWNER);
  const benefitPool = sum(benefitLines.map((c) => lineCents(byCategory.get(c))));
  const ownPay = data.staff.map((person) => sum(person.sources.filter((c) => sourceOwner.get(c) === person.id).map((c) => lineCents(byCategory.get(c)))));
  const plannerWeights = data.staff.map((p) => p.benefitWeight || 0);
  const benefitParts = benefitPool ? distribute(benefitPool, sum(plannerWeights) ? plannerWeights : ownPay.map((v) => Math.max(0, v))) : data.staff.map(() => 0);
  let unassigned = data.staff.length && sum(benefitParts) === benefitPool ? 0 : benefitPool;
  const programTotals = [0, 0, 0, 0];
  const rows = lines.map((line) => {
    const cents = lineCents(line);
    if (sourceOwner.has(line.category)) return { line, cents, isSource: true, ownerId: sourceOwner.get(line.category), isBenefit: sourceOwner.get(line.category) === BENEFITS_OWNER };
    const entry = data.lines[line.category] || null;
    const method = entry?.method || null;
    const shares = entry && method !== 'spread' ? entry.shares : [0, 0, 0, 0];
    return { line, cents, isSource: false, entry, method, shares, note: entry?.note || '', leads: [] };
  });
  const rowByCategory = new Map(rows.filter((r) => !r.isSource).map((r) => [r.line.category, r]));
  for (const r of rows) {
    if (r.isSource || r.method === 'spread') continue;
    const parts = apportion(r.cents, [...r.shares, FULL - sum(r.shares)]);
    r.parts = parts.slice(0, 4); r.unassigned = parts[4];
    r.parts.forEach((p, i) => { programTotals[i] += p; });
    unassigned += parts[4];
  }
  // Typical-week hours on a budget line take that line's Ends; a "spread" line follows the lines
  // aligned directly.
  const directSpread = toShares(programTotals);
  const lineSharesOf = (c) => { const r = rowByCategory.get(c); if (!r || !r.entry) return null; if (r.method === 'spread') return directSpread; return sum(r.shares) ? r.shares : null; };
  const staffTotals = [0, 0, 0, 0];
  const staff = data.staff.map((person, index) => {
    const benefitShare = data.staff.length && sum(benefitParts) === benefitPool ? benefitParts[index] : 0;
    const pool = ownPay[index] + benefitShare;
    const shares = staffShares(person, lineSharesOf);
    const parts = apportion(pool, [...shares, FULL - sum(shares)]);
    parts.slice(0, 4).forEach((p, i) => { staffTotals[i] += p; });
    unassigned += parts[4];
    return { ...person, pool, ownPay: ownPay[index], benefitShare, shares, effShares: shares, parts: parts.slice(0, 4), unassigned: parts[4], week: person.week, weekResult: weekShares(person.week, lineSharesOf) };
  });
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
  // Typical-week hours on budget lines: each person's hours, share of their week and of their cost.
  for (const r of rows) if (!r.isSource) r.timeBy = [];
  for (const p of staff) {
    p.timeOnLines = [];
    const wr = p.mode === 'week' ? p.weekResult : null;
    if (!wr || !wr.total) continue;
    const entries = Object.entries(wr.lines).filter(([c, h]) => h > 0 && rowByCategory.has(c));
    if (!entries.length) continue;
    const bps = entries.map(([, h]) => Math.round((h / wr.total) * FULL));
    const cents = apportion(p.pool, [...bps, Math.max(0, FULL - sum(bps))]);
    entries.forEach(([c, h], i) => {
      const item = { category: c, line: rowByCategory.get(c).line, hours: h, bp: bps[i], cents: cents[i] };
      p.timeOnLines.push(item);
      rowByCategory.get(c).timeBy.push({ id: p.id, label: p.label, hours: h, bp: bps[i], cents: cents[i] });
    });
  }
  // Who leads each line: its share of the line's dollars, and of each End, credited to that person.
  const staffById = new Map(staff.map((p) => { p.ledLines = []; p.ledCents = 0; p.ledParts = [0, 0, 0, 0]; return [p.id, p]; }));
  for (const r of rows) {
    if (r.isSource) continue;
    const byStaff = Object.entries((data.leads || {})[r.line.category] || {}).filter(([id]) => staffById.has(id));
    r.leads = [];
    if (!byStaff.length) continue;
    const bps = byStaff.map(([, bp]) => bp);
    const cents = apportion(r.cents, [...bps, FULL - sum(bps)]);
    byStaff.forEach(([id, bp], i) => {
      const p = staffById.get(id);
      const parts = r.parts ? apportion(cents[i], [...(r.cents ? r.parts.map((v) => Math.max(0, v)) : [0, 0, 0, 0]), Math.max(0, (r.unassigned || 0))]).slice(0, 4) : [0, 0, 0, 0];
      r.leads.push({ id, label: p.label, bp, cents: cents[i] });
      p.ledLines.push({ category: r.line.category, line: r.line, bp, cents: cents[i] });
      p.ledCents += cents[i];
      parts.forEach((v, j) => { p.ledParts[j] += v; });
    });
  }
  const totals = programTotals.map((v, i) => v + staffTotals[i]);
  const programRows = rows.filter((r) => !r.isSource);
  const needs = programRows.filter((r) => r.status === 'needs' || r.status === 'partial');
  const staffPool = sum(staff.map((s) => s.pool));
  return {
    rows, staff, totals, staffTotals, programTotals, unassigned,
    total: sum(lines.map(lineCents)), staffPool, benefitPool, benefitLines, programTotal: sum(programRows.map((r) => r.cents)),
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
  if (data.staff.some((s) => s.sources.includes(category)) || (data.benefitLines || []).includes(category)) fail('This line is staff compensation. Set it on the Staff time page.');
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
  const leads = { ...(data.leads || {}) };
  if (form.leads === '1') {
    const entry = {};
    data.staff.forEach((person, i) => { const bp = percent(form[`lead_${i}`]); if (bp) entry[person.id] = bp; });
    if (sum(Object.values(entry)) > FULL) fail('The people leading this line add up to more than 100% of it.');
    if (Object.keys(entry).length) leads[category] = entry; else delete leads[category];
  }
  return { data: { ...data, lines, leads }, params: { line: category } };
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
    if ((data.benefitLines || []).includes(c)) fail(`${c} is a shared staff benefit line. Untick it under shared benefit lines first.`);
    if (lineCents(lines.find((l) => l.category === c)) < 0) fail('Compensation lines must have nonnegative planned amounts.');
  }
  const mode = form.mode === 'week' ? 'week' : 'quick';
  const person = { ...data.staff[index], label, sources, mode, hours: hoursValue(form.hours, 'Hours per week'), reviewed: form.reviewed === 'yes' };
  let leads = data.leads || {};
  if (form.led_lines === '1') {
    const owned = new Set([...data.staff.flatMap((s) => s.sources), ...sources, ...(data.benefitLines || [])]);
    leads = { ...leads };
    for (let i = 0; i < lines.length; i += 1) {
      const c = lines[i].category;
      const bp = percent(form[`led_${i}`]);
      const entry = { ...(leads[c] || {}) };
      if (bp && owned.has(c)) fail('Staff lead ministry lines, not staff pay or benefit lines.');
      if (bp) entry[person.id] = bp; else delete entry[person.id];
      if (sum(Object.values(entry)) > FULL) fail(`${lines[i].name || c} is led by more than 100% in total.`);
      if (Object.keys(entry).length) leads[c] = entry; else delete leads[c];
    }
  }
  if (mode === 'quick') person.shares = sharesFrom(form);
  else {
    const week = [];
    for (let i = 0; i < MAX_WEEK_ROWS; i += 1) {
      const activity = String(form[`act_${i}`] ?? '').trim();
      const hours = hoursValue(form[`act_hours_${i}`], `Hours for ${activity || 'an activity'}`);
      if (!activity && !hours) continue;
      if (!activity) fail('Name each activity that has hours.');
      if (activity.length > 80) fail('Keep activity names to 80 characters.');
      const raw = String(form[`act_end_${i}`] || '');
      let end = raw === 'spread' ? 'spread' : endIndex(raw);
      if (raw.startsWith('line:')) {
        const c = raw.slice(5);
        const owned = new Set([...data.staff.flatMap((s) => s.sources), ...sources, ...(data.benefitLines || [])]);
        if (!lines.some((l) => l.category === c) || owned.has(c)) fail(`“${activity}” must count toward a ministry line in this year’s plan.`);
        end = { line: c };
      }
      if (end === -1) fail(`Choose what “${activity}” counts toward.`);
      const weeksRaw = String(form[`act_weeks_${i}`] ?? '').trim();
      let weeks = null;
      if (weeksRaw !== '') {
        if (!/^\d{1,2}$/.test(weeksRaw) || Number(weeksRaw) < 1 || Number(weeksRaw) > 52) fail(`Weeks a year for “${activity}” must be a whole number from 1 to 52.`);
        if (Number(weeksRaw) < 52) weeks = Number(weeksRaw);
      }
      week.push({ activity, hours: hours || 0, end, ...(weeks ? { weeks } : {}) });
    }
    if (sum(week.map((w) => (w.weeks ? (w.hours * w.weeks) / 52 : w.hours))) > 12000) fail('A typical week cannot average more than 120 hours.');
    person.week = week;
  }
  const staff = data.staff.map((s, i) => (i === index ? person : s));
  return { data: { ...data, staff, leads }, params: { role: person.id, ...(mode === 'week' ? { mode: 'week' } : {}) } };
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
  const leads = Object.fromEntries(Object.entries(data.leads || {}).map(([c, e]) => [c, Object.fromEntries(Object.entries(e).filter(([k]) => k !== id))]).filter(([, e]) => Object.keys(e).length));
  return { data: { ...data, leads, staff: data.staff.filter((s) => s.id !== id) }, params: {} };
}

export function applyStory(data, form) {
  const bullets = GOAL_KEYS.map((g) => String(form[`bullets_${g}`] || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  if (bullets.some((b) => b.length > 6 || b.some((s) => s.length > 80))) fail('Use up to six lines per End, 80 characters each.');
  const note = String(form.note || '').trim();
  if (note.length > MAX_NOTE) fail(`Keep the closing note to ${MAX_NOTE} characters.`);
  return { data: { ...data, story: { bullets, note } }, params: {} };
}

// ── Bringing staff in from the compensation planner ──────────────────────────────────────────

// Every church staff benefit and payroll-cost line, so a person's full cost follows their time.
// Mother's Day Out payroll lines are its own program and stay out.
const BENEFIT_LINE_RE = /health|medical|dental|vision|disabilit|pension|retirement|\bfica\b|social security|payroll tax|payroll processing|workers?.? ?comp|mileage|professional development|continuing ed/i;
const PAY_LINE_RE = /salar|wage|housing|stipend/i;
const MDO_RE = /\bMDO\b|mother.?s day out/i;
const plannerKey = (w) => `plan:${String(w.name || '').trim().toLowerCase()}`;

// The compensation planner's roster, projected for the budget year, as the allocation tool needs
// it: who, their position, typical hours, the budget line their pay is charged to, and their
// projected benefit cost (used only to weigh the shared benefit lines). Workers paid from another
// budget are left out because their pay is not in this budget.
export function plannerWorkers({ computed, roster } = {}) {
  if (!Array.isArray(computed) || !Array.isArray(roster)) return null;
  const entries = roster.map((w, i) => ({ w, c: computed[i] }));
  return entries
    .filter(({ w }) => w && String(w.name || '').trim() && !w.externallyFunded).map(({ c, w }) => {
    const fte = Number(w.ftePct);
    return {
      key: plannerKey(w), name: String(w.name).trim().slice(0, 80), position: String(w.position || '').trim().slice(0, 80),
      accountCode: String(w.accountCode || '').trim(), hours: Number.isFinite(fte) && fte > 0 ? Math.round(fte * 40) : null,
      benefitsCents: Math.max(0, c?.benefits?.totalCents || 0), churchCostCents: Math.max(0, c?.churchCostCents || 0),
      councilHidden: Boolean(w.hideFromCouncil),
    };
  });
}

// The budget line a worker's pay is charged to: the planner's account code found in the line's
// QuickBooks path or name.
export function payLinesFor(worker, lines) {
  if (!worker.accountCode) return [];
  return lines.filter((l) => `${l.category} ${l.name || ''}`.includes(worker.accountCode)).map((l) => l.category);
}

export function suggestedBenefitLines(data, builder) {
  const owned = new Set(data.staff.flatMap((s) => s.sources));
  return expenseLines(builder).filter((l) => !owned.has(l.category) && !data.lines[l.category] && BENEFIT_LINE_RE.test(`${l.category} ${l.name || ''}`) && !PAY_LINE_RE.test(l.name || '') && !MDO_RE.test(`${l.category} ${l.name || ''}`)).map((l) => l.category);
}

export function importStaff(data, form, builder, { workers } = {}) {
  if (!Array.isArray(workers)) fail('The compensation planner could not be read just now. Nothing was changed; try again.');
  if (!workers.length) fail('The compensation planner has no staff paid from this budget yet.');
  const lines = expenseLines(builder);
  const staff = data.staff.map((s) => ({ ...s, sources: [...s.sources] }));
  const owned = new Set(staff.flatMap((s) => s.sources));
  const totalBenefits = sum(workers.map((w) => w.benefitsCents));
  const weights = totalBenefits ? distribute(FULL, workers.map((w) => w.benefitsCents)) : workers.map(() => 0);
  let added = 0;
  workers.forEach((w, i) => {
    const payLines = payLinesFor(w, lines);
    // A role set up by hand (or from the budget narrative) that already holds this person's pay
    // line is the same person: it is adopted rather than duplicated.
    let person = staff.find((s) => s.planKey === w.key) || staff.find((s) => !s.planKey && payLines.some((c) => s.sources.includes(c)));
    if (!person) {
      if (staff.length >= 30) fail('A year can have up to 30 staff roles.');
      person = { id: crypto.randomUUID(), label: (w.position || w.name).slice(0, 60), hours: null, sources: [], mode: 'quick', shares: [0, 0, 0, 0], week: [], reviewed: false };
      staff.push(person);
      added += 1;
    }
    Object.assign(person, { planKey: w.key, name: w.name, position: w.position, benefitWeight: weights[i], councilHidden: w.councilHidden });
    if (person.hours == null && w.hours) person.hours = w.hours;
    for (const c of payLines) {
      if (owned.has(c) || data.lines[c] || (data.benefitLines || []).includes(c)) continue;
      person.sources.push(c); owned.add(c);
    }
  });
  const next = { ...data, staff };
  if (!(data.benefitLines || []).length) next.benefitLines = suggestedBenefitLines(next, builder);
  return { data: next, params: { imported: String(added) } };
}

export function applyBenefitLines(data, form, builder) {
  const lines = expenseLines(builder);
  const chosen = [];
  for (let i = 0; i < lines.length; i += 1) if (form[`benefit_${i}`] === lines[i].category) chosen.push(lines[i].category);
  for (const c of chosen) {
    if (data.staff.some((s) => s.sources.includes(c))) fail(`${c} is already linked to one staff role.`);
    if (data.lines[c]) fail(`${c} already has its own mission split. Clear it on Line items by End first.`);
  }
  return { data: { ...data, benefitLines: chosen }, params: {} };
}

// Percentages typed straight into the Line items table. Only rows whose figures changed from what
// the page showed are touched; each keeps its reason. A row typed back to all blanks is cleared.
export function applyLines(data, form, builder) {
  const lines = new Map(expenseLines(builder).map((l) => [l.category, l]));
  const next = { ...data.lines };
  let changed = 0;
  for (let i = 0; i < 2000 && form[`row_${i}`] !== undefined; i += 1) {
    const category = String(form[`row_${i}`]);
    const shares = GOAL_KEYS.map((g) => percent(form[`cell_${i}_${g}`]));
    if (shares.join(',') === String(form[`orig_${i}`] || '')) continue;
    const line = lines.get(category);
    if (!line) fail('The budget lines changed. Reload and try again.');
    if (data.staff.some((s) => s.sources.includes(category)) || (data.benefitLines || []).includes(category)) fail('Staff compensation lines are set on the Staff time page.');
    if (sum(shares) > FULL) fail(`The shares for ${line.name || category} add up to more than 100%.`);
    const note = next[category]?.note || '';
    if (!sum(shares)) delete next[category];
    else next[category] = { method: onlyEnd(shares) >= 0 ? 'one' : 'split', shares, note };
    changed += 1;
  }
  return { data: { ...data, lines: next }, params: { changed: String(changed) } };
}

// Percentages typed straight into the Staff time table (quick splits only; a typical week is
// edited in its own builder).
export function applyStaffShares(data, form) {
  let changed = 0;
  const staff = data.staff.map((s) => ({ ...s }));
  for (let i = 0; i < 60 && form[`srole_${i}`] !== undefined; i += 1) {
    const person = staff.find((s) => s.id === String(form[`srole_${i}`]));
    if (!person) fail('The staff roles changed. Reload and try again.');
    const shares = GOAL_KEYS.map((g) => percent(form[`scell_${i}_${g}`]));
    if (shares.join(',') === String(form[`sorig_${i}`] || '')) continue;
    if (person.mode === 'week') fail(`${person.label}’s time comes from a typical week. Edit it there.`);
    if (sum(shares) > FULL) fail(`${person.label}’s shares add up to more than 100%.`);
    person.shares = shares;
    changed += 1;
  }
  return { data: { ...data, staff }, params: { changed: String(changed) } };
}

function moneyCents(raw, label) {
  const v = String(raw ?? '').replace(/[$,\s]/g, '');
  if (v === '') return null;
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(v)) fail(`${label} must be a dollar amount.`);
  return Math.round(Number(v) * 100);
}
export function applyDistrict(data, form) {
  const whole = (raw, label) => {
    const v = String(raw ?? '').replace(/[,\s]/g, '');
    if (v === '') return null;
    if (!/^\d{1,5}$/.test(v) || Number(v) < 1) fail(`${label} must be a whole number.`);
    return Number(v);
  };
  const benchmarks = DISTRICT_BENCHMARKS.map((b) => ({
    ...b,
    perCongregation: moneyCents(form[`${b.key}_congregation`], `${b.label} per congregation`) ?? b.perCongregation,
    perBaptized: moneyCents(form[`${b.key}_baptized`], `${b.label} per baptized member`) ?? b.perBaptized,
    perConfirmed: moneyCents(form[`${b.key}_confirmed`], `${b.label} per confirmed member`) ?? b.perConfirmed,
  }));
  const baptized = whole(form.baptized, 'Baptized members');
  const confirmed = whole(form.confirmed, 'Confirmed members');
  if (baptized && confirmed && confirmed > baptized) fail('Confirmed members cannot be more than baptized members.');
  return { data: { ...data, district: { baptized, confirmed, benchmarks } }, params: {} };
}

const ACTIONS = {
  district: { run: applyDistrict, page: 'district' },
  lines: { run: applyLines, page: 'mission' },
  'staff-shares': { run: applyStaffShares, page: 'staff-time' },
  line: { run: applyLine, page: 'mission' },
  building: { run: applyBuildingUse, page: 'mission' },
  staff: { run: applyStaff, page: 'staff-time' },
  'staff-add': { run: addStaff, page: 'staff-time' },
  'staff-remove': { run: removeStaff, page: 'staff-time' },
  'staff-import': { run: importStaff, page: 'staff-time' },
  'staff-benefits': { run: applyBenefitLines, page: 'staff-time' },
  story: { run: applyStory, page: 'congregation' },
};

function yearValue(raw) {
  if (!/^20\d{2}$/.test(String(raw))) fail('Choose a fiscal year between 2000 and 2099.');
  return Number(raw);
}

// One change per post, checked against the revision the page was drawn from, then written with an
// atomic compare-and-swap so two people saving at once never lose each other's work.
export async function saveMission(db, form, actor, builder, extras = {}) {
  const action = ACTIONS[form.action];
  if (!action) fail('That change could not be understood. Reload and try again.');
  const year = yearValue(form.target);
  if (builder.targetYear !== year) fail('The requested budget year could not be loaded.');
  const data = await readMission(db, year);
  if (String(data.revision) !== String(form.revision)) fail('Someone else saved mission alignment just now. Reload before editing again.');
  const { stored, ...current } = data;
  const result = action.run(current, form, builder, extras);
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
  document.querySelectorAll('form[data-cells-form]').forEach((cellsForm) => {
    const status = cellsForm.querySelector('[data-cells-status]');
    const idle = status ? status.textContent : '';
    const cells = Array.from(document.querySelectorAll('input.ma-cell[form="' + cellsForm.id + '"]'));
    const rowOf = (n) => cells.filter((c) => c.dataset.cellRow === n);
    const origOf = (n) => {
      const name = n.charAt(0) === 's' ? 'sorig_' + n.slice(1) : 'orig_' + n;
      const el = document.querySelector('input[form="' + cellsForm.id + '"][name="' + name + '"]');
      return el ? el.value : '';
    };
    const updateRow = (n) => {
      const inputs = rowOf(n);
      const shares = inputs.map(pct);
      const total = shares.reduce((a, b) => a + b, 0);
      inputs.forEach((el, i) => {
        el.classList.toggle('is-changed', shares.join(',') !== origOf(n));
        el.classList.toggle('is-over', total > FULL);
        el.setCustomValidity(total > FULL && i === 0 ? 'These shares add up to more than 100%.' : '');
      });
      const tr = inputs[0] && inputs[0].closest('tr');
      if (tr && total) paint(tr.querySelector('.ma-bar'), shares);
    };
    const refresh = () => {
      const changed = new Set(cells.filter((c) => c.classList.contains('is-changed')).map((c) => c.dataset.cellRow)).size;
      const over = new Set(cells.filter((c) => c.classList.contains('is-over')).map((c) => c.dataset.cellRow)).size;
      cellsForm.classList.toggle('is-dirty', changed > 0);
      if (status) status.textContent = over ? over + (over === 1 ? ' row adds' : ' rows add') + ' up to more than 100%.' : changed ? changed + (changed === 1 ? ' row' : ' rows') + ' changed, not saved yet.' : idle;
    };
    cells.forEach((el) => {
      el.addEventListener('input', () => { updateRow(el.dataset.cellRow); refresh(); });
      el.addEventListener('focus', () => el.select());
      el.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); cellsForm.requestSubmit(); } });
    });
    cellsForm.addEventListener('submit', (event) => { if (!cellsForm.reportValidity()) event.preventDefault(); else cellsForm.dataset.sending = '1'; });
    window.addEventListener('beforeunload', (event) => { if (cellsForm.classList.contains('is-dirty') && !cellsForm.dataset.sending) event.preventDefault(); });
  });
  document.querySelectorAll('form[data-ma-week]').forEach((form) => {
    const cents = Number(form.dataset.cents || 0);
    const target = Number(form.dataset.hours || 0);
    const update = () => {
      const direct = [0, 0, 0, 0];
      let spread = 0;
      form.querySelectorAll('[data-week-row]').forEach((row) => {
        const raw = Number(row.querySelector('[data-week-hours]').value) || 0;
        const weeksEl = row.querySelector('[data-week-weeks]');
        const weeks = weeksEl && Number(weeksEl.value) >= 1 && Number(weeksEl.value) < 52 ? Number(weeksEl.value) : 52;
        const h = (raw * weeks) / 52;
        const sel = row.querySelector('[data-week-end]');
        const end = sel.value;
        if (end === 'spread') spread += h;
        else if (['welcome', 'receive', 'grow', 'go'].includes(end)) direct[['welcome', 'receive', 'grow', 'go'].indexOf(end)] += h;
        else if (end.indexOf('line:') === 0) {
          const opt = sel.options[sel.selectedIndex];
          const ls = opt && opt.dataset.shares ? opt.dataset.shares.split(',').map(Number) : null;
          const tot = ls ? ls.reduce((a, b) => a + b, 0) : 0;
          if (!tot) spread += h; else { ls.forEach((bp, i) => { direct[i] += (h * bp) / FULL; }); spread += (h * (FULL - tot)) / FULL; }
        }
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
      if (sumOut) sumOut.textContent = String(Math.round(total * 10) / 10);
      const badge = form.querySelector('[data-week-badge]');
      if (badge) {
        const ok = !target || Math.abs(total - target) < 0.5;
        badge.textContent = !target ? (Math.round(total * 10) / 10) + ' hours' : ok ? 'Matches ' + target + ' hours' : (total > target ? (total - target).toFixed(1).replace(/\.0$/, '') + ' hours over ' : (target - total).toFixed(1).replace(/\.0$/, '') + ' hours under ') + target;
        badge.className = 'ma-badge ' + (ok ? 'ok' : 'warn');
      }
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    update();
  });
}
export const MISSION_LIVE_JS = '(' + missionLive.toString() + ')();';
