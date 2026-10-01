# Architecture

Finance is one Cloudflare Worker (`apps/finance/shell.js`) with its own D1 database. It is one of
several church apps, each in its own repository and Worker. Central cross-app architecture lives in
[digital-architecture](https://github.com/timothystl/digital-architecture) (linked, not copied); the
overhaul status is in [the architecture plan](https://github.com/timothystl/digital-architecture/blob/main/architecture/11-overhaul-readiness-and-execution-plan.md).
Finance was split out of the Connect repository on October 1, 2026 with its full history.

## Apps Finance touches

| App | Repository / Worker | Relationship |
| --- | --- | --- |
| Connect | `timothystl/Connect`, `timothy-connect` | Owns people, roles, Giving, Serve. Publishes the contracts Finance consumes. |
| Website | `timothystl/website`, `timothy-website-admin` (Website Admin) | Current payroll backend; gym rental invoices. |
| myMDO | `timothystl/myMDO` | Childcare; Finance's Daycare Report can sync from it (those syncs run through Connect unless Finance holds the myMDO settings). |

## Bindings (names only; real IDs are in the wrangler files)

| Binding | Production (`wrangler.finance.jsonc`) |
| --- | --- |
| Worker name | `timothy-finance-app` at `finance.timothystl.org` |
| `FINANCE_DB` (D1) | `timothy-finance-db` |
| `FACILITY_FILES` (R2, private) | `timothy-finance-files` |
| `CONNECT_SERVICE` | `timothy-connect` |
| `PAYROLL_SERVICE` | `timothy-website-admin` |

There is no KV binding and no binding to Connect's database. The hostname sits behind Cloudflare
Access; the Worker also verifies the Access token itself (`FINANCE_ACCESS_TEAM_DOMAIN`,
`FINANCE_ACCESS_AUD`). Other settings: `ENVIRONMENT`, `RELEASE_SHA` (set by the deploy workflow),
`FINANCE_QB_ENABLED` and `FINANCE_QB_ENVIRONMENT` (production `1` / `production`), `FINANCE_LOCAL_CONTRACT_READS` (production only).

Worker secrets the code reads, by name: `FINANCE_CONTRACT_API_KEY` (calls to Connect),
`FINANCE_PAYROLL_CONTRACT_KEY` (calls to Website Admin), `FINANCE_QB_CLIENT_ID`,
`FINANCE_QB_CLIENT_SECRET`, and optionally `MYMDO_API_URL`, `MYMDO_API_KEY`, `MYMDO_ROOMS_API_URL`
(older `DAYCARE_*` names still work). Whether each is set in production cannot be seen from the code.

## Request flow

1. `shell.js` matches the path against `route-manifest.js` (closed list; unknown paths are 404).
2. Pages are server-rendered with a strict content policy (no inline script). Only the Budget
   planner, the Compensation planner, the Tuition planner and the `/accounting` workspace load script from this Worker.
3. The viewer's role comes from Connect's `staff-role-v1` contract, which verifies the Access token.
   Finance applies its own section permissions (`roleCanAccessSection`). The last role Connect
   confirmed is cached (`finance_role_cache`) so views survive a Connect outage; writes never use it.
4. Reads: with `FINANCE_LOCAL_CONTRACT_READS=1`, `local-contract-reads.js` answers the accounting
   contracts (church report, balance sheet, budget, daycare, property, compensation, chart of
   accounts and others) from `FINANCE_DB`. A failed local read falls through to Connect; a local
   write never does, so a save cannot be applied twice. Everything else (Giving, roles, board
   packet) goes to Connect through `CONNECT_SERVICE`.
5. Writes: accounting saves (budget plan, Church Report corrections and imports, Chart of Accounts
   layout, property, daycare, compensation, settings) run in Finance (`accounting/write-contracts.js`)
   after asking Connect who is acting. Giving writes are relayed to Connect's `giving-*` contracts.
   Payroll calls go to Website Admin.

## Where code came from

- `apps/finance/accounting/` is Finance's own copy of Connect's accounting handlers, forked
  September 29, 2026. Connect's copy serves only its remaining embedded screens; change this one.
- `contracts/validators/` are consumer-side parsers for the contracts Connect publishes. Connect is
  the source of truth: change the contract there first, then update the validator here.
- `src/` and `contracts/accounting-workspace.js` are vendored copies of Connect files. What actually
  runs from them: `src/html-chms.js` and `src/frontend/*` (the markup and scripts of the accounting
  workspace) and the operation list in `contracts/accounting-workspace.js`. `src/finance-storage.js`
  is used by `scripts/finance-accounting-copy.mjs` (the one-time data copy) and its test.
  `src/api-utils.js` and `src/auth.js` are used by tests and by the embedded scripts' text, not by
  the Worker's request path. Do not edit these by hand to add features; replace them with native
  pages (as was done for the Budget planner and Chart of accounts) or refresh them from Connect.

## Accounting workspace (`/accounting`)

The older, familiar accounting layout (Financial Health, Church Report, Balance Sheet, Daycare,
Commercial Property, Budget, Chart of Accounts, Compensation, Full Report, Data and Imports) is served
at `/accounting` from the vendored Connect markup, filtered by the viewer's permissions. Its
operations (`/api/v1/accounting-workspace`) are answered by Finance's own handlers; only the reads
that mix in Giving and the myMDO syncs go to Connect. Council budget writes keep the verified user's
private draft identity; cookies and caller-supplied usernames or roles are never forwarded. The newer
native pages are at the site root. Browser checks against it use synthetic local responses and do not
establish production data correctness.

## Data and schema

See [DATA-OWNERSHIP](DATA-OWNERSHIP.md) for who owns what. Schema: numbered files in
`apps/finance/migrations/` plus `apps/finance/finance-owned-schema.js`, which creates the later
tables on first use because the release token cannot run D1 migrations (each block is `CREATE ...
IF NOT EXISTS` and is kept identical to its migration file by a test). Numbering has two `0016` files
(HR placement and import history). Check the live database before schema changes; numbered files alone
are not the production ledger.
