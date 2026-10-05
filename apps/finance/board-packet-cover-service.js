import { COVER_NOTE_MAX, COVER_TEMPLATE_KEY } from './print-pages.js';

// The board packet's monthly cover-letter template lives in Finance's own finance_settings table.
// Returns null when nothing is saved (or the database cannot be read) so the caller shows the starter letter.
export async function readCoverTemplate(db) {
  if (!db) return null;
  try {
    const row = await db.prepare('SELECT value FROM finance_settings WHERE key=?').bind(COVER_TEMPLATE_KEY).first();
    return row && typeof row.value === 'string' && row.value.trim() ? row.value : null;
  } catch {
    return null;
  }
}

export async function saveCoverTemplate(db, text) {
  if (!db) return { ok: false, status: 503, error: 'Finance database is not available.' };
  const value = String(text || '').slice(0, COVER_NOTE_MAX).trim();
  await db.prepare('INSERT INTO finance_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .bind(COVER_TEMPLATE_KEY, value).run();
  return { ok: true };
}
