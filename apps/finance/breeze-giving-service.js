import { ensureFinanceOwnedSchema } from './finance-owned-schema.js';
import { BreezeError, makeBreezeClient } from './breeze-client.js';

// Side-by-side copy of Breeze's giving into Finance's own tables (finance_breeze_*), so Finance's
// monthly totals can be checked against Connect's before Finance takes giving over. Connect stays
// the authoritative record. The copy keeps no names. One year is read a month at a time (Breeze
// caps a single answer, and a capped answer would silently drop gifts), and within each month the
// copy is made to match Breeze exactly: gifts Breeze still lists are added or corrected, and gifts
// Breeze no longer lists (deleted there) are removed.
const MONTH_LIMIT = 10000;
const BATCH_SIZE = 90;

const pad = (n) => String(n).padStart(2, '0');
export function monthRange(year, month) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(last)}` };
}

function toCents(value) {
  if (value == null || value === '') return null;
  const n = Number.parseFloat(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

// One Breeze giving/list record -> a gift, or null when it has no usable id, date or amount.
export function normalizeBreezeGift(record) {
  if (!record || typeof record !== 'object') return null;
  const paymentId = String(record.id ?? '').trim();
  const paidOn = String(record.paid_on || record.date || '').slice(0, 10);
  const amountCents = toCents(record.amount);
  if (!paymentId || !/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || amountCents === null) return null;
  const rawFunds = Array.isArray(record.funds) ? record.funds
    : (record.fund && typeof record.fund === 'object' ? [record.fund]
      : (record.fund_id ? [{ fund_id: record.fund_id, name: record.fund_name || '' }] : []));
  let funds = rawFunds.map((f) => ({
    fundRef: String(f.fund_id ?? f.id ?? '').slice(0, 40),
    fundName: String(f.name || f.fund_name || '').slice(0, 120),
    amountCents: toCents(f.amount),
  }));
  if (funds.length === 0) funds = [{ fundRef: '', fundName: '', amountCents }];
  if (funds.length === 1 || funds.every((f) => f.amountCents === null)) {
    funds = funds.map((f, i) => ({ ...f, amountCents: i === 0 ? amountCents : 0 }));
  } else {
    funds = funds.map((f) => ({ ...f, amountCents: f.amountCents ?? 0 }));
  }
  return {
    paymentId, paidOn, amountCents,
    personRef: String(record.person_id ?? '').slice(0, 40),
    method: String(record.method || '').slice(0, 40),
    feeCents: toCents(record.fee),
    funds,
  };
}

async function runBatches(db, statements) {
  for (let i = 0; i < statements.length; i += BATCH_SIZE) await db.batch(statements.slice(i, i + BATCH_SIZE));
}

// Makes one month of the copy match Breeze's answer for that month.
async function syncMonth(db, gifts, { start, end }, syncedAt) {
  const existingRows = (await db.prepare('SELECT payment_id, paid_on, amount_cents FROM finance_breeze_gifts WHERE paid_on BETWEEN ? AND ?').bind(start, end).all()).results || [];
  const existing = new Map(existingRows.map((r) => [r.payment_id, r]));
  const seen = new Set(gifts.map((g) => g.paymentId));
  let added = 0;
  let updated = 0;
  const statements = [];
  for (const g of gifts) {
    const was = existing.get(g.paymentId);
    if (!was) added += 1;
    else if (was.paid_on !== g.paidOn || was.amount_cents !== g.amountCents) updated += 1;
    statements.push(db.prepare(`INSERT INTO finance_breeze_gifts (payment_id, person_ref, paid_on, amount_cents, method, fee_cents, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(payment_id) DO UPDATE SET person_ref = excluded.person_ref, paid_on = excluded.paid_on, amount_cents = excluded.amount_cents,
        method = excluded.method, fee_cents = excluded.fee_cents, synced_at = excluded.synced_at`)
      .bind(g.paymentId, g.personRef, g.paidOn, g.amountCents, g.method, g.feeCents, syncedAt));
    statements.push(db.prepare('DELETE FROM finance_breeze_gift_funds WHERE payment_id = ?').bind(g.paymentId));
    for (const f of g.funds) {
      statements.push(db.prepare('INSERT INTO finance_breeze_gift_funds (payment_id, fund_ref, fund_name, amount_cents) VALUES (?, ?, ?, ?)')
        .bind(g.paymentId, f.fundRef, f.fundName, f.amountCents));
    }
  }
  const gone = existingRows.filter((r) => !seen.has(r.payment_id));
  for (const r of gone) {
    statements.push(db.prepare('DELETE FROM finance_breeze_gift_funds WHERE payment_id = ?').bind(r.payment_id));
    statements.push(db.prepare('DELETE FROM finance_breeze_gifts WHERE payment_id = ?').bind(r.payment_id));
  }
  await runBatches(db, statements);
  return { added, updated, removed: gone.length };
}

// Reads one year (January to the end of this month, if it is the current year) and records the run.
export async function syncBreezeGivingYear(env, db, { year, runBy = '', now = new Date(), fetchImpl } = {}) {
  if (!db) return { ok: false, status: 503, error: 'Finance database is not available.' };
  const breeze = makeBreezeClient(env, fetchImpl ? { fetchImpl } : {});
  if (!breeze) return { ok: false, status: 503, error: 'Breeze is not connected to Finance yet (the Breeze subdomain and key have not been added).' };
  if (!Number.isInteger(year) || year < 2000 || year > now.getUTCFullYear()) return { ok: false, status: 400, error: 'Choose a year from 2000 to this year.' };
  if (!(await ensureFinanceOwnedSchema(db, 'breezeGiving'))) return { ok: false, status: 503, error: 'Finance could not prepare its Breeze tables.' };

  const lastMonth = year === now.getUTCFullYear() ? now.getUTCMonth() + 1 : 12;
  const startedAt = now.toISOString();
  const rangeStart = `${year}-01-01`;
  const rangeEnd = monthRange(year, lastMonth).end;
  const total = { fetched: 0, added: 0, updated: 0, removed: 0 };
  const warnings = [];
  let failure = '';

  for (let month = 1; month <= lastMonth && !failure; month += 1) {
    const range = monthRange(year, month);
    let list;
    try {
      list = await breeze.givingList({ ...range, limit: MONTH_LIMIT });
    } catch (error) {
      failure = error instanceof BreezeError ? error.message : 'Breeze could not be read.';
      break;
    }
    if (!Array.isArray(list)) { failure = `Breeze sent an unexpected answer for ${range.start.slice(0, 7)}.`; break; }
    if (list.length >= MONTH_LIMIT) { failure = `${range.start.slice(0, 7)} has more gifts than one Breeze answer can hold, so nothing more was copied.`; break; }
    const gifts = [];
    let skipped = 0;
    const byId = new Map();
    for (const record of list) {
      const gift = normalizeBreezeGift(record);
      if (!gift || gift.paidOn < range.start || gift.paidOn > range.end) { skipped += 1; continue; }
      byId.set(gift.paymentId, gift);
    }
    gifts.push(...byId.values());
    if (skipped) warnings.push(`${range.start.slice(0, 7)}: ${skipped} Breeze record${skipped === 1 ? '' : 's'} left out (no date, amount or id, or outside the month).`);
    // An empty answer for a month that already has gifts copied is more likely a Breeze hiccup than
    // every gift being deleted, so the month is left alone rather than emptied.
    if (gifts.length === 0) {
      const have = await db.prepare('SELECT COUNT(*) AS n FROM finance_breeze_gifts WHERE paid_on BETWEEN ? AND ?').bind(range.start, range.end).first();
      if (have && have.n > 0) { warnings.push(`${range.start.slice(0, 7)}: Breeze listed no gifts, but ${have.n} are already copied, so that month was left unchanged.`); continue; }
    }
    total.fetched += gifts.length;
    const changes = await syncMonth(db, gifts, range, startedAt);
    total.added += changes.added; total.updated += changes.updated; total.removed += changes.removed;
  }

  const sum = await db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM finance_breeze_gifts WHERE paid_on BETWEEN ? AND ?').bind(rangeStart, rangeEnd).first();
  const status = failure ? 'failed' : (warnings.length ? 'warnings' : 'ok');
  const message = [failure, ...warnings].filter(Boolean).join(' ').slice(0, 1500);
  await db.prepare(`INSERT INTO finance_breeze_sync_runs (started_at, finished_at, range_start, range_end, fetched, added, updated, removed, total_cents, status, message, run_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(startedAt, new Date().toISOString(), rangeStart, rangeEnd, total.fetched, total.added, total.updated, total.removed, sum?.cents || 0, status, message, String(runBy).slice(0, 120)).run();
  return failure ? { ok: false, status: 502, error: failure, ...total } : { ok: true, status, message, ...total, totalCents: sum?.cents || 0 };
}

export async function readLastBreezeRuns(db, limit = 5) {
  if (!db || !(await ensureFinanceOwnedSchema(db, 'breezeGiving'))) return [];
  try {
    return (await db.prepare('SELECT * FROM finance_breeze_sync_runs ORDER BY id DESC LIMIT ?').bind(limit).all()).results || [];
  } catch { return []; }
}

// Finance's copy: total cents and gift count for each month (index 0 = January) of a year.
export async function readCopyMonthly(db, year) {
  const cents = new Array(12).fill(0);
  const gifts = new Array(12).fill(0);
  if (!db || !(await ensureFinanceOwnedSchema(db, 'breezeGiving'))) return { cents, gifts, hasData: false };
  try {
    const rows = (await db.prepare(`SELECT CAST(substr(paid_on, 6, 2) AS INTEGER) AS m, SUM(amount_cents) AS cents, COUNT(*) AS n
      FROM finance_breeze_gifts WHERE paid_on BETWEEN ? AND ? GROUP BY m`).bind(`${year}-01-01`, `${year}-12-31`).all()).results || [];
    for (const r of rows) { cents[r.m - 1] = r.cents; gifts[r.m - 1] = r.n; }
    return { cents, gifts, hasData: rows.length > 0 };
  } catch { return { cents, gifts, hasData: false }; }
}

// Finance's copy against Connect's monthly totals. A month "matches" only when the two agree to the cent.
export function buildReconciliation({ copy, connectMonthlyCents, year, now = new Date() }) {
  const lastMonth = year === now.getUTCFullYear() ? now.getUTCMonth() + 1 : 12;
  const months = [];
  for (let i = 0; i < lastMonth; i += 1) {
    const connect = Array.isArray(connectMonthlyCents) && Number.isInteger(connectMonthlyCents[i]) ? connectMonthlyCents[i] : null;
    const finance = copy.cents[i];
    months.push({ month: i + 1, financeCents: finance, gifts: copy.gifts[i], connectCents: connect, differenceCents: connect === null ? null : finance - connect, matches: connect !== null && finance === connect });
  }
  const sum = (key) => months.reduce((s, m) => s + (m[key] || 0), 0);
  const connectKnown = months.every((m) => m.connectCents !== null);
  return {
    year, months, financeCents: sum('financeCents'), gifts: sum('gifts'),
    connectCents: connectKnown ? sum('connectCents') : null,
    differenceCents: connectKnown ? sum('financeCents') - sum('connectCents') : null,
    allMatch: connectKnown && months.every((m) => m.matches),
  };
}

// ── Which gifts differ ──────────────────────────────────────────────────────────────────────
// For one month: Finance's copy of Breeze, line by line (one line per fund a gift was split across),
// against Connect's gift lines for the same days. Lines are matched by day and amount, as many times
// as each appears, so what is left over on either side is exactly the gifts the two disagree about.
// Connect's list carries donor names; they are never shown here, only the day, amount, fund and method.
export async function readCopyLines(db, year, month) {
  const { start, end } = monthRange(year, month);
  if (!db || !(await ensureFinanceOwnedSchema(db, 'breezeGiving'))) return [];
  try {
    return (await db.prepare(`SELECT g.payment_id, g.person_ref, g.paid_on, g.method, f.fund_name, f.amount_cents
      FROM finance_breeze_gifts g JOIN finance_breeze_gift_funds f ON f.payment_id = g.payment_id
      WHERE g.paid_on BETWEEN ? AND ? ORDER BY g.paid_on, g.payment_id`).bind(start, end).all()).results || [];
  } catch { return []; }
}

export function diffGiftLines({ copyLines, connectRows }) {
  const key = (day, cents) => `${day}|${cents}`;
  const connect = new Map();
  for (const r of connectRows) {
    const k = key(String(r.gift_date || '').slice(0, 10), r.amount);
    (connect.get(k) || connect.set(k, []).get(k)).push(r);
  }
  const onlyInBreeze = [];
  const possibleDuplicates = new Set();
  const seenGift = new Map();
  for (const line of copyLines) {
    const k = key(line.paid_on, line.amount_cents);
    const bucket = connect.get(k);
    if (bucket && bucket.length) bucket.pop();
    else onlyInBreeze.push(line);
    const sameGift = `${line.person_ref}|${k}`;
    if (seenGift.has(sameGift) && seenGift.get(sameGift) !== line.payment_id) { possibleDuplicates.add(line.payment_id); possibleDuplicates.add(seenGift.get(sameGift)); }
    else seenGift.set(sameGift, line.payment_id);
  }
  const onlyInConnect = [...connect.values()].flat();
  return {
    onlyInBreeze: onlyInBreeze.map((l) => ({ paymentId: l.payment_id, day: l.paid_on, cents: l.amount_cents, method: l.method, fund: l.fund_name, possibleDuplicate: possibleDuplicates.has(l.payment_id) })),
    onlyInConnect: onlyInConnect.map((r) => ({ day: String(r.gift_date || '').slice(0, 10), cents: r.amount, method: r.method || '', fund: r.fund_name || '', processor: r.processor || '' })),
  };
}
