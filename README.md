# Timothy Finance

Timothy Lutheran Church's finance application: the budget planner, chart of accounts, church and
daycare reports, property books, payroll relay, Giving reports, and Facilities. It runs as the
`timothy-finance-app` Cloudflare Worker (`apps/finance/shell.js`) with its own D1 database,
`timothy-finance-db`. A separate staging Worker and database mirror it.

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
| `contracts/validators/` | Consumer-side validators for the contracts Connect publishes (copied from Connect; Connect is the source of truth) |
| `src/`, `contracts/accounting-workspace.js` | Copies of the few Connect files Finance still embeds (the compensation planner screens and the accounting workspace). Treat as vendored; remove as Finance replaces them with native pages. |
| `docs/`, `architecture/evidence/` | Finance runbooks and cutover evidence |
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
(`.github/workflows/deploy-finance.yml`) with the exact tested `main` SHA and a real reason.
Staging has its own workflow. The workflows need these repository secrets: `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_D1_API_TOKEN` (recovery check only), plus a `production`
environment.

See `AGENTS.md` for working rules and data protections.
