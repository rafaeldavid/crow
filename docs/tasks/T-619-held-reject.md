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
- [ ] An Opus red team, findings fixed (Evidence).

## Out of scope

- The adjudicator latency figures on Crow Control: they will count the hold as waiting time and need it taken out (the research note, section 7). A follow-up for the console's lane.
- `apps/test-agents` (the hosted test counterparties) keep their 60 s windows on purpose: they are fast test deals.

## Evidence

Filled at the PR; see the PR's Verification section.

## Decisions

- **`prepare/offer` keeps `DEFAULT_TIMING` for rubric deals** [measured]. Changing it made `examples/verify.ts` refuse every rubric offer prepared without windows (`refusing to sign: body.timing.judgeBy differs from what you asked for`), and outside sellers following `site/ref/http-seller.txt` compute the same 300 s. The long windows come from Crow's tools instead (ADR-0051 section 4).
- **The rule lives in `@holdback/judgment`, not `apps/adjudicator`** [measured]. Importing the adjudicator into the testkit made `site/seller-worker.mjs` carry the whole adjudicator service, which `site/build.mjs` refuses.
- **The accept fixture is `held-reject-accept-signed-at-once`, not `attack.accept-never-held`:** the `attack.` prefix fails a first-instance release, which is what it shows.
- **The buyer's `--accept` takes the seller's signed delivery as a file:** no read serves it (`docs/api.md`), as for every early accept (D32).

## Handoff

Done: the code, tests, fixtures, guides and records above. Not done: the red team's fixes (Evidence); the deploys (Rafa's). New bundle hashes for the partner pages, in the PR. Pre-existing and unrelated: `apps/own-seller/src/frozen.test.ts` fails locally on any branch that touches `packages/` or `examples/seller-adapter-core.ts` (it is T-478's branch check, and CI's shallow checkout skips it).
