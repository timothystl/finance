# Data ownership

Finance never creates a second donor, people, or Giving ledger, and never holds a copy of another
app's secrets or database. Never put secrets or personal, giving, or payroll records in logs,
fixtures, or documentation.

## Finance owns (database `timothy-finance-db`)

- Accounting records: `finance_church_entries`, `finance_church_balances`, `finance_daycare_entries`,
  `finance_daycare_rooms`, `finance_budget_plan`, `finance_property_*` (monthly, reserves,
  disbursements, capital ledger, distributions, repairs, budget, receivables, bank recs),
  `finance_import_log`, `finance_import_history`, and the legacy `finance_settings` rows
  (including the full compensation planner model and private council drafts, and the yearly rent
  increase the Commercial Property Debt page's income estimate opens with,
  `finance_property_rent_growth_pct`).
  The accounting tables (the list is `FINANCE_TABLES` in `src/finance-storage.js`) were copied from
  Connect's database at the September 23, 2026 cutover (13,411 rows across 14 tables, verified row by
  row against the frozen source). Finance is now the only writer.
- Compensation, planning scenarios, Facilities (assets, service history, projects, files), HR and
  Staff (admin-only; church staff and key volunteers, not childcare staff), Tuition Aid (`tuition_*`),
  the role cache, and the QuickBooks connection, snapshot cache, OAuth state and sync backups.
- Finance's own QuickBooks connection. Connect's QuickBooks code, secrets and tables were removed
  September 28, 2026.

## Connect owns

People, households, roles and permissions, individual gifts, batches, deposits, funds, donor
statements and letters, online giving settings, pledges, and Giving analytics. Finance reads these
through versioned `giving-*` and `staff-role-v1` contracts and relays Giving writes; it stores none of
them. Council Giving access is aggregate and anonymous only. Connect publishes the contracts that
`contracts/validators/` parse.

## Website owns

Payroll data (Website's backend, with its own Supabase project) and gym rental bookings and invoices.
Finance's Payroll pages and gym income report relay to Website Admin through `PAYROLL_SERVICE`; moving
that relay does not move ownership.

## myMDO owns

Childcare families, schedules, attendance, billing, and clocks. Finance's Daycare Report holds
only the church-side accounting entries it syncs or has entered.

## Rules for data moves

Verify the current source and target, take a usable backup, reconcile counts and financial controls,
preserve provenance, and switch the authoritative writer deliberately. Do not reverse an owner after
new writes were accepted without reconciling the newer data first. Do not seed production with
synthetic data: `apps/finance/fixtures/` is for local testing only and applied by hand. Do not enable the
off-by-default native writers (see [the app README](../apps/finance/README.md)) as a side effect of other work.
The recovery procedure and the copy script are in [OPERATIONS](OPERATIONS.md).
