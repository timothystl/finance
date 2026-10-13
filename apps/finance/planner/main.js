// Compensation Planner — Finance's own, running on Compensation → Planner.
//
// The same five views, figures and wording as the legacy planner in Connect, rebuilt as Finance
// code: every figure comes from compensation-projection.js (the model Finance's other
// Compensation pages already use, tested against legacy), state and saving live in state.js, and
// every change is an entry in actions.js. The page keeps legacy's feel: the whole view re-renders
// on every change, typing keeps its focus and caret, and changes autosave after a short pause.
import { S, model, load, scheduleSave, saveNow, savePending, flushOnExit, onSaveStatus, baseYear, targetYear } from './state.js';
import { ACTIONS } from './actions.js';
import { planBudgetLines, KIND_LABELS } from './budget-lines.js';
import { allowed } from './ui.js';
import { sanitizeDecimal, sanitizeWholeDollar, esc, money } from './format.js';
import { headerHtml, emptyRosterHtml, renderPlan } from './view-plan.js';
import { renderFairness, renderHealth, renderRates, renderCouncil } from './view-other.js';

let root;

function body() {
  if (!S.loaded) return S.error ? '<p class="status status-error">The planner could not load: ' + esc(S.error) + '</p>' : '<p class="status status-pending">Loading the compensation plan…</p>';
  const roster = S.plan.roster;
  if (!roster.length) return emptyRosterHtml(model());
  if (S.selected >= roster.length) S.selected = roster.length - 1;
  // The Council summary shows what a council audience sees, header strip included, so the two
  // never disagree on one screen.
  const council = S.view === 'council';
  const m = model({ council });
  const computed = m.computeAll();
  const totals = m.totals(computed);
  let view;
  if (S.view === 'fairness') view = renderFairness(m, computed);
  else if (S.view === 'health') view = renderHealth(m, computed, totals);
  else if (S.view === 'rates') view = renderRates(m);
  else if (council) view = renderCouncil(m, computed, totals);
  else view = renderPlan(m, computed, totals);
  return headerHtml(m, totals) + view;
}

// Re-render, putting focus, caret and scroll back where they were (legacy
// finRerenderPlanningPreserveFocus).
function render() {
  const active = document.activeElement;
  const activeId = active && root.contains(active) ? active.id : '';
  const activeValue = activeId && typeof active.value === 'string' ? active.value : null;
  const selStart = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  const selEnd = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
  const scrollY = window.scrollY;
  const scrollers = [...root.querySelectorAll('.fin-comp-scroll')].map((el) => el.scrollLeft);
  root.innerHTML = body();
  root.querySelectorAll('.fin-comp-scroll').forEach((el, i) => { if (scrollers[i] != null) el.scrollLeft = scrollers[i]; });
  if (activeId) {
    const restored = document.getElementById(activeId);
    if (restored) {
      restored.focus({ preventScroll: true });
      // What was typed stays as typed ("-", "3.", a half-entered figure) even when the saved value
      // it produced renders differently.
      if (activeValue != null && restored.value !== activeValue) restored.value = activeValue;
      if (selStart != null && restored.setSelectionRange) {
        try { restored.setSelectionRange(selStart, selEnd); } catch { /* not a text input */ }
      }
    }
  }
  window.scrollTo(0, scrollY);
}

function updateSaveStatus() {
  const el = root.querySelector('.fin-comp-actions');
  if (!el) return;
  const old = el.querySelector('.fin-comp-save');
  const html = S.saveState === 'saving' ? 'Saving…' : S.saveState === 'saved' ? 'Saved automatically.'
    : S.saveState === 'draft' ? 'Saved to your council draft.' : esc(S.saveState);
  if (!S.saveState) { if (old) old.remove(); return; }
  const span = old || document.createElement('span');
  span.className = 'fin-comp-save' + (['saving', 'saved', 'draft'].includes(S.saveState) ? '' : ' err');
  span.innerHTML = html;
  if (!old) el.prepend(span);
}

function run(name, el, value) {
  const a = ACTIONS[name];
  if (!a || !allowed(a.who)) return;
  if (a.confirm && !window.confirm(a.confirm(el.dataset))) return;
  a.run(el.dataset, value, el);
  if (a.save) scheduleSave();
  if (!a.quiet) render();
}

// Opens the printable Council report after any pending change is saved, so it prints what is on
// screen. The window is opened first, inside the click, so no popup blocker stops it.
function printCouncil(el) {
  const href = el.getAttribute('href');
  if (!savePending()) { window.open(href, '_blank', 'noopener'); return; }
  const win = window.open('about:blank', '_blank');
  saveNow().then(() => { if (win) win.location.href = href; else window.location.href = href; });
}

// Writes the plan into the target year's budget: each worker's pay on their own salary line and
// pension, health, disability, FICA and mileage on theirs, the same save the Budget builder makes.
// Says plainly what landed where and what it could not place.
let sending = false;
async function sendToBudget() {
  if (sending) return;
  const year = targetYear();
  const m = model();
  const plan = planBudgetLines(m, m.computeAll(), S.baseTree, S.targetCategory);
  if (!plan.rows.length) {
    S.toast = 'No salary or benefit lines found in the FY' + baseYear() + ' budget to send this to.';
    render();
    return;
  }
  sending = true;
  S.toast = 'Sending to the FY' + year + ' budget…';
  render();
  try {
    for (const r of plan.rows) {
      const res = await fetch('/api/v1/connect-budget-plan-write', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          category: r.category, fiscal_year: year, classification: 'Expenses',
          planned_amount: Math.round(r.cents / 100), notes: 'Sent from the Compensation Planner',
        }),
      });
      let body = {};
      try { body = await res.json(); } catch { body = {}; }
      if (!res.ok || body.ok === false) throw new Error((r.label || r.category) + ': ' + (body.message || 'the budget did not accept it (' + res.status + ')'));
    }
    const lines = plan.rows.map((r) => r.label + ' ' + money(r.cents)).join('; ');
    const left = plan.unplaced.length
      ? ' No budget line was found for ' + plan.unplaced.map((k) => KIND_LABELS[k] || k).join(', ') + ', so those were left alone.'
      : '';
    S.toast = 'Sent to the FY' + year + ' budget: ' + lines + '.' + left + ' Open Planning → Budget builder to see it.';
  } catch (err) {
    S.toast = 'Not finished: ' + ((err && err.message) || 'the budget could not be reached') + '. Lines sent before this one are already saved.';
  }
  sending = false;
  render();
}

function onClick(event) {
  const el = event.target.closest('[data-act]');
  if (!el || !root.contains(el)) return;
  event.preventDefault();
  if (el.dataset.act === 'printCouncil') { printCouncil(el); return; }
  if (el.dataset.act === 'sendToBudget') { sendToBudget(); return; }
  run(el.dataset.act, el);
}

function onKey(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const el = event.target.closest('[data-act]');
  if (!el || !root.contains(el) || /^(A|BUTTON|INPUT|SELECT)$/.test(el.tagName)) return;
  event.preventDefault();
  run(el.dataset.act, el);
}

function onInput(event) {
  const el = event.target;
  const name = el.dataset && el.dataset.input;
  if (!name) return;
  const how = el.dataset.sanitize;
  const value = how === 'decimal' ? sanitizeDecimal(el) : how === 'whole' ? sanitizeWholeDollar(el) : el.value;
  run(name, el, value);
}

function onChange(event) {
  const el = event.target;
  const name = el.dataset && el.dataset.change;
  if (!name) return;
  run(name, el, el.type === 'checkbox' ? el.checked : el.value);
}

async function boot() {
  root = document.getElementById('cp-root');
  const cfgEl = document.getElementById('cp-config');
  if (!root || !cfgEl) return;
  S.config = JSON.parse(cfgEl.textContent);
  if (!S.config.targetYear) S.config.targetYear = S.config.baseYear + 1;
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  window.addEventListener('pagehide', flushOnExit);
  onSaveStatus(updateSaveStatus);
  render();
  try {
    await load();
  } catch (err) {
    S.error = (err && err.message) || String(err);
  }
  render();
}

boot();
