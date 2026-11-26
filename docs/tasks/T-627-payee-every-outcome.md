# T-627: the deal record names who was paid after an early accept and a default outcome

- **Lane:** settlement (the chain adapter) and api (the deal record in `examples/`)
- **Phase:** 2
- **Depends on:** T-621 (the chain adapter's postings after a decision and a reclaim)
- **Paths this task may touch:** `packages/settlement/evm/evm-settlement.ts` and its test, `examples/deal-record.ts`, `examples/deal-record.test.ts`, `examples/deal-record-chain.test.ts`, `examples/seller-invoice.ts` (one comment), `examples/setup.ts` (one note) and `examples/setup-bundle.test.ts`, the generated `site/*.mjs` bundles and `examples/seller-worker-pin.ts`, this file
- **Human gate:** yes. The new postings take effect only when both operators run this code; the record's new check only when the site serves the rebuilt bundles. Both deploys are Rafa's. The change moves the pinned `buy.mjs` (D101).
- **Status:** in progress
- **Agent/session:** payee-every-outcome, 2026-11-26
- **Roadmap row:** N142

## What exists

- The stranger smoke test after the 2026-11-25 22:15 deploy measured `paidTo: null` in the seller's record of a Released deal, and both postings checks "not run" in the buyer's record, because "the operators' events carry no postings" (crow-private `case-studies/2026-11-25-stranger-smoke-test-after-2215.md`).
- T-621 (PR 836, deployed to both operators at 06:19 UTC on 2026-11-26) writes postings on the settled event of a decision and a reclaim, from the rules contract's logs. Every deal in that smoke test was settled by a decision.
- T-621 left early accepts, default outcomes and decisions on a price of 0 without postings: the record's "postings follow the outcome" check fails SimChain's own postings for the first two.

## Intent

The record of every outcome that moves money out of escrow names who was paid and how much, for the buyer and the seller, and runs both postings checks. Each figure comes from the rules contract's logs, read by each operator from the chain, and the record compares the operators' answers.

**Non-goals:** any contract, schema or route change. Reading the chain from the record itself (it would tell an RPC provider which deal the party looks at, D35). A new field in the record's row: the postings carry the amounts.

## Context

- ADR-0033: money goes to the seller's payout address and back to the buyer's payment address.
- `contracts/src/HoldbackRules.sol`: `earlyAccept` emits `PaymentReleased(price)` and `Refunded(fee)`; `triggerDefault` emits `Defaulted` and `Refunded(price + fee)`.
- `packages/settlement/sim/simchain.ts`: the same postings and labels on SimChain.
- D101: `buy.mjs` keeps its bytes unless Rafa says otherwise.

## Acceptance criteria

- [ ] On anvil, an early accept and a default outcome write postings equal to what each address received.
- [ ] On SimChain and on anvil, the record of an early accept names `paidTo` and no `refundedTo`; the record of a default outcome names `refundedTo`. Both postings checks pass, for the buyer's and the seller's record.
- [ ] A decision on a price of 0 writes the fee's posting, and the record's checks pass on it.
- [ ] No schema, route or contract change.
- [ ] One deal on Sepolia through the live guides, after the deploy: its record names the payee and both postings checks pass.

## Evidence

## Decisions

## Handoff
