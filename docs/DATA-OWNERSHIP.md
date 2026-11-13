# Data ownership

Finance does not create a second donor or people list, and never holds a copy of another app's secrets
or database. The one deliberate exception is the staged giving move below, which Andrew began on
October 5, 2026. Never put secrets or personal, giving, or payroll records in logs,
fixtures, or documentation.

## Finance owns (database `timothy-finance-db`)

- Accounting records: `finance_church_entries`, `finance_church_balances`, `finance_daycare_entries`,
  `finance_daycare_rooms`, `finance_budget_plan`, `finance_property_*` (monthly, reserves,
  disbursements, capital ledger, distributions, repairs, budget, receivables, bank recs),
  `finance_import_log`, `finance_import_history`, and the legacy `finance_settings` rows
  (including the full compensation planner model and private council drafts, and the yearly rent
  increase the Commercial Property Debt page's income estimate opens with,
  `finance_property_rent_growth_pct`, the board packet cover-letter template `board_packet_cover_template`,
  each person's final report list, `board_final_report_<username>`, and the ZIP codes Giving › Campaign
  capacity compares with, `finance_campaign_benchmark_zips`, and each budget year's mission alignment,
  `finance_mission_alignment_<year>`: line splits by End with their reasons, staff time splits, the
  building-use preset and the congregation slide's words. Budget and compensation amounts stay in
  Connect's plan; the alignment only refers to plan lines by category).
  The accounting tables (the list is `FINANCE_TABLES` in `src/finance-storage.js`) were copied from
  Connect's database at the September 23, 2026 cutover (13,411 rows across 14 tables, verified row by
  row against the frozen source). Finance is now the only writer.
- Compensation, planning scenarios, Facilities (assets, service history, projects, files), HR and
  Staff (admin-only; church staff and key volunteers, not childcare staff), Tuition Aid (`tuition_*`),
  the role cache, and the QuickBooks connection, snapshot cache, OAuth state and sync backups.
- Finance's own QuickBooks connection. Connect's QuickBooks code, secrets and tables were removed
  September 28, 2026.

## Outside data Finance reads

- Giving › Campaign capacity shows free U.S. Census Bureau figures (American Community Survey 5-year
  estimates: households, median and average income) for the ZIP codes an admin chooses. They are read
  from Census Reporter (`api.censusreporter.org`, the same published tables, no key) and cached for a
  week. Only the ZIP codes leave Finance; no member, address or gift is sent, and nothing from the
  response is stored beyond the cache. The figures describe neighborhoods, never the church's households.
  The Census Bureau's own API now requires a key; if an admin gets one, the lookup can move to it.

## Connect owns

People, households, roles and permissions, individual gifts, batches, deposits, funds, donor
statements and letters, online giving settings, pledges, and Giving analytics. Finance reads these
through versioned `giving-*` and `staff-role-v1` contracts and relays Giving writes; it stores none of
them. Council Giving access is aggregate and anonymous only. Connect publishes the contracts that
`contracts/validators/` parse.

## Official giving imports in Finance

Finance's Data & Imports → Giving imports is the working interface for official Breeze API
imports, giving CSV uploads, reviewed application, resume and unmatched donor backfill. Connect's
`giving-import-v1` contract independently verifies the active administrator and retains the official
giving records. People and permissions stay in Connect; matching only fills unattributed gifts for
an already-linked person. It never creates or edits people or roles.

Previews validate complete fund allocations and cents. Application uses atomic ten-payment chunks,
snapshot guards, a progress cursor and permanent before/after provenance. Missing Breeze gifts are
never deleted automatically. Local corrections, refunds, voids and deposit-linked gifts are kept
for explicit review through Finance's existing correction screens. A failed chunk is rolled back;
prior completed chunks remain visible and can be resumed. The CSV upload parses the whole file,
including quoted newlines, and groups split payments before creating stable payment IDs.

This interface release does not migrate the giving database or remove Connect's accounting
compatibility binding. Those remain explicit backend dependencies, rather than a second giving writer.

## Giving move in progress (started October 5, 2026)

Andrew's goal is for Finance to own giving and for Connect's financial parts to be removed; Breeze stays
in use for now and its payments continue as a payment processor until people move on (Breeze itself is
no longer paid for from the start of the new year). The move is staged, and **Connect stays the
authoritative record until the writer is switched on purpose** (see Rules for data moves below).

- **Step 1 (this change): a side-by-side copy.** Finance reads Breeze's giving list into
  `finance_breeze_gifts`, `finance_breeze_gift_funds` and `finance_breeze_sync_runs` (migration 0019) and
  checks its monthly totals against Connect's to the cent (not a certification of donor/fund parity) on Data & Imports › Breeze giving copy (admin
  only). The copy holds no names, only Breeze's person number, date, amount, method and funds. Nothing in
  Finance's reports reads it yet. Finance holds its own Breeze credentials as Worker secrets
  (`BREEZE_SUBDOMAIN`, `BREEZE_API_KEY`), never copied from Connect, never stored in a database or logged.
- Next steps, each only after the one before reconciles: Finance reports read their own giving data; gift
  entry, batches, deposits, statements, pledges and the online giving form move; Connect's financial parts
  are removed. People, households and roles stay in Connect.

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
