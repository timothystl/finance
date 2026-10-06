-- Breeze giving, a side-by-side copy (Andrew, 2026-10-05). Finance reads Breeze's giving list into
-- these tables so its totals can be checked against Connect's, to the penny, before Finance takes
-- over giving from Connect. Connect stays the authoritative record until that switch is made on
-- purpose. The copy holds no names: only Breeze's own person number, the date, the amount, the
-- method, and how the gift was split across funds. Money is in whole cents; days are YYYY-MM-DD.

CREATE TABLE IF NOT EXISTS finance_breeze_gifts (
  payment_id TEXT PRIMARY KEY,
  person_ref TEXT NOT NULL DEFAULT '',
  paid_on TEXT NOT NULL CHECK (paid_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT '',
  fee_cents INTEGER,
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS finance_breeze_gifts_paid_on
  ON finance_breeze_gifts (paid_on);

CREATE TABLE IF NOT EXISTS finance_breeze_gift_funds (
  payment_id TEXT NOT NULL,
  fund_ref TEXT NOT NULL DEFAULT '',
  fund_name TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS finance_breeze_gift_funds_payment
  ON finance_breeze_gift_funds (payment_id);

CREATE TABLE IF NOT EXISTS finance_breeze_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL DEFAULT '',
  range_start TEXT NOT NULL,
  range_end TEXT NOT NULL,
  fetched INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  run_by TEXT NOT NULL DEFAULT ''
);
