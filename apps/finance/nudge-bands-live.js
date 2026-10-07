// Live preview for Giving reports › Nudges and next steps › Regular givers. The page is server-rendered,
// so the weekly increases used to change only after Save. This script (served by this Worker, never
// inline) redraws the band table, its total and the headline figures as an amount is typed, with the
// same arithmetic Connect uses to build the report (api-utils.js: findRegularBand and
// regularBandOptions). It changes what is on screen only; nothing is saved until Save is pressed.
//
// computeBandPreview and formatBandRow are plain functions so they can be tested directly, and the
// server uses them to draw the first view; the served script embeds their source, so each must not
// refer to anything outside itself.

// weekly: whole dollars a week, one per regular household. rawBands: [{ from, step }] as typed, in the
// order of the rows on the page (a row may be blank or unfinished). Returns one entry per row (null
// for a blank or unfinished one) plus the total across the bands.
export function computeBandPreview(weekly, rawBands) {
  const near5 = (x) => Math.round(x / 5) * 5;
  const valid = [];
  rawBands.forEach((b, i) => {
    const blank = b.from === '' || b.from == null || b.step === '' || b.step == null;
    const from = Math.round(Number(b.from));
    const step = Math.round(Number(b.step));
    if (!blank && Number.isFinite(from) && from >= 0 && Number.isFinite(step) && step >= 1 && step <= 5000) valid.push({ i, from, step });
  });
  const seen = {};
  const bands = valid.sort((x, y) => x.from - y.from || x.i - y.i).filter((v) => (seen[v.from] ? false : (seen[v.from] = true)));
  const rows = rawBands.map(() => null);
  const total = { count: 0, modest: 0, generous: 0 };
  bands.forEach((v, k) => {
    // The lowest band always reaches down to $0; each other band runs to the next one.
    const lo = k === 0 ? 0 : v.from;
    const hi = k + 1 < bands.length ? bands[k + 1].from - 1 : null;
    const inBand = weekly.filter((w) => w >= lo && (hi === null || w <= hi));
    const modest = Math.min(v.step, Math.max(5, near5(v.step * 0.4)));
    const generous = Math.max(v.step, near5(v.step * 1.6));
    const row = {
      from: lo, to: hi, step: v.step, count: inBand.length,
      nowMin: inBand.length ? Math.min.apply(null, inBand) : 0, nowMax: inBand.length ? Math.max.apply(null, inBand) : 0,
      modestYear: inBand.length * modest * 52, generousYear: inBand.length * generous * 52,
    };
    rows[v.i] = row;
    total.count += row.count; total.modest += row.modestYear; total.generous += row.generousYear;
  });
  return { rows, total };
}

// The text of one row's figures, exactly as the server draws them.
export function formatBandRow(row) {
  const dollars = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const added = (lo, hi) => (lo === hi ? '+' + dollars(lo) : '+' + dollars(lo) + '–' + dollars(hi));
  if (!row) return { count: '—', now: '', typical: '', added: '' };
  return {
    count: String(row.count),
    now: row.count ? dollars(row.nowMin) + '–' + dollars(row.nowMax) + '/wk' : '—',
    typical: '+' + dollars(row.step) + '/wk',
    added: row.count ? added(row.modestYear, row.generousYear) : '—',
  };
}

const DOM_GLUE = `
(function () {
  var table = document.querySelector('table[data-nudge-bands]');
  if (!table) return;
  var weekly;
  try { weekly = JSON.parse(table.getAttribute('data-weekly') || '[]'); } catch (e) { return; }
  var rows = [].slice.call(table.querySelectorAll('tr[data-band-row]'));
  var note = document.querySelector('[data-live-note]');
  var original = rows.map(function (r) { return r.querySelector('[data-band-from]').value + '|' + r.querySelector('[data-band-step]').value; }).join(',');
  function dollars(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function added(lo, hi) { return lo === hi ? '+' + dollars(lo) : '+' + dollars(lo) + '\\u2013' + dollars(hi); }
  function put(scope, col, text) { var cell = scope.querySelector('[data-col="' + col + '"]'); if (cell) cell.textContent = text; }
  function recompute() {
    var raw = rows.map(function (r) { return { from: r.querySelector('[data-band-from]').value, step: r.querySelector('[data-band-step]').value }; });
    var out = computeBandPreview(weekly, raw);
    rows.forEach(function (r, i) {
      var f = formatBandRow(out.rows[i]);
      put(r, 'count', f.count); put(r, 'now', f.now); put(r, 'typical', f.typical); put(r, 'added', f.added);
    });
    var tot = table.querySelector('[data-band-total]');
    if (tot) { put(tot, 'count', String(out.total.count)); put(tot, 'added', added(out.total.modest, out.total.generous)); }
    var headline = document.querySelector('[data-live-headline]');
    if (headline) headline.textContent = added(+headline.getAttribute('data-rest-modest') + out.total.modest, +headline.getAttribute('data-rest-generous') + out.total.generous);
    var reg = document.querySelector('[data-live-regular-added]');
    if (reg) reg.textContent = added(out.total.modest, out.total.generous);
    var all = document.querySelector('[data-live-total-added]');
    if (all) all.textContent = added(+all.getAttribute('data-rest-modest') + out.total.modest, +all.getAttribute('data-rest-generous') + out.total.generous);
    var now = rows.map(function (r) { return r.querySelector('[data-band-from]').value + '|' + r.querySelector('[data-band-step]').value; }).join(',');
    if (note) note.hidden = now === original;
  }
  table.addEventListener('input', function (event) {
    if (event.target && event.target.hasAttribute && (event.target.hasAttribute('data-band-from') || event.target.hasAttribute('data-band-step'))) recompute();
  });
})();
`;

export const NUDGE_BANDS_LIVE_JS = `var computeBandPreview = (${computeBandPreview.toString()});\nvar formatBandRow = (${formatBandRow.toString()});\n${DOM_GLUE}`;

// A short stamp of the script, so a browser fetches it again whenever it changes.
export const NUDGE_BANDS_LIVE_VERSION = (() => {
  let h = 0;
  for (let i = 0; i < NUDGE_BANDS_LIVE_JS.length; i += 1) h = (h * 31 + NUDGE_BANDS_LIVE_JS.charCodeAt(i)) >>> 0;
  return h.toString(36);
})();
