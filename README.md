# Timothy Finance

Timothy Lutheran Church's finance application: the budget planner, chart of accounts, church and
daycare reports, property books, payroll relay, Giving reports, and Facilities. It runs as the
`timothy-finance-app` Cloudflare Worker (`apps/finance/shell.js`) with its own D1 database,
`timothy-finance-db`. A separate staging Worker and database mirror it (the production Finance site is behind Cloudflare Access).

This repository was split from [timothystl/connect](https://github.com/timothystl/connect) in
October 2026 with its full history. Connect still owns people, Giving (the authoritative gift
records), Serve/Scheduler, and the roles Finance asks it about. Finance reads versioned contract
summaries from Connect and relays Giving and compensation writes back to it over a service binding.

## Layout

| Path | What it is |
| --- | --- |
| `apps/finance/` | The Worker: shell, pages, services, importers, accounting, migrations of Finance's own tables |
| `test/finance-*.test.js` | Finance's tests (vitest) |
| `wrangler.finance.jsonc`, `wrangler.finance.staging.jsonc` | Production and staging Worker configuration |
| `contracts/validators/` | Consumer-side validators for the contracts Connect publishes (Connect is the source of truth) |
| `src/`, `contracts/accounting-workspace.js` | Vendored copies of Connect files (the `/accounting` workspace markup and scripts, a storage helper, and helpers used by tests). Connect is the source of truth; retire them as native pages replace them. |
| `docs/` | ARCHITECTURE, DATA-OWNERSHIP, OPERATIONS, TESTING |
| `scripts/` | Accounting data copy, D1 recovery drill and its import helper |
| `.github/workflows/` | Validation, staging deploy, production deploy, D1 recovery check |

## Working on it

Node 22.

```
npm ci
npm test                       # all tests
npm run validate:finance       # tests + staging dry-run deploy
npm run validate:finance:prod  # tests + production dry-run deploy
```

## Releasing

Merging to `main` does not deploy. Dispatch **Deploy Finance Production**
(`.github/workflows/deploy-finance.yml`) with the exact tested `main` SHA and a real reason. The
full procedure, rollback, secrets (by name) and the recovery drill are in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Documentation

[AGENTS.md](AGENTS.md) (working rules; `CLAUDE.md` imports it), [apps/finance/README.md](apps/finance/README.md)
(what the app does), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATA-OWNERSHIP.md](docs/DATA-OWNERSHIP.md),
[docs/OPERATIONS.md](docs/OPERATIONS.md), [docs/TESTING.md](docs/TESTING.md). Cross-app architecture and plan:
[digital-architecture](https://github.com/timothystl/digital-architecture). History lives in git, not in docs.
