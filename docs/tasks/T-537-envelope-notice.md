# T-537: the parties see when an adjudicator cannot open its envelope

- **Lane:** judgment
- **Phase:** 2
- **Kind:** 5, settlement and judgment code (`docs/team.md`, Change recipes): the packages' tests and one review
- **Depends on:** T-523 (the triage of an outside scan's findings), D81
- **Paths this task may touch:** `apps/adjudicator/src/service.ts`, `apps/adjudicator/src/service.test.ts`, `apps/adjudicator/scripts/mutants.mjs` (the mutant on the changed line), `apps/demo-cloud/src/refusals.test.ts`, `docs/decisions-today.md` (D81), `docs/audit/known-issues.md` (the H-2 row), this file
- **Human gate:** no for the change; a deploy of the operators is Rafa's
- **Status:** in review
- **Agent/session:** scan-fixes-main, on Rafa's word of 2026-11-18
- **Roadmap row:** N191

## Intent

ADR-0031's red team (H-2) found that a seller can choose which adjudicator decides by giving the primary an envelope it cannot open. Its follow-up proposed that the reference primary sign a reject then. Rafa declined that (D81): a reject is final, and an envelope can fail through the adjudicator's own key. The service already retried silently; neither party saw the turn drift to the fallback.

Now the refusal is a turn the adjudicator cannot take yet (`adjudicator_unavailable`), with a detail that says what follows. The hosted world shows it on the deal's state read to both parties, and logs it once. A delivery with no envelope for the primary is said the same way. Nothing is signed or published, and the fallback and the default stay as they were.

Non-goals: no reject, no contract change, no change to the fallback's or the appeal adjudicator's turn. An on-chain signal waits for the rebuilt contracts (D81, row N26).

## Acceptance criteria

- [x] An envelope the primary cannot open is refused as `adjudicator_unavailable`, retried on each pass, and never decided; the fallback still decides after `judgeBy`.
- [x] A delivery with no envelope for the primary is refused the same way, before any judge is called.
- [x] The hosted world's state read tells the buyer and the seller, and the log has the line once.
- [x] The mutant that turns the refusal into a reject is killed by the tests.
- [x] Each new test fails before the change and passes after it.
- [ ] One review has read the change, and its blocking findings are fixed.

## Evidence

Measured on 2026-11-18 in the worktree `t-537-envelope-notice`, unless marked.

- **Before the change.** With `apps/adjudicator/src/service.ts` at `origin/main`, these failed:
  - `apps/adjudicator/src/service.test.ts`: "a key the primary cannot unwrap refuses without a record or a decision; the fallback takes over at judgeBy" (extended: type, detail, a second pass) and "a delivery with no envelope for the primary is said the same way, retried and never decided (T-537)";
  - `apps/demo-cloud/src/refusals.test.ts`: "says the primary cannot open its envelope when the seller signed a delivery whose envelope for it does not open".
- **After the change.** All three pass. `service.test.ts`, `unreadable-delivery.test.ts`, `refusals.test.ts`, `world.test.ts` and the root checks `cut-feature-alignment` and `decisions-status`: 261 of 262 passed in one run; the one failure, "a party appeal that overturns an accept signs reject", took 38 s under the load below and passes alone. `eslint` on the changed files and `pnpm typecheck` exit 0.
- **Load.** The machine ran other sessions' suites at a load average of 44 to 69; `apps/adjudicator/src/hung-read.test.ts`'s timing bounds failed with and without this change (3 of 13 both ways), so they say nothing about it. CI runs them on a clean runner.

## Handoff

**A deploy of the operators would carry:** the hosted adjudicators say on the state read when they cannot open their envelope, instead of nothing. No deal settles differently.

**Open:** the on-chain signal for the rebuilt contracts (D81) is a roadmap item for the coordinator, not built here.
