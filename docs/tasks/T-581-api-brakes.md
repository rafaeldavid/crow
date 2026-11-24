# T-581: Limits on judge calls and relayer gas

- **Lane:** api
- **Phase:** 2
- **Depends on:** T-422, T-574
- **Paths this task may touch:** `apps/demo-cloud/src/` (limits.ts, world.ts, judges.ts and their tests, and a new brakes.test.ts), `apps/early-access/`, `apps/demo-cloud/wrangler.op1.jsonc`, `apps/demo-cloud/wrangler.op2.jsonc`, `apps/early-access/wrangler.jsonc`, `docs/operations.md`, this file; one new test file, `tests/early-access-signup-limit.test.ts` (see Handoff)
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

1. A cap on funded judged deals per client per node a day (`JUDGED_DEALS_PER_CLIENT_PER_DAY`, default 3 since Rafa's decision of 2026-11-24, first built at 1). A deal counts when its terms can need a panel (`needsPanel`) and name one of Crow's adjudicators. One client then holds at most 18 judge calls per node.
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
- Review and red team [measured]: one reviewer pass and one red-team pass, both on Sonnet 5.5, because Fable 5.2 and Opus 5.5 were out of quota until 03:00 Berlin on 2026-11-25. Both found the same High: `takeFunding` awaited the global row between the client's check and its count, so 20 concurrent takes from one client were all admitted (measured by both). The fixes and their tests are in the second commit. Of the 5 new tests in "the red team and review of T-581" and the sign-up /64 test, 4 fail at the first commit (24384bcf). The midnight test passes there too, so it guards against a regression and proves no bypass.
- After the fixes [measured]: `pnpm typecheck` and `pnpm lint` passed. `pnpm exec vitest run apps/demo-cloud tests/early-access` gave 21 files passed and 5 skipped, 274 tests passed and 13 skipped.
- Existing tests changed: three test servers that fund several judged deals from one client now set `judgedDealsPerClientPerDay: 100`. The DailyCaps unit tests pass the two new limits, and the telemetry test's list of storage prefixes gains `fc` (hashed, no address; the IP check there still covers it).

## Decisions

- **The judged cap counts at funding, not at offer** [inferred]. The judge budget is reserved only once a deal is funded (`reservedJudgeCalls`), and an unfunded offer costs nothing. It counts inside the per-client funded-deal cap too.
- **Terms that cannot be read count as not judged.** The relay refuses a funding with unknown terms anyway. Terms that name no adjudicator count as judged.
- **Default of 200 for the global cap** [guessed]. That is about 312 million gas a day at about 1.56 million gas a deal (T-389's measurement). Rafa should set it from the relayer's balance; the review suggests exactly that.
- **No discovery fields for the new limits.** `demo.limits` is defined in `spec/openapi/`, which changes only through an ADR and a version bump. The refusals' `detail` text names each limit instead.
- **The sign-up limit uses a Cloudflare rate-limit binding** and fails open, like the operators' flood ceiling. The binding's namespace ID is `5811`. It counts an IPv4 address or an IPv6 /64 (`clientKey` from listing.js), after the red team.
- **`LIVE_JUDGE_CALLS_PER_DAY` is strict now**, like the other limits. A malformed value refuses to start; before, it fell back to 30, so a mistyped quick stop left judging on. It is listed in `wrangler.op1.jsonc` at 30, so the runbook's "put the value in that file" has a line to edit.
- **`takeFunding` reads both rows of one UTC day before it checks** (`DailyCaps.pair`), with no await between the check and the count. The faucet marks an address in progress only after its count is stored, and it prunes closed `fc:` rows inside its queue, as best effort.

- **The live judge budget's default is 100** (Rafa, 2026-11-24, through the coordinator; 30 before). One budget serves both nodes [measured from the code]. One address reserves up to 18 calls per node, 36 of 100 over both nodes. Model spend can rise about threefold, so the provider-side spend limits in Rafa's checklist matter more.

## Handoff

Done: all four changes, their tests and the runbook paragraph. Not done:

- **Deploy waits for Rafa:** holdback-op1, holdback-op2 and crow-early-access. `workers_dev: false` removes the `*.workers.dev` hostnames. Nothing in the repo calls them except an old cutover note in `docs/operations.md` (Sepolia cutover step 2).
- **A path outside the list:** the early-access tests live in `tests/` (vitest does not collect `apps/early-access/`), so the new test is `tests/early-access-signup-limit.test.ts`. It is a new file, and no other file there changed.
- **Decided: the default is 3** (Rafa, 2026-11-24, through the coordinator: "change the default so demos can take place"). A default of 1 refused part of `pnpm demo:sepolia` [inferred from examples/demo-sepolia.ts: it plays the release, reject and escalate beats at once from one machine]. The trade-off [inferred]: one address reserves up to 18 calls per node, and the 30 calls are one budget for both nodes, so one address using both nodes can reserve all 30. The default now only stops one address from taking the budget through one node. On a day with no demo, setting the value to 1 restores the tighter cap. The site's single judged try and Crow's test buyer, which takes checks-only deals (`apps/test-agents/src/buyer.ts:160`), are not affected.
- **Residuals that need a product decision** [inferred, red team items 2 and 5]: (a) a client is an address, counted per node, so about 3 addresses (IPv4s or IPv6 /64s) can still reserve the 30 calls; (b) funding straight on the rules contract skips every operator cap, and `reservedJudgeCalls` counts that deal too, so offers plus direct funding can hold the budget at the cost of test gas. Both need identity or payment for judged deals, or a reservation counted at the adjudicator's acceptance with its own per-seller limit. Until then `LIVE_JUDGE_CALLS_PER_DAY=0` is the stop, and the runbook says so.
- **Follow-up:** add `judgedDealsPerDay` and the global cap to discovery's `demo.limits` (a schema change with an ADR), and to the agent docs.
