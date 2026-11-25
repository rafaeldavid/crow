# T-581: Limits on judge calls and relayer gas

- **Lane:** api
- **Phase:** 2
- **Depends on:** T-422, T-574
- **Paths this task may touch:** `apps/demo-cloud/src/` (limits.ts, world.ts, judges.ts and their tests, and a new brakes.test.ts), `apps/adjudicator/src/service.ts` and `test-adjudicator.ts` (the acceptance hook, on Rafa's decision of 2026-11-24), `apps/early-access/`, `apps/demo-cloud/wrangler.op1.jsonc`, `apps/demo-cloud/wrangler.op2.jsonc`, `apps/early-access/wrangler.jsonc`, `docs/operations.md`, this file; one new test file, `tests/early-access-signup-limit.test.ts` (see Handoff)
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

1. A limit on judged deals per seller and buyer pair a day, kept by Crow's adjudicator (`JUDGED_DEALS_PER_PAIR_PER_DAY`, default 3): at acceptance as primary, and at a fallback or appeal turn for an outside primary. It was first built on the operators, per IP address at funding; Rafa moved it on 2026-11-24, so there is one limit in one place and it covers offers sent straight to the contract. A deal counts while live judges run, when its terms can need a panel (`needsPanel`). It was keyed per buyer until the Opus red team of 2026-11-25 showed that a stranger could lock a buyer out (H1).
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
- After the Opus red team [measured]: see the PR description for the counts. The griefing test and the storage-read test fail with their fixes taken out.
- Acceptance-time limit [measured]: `pnpm typecheck` and `pnpm lint` passed. `pnpm exec vitest run apps/demo-cloud apps/adjudicator apps/test-agents tests/early-access examples/demo-sepolia.test.ts` gave 46 files passed and 7 skipped, 756 tests passed and 17 skipped. `pnpm snap` gave 52 passed and 0 failed. With the hook unplugged in `world.ts`, all 3 acceptance tests in `brakes.test.ts` failed: the fourth deal, the offer sent straight to the settlement layer, and the value of 0.
- After the fixes [measured]: `pnpm typecheck` and `pnpm lint` passed. `pnpm exec vitest run apps/demo-cloud tests/early-access` gave 21 files passed and 5 skipped, 274 tests passed and 13 skipped.
- Existing tests changed: the DailyCaps unit tests pass the new global limit, and the telemetry test's list of storage prefixes gains `fc` (hashed, no address; the IP check there still covers it).

## Decisions

- **The judged limit counts at acceptance, per pair** (Rafa, 2026-11-24, on acceptance; the pair after the Opus red team). The pair is the seller and the buyer of the signed terms. The seller alone signs an offer, so a count per buyer let a stranger's offers spend an honest buyer's count. The red team suggested counting once the buyer signs instead, but that comes after acceptance, where Crow can no longer decline before funding. A new hook in the adjudicator service, `acceptLimit` (`apps/adjudicator/src/service.ts`), has three parts. `take` is asked last in `#accept`, after every other reason to decline, and its count is given back unless the acceptance is submitted. `check` answers the same question without counting, for `declines`, so the operators show a notice before they relay. `giveBack` returns a count. The World fills the hook through `judgedDealLimits` (`world.ts`), with one `JudgedDealsPerPair` counter (`limits.ts`) shared by Crow's three adjudicators. It keeps one row per pair and day, `ja:<day>:<pair hash>`, holding the commitment IDs it counted. Its takes run one at a time, so concurrent passes cannot slip past it, and a repeated pass counts one deal once.
- **A fallback or appeal turn counts too, for an outside primary** (red team M2). `judgeGate` asks `turnLimit` before a panel is convened. Over the limit, the panel is not convened and the deal ends by its own deadlines. A deal Crow accepted as primary is already counted, and one deal counts once whatever role takes it.
- **It counts only while live judges run.** A scripted panel spends no budget, so the local worlds and the SimChain tests are unchanged.
- **Neutrality** [inferred from the code]: the hook is asked only at acceptance and in `declines`. Nothing after acceptance reads it, so it cannot move funds or stop an accepted deal from ending by its terms. A declined offer stays unaccepted and expires at `offerExpiresAt` with nothing held: the fixture `neutrality.adjudicator-never-accepts` shows that ending, and it passes in `pnpm snap`. An adjudicator may decline terms it will not run (D29), and the parties can name another.
- **Default of 200 for the global cap** [guessed]. That is about 312 million gas a day at about 1.56 million gas a deal (T-389's measurement). Rafa should set it from the relayer's balance; the review suggests exactly that.
- **No discovery fields for the new limits.** `demo.limits` is defined in `spec/openapi/`, which changes only through an ADR and a version bump. The refusals' `detail` text names each limit instead.
- **The sign-up limit uses a Cloudflare rate-limit binding** and fails open, like the operators' flood ceiling. The binding's namespace ID is `5811`. It counts an IPv4 address or an IPv6 /64 (`clientKey` from listing.js), after the red team.
- **`LIVE_JUDGE_CALLS_PER_DAY` is strict now**, like the other limits. A malformed value refuses to start; before, it fell back to 30, so a mistyped quick stop left judging on. It is listed in `wrangler.op1.jsonc` (now at 100), so the runbook's "put the value in that file" has a line to edit.
- **`takeFunding` reads both rows of one UTC day before it checks** (`DailyCaps.pair`), with no await between the check and the count. The faucet marks an address in progress only after its count is stored, and it prunes closed `fc:` rows inside its queue, as best effort.

- **The live judge budget's default is 100** (Rafa, 2026-11-24, through the coordinator; 30 before). One budget serves both nodes [measured from the code]. One address reserves up to 18 calls per node, 36 of 100 over both nodes. Model spend can rise about threefold, so the provider-side spend limits in Rafa's checklist matter more.

## Handoff

Done: all four changes, the judged limit moved to Crow's acceptance, their tests and the runbook paragraph. Not done:

- **Deploy waits for Rafa:** holdback-op1, holdback-op2 and crow-early-access. `workers_dev: false` removes the `*.workers.dev` hostnames. Nothing in the repo calls them except an old cutover note in `docs/operations.md` (Sepolia cutover step 2).
- **A path outside the list:** the early-access tests live in `tests/` (vitest does not collect `apps/early-access/`), so the new test is `tests/early-access-signup-limit.test.ts`. It is a new file, and no other file there changed.
- **Decided: the default is 3** (Rafa, 2026-11-24: "change the default so demos can take place"). Correction from the Opus red team: `examples/demo-sepolia.ts` makes fresh keys per beat, and 2 of its 3 beats are judged, so a default of 1 would not have blocked it either [inferred from the code]. Crow's test buyer takes checks-only deals (`apps/test-agents/src/buyer.ts:160`), so the limit does not apply to it.
- **Closed:** the red team's Medium. Funding straight on the contract skipped the judged cap; the limit now sits at acceptance, which every route passes.
- **Remaining limit** [inferred]: addresses cost nothing on a test network. One escalated deal spends 8 calls or more, so about 3 seller and buyer pairs can hold the 100-call budget. The budget is the hard ceiling, and `LIVE_JUDGE_CALLS_PER_DAY=0` is the stop.
- **Opus red team, 2026-11-25** [measured by the red team]: H1, a stranger locking a buyer out, is fixed by the pair key, with a test. M2, an outside primary using Crow's fallback panel with no count, is fixed by `turnLimit`, with unit tests; the one line in `judgeGate` that calls it is inferred from reading. L4, a failed storage read refusing every client's funding until midnight, is fixed with a test. L3 (calls per deal) and L5 (two wrong statements in this file) are corrected in the docs.
- **Follow-up:** add the judged limit and the global cap to discovery's `demo.limits` (a schema change with an ADR), and to the agent docs.
