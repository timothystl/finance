# Finance app (`apps/finance/`)

This folder is the Finance Worker, deployed as `timothy-finance-app` at `finance.timothystl.org`
behind Cloudflare Access. Release process: [OPERATIONS](../../docs/OPERATIONS.md). How the pieces fit:
[ARCHITECTURE](../../docs/ARCHITECTURE.md). Who owns which data: [DATA-OWNERSHIP](../../docs/DATA-OWNERSHIP.md).

The version label in `version.js` (`0.1.0-alpha.1`, reset September 24, 2026) is a release label only.
It is not a statement that Finance is unfinished or synthetic.

## What Finance does today

The sidebar is defined in `parity-manifest.js` and every page listed there is live (none is a
placeholder). Each section is also gated by the viewer's role and permission, checked on the server
(`connect-role-client.js`, `roleCanAccessSection`).

| Section | Pages (summary) | Where its data lives |
| --- | --- | --- |
| Financial Health, Charts, Board packet | Summary and detail, revenue and expense mix, cash and reserve, giving pace and concentration, packet builder and print, a per-person "final report" list (Add to final report on each report) and a saved monthly cover-letter template | Reads Finance reports plus Giving totals from Connect |
| Gift Entry | Enter a batch, Transactions, Online giving, Funds, Reconciliation to bank, Batch reports, online form settings | Connect (relayed; Finance stores nothing) |
| Giving, Giving reports, Donor letters | Council report, trends, year over year, pledges, what-if, statements, bands, nudges, letters and receipts | Connect (relayed) |
| Church Report, Balance Sheet, Daycare Report, Chart of Accounts | Overview, detail, multi-year trends, imports, daycare entries and allocation, account layout and board categories, Access and roles view | Finance database |
| Commercial Property | Operating results, rent roll, receivables, bank rec, reserves, capital, valuation, forecast, debt, acquisition model | Finance database |
| Facilities | Assets, service history, preventive maintenance, capital projects, files (private storage) | Finance database and private R2 bucket |
| Gym rental income (under Facilities) | Invoiced, paid and overdue totals | Read live from Website Admin; Finance stores nothing |
| Budget | Native Budget planner, Scenarios, Multi-year forecast | Finance database (budget plan, scenarios) |
| Compensation | Planner, Benefits and taxes, Benchmarks, Rates and ranges, Council report | Finance database (`finance_settings` rows and compensation tables) |
| Tuition Aid | Overview, Planner, Past years, Settings | Finance database (`tuition_*` tables) |
| QuickBooks | Sync status, Transactions, Expense drill-down, Vendor spend, Exceptions, Import history | Finance's own QuickBooks connection |
| Data and Imports | Connections, every importer with its last run, classification and policy | Finance database |
| Payroll (admin only) | Run payroll, Staff entry, Import from MDO, Email and print, History | Relayed to Website Admin |
| HR and Staff (admin only) | Directory, org chart, reviews, checks, trainings, policies, benefits, volunteer screening | Finance database |

Nudges and next steps group givers as rare (start giving), irregular (automate at their average gift, no guessed increase), regular (a gift a month or more; increase by +$10, +$25 or +$45 a week by current level) and large annual gifts such as retirement distributions. Connect computes the groups, for member households only (an active member, or a household with one); Funds sharing a leading account code (every `40085` fund) count as one fund there, and the fund picker lists them once. Members who are not giving this year are listed separately (gave last year but not this year, and no gift in two years), and members who are not in a household are flagged. The page also gives a planning estimate for regular givers from two editable numbers (a weekly increase, default $25, and the share who say yes); it recalculates when you press Show. A household placed in the wrong group can be moved by hand (Giving edit) and stays there until set back to automatic; Connect keeps that. Finance falls back to the older single ladder when Connect has not yet been updated.

A separate familiar accounting layout is served at `/accounting` (see ARCHITECTURE).

## What still relays to other apps

- Connect (`CONNECT_SERVICE`): who is signed in and their role, every Giving read and write, the
  board and Giving-mixed reports, Tuition Aid's link-a-person search, and the myMDO daycare syncs
  until Finance holds those connection settings.
- Website Admin (`PAYROLL_SERVICE`): payroll and gym rental income.
- Council Giving access is aggregate and anonymous only; Gift Entry is refused to totals-only access.

## Known limitations

- Some overview cards and the preview endpoints (`/api/v1/summary`, `/api/v1/connect-giving-preview`)
  can fall back to a labeled synthetic fixture when a live read fails. The production database holds
  no synthetic rows, so such a card shows "unavailable". Fixtures (`fixtures/`) are for local testing only.
- Role checks need Connect. If Connect is unreachable, page views use a role cached for up to seven
  days (with a notice); saves always require a live check and are refused otherwise.
- A stored QuickBooks token or past sync does not prove the connection works today. Confirm it on
  the QuickBooks page (an admin connects and syncs there).
- The off-by-default native writers (`budget-plan-save-v1`, the property `*-entry-v1` routes,
  `compensation-plan-save-v1`, `compensation-council-draft-save-v1`, CSV/XLSX import writers) are
  gated by flags and are not the live save paths. Do not enable them without a data decision: they
  use parallel models that would conflict with the live records.
- Release workflows and wrangler config still carry older "do not dispatch without approval" and
  "not yet created" comments; they are superseded by [AGENTS.md](../../AGENTS.md).

## Folder map

- `shell.js`: Worker entry, routing, role checks, security headers. `route-manifest.js` is the
  closed list of routes, methods, data sources and read budgets (unknown paths return 404).
- `*-pages.js`, `shell-layout.js`: server-rendered pages. `*-client.js`: calls to Connect or Website.
- `*-service.js`, `accounting/`: Finance's own reads, writes and report logic. `accounting/` is
  Finance's copy of Connect's accounting handlers (forked September 29, 2026); change it here, not in Connect.
- `local-contract-reads.js`: answers accounting contracts from Finance's database instead of calling Connect.
- `planner/`, `tuition-planner/`: the two browser bundles. After editing either, run
  `node apps/finance/planner/build.mjs` or `node apps/finance/tuition-planner/build.mjs` and commit the
  generated bundle (a test fails when it is stale).
- `quickbooks-*.js`: QuickBooks connection, sync, sync backups, transactions.
- `migrations/`: Finance D1 migrations; `finance-owned-schema.js` creates the later tables on first use.
- `migration/`: copy-and-verify tooling used for the accounting data move.
- `fixtures/`: synthetic test data; applied by hand, never as a migration, never to production.
