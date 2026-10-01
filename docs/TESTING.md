# Testing

Use Node 22. Tests are vitest files in `test/` (config in `vitest.config.js`).

```sh
npm ci
npm test                         # every test file
npm run test:finance             # test/finance-*.test.js (today, the same set)
npm run validate:finance         # test:finance + production dry-run deploy
npm run validate:finance:prod    # test:finance + production dry-run deploy
node .github/scripts/check-built-scripts.js   # the vendored workspace scripts still parse
```

As of October 1, 2026: 189 test files, 2,229 tests, all passing. A passing suite does not establish a
successful migration, live authorization, production health, or business-data correctness.

## What the tests cover

- Worker boundary and security: routing and the closed route list (`finance-route-manifest`,
  `finance-alpha-shell`), security headers and boundaries (`finance-security-boundaries`), Access token
  handling, role verification and the role cache, navigation permission visibility.
- Each report and page family: Church Report, Balance Sheet, Daycare, Commercial Property (the
  largest group), Budget and planning, Compensation (including the browser planner against a
  harness), Payroll relay, Facilities, HR, Tuition Aid planner model, Giving relays, QuickBooks
  (OAuth client, token service, budget merge, transactions).
- Contract consumers: the validators in `contracts/validators/` fail closed on malformed or
  unreconciled data (`*-consumer.test.js`), and each `*-client.test.js` covers its transport.
- Write routes: validation, permission refusals, and private council draft isolation.
- Schema and data tooling: the migration/copy-and-verify tooling, `finance-owned-schema` (each
  first-use schema block must equal its migration file), D1 foundation.
- Generated bundles: a test fails when `planner/bundle.generated.js` or the tuition planner bundle is stale.

## What was retired in the split

Fourteen cross-app test files that exercised Connect and Finance together were retired when Finance
left the Connect repository (October 1, 2026); their names are not recorded here. Tests of Connect's
side of each contract now belong in Connect. Finance tests use mocked Connect and Website responses;
nothing here proves a live contract still matches. After a Connect contract change, check the
validators and, when in doubt, check the affected page after release (there is no staging).

## What the tests do not do

They make no real requests to QuickBooks, Connect, Website, or Cloudflare, send no messages, and
start no charges. Browser checks use synthetic local responses. The recovery drill (see
[OPERATIONS](OPERATIONS.md)) is a separate, dispatched workflow, not part of `npm test`.

## Notes

- Add focused regression coverage for changed behavior, and confirm it fails on the old behavior.
- After editing anything under `apps/finance/planner/` or `apps/finance/tuition-planner/`, run the
  matching `build.mjs` (in that folder) and commit the generated bundle.
- Documentation-only changes need no rebuild; review the diff and links.
- `scripts/prepare-d1-import.py` (added after the split) is exercised only by the recovery drill.
- `.github/scripts/check-deploy-version.js` and `.github/scripts/resolve-auto-merge-conflicts.js` are Connect leftovers
  that no Finance workflow calls.
