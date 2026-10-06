import { FINANCE_PARITY_SECTIONS } from './parity-manifest.js';

// "Final report": each person's own ordered list of the report screens to print together. It lives
// in Finance's finance_settings table under a key per person, so one person's list never shows up
// for another. An item is a section, a page and the few view settings (year, period, columns) the
// screen was showing when it was added; the print re-reads each screen with the viewer's own role,
// so the list can never print something its owner may not see.
export const SELECTION_KEY_PREFIX = 'board_final_report_';
export const SELECTION_MAX = 40;
// Reports that can be added: the ones the board packet already knows how to print.
export const SELECTABLE_SECTIONS = Object.freeze(['health', 'charts', 'church', 'attendance', 'balance', 'daycare', 'property', 'planning', 'giving-analytics']);
const ONLY_PAGES = { planning: ['builder'] };
// View settings a screen may carry into the list (everything else, such as status messages, is dropped).
const ALLOWED_PARAMS = ['fiscal_year', 'year', 'period', 'lens', 'view', 'print_mode', 'target', 'base', 'cols', 'x', 'f', 'zero', 'hidden', 'rent_growth', 'extra', 'compact'];

export function selectionOwner(roleResult) {
  const who = roleResult && roleResult.ok ? String(roleResult.username || roleResult.identity || '') : '';
  return /^[\w.@+-]{1,120}$/.test(who) ? who : '';
}

export function isSelectable(sectionId, pageId = null) {
  if (!SELECTABLE_SECTIONS.includes(sectionId)) return false;
  const section = FINANCE_PARITY_SECTIONS.find((s) => s.id === sectionId);
  if (!section) return false;
  if (pageId == null) return true;
  const page = section.pages.find((p) => p.id === pageId);
  return Boolean(page) && page.status === 'live' && (!ONLY_PAGES[sectionId] || ONLY_PAGES[sectionId].includes(pageId));
}

function cleanQuery(sectionId, pageId, rawQuery) {
  const source = new URLSearchParams(rawQuery || '');
  const out = new URLSearchParams();
  for (const key of ALLOWED_PARAMS) {
    for (const value of source.getAll(key)) {
      const v = String(value).slice(0, 200);
      if (v) out.append(key, v);
    }
  }
  // The Budget goes in as this year only unless the screen asked otherwise.
  if (sectionId === 'planning' && pageId === 'builder' && !out.has('print_mode')) out.set('print_mode', 'thisyear');
  return out.toString().slice(0, 600);
}

export function itemId(item) { return `${item.section}|${item.page}|${item.query}`; }

export function itemLabel(item) {
  const section = FINANCE_PARITY_SECTIONS.find((s) => s.id === item.section);
  const page = section?.pages.find((p) => p.id === item.page);
  const q = new URLSearchParams(item.query);
  const year = q.get('fiscal_year') || q.get('year');
  const head = section && page ? (section.pages.length > 1 ? `${section.label}: ${page.label}` : section.label) : `${item.section}: ${item.page}`;
  return `${head}${year ? ` · ${year}` : ''}${item.section === 'planning' && q.get('print_mode') === 'thisyear' ? ' · this year only' : ''}`;
}

export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const section = String(raw.section || '');
  const page = String(raw.page || '');
  if (!isSelectable(section, page)) return null;
  return { section, page, query: cleanQuery(section, page, raw.query) };
}

export async function readSelection(db, owner) {
  if (!db || !owner) return [];
  try {
    const row = await db.prepare('SELECT value FROM finance_settings WHERE key = ?').bind(`${SELECTION_KEY_PREFIX}${owner}`).first();
    const parsed = row && row.value ? JSON.parse(row.value) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeItem).filter(Boolean).slice(0, SELECTION_MAX) : [];
  } catch {
    return [];
  }
}

async function writeSelection(db, owner, items) {
  await db.prepare('INSERT INTO finance_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(`${SELECTION_KEY_PREFIX}${owner}`, JSON.stringify(items)).run();
}

// Applies one change (add, remove, up, down, clear) to the owner's list. `canSee(sectionId)` is the
// caller's role check, so a person can only add a report they are allowed to open.
export async function changeSelection(db, owner, form, canSee = () => true) {
  if (!db) return { ok: false, status: 503, error: 'Finance database is not available.' };
  if (!owner) return { ok: false, status: 403, error: 'This account has no name to keep a final report under.' };
  const action = String(form.action || '');
  const items = await readSelection(db, owner);
  let next = items;
  if (action === 'add') {
    const item = normalizeItem({ section: form.section, page: form.page, query: form.query });
    if (!item) return { ok: false, status: 400, error: 'That report cannot be added to the final report.' };
    if (!canSee(item.section)) return { ok: false, status: 403, error: 'You do not have access to that report.' };
    if (items.some((x) => itemId(x) === itemId(item))) return { ok: true, items };
    if (items.length >= SELECTION_MAX) return { ok: false, status: 400, error: `The final report holds at most ${SELECTION_MAX} pages.` };
    next = [...items, item];
  } else if (action === 'remove') {
    next = items.filter((x) => itemId(x) !== String(form.id || ''));
  } else if (action === 'up' || action === 'down') {
    const i = items.findIndex((x) => itemId(x) === String(form.id || ''));
    const j = action === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= items.length) return { ok: true, items };
    next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
  } else if (action === 'clear') {
    next = [];
  } else {
    return { ok: false, status: 400, error: 'Unknown change.' };
  }
  await writeSelection(db, owner, next);
  return { ok: true, items: next };
}
