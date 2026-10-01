# Timothy Finance: Agent Instructions

Andrew's request authorizes the implementation, tests, documentation, commits, PR merge, and routine
deployment needed to finish that request. Carry the work through to a usable result. Follow an
explicit review-only, no-deploy, or other scope limit. Ask only when a material decision is missing,
the work would expand the requested scope, or an action would destroy data, irreversibly affect
people, or create a new financial commitment. Do not send real messages or initiate real charges to
test an application.

## Talking with Andrew

Andrew is a pastor, not a developer. Do not narrate steps or mention files, scripts, commands,
branches, or tools in messages to him. Reply in plain language, in this order: restate the issue; if
a bug, what you confirmed is going wrong; the resolution (what changed, whether it is live, anything
he needs to do or check). Keep technical detail in commits and PRs.

## Runtime and ownership

- This repo is `timothystl/finance`, split from `timothystl/connect` with full history. The Worker is
  `apps/finance/shell.js`, deployed as `timothy-finance-app` with `timothy-finance-db`. There is no staging copy (retired
  October 2026); verify with tests and a production dry-run, then release.
- Connect (separate repo and Worker, `timothy-connect`) stays authoritative for Giving, people, roles
  and the contracts Finance consumes. Finance reads versioned contract summaries and relays Giving
  and compensation writes through the `CONNECT_SERVICE` binding. Never copy a Connect secret or
  database into Finance.
- Files under `src/` and `contracts/` are vendored copies from Connect. Change the source of truth in
  Connect first when a contract changes, then update the copy here.
- Finance settings use `finance_settings`. Check actual database state before schema changes; later
  tables are created on first use by `apps/finance/finance-owned-schema.js`, not only by migrations.
- QuickBooks has a historical successful connection; a stored token does not prove current
  connectivity. Avoid competing refresh-token writers.
- Finance ships no editor of its own. The vendored `src/frontend/` scripts mention a self-hosted TinyMCE
  (`vendor/tinymce/`, which is not in this repository); do not add a cloud-hosted editor dependency.

## Data and authorization

Enforce the server-side permission matrix; UI visibility is not authorization. Council Giving is
aggregate/anonymous only; preserve compensation visibility and per-user draft isolation. Never expose
secrets or personal/giving/payroll records in logs, fixtures, or documentation. For real data moves,
verify source and target, take a usable backup, reconcile counts, preserve provenance. Do not seed
production with synthetic data.

## Tests and releases

Use Node 22. Run `npm test` and `node .github/scripts/check-built-scripts.js`; for release
confidence also `npm run validate:finance:prod`. Main merges do not deploy. To release, dispatch
`.github/workflows/deploy-finance.yml` with the exact tested main SHA and a real reason. Confirm the
deployed revision afterward.

## Documentation

Canonical docs: `README.md`, this file, `apps/finance/README.md`, and `docs/` (ARCHITECTURE,
DATA-OWNERSHIP, OPERATIONS, TESTING). Keep them current when behavior or ownership changes; do not add
diaries, completed task lists or dated progress notes (git history is the record). Cross-app
architecture lives in [digital-architecture](https://github.com/timothystl/digital-architecture); link,
do not copy. Older "approval gate" wording in workflow and config comments is superseded by this file.
