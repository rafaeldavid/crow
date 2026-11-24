# T-581: Limits on judge calls and relayer gas

- **Lane:** api
- **Phase:** 2
- **Depends on:** T-422, T-574
- **Paths this task may touch:** `apps/demo-cloud/src/` (limits.ts, world.ts, judges.ts and their tests), `apps/early-access/`, `apps/demo-cloud/wrangler.op1.jsonc`, `apps/demo-cloud/wrangler.op2.jsonc`, `apps/early-access/wrangler.jsonc`, `docs/operations.md`, this file; one new test file, `tests/early-access-signup-limit.test.ts` (see Handoff)
- **Human gate:** yes for the deploy only; the code is in-repo
- **Status:** review
- **Agent/session:** api-brakes (side session of the coordinator, 2026-11-24)
- **Roadmap row:** N222

## What exists

- T-422's daily caps (`apps/demo-cloud/src/limits.ts`, `DailyCaps`): per client and per node, deals the relayer funds (100 a day) and ciphertext bytes stored. They are kept in storage rows.
- T-574's judged-deal gate (`judgedDealGate` and `reservedJudgeCalls` in `world.ts`): each open judged deal reserves 2 × panel size, which is 6 of the 30 daily live judge calls. Nothing limits how many of those one client funds.
- The faucet (`grantFrom` in `world.ts`): 50 grants per client an hour, counted in a `Map` in memory, so a restart resets the count.
- The sign-up Worker (`apps/early-access/worker.js`): no rate limit. Both operators and the sign-up Worker set `workers_dev: true`.

The security review of 2026-11-21 (private repo, `security/2026-11-21-security-review.md`, sections 3 and 5) found four gaps. This task closes them.

## Intent

The goal: a stranger cannot hold Crow's daily judge budget or drain the relayer's test ETH from a few addresses. The task makes four changes, and each new limit is an operator's variable with a default, never a protocol rule (D31):

1. A cap on funded judged deals per client per node a day (`JUDGED_DEALS_PER_CLIENT_PER_DAY`, default 1). A deal counts when its terms can need a panel (`needsPanel`) and name one of Crow's adjudicators. One client then holds at most 6 of the 30 judge calls per node.
2. A global cap on deals the relayer funds a day, across all clients and both nodes (`FUNDED_DEALS_PER_DAY`, default 200).
3. The faucet's per-client count moves into storage (`fc:<client hash>`), hashed with the world's secret like the `lc:` rows, so a restart keeps it.
4. A rate limit on the sign-up Worker's writes (`SIGNUP_LIMIT` binding, 5 per 60 s per client, fails open), `workers_dev: false` on the three Workers, and the quick stops in `docs/operations.md`.

Non-goals: provider-side spend limits, WAF rules and alerts (Rafa's checklist), and any change to the API contract (`spec/`).

## Acceptance criteria

- [x] Each cap has a test and an attack test that fails without the change.
- [x] `pnpm typecheck`, the demo-cloud and early-access tests and `pnpm lint` pass.
- [x] The runbook names the quick stops and says that a value set in the dashboard is lost at the next deploy.

## Evidence

- Commands run and results [measured]: `pnpm typecheck` passed. `pnpm exec vitest run apps/demo-cloud tests/early-access` gave 21 files passed and 5 skipped, 269 tests passed and 13 skipped. `pnpm lint` passed.
- Attack tests against main [measured]: with main's `world.ts`, `limits.ts` and `worker.js` swapped in, 11 of the 12 new tests in `apps/demo-cloud/src/brakes.test.ts` and `tests/early-access-signup-limit.test.ts` failed. The 12th, the fail-open test, passed there, as it should.
- Existing tests changed: three test servers that fund several judged deals from one client now set `judgedDealsPerClientPerDay: 100`. The DailyCaps unit tests pass the two new limits, and the telemetry test's list of storage prefixes gains `fc` (hashed, no address; the IP check there still covers it).

## Decisions

- **The judged cap counts at funding, not at offer** [inferred]. The judge budget is reserved only once a deal is funded (`reservedJudgeCalls`), and an unfunded offer costs nothing. It counts inside the per-client funded-deal cap too.
- **Terms that cannot be read count as not judged.** The relay refuses a funding with unknown terms anyway. Terms that name no adjudicator count as judged.
- **Default of 200 for the global cap** [guessed]. That is about 312 million gas a day at about 1.56 million gas a deal (T-389's measurement). Rafa should set it from the relayer's balance; the review suggests exactly that.
- **No discovery fields for the new limits.** `demo.limits` is defined in `spec/openapi/`, which changes only through an ADR and a version bump. The refusals' `detail` text names each limit instead.
- **The sign-up limit uses a Cloudflare rate-limit binding** and fails open, like the operators' flood ceiling. The binding's namespace ID is `5811`.

## Handoff

Done: all four changes, their tests and the runbook paragraph. Not done:

- **Deploy waits for Rafa:** holdback-op1, holdback-op2 and crow-early-access. `workers_dev: false` removes the `*.workers.dev` hostnames. Nothing in the repo calls them except an old cutover note in `docs/operations.md` (Sepolia cutover step 2).
- **A path outside the list:** the early-access tests live in `tests/` (vitest does not collect `apps/early-access/`), so the new test is `tests/early-access-signup-limit.test.ts`. It is a new file, and no other file there changed.
- **Residual** [inferred]: a client is an address, so a stranger who rotates through 3 addresses per node can still reserve the 30 calls. The cap raises the cost from 1 address to several. Closing it fully needs identity or payment for judged deals, which is a product decision.
- **Follow-up:** add `judgedDealsPerDay` and the global cap to discovery's `demo.limits` (a schema change with an ADR), and to the agent docs.
