# T-619: Crow's adjudicators hold a rubric deal's reject before signing it

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** ADR-0048 (D104), ADR-0051 (D107)
- **Paths this task may touch:** `packages/judgment/src/hold.ts` and its export, `apps/adjudicator/src/` (decide path, `hold.ts`, tests), `apps/demo-cloud/src/` (world, telemetry, tests), `examples/seller-adapter-core.ts`, `examples/held-reject.ts`, `examples/audit-deal.ts`, `packages/testkit/src/stub-settlement.ts`, `fixtures/`, `site/` (guides and rebuilt bundles), `docs/decisions/ADR-0051-held-reject.md`, `docs/decisions-today.md` (D107), `docs/api.md`, `docs/neutrality.md`, `docs/judgment-and-defenses.md`
- **Human gate:** no for the code; the deploys of the Workers and the site that carry it are Rafa's
- **Status:** review
- **Agent/session:** Claude Code session in worktree `held-reject-interim-22d9a6`, started by the coordinator on 2026-11-25
- **Roadmap row:** none

## What exists

- **Before a decision lands, the parties already have moves** (`docs/what-a-deal-can-do.md`; `site/ref/after-funding.txt`, "Beyond the happy path"): in `Delivered` the buyer alone may accept early, and in `Delivered` or `Escalated` both may settle by agreement. Nothing else is needed on chain.
- **What was missing:** Crow's adjudicators signed a reject the moment the panel returned, so the window closed in seconds. On 2026-11-25 a design partner's delivery passed every check and was refunded 48 s after the escalation, and the buyer, who wanted the work, had no move left.
- **ADR-0048** gives the window in the next contract version. This task gives the same window now, with no contract change.

## Intent

On a deal whose terms carry a rubric, Crow's reference adjudicators publish a panel's reject at once and sign it later: the primary at the record's `decidedAt` plus `judgeWithinSec` minus 600 s, the appeal adjudicator after an escalation at `decidedAt` plus `appealDecideSec` minus 600 s, never later than the turn's deadline minus 600 s. Accepts, escalations, the fallback's decision and checks-only deals sign at once. The rule is fixed and reads only the signed terms, the turn and the outcome. The operators wake the adjudicator once at the hold's end, say on the state read that a reject is held and until when, reserve no judge calls for a held deal, and count held, rescued, signed and missed. Crow's seller tools write 87,000 s for both windows on a rubric deal. A new buyer command notices a held reject and runs the existing accept or settlement.

Non-goals: no contract, schema, signed type or `packages/core` change; no early hand-out of the signed reject (research open point 4); the pinned buyer bundles `buy.mjs` and `try.mjs` do not change.

## Context

ADR-0001, ADR-0006, ADR-0019, ADR-0031 section 8, ADR-0048, ADR-0051; D26, D31, D32, D104, D107. Design: the private research note `roadmap/triage/2026-11-25-held-reject-research.md`.

## Acceptance criteria

- [x] `holdUntil` in `packages/judgment/src/hold.ts`, run by `decideTask` between publishing the record and signing, and by the scenario runner.
- [x] A restart mid-hold signs at the same second and runs no second panel (`apps/adjudicator/src/hold.test.ts`, `attack.held-reject-restart-no-second-panel`).
- [x] A held reject is signed no later than the deadline minus 600 s, over a grid of windows and decision times, and a late wake still signs before `judgeBy` (`hold.test.ts`).
- [x] `workAt` wakes at the hold's end; the state read's notice; no reserved judge calls for a held deal; `heldRejects` counts (`apps/demo-cloud/src/held-reject.test.ts`, `world.test.ts`).
- [x] The seller adapter's `rubricTiming` default writes 87,000 s for rubric offers; checks-only offers keep `timing`.
- [x] `examples/held-reject.ts` with a sim-world test of accept and settlement.
- [x] Guides: `site/ref/after-funding.txt` "A held reject", lines in `site/buy.txt`, `site/ref/adjudicators.txt` and `site/ref/http-seller.txt`, within the first-deal budget.
- [x] Fixtures: the nine held-reject scenarios, including `neutrality.held-reject-adjudicator-offline`.
- [x] An Opus red team, findings fixed (Evidence).

## Out of scope

- The adjudicator latency figures on Crow Control: they will count the hold as waiting time and need it taken out (the research note, section 7). A follow-up for the console's lane.
- `apps/test-agents` (the hosted test counterparties) keep their 60 s windows on purpose: they are fast test deals.

## Evidence

All measured on the branch after merging `origin/main` at `7f29c3a` (PR 827, agg-5's new default policy), 2026-11-25:

- `corepack pnpm typecheck`: pass. `corepack pnpm lint`: pass.
- `vitest run apps/adjudicator apps/demo-cloud packages/judgment packages/testkit examples/held-reject.test.ts examples/seller-adapter* examples/audit-deal.test.ts examples/serve.test.ts examples/setup-bundle.test.ts`: 2,329 passed, 3 expected fail, 35 skipped. The hold tests run under the new default policy.
- `vitest run apps/operator apps/own-seller`: 362 passed, 1 failed: `apps/own-seller/src/frozen.test.ts`, T-478's branch check, which fails on any branch touching `packages/` or `examples/seller-adapter-core.ts` and which CI's shallow checkout skips (inferred from `ci.yml`).
- `pnpm snap`: 73 passed, 0 failed. The ten held-reject snapshots were updated after the merge: only the policy, template, input and commitment hash lines changed, because agg-5's default policy has a new hash; `held-reject-accept-signed-at-once` was re-recorded with fake judges for the same reason. Outcomes and balances are unchanged.
- `node site/build.mjs && node site/check.mjs`: pass. First-deal paths: buyer 4,995 and seller 4,994 of 5,000 tokens (estimate). New hashes: `setup.mjs` `c332e333b286a41e63fdf08ad42933b917104a618fb42eca318af5acac1b1aa1`, `serve.mjs` `37b7667ca25c4c88f4372f6a87701bbbda4406ba2d320014dbd0256a8cd03908`, `seller-worker.mjs` `d409200baa800f122916482587db640fb086a575700c01437ed9fe2f215be2e1`. `buy.mjs` and `try.mjs` are unchanged against `origin/main`.
- **Red team (Opus, `red-teamer`):** no Critical or High. Fixed: M1 (the hold had no cap; now a day at most, and a held task skips the preflight), M2 (a service without `judgedStore` judged again after a restart; now it does not hold), L2 (the held notice hid a waiting adjudicator; now after it), L3 (`rubricTiming` overrode the seller API's `deliverWithinSec`; now the API wins). Documented: M3 (a settlement paying the seller less than the fee beats the signed reject for both parties; ADR-0048 fixes it), L4 (guides now say "up to a day", sealed terms are not held). Open: L1 (scale the 600 s margin with the window), in Handoff. Tests: `apps/adjudicator/src/hold.redteam.test.ts`, `attack.held-reject-fee-dodge`.

## Decisions

- **`prepare/offer` keeps `DEFAULT_TIMING` for rubric deals** [measured]. Changing it made `examples/verify.ts` refuse every rubric offer prepared without windows (`refusing to sign: body.timing.judgeBy differs from what you asked for`), and outside sellers following `site/ref/http-seller.txt` compute the same 300 s. The long windows come from Crow's tools instead (ADR-0051 section 4).
- **The rule lives in `@holdback/judgment`, not `apps/adjudicator`** [measured]. Importing the adjudicator into the testkit made `site/seller-worker.mjs` carry the whole adjudicator service, which `site/build.mjs` refuses.
- **The accept fixture is `held-reject-accept-signed-at-once`, not `attack.accept-never-held`:** the `attack.` prefix fails a first-instance release, which is what it shows.
- **The buyer's `--accept` takes the seller's signed delivery as a file:** no read serves it (`docs/api.md`), as for every early accept (D32).

## Handoff

Done: the code, tests, fixtures, guides, records and the red team's fixes above. Not done: the deploys (Rafa's: the demo Workers carry the adjudicator and operator change; the site carries the guides and bundles). Open: red team L1, a margin that scales with the window (for example max(600 s, 5% of the window)); a count of rescues that pay the seller less than the fee (M3); the latency figures on Crow Control (Out of scope). New bundle hashes for the partner pages, in the PR. Pre-existing and unrelated: `apps/own-seller/src/frozen.test.ts` fails locally on any branch that touches `packages/` or `examples/seller-adapter-core.ts` (it is T-478's branch check, and CI's shallow checkout skips it).
