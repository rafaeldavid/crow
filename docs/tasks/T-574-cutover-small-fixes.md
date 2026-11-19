# T-574: The small defects the contract cutover left

- **Lane:** shipping (tests, operator, core, tooling)
- **Phase:** 2
- **Depends on:** T-563, the cutover to the fixed phase-one contracts; T-559, the operators' early refusals
- **Paths this task may touch:** `apps/adjudicator/src/hung-read.test.ts`, `apps/adjudicator/src/drand-fork.test.ts`, `apps/demo-cloud/src/limits.attack.test.ts`, `apps/demo-cloud/src/worker.ts` and its test, `apps/operator/src/server.ts` (the JSON body reader) and `apps/operator/src/body-limit.test.ts`, `packages/core/src/parse.ts`, `packages/core/src/state.ts`, `packages/core/src/validators-codegen.ts` and the generated `validators.generated.ts`, new tests in `packages/core/src/`, `packages/settlement/evm/evm-settlement.ts` (the decide case only) and `packages/settlement/evm/appeal-ground.test.ts`, `tools/duet/replay.ts` and `tools/duet/duet.test.ts`, this file
- **Human gate:** no for the merges. The operator deploy that carries items 2 and 5 is Rafa's.
- **Status:** in progress
- **Agent/session:** the T-574 session, started by the coordinator on 2026-11-19 ("Start all seven")
- **Roadmap row:** N211

## Intent

The cutover of 2026-11-19 and the review of T-559 left five small defects, none blocking. This task fixes each one with a test that fails before the fix, or drops it with the reason. Nothing new: no route, field or message. Three kinds, in three small pull requests:

1. **Tests that depend on the clock or the network** become deterministic, and each still proves what it proved.
2. **Operator and core:** a JSON body over a route's limit costs about that limit to refuse, not 10 MiB; one rule in core says what "no appeal ground" is, matching the rules contract; a beacon without its signature is told so; the API hostnames answer `/.well-known/security.txt`.
3. **Tooling:** the duet tool's published page keeps its record links whole.

Non-goals: no schema rule changes (item 3 changes only the error text), no change to what the contract accepts, no deploy.

## Acceptance criteria

- [ ] Each of the five items is fixed or dropped with its reason (Evidence).
- [ ] Each fix has a test that fails before it and passes after it.
- [ ] The three tests of item 1 assert at least what they asserted before, and none reads the wall clock for a bound.
- [ ] Item 2(b): a property test shows the core rule refuses an appeal ground exactly when the rules contract would.
- [ ] Each pull request has a reviewer subagent's report, and every finding of Medium or above is fixed with a test.
- [ ] The coordinator knows which items need an operator deploy and which a site deploy.

## Evidence

All measured on 2026-11-19 on this Mac, on `origin/main` `22dd494a` plus each branch, unless labelled otherwise. Outputs are in `reports/scratch/t574-*` on the maintainer's machine (not committed).

**Every item is real** [measured where a test or a run shows it; inferred from reading the code otherwise]: each was confirmed against the code before its fix. None is dropped.

### Pull request 1: tests only (item 1)

**1(a) `apps/adjudicator/src/hung-read.test.ts`.** Four tests bounded a pass by the wall clock: "many stuck deals" (under 5 limits), "a registration read that never answers" (under 4 limits, the one that read 238 ms against 160 ms), "a pass waits out at most PASS_WAIT_LIMITS limits" (under 4 limits) and "offers come after the turns" (under 1 limit). They now run on fake timers (`setTimeout`, `clearTimeout` and `Date`; `setImmediate` stays real), so time moves only when one of the pass's own timers fires. What each still proves, now exactly:
- many stuck deals: the second pass waits at most what is left of one limit, never five (was: under five);
- a registration read that never answers: the pass waits exactly one limit for five deals (was: under four);
- PASS_WAIT_LIMITS: the pass waits exactly 2 full limits and 3 tenths, 1,150 ms of fake time at a 500 ms limit (was: under 2,000 ms);
- offers come after the turns: the delivered deal is judged before any wait at all (was: under one limit).

The driver gives the pass real turns of the event loop while no timer is due, and fires the next timer only then. The store reads in this file are in-memory and settle in promise steps; the one real asynchronous step, the WebCrypto decrypt, runs between reads, when no time limit is pending, and the driver then gives real turns without moving time [inferred from the code; the reviewer measured at most 16 turns for one decrypt against the driver's 10,000]. While it fired a timer, `process.getActiveResourcesInfo()` listed only the stdio pipes [measured]. Under a load average of 34 to 58 (ten busy loops on 8 cores), one run of the file passed 13 of 13 tests; the old file passed too at that load, so the old failure does not reproduce on demand [measured].

**1(b) `attack.t422-replay-cpu` in `apps/demo-cloud/src/limits.attack.test.ts`.** It now counts body work instead of timing it. With a budget of 12 writes a minute and one accepted faucet grant of 991,954 bytes, 36 replays answered 12 with 200 and 24 with 429, a burst of 12 more was refused 12 of 12, the operator parsed the body 12 times, and a stranger's read answered 200 [measured]. With the replay budget removed from `knownKey` (a mutation, reverted), all 36 replays were answered, none of the burst was refused, and the body was parsed 48 times: the test failed [measured]. It proves the count bound of T-422's fix for the red team's F3; the cost of one replay of a body of about 1 MiB is T-422's measurement (75 ms), so the cost bound is the budget times that [documented].

**1(c) `apps/adjudicator/src/drand-fork.test.ts`.** Forking a public Sepolia node at its head failed 1 of 6 times with `block not found: 0xb9b760`; anvil exited [measured]. The fork now starts 8 blocks behind the node's head (`FORK_BEHIND`), and 10 of 10 forks started [measured]. A fork at that block runs its clock 99 to 120 s behind; `anvil_setTime` brings it within 1 s, which the test now calls before its deals, since they are timed by the wall clock and the drand rounds by real time [measured]. The whole test then passed against a public Sepolia node, 1 of 1 in 168 s [measured]. It still proves that the fallback and the appeal adjudicator decide from live quicknet rounds, that the rules contract accepts both decisions, and that a bad proof never reaches it.

**Local checks (kind 4 for the test files).** `pnpm exec vitest run` over the three files: 2 files passed, 1 skipped (the fork test, without `SEPOLIA_FORK_RPC`); 25 tests passed. `pnpm build` (typecheck) exit 0; `pnpm exec eslint` on the three files exit 0 [measured].

## Handoff

Filled in at the end.
