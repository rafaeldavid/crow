# T-595: The seller-invoice test no longer fails when the deal is read before its appeal state settles

- **Lane:** api
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `examples/seller-invoice.test.ts`
- **Human gate:** no
- **Status:** review
- **Agent/session:** flaky-seller-invoice
- **Roadmap row:** none (flaky test, 2026-11-25)

## What exists

PR 791's session saw four `seller-invoice` tests fail in a full run on a loaded Mac, with "the operators gave different answers for outcome" and for "steps". They passed alone.

## Intent

Remove the cause of the intermittent failure; no retry, timeout or skip.

## Root cause (measured)

The test's `final()` waited for `finalAt` on one operator. In SimChain, `finalAt` is derived from the clock (D20): with the appeal window of 0 it is set the second the decision lands. `appealState` moves from `none` to `expired` only on the primary adjudicator's next pass (100 ms poll), which applies `expire_appeal`. Under load, `deal-record` read the two operators on either side of that move: one said `none`, the other `expired`, and the record rightly reported a disagreement. Both operators serve one shared SimChain; they did not diverge. The settlement layer's view changed between two reads.

Settlement and operator code is unchanged. The test now waits until every operator serves the deal as settled for good (`finalAt` set, and for a decided deal `appealState` `expired`).

## Evidence

- Before: `vitest run examples/seller-invoice.test.ts` in 20 concurrent processes on 8 cores: 3, 4 and 4 of 20 runs failed (11 of 60), all with an operator disagreement on `outcome` or `steps`.
- After: 0 of 100 runs failed in the same setup.
- `examples/deal-record.test.ts`, same method: 0 of 40 failed. It waits the same way but does not compare the views in a way that fails on this move.
- `corepack pnpm typecheck` and `corepack pnpm lint` pass.

## Handoff

Open question, not changed here: `deal-record` run by hand against a SimChain deal in the second after `finalAt` can still report the same `none`/`expired` disagreement. It is correct to ask the user to run it again; a real EVM or phase-one settlement reports `none` throughout and cannot show it.
