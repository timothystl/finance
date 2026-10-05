# Operations

[AGENTS.md](../AGENTS.md) defines routine delivery authorization: a requested release needs no
further signoff. History of the setup and the September 2026 data cutover is in git (the retired
cutover runbook and its commits); this page is only what is needed to run Finance now.

## Environment

There is one environment, production. A staging copy existed until October 2026 and was retired
and deleted (Worker, database, files bucket); there is no place to try a change except tests and a
dry-run deploy.

| | Production |
| --- | --- |
| Worker / host | `timothy-finance-app`, `finance.timothystl.org` |
| Database / files | `timothy-finance-db`, `timothy-finance-files` |
| Connect binding | `timothy-connect` |
| QuickBooks | production, enabled |
| Config | `wrangler.finance.jsonc` |
| Sample data | never (`apps/finance/fixtures/` are for local testing, applied by hand, never in production) |

The host is behind Cloudflare Access.

## Releasing

Merging to `main` does not deploy. Pull requests touching Finance code run
`.github/workflows/validate-finance.yml` (tests plus a production dry-run deploy).

1. Merge after `npm test` and `npm run validate:finance:prod` pass.
2. Dispatch **Deploy Finance Production** (`deploy-finance.yml`) with the exact tested full `main`
   SHA (`expected_sha`) and a real `reason`. It confirms the SHA is on main, refuses a placeholder
   database ID, reruns the production validation, creates the Facilities bucket only if missing,
   deploys with `RELEASE_SHA` and `RELEASE_NUMBER` (the workflow run number, which only grows) set, and writes a deployment summary. The page header shows `v0.1.0-alpha.<RELEASE_NUMBER>`, so a release that went live is visible on screen.
3. Confirm: the workflow run completed, and (signed in through Access) `/health` reports the
   same `releaseSha`. A green build is not proof of data correctness or staff acceptance.

Deploy only Finance for a Finance change. If a Connect contract changed, release Connect first and
check the vendored validators in `contracts/validators/` and the copies in `src/`.

## Database and schema

- Finance tables are created two ways: numbered migrations in `apps/finance/migrations/`, and
  `finance-owned-schema.js`, which creates later tables on first use (the release token cannot run
  D1 migrations). Check the live database (and its `d1_migrations` table) before schema changes; do
  not assume the migration folder is the whole ledger. A new table needs both a migration file and
  a matching block in `finance-owned-schema.js`.
- Never load fixtures into production or seed it with synthetic data.
- For a real data move: verify source and target, take a usable backup, reconcile counts and
  financial controls, preserve provenance, then switch the writer deliberately.
  `scripts/finance-accounting-copy.mjs` prepares an insert-only copy of the accounting tables from
  restorable SQLite backups (refuses a nonempty destination or a column mismatch, compares every row
  by SHA-256). It does not touch Giving, users, or QuickBooks tokens.

## Rollback and recovery

- Worker: redeploy the previous tested SHA with the production workflow. This does not undo D1 or R2 changes.
- D1 Time Travel can return the whole `timothy-finance-db` to any minute in the last 30 days
  (`npx wrangler d1 time-travel restore timothy-finance-db --timestamp=<ISO time> --config wrangler.finance.jsonc`).
  It rolls back every Finance table, so use it only when a narrower fix is not enough.
- Recovery drill: **Verify Finance D1 backup and recovery** (`verify-finance-d1-recovery.yml`,
  dispatched with a main SHA and reason). It exports the database, restores it into a disposable D1,
  compares schema, integrity, every table's row count and the monetary-column totals, then deletes
  the disposable database and the export. It prints no row values. Its source is the production database
  (`SOURCE_DB` and `SOURCE_DB_ID` in the workflow); it only reads from it. `scripts/prepare-d1-import.py` is the helper it calls
  to rewrite oversized export statements. Database recovery does not recover R2 file bytes.

## QuickBooks

Finance owns the only QuickBooks connection. Intuit rotates the refresh token on each use, so there
must be exactly one refresh-token writer; never copy a token between apps or run two connections.

- An admin connects and syncs on Finance's QuickBooks page. The Intuit app's redirect URI is
  `https://finance.timothystl.org/api/v1/qb/callback`; client ID and secret are Worker secrets
  `FINANCE_QB_CLIENT_ID` and `FINANCE_QB_CLIENT_SECRET`. `FINANCE_QB_ENABLED` switches the routes on.
- A sync imports actuals only: yearly Profit and Loss for this year and four before, monthly for this
  year and last, and the chart of accounts. It does not import budgets (Intuit does not list
  Budget-vs-Actuals among its supported API reports); budgets come from imports or a committed plan.
  Transactions are read live, one date range at a time, and not stored.
- Before every sync, Finance copies the rows a sync can replace (Church Report rows tagged `qbo_sync`
  and the snapshot cache) into `finance_qb_sync_backup_*`; if that fails, the sync does not run. The
  10 most recent backups are kept. Sync status lists them with a Restore button; a restore saves
  the current figures first, so it can be undone. Imports, plans and hand-typed corrections are never
  changed by a sync or restore.
- Connect no longer has any QuickBooks code, secrets or tables (removed September 28, 2026).
- A stored token or an earlier successful sync does not prove the connection works now; confirm
  by looking at Sync status, and compare a few Church Report totals with QuickBooks after reconnecting.

## Secrets and tokens (names only; never write values)

| Name | Where it lives | Used for |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` (the `deploy` token) | GitHub `production` environment of this repository | Production deploys |
| `CLOUDFLARE_D1_API_TOKEN` (the `d1-data` token) | same | Recovery drill only |
| `CLOUDFLARE_ACCOUNT_ID` | same (an identifier, not a credential) | Deploys and the recovery drill |
| `FINANCE_CONTRACT_API_KEY`, `FINANCE_PAYROLL_CONTRACT_KEY` | Cloudflare Worker secrets (and the matching key on the receiving Connect / Website Admin Worker) | Authenticating calls to Connect and Website Admin |
| `FINANCE_QB_CLIENT_ID`, `FINANCE_QB_CLIENT_SECRET` | Cloudflare Worker secrets | QuickBooks OAuth |
| `MYMDO_API_URL`, `MYMDO_API_KEY`, `MYMDO_ROOMS_API_URL` | Cloudflare Worker settings, only if Finance runs the myMDO sync | Daycare sync |

The Cloudflare token audit and rotation map is
[in Connect](https://github.com/timothystl/Connect/blob/main/docs/CLOUDFLARE_TOKENS.md). Rotating a
GitHub deploy token does not affect Worker runtime secrets. Which secrets are currently set in the
Worker cannot be read from this repository.

## Access (Cloudflare Zero Trust)

Finance's Access application for `finance.timothystl.org` was enforcing
from the first route deployment (September 15, 2026). A parity checklist for production (policy limited
to church accounts, Google Workspace sign-in, branded login page, session duration of an hour or less,
offboarding) was drafted but never recorded as completed; verify those settings in the dashboard.
The checklist's offboarding rule (unconfirmed) is to both suspend the Workspace account and revoke
the person in Zero Trust. Access does not grant Finance permissions: roles come from Connect.

Logo files bypass Access. Phones and browsers fetch the home-screen icon without a session, so behind
Access they get the sign-in page and show a plain letter instead of the logo. A second Access
application, "finance logo files" (hostname `finance.timothystl.org`, policy action Bypass, include
Everyone), covers only the paths served by the `brand-asset` route in `apps/finance/route-manifest.js`
(`/apple-touch-icon.png`, `/apple-touch-icon-precomposed.png`, `/favicon.ico`, `/manifest.webmanifest`,
`/assets/finance-mark.png`, `/assets/finance-icon.png`, `/assets/finance-icon-192.png`,
`/assets/finance-icon-512.png`, `/assets/finance-icon-maskable-512.png`). These serve only the logo; keep the
list in step with that route. Check: an unauthenticated request for `/apple-touch-icon.png` returns the
image, and one for `/` still redirects to sign-in.
