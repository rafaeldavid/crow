# T-604: follow-ups from the 2026-11-25 reviews

- **Lane:** api
- **Phase:** 2
- **Depends on:** T-057, T-313, T-574, T-597 (D92, PR 795), T-600
- **Paths this task may touch:** `apps/demo-cloud/src/` (worker.ts, world.ts and their tests), `docs/operations.md` (the alarm's behaviour, which item 1 changes), `apps/adjudicator/src/` (service.ts and check-kinds.test.ts, item 2), `spec/openapi/paths.json`, `spec/openapi.json`, this file
- **Human gate:** yes for the deploy only; the code is in-repo
- **Status:** review
- **Agent/session:** review-follow-ups, a side session of the coordinator, 2026-11-25; branch `t-604-review-follow-ups`
- **Roadmap row:** N222

## What exists

- **The alarm** (`apps/demo-cloud/src/worker.ts`, T-057 and T-313): before this task, a pass that threw left the next one to the Cloudflare runtime's retries. A request re-arms an alarm that is more than 5 s overdue.
- **The doubling cadence** (`apps/demo-cloud/src/world.ts`, `nextPass`): each pass in a row that changes nothing doubles the wait, up to 60 s.

## Intent

Clear the small findings that the 2026-11-25 reviews left open, with one commit for each item.

1. A pass that throws once must not wait out the runtime's backoff. The World logs the failure, with no secrets, and runs the next pass about 1 s later. A failure that never clears must not turn into an endless loop.
2. D92 (PR 795): add the check-kind condition to the `cannotJudge` notice, and test the appeal role through `decideTask`. PR 795 merged at 09:46 UTC, while this task ran.
3. The OpenAPI text for `demo.judges.panel` names `unavailable` too.
4. Decide whether Crow's offer-time gate (`offerGate`: the judge budget and the missing judge variables) also applies when Crow is the fallback.

Non-goals: no schema shape, signed type, contract or money path changes.

## Context

- The private triage note on adjudicator latency, 2026-11-25: item 1.
- D92 and PR 795: items 2 and 4.
- PR 797 (T-600): items 3 and 4.

## Acceptance criteria

- [x] A pass that throws once: `alarm()` resolves, logs one warning, and the next pass runs 1 s later and takes its step.
- [x] A pass that keeps failing waits 1, 2, 4 and 8 s. A read does not bring it forward. The next failure, and any failure on a runtime retry, is thrown to the runtime.
- [x] The warning cuts every URL to its host, also one that the RPC client rewrote.
- [x] The OpenAPI description names the three values, and `pnpm validate:spec` passes.
- [x] Item 4 is decided, with the reasons in this file.
- [x] `cannotJudge` names an unrun check kind at every role, and a `decideTask` test covers the appeal role on an escalated deal.

## Out of scope

- Any change to what D92 refuses.

## Evidence

All measured on 2026-11-25 unless labelled.

- **Before the fix:** the first tests for item 1 failed against `main`'s code (3 new tests and the changed T-313 test). The tests for the corrected design then failed against the first version of the fix (4 tests).
- **Local `workerd`** (Miniflare from a cached Wrangler 4.80.0, not the repo's pinned version; the built `worker.js` with every pass made to throw, one discovery request, 200 s): alarms ran at 0, 1, 3, 7 and 15 s with `isRetry=false`. Retries 1 to 6 followed at 17.2, 21.7, 30.2, 49.2, 82.2 and 147.1 s with `isRetry=true`. The runtime built a new instance before each of the last two, and neither started the short retries again. No further alarm ran before the probe ended. That the runtime stops after retry 6 is Cloudflare's documented limit.
- **Item 2:** the `cannotJudge` test failed before the change. The appeal test passed at once, since PR 795 built that behaviour. Its control step shows the same task decided once the build runs the kind.
- **Checks on the final code,** on `main` at `91430b55`: `corepack pnpm test` ran 288 test files and 5,779 tests, all passed, with 26 files and 315 tests skipped. `pnpm typecheck` and `pnpm lint` are clean. `pnpm snap` passed 57 of 57. `pnpm validate:spec` passed. `node site/build.mjs && node site/check.mjs` passed and changed no tracked file, so no pinned bundle moved.
- **Review:** one `reviewer` pass, on items 1, 3 and 4. It found one blocking problem in the first version of item 1 (below). **It did not see the corrected item 1 or item 2.** The corrected item 1 rests on the new tests and the `workerd` run above.

## Decisions

### Item 1: the World retries a few times, then hands back to the runtime

- **The first version was wrong.** It caught every failure and doubled the wait up to 60 s. The reviewer showed in local `workerd` that the runtime drops an idle instance during a wait of 16 s. That reset the count in memory, so a lasting failure looped every 1 to 16 s with no end.
- **Built:** the World arms the alarm itself for 4 failures in a row (1, 2, 4 and 8 s, each under the runtime's 10 s idle limit). It rethrows the next one, and any failure on a retry the runtime started (`isRetry`). The task asked for no rethrow. This rethrows only where catching would make a loop.
- **Rejected:** a failure count in a storage row. It needs a row write for each failure, its own end rule, and storage that works while storage may be what fails.
- **A world that cannot open is unchanged.** `open()` runs inside `blockConcurrencyWhile`, and the runtime resets the object when that callback throws, so no `catch` in `alarm()` sees it (the reviewer measured this in local `workerd`). The runtime's own retries apply, as before.
- **An earlier alarm is kept.** A request that arrives while a pass waits for the chain may set a sooner alarm.
- **The doubling cadence stays.** `work()` counts a failed pass as one that changed nothing, so a read does not bring a retry forward.

### Item 3: no version bump

`spec/README.md` asks for a version bump when `spec/schemas/` changes. This changes the description of a free-form field. Earlier description-only edits to `spec/openapi/paths.json` made no bump (for example commits `78ac449a` and `765c8d37`).

### Item 4: the offer-time gate stays the primary's alone

**State:** not built. The code is as on `main`.

**The finding** (red team of PR 797). Crow can be the fallback behind another operator's primary. Its `declines('fallback')` does not ask `offerGate`. So Crow does not decline such a deal at offer time while its judge budget is spent or its judge variables are incomplete. If its turn then needs a panel it cannot run, the seats abstain and the deal escalates (T-574, T-600).

**Why the gate stays off.** The code facts are read from `main` at `91430b55`. I ran no test for this decision.

1. **The gate alone would make a false statement.** `declines` says why a service would decline a role. The takeover pass (`apps/adjudicator/src/service.ts`) never asks `offerGate`. So Crow would still take the turn, while the operator's notice said it "will decline its fallback turn".
2. **The answer at offer time does not predict the turn.** For the fallback and the appeal role, `declines` asks no bond, clock or delivery question. The budget resets at 00:00 UTC, and a later deploy can restore the judge variables. The turn comes after `judgeBy`, which the parties may set far ahead (D31).
3. **It adds a refusal that a third party can set off.** `POST /v1/prepare/offer` refuses to fill in this operator's default adjudicator when that adjudicator declines (`apps/operator/src/prepare.ts`). With the gate, a spent budget would also stop that route for one more kind of offer: it can need a panel, names an outside primary and leaves the fallback out. Anyone can spend the budget with their own deals. T-581 limits this for each seller and buyer pair, not across new addresses [inferred]. The parties could still name Crow's fallback themselves, so the refusal would protect nobody.
4. **D92's "signs nothing" is a different case.** D92 covers what a build cannot run. That follows from the terms and the build, and the turn itself refuses it, so the offer-time answer and the turn agree. A judge budget or a missing variable is a condition at the time of the turn.
5. **The parties can see the panel's state first (D32), with one gap.** The operators' offer answers for a deal with a rubric carry the panel notice, whoever the primary is. `demo.judges` shows the panel's state, but its `judgedDeals` speaks for Crow's primary. A `checks-only` offer with an optional check gets no panel notice at prepare. **The gap:** the notice says Crow's "adjudicators" decline deals that can need a panel (`livePanel` and `CLOSED_PANEL` in `apps/demo-cloud/src/world.ts`). For Crow as fallback that is wrong: it takes the turn, and its panel abstains.

**The cost of leaving it.** Such a deal can lose its fallback judgment. Crow takes a fallback turn only under an appeal adjudicator it trusts, which in this world is one of its own three. That appeal panel can still decide if the budget or the variables return before the escalation's deadline. If it does not, the default outcome returns the price and the fee to the buyer, and the seller is unpaid (phase one).

**The case for the other side.** A takeover that refused and retried on each pass could run the fallback panel after a budget reset, when `fallbackBy` is late enough. Today's abstaining result is kept, and the panel never runs again. That change belongs to the takeover and the turn, not to the offer-time gate, and it would change T-574's "abstains, so it escalates". It must also leave alone a turn that the required checks decide with no panel.

## Handoff

**Done:** all four items. Nothing is deployed.

- **Deploy:** the operators' next deploy carries items 1 and 2. Rafa's gate. After it, search the Workers logs for `an adjudicator pass failed`.
- **For triage, none built:**
  - Low: a check kind that stage 1 lists in `CHECK_TYPES` but has no evaluator for makes `evaluate` return nothing and throw on a delivery that parses as a table (`packages/judgment/src/checks/index.ts`). Only a test that edits the set reaches this today, since `CHECK_TYPES` and the evaluators ship together.
  - Low: the panel notices should say that Crow's primary declines (item 4, reason 5).
  - Low: `redact` in `worker.ts` cuts only the RPC URL as configured. The reviewer measured that viem's rewritten forms (credentials removed, an uppercase scheme) pass it. Item 1's warning cuts every URL, but the older `console.error` lines still use `redact` alone.
  - [inferred] `idlePasses` and `lastActive` in `world.ts` live in memory too. If the runtime drops the instance between passes, a stuck case with no traffic may never reach the 60 s cadence or the 15-minute stop. The `wakes` count on the telemetry day line can show it.
  - Low: a failed pass that the World retries itself does not show in the Durable Object's error count, and it flushes telemetry only when request lines wait.
