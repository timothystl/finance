import { describe, expect, it } from 'vitest';
import { renderYearOverYear } from '../apps/finance/balance-pages.js';

const acct = (path, name, cents, classification = 'Assets', depth = path.split(':').length - 1) => ({
  classification, categoryPath: path, accountName: name, depth, hasChildren: false, ownBalanceCents: cents,
});
const current = [
  acct('Assets:11001 Accounts Receivable', '11001 Accounts Receivable', 0),
  acct('Assets:11004 Caring Ministries', '11004 Caring Ministries', 0),
  acct('Assets:11027 Checking', '11027 Checking', 8755000),
  acct('Assets:12021 Reserve', '12021 Reserve', 0),
  acct('Assets:12022 New Fund', '12022 New Fund', 0),
];
const prior = { ok: true, accounts: [
  acct('Assets:11001 Accounts Receivable', '11001 Accounts Receivable', 0),
  acct('Assets:11004 Caring Ministries', '11004 Caring Ministries', 0),
  acct('Assets:11027 Checking', '11027 Checking', 5478100),
  acct('Assets:12021 Reserve', '12021 Reserve', 120000),
] };

describe('2026 vs 2025 comparison hides lines that are $0 in both years', () => {
  it('leaves out lines that are zero in both years and says how many', () => {
    const html = renderYearOverYear(current, 2026, prior);
    expect(html).toContain('11027 Checking');
    expect(html).not.toContain('11001 Accounts Receivable');
    expect(html).not.toContain('11004 Caring Ministries');
    expect(html).not.toContain('12022 New Fund');
    expect(html).toMatch(/\d+ lines that are \$0 in both years are hidden/);
  });

  it('keeps a line that was spent down to $0 this year (it had a balance last year)', () => {
    const html = renderYearOverYear(current, 2026, prior);
    expect(html).toContain('12021 Reserve');
  });

  it('shows every line when zero-balance lines are switched on', () => {
    const html = renderYearOverYear(current, 2026, prior, { hideZero: false });
    expect(html).toContain('11001 Accounts Receivable');
    expect(html).toContain('12022 New Fund');
    expect(html).not.toContain('are hidden');
  });
});
