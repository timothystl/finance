import { describe, it, expect } from 'vitest';
import { planBudgetLines } from '../apps/finance/planner/budget-lines.js';

const leaf = (path, label) => ({ path, label, classification: 'Expenses', children: [] });
const tree = [
  { path: 'E', label: 'Expenses', classification: 'Expenses', children: [
    leaf('E:6100 Pastor Salary', '6100 Pastor Salary'),
    leaf('E:6200 Staff Salary', '6200 Staff Salary'),
    leaf('E:6300 Pension', '6300 Pension'),
    leaf('E:6310 Health Insurance', '6310 Health Insurance'),
  ] },
];
const model = {
  countedEntries: () => [{ w: { accountCode: '6100' }, i: 0 }, { w: { accountCode: '6200' }, i: 1 }],
  benefitBreakdown: () => ({ rows: [
    { key: 'pension', cents: 1000000 }, { key: 'health', cents: 2000000 }, { key: 'fica', cents: 500000 },
  ] }),
};
const computed = [{ salaryCents: 9000000 }, { salaryCents: 4000000 }];

describe('planBudgetLines', () => {
  it('puts pay and each benefit on its own budget line and reports what has no line', () => {
    const plan = planBudgetLines(model, computed, tree, '');
    const by = Object.fromEntries(plan.rows.map((r) => [r.category, r.cents]));
    expect(by['E:6100 Pastor Salary']).toBe(9000000);
    expect(by['E:6200 Staff Salary']).toBe(4000000);
    expect(by['E:6300 Pension']).toBe(1000000);
    expect(by['E:6310 Health Insurance']).toBe(2000000);
    expect(plan.unplaced).toEqual(['fica']);
  });
});
