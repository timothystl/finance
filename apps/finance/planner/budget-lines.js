// Works out which budget lines "Send to budget" fills, and with what. Salaries go to each worker's
// own salary line (matched by account code, as the planner reads current pay); pension, health,
// disability, FICA and mileage go to the base-year budget's line for each. A line the plan cannot
// place is left as it is and reported, so nothing is double counted or guessed.
const KINDS = [
  ['pension', /pension|retirement/i],
  ['health', /health|medical|dental|vision/i],
  ['disability', /disabilit/i],
  ['fica', /\bfica\b|social security|payroll tax/i],
  ['mileage', /mileage|\b(auto|car|vehicle)\b.*\b(allowance|reimb)|\btravel\b.*\b(allowance|reimb)/i],
];
const SALARY_RE = /salar|payroll|compensation|wages/i;
const BENEFIT_RE = /health|medical|dental|vision|disabilit|pension|retirement|\bfica\b|social security|tax/i;

export const KIND_LABELS = { pension: 'pension', health: 'health', disability: 'disability', fica: 'FICA', mileage: 'mileage' };

function leaves(tree) {
  const out = [];
  (function walk(nodes) {
    (nodes || []).forEach((n) => { if (!n.children.length && n.classification !== 'Income') out.push(n); walk(n.children); });
  })(tree);
  return out;
}

const kindOf = (label) => { const hit = KINDS.find(([, re]) => re.test(label)); return hit ? hit[0] : ''; };

// m: the compensation model; computed: m.computeAll(); tree: the base-year ledger tree (or null);
// fallbackSalaryPath: the single line to use for all pay when no worker has an account code.
export function planBudgetLines(m, computed, tree, fallbackSalaryPath) {
  const all = leaves(tree);
  const salaryLeaves = all.filter((n) => SALARY_RE.test(n.label || '') && !BENEFIT_RE.test(n.label || ''));
  const payLeaves = all.filter((n) => !kindOf(n.label || ''));
  const entries = m.countedEntries();
  const rows = [];
  const placed = new Set();

  // Pay: each salary line gets the pay of the workers whose account code it carries.
  const byLeaf = new Map();
  let salaryPlaced = 0;
  entries.forEach(({ w, i }) => {
    const code = String(w.accountCode || '').trim();
    if (!code) return;
    // A worker's own account code is enough to find their line; the line need not say "salary".
    const leaf = payLeaves.find((n) => n.path.indexOf(code) >= 0 || (n.label || '').indexOf(code) >= 0);
    if (!leaf) return;
    byLeaf.set(leaf, (byLeaf.get(leaf) || 0) + computed[i].salaryCents);
    salaryPlaced += computed[i].salaryCents;
  });
  byLeaf.forEach((cents, leaf) => { rows.push({ category: leaf.path, label: leaf.label, kind: 'salary', cents }); placed.add(leaf.path); });
  const totalSalary = entries.reduce((t, { i }) => t + computed[i].salaryCents, 0);
  // Pay nobody's code placed goes to the remembered salary line, else the first salary-named line (as legacy did).
  const target = fallbackSalaryPath || (salaryLeaves[0] ? salaryLeaves[0].path : '');
  const unplacedSalary = totalSalary - salaryPlaced;
  if (unplacedSalary > 0 && target && !placed.has(target)) {
    const node = all.find((n) => n.path === target);
    rows.push({ category: target, label: node ? node.label : target, kind: 'salary', cents: unplacedSalary });
    placed.add(target);
  }

  // Benefits: one budget line per kind, filled from the plan's breakdown.
  const breakdown = m.benefitBreakdown(computed);
  const unplaced = [];
  // Several lines can look alike (a ministry's own "Payroll Taxes" beside the staff one), so the
  // lines are chosen from the section most of the benefit lines sit in.
  const parentOf = (n) => n.path.split(':').slice(0, -1).join(':');
  const wanted = breakdown.rows.filter((r) => r.cents);
  const counts = {};
  wanted.forEach((r) => {
    const first = all.find((n) => kindOf(n.label || '') === r.key);
    if (first) counts[parentOf(first)] = (counts[parentOf(first)] || 0) + 1;
  });
  const home = Object.keys(counts).sort((x, y) => counts[y] - counts[x])[0];
  wanted.forEach((r) => {
    const open = all.filter((n) => !placed.has(n.path) && kindOf(n.label || '') === r.key);
    const leaf = open.find((n) => parentOf(n) === home) || open[0];
    if (leaf) { rows.push({ category: leaf.path, label: leaf.label, kind: r.key, cents: r.cents }); placed.add(leaf.path); }
    else unplaced.push(r.key);
  });
  const missingSalary = Math.max(0, totalSalary - rows.filter((r) => r.kind === 'salary').reduce((t, r) => t + r.cents, 0));
  if (missingSalary > 0) unplaced.unshift('salary');
  return { rows, unplaced, totalCents: rows.reduce((t, r) => t + r.cents, 0) };
}
