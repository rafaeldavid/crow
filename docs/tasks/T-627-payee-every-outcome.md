# T-627: the deal record names who was paid after an early accept and a default outcome

- **Lane:** settlement (the chain adapter) and api (the deal record in `examples/`)
- **Phase:** 2
- **Depends on:** T-621 (the chain adapter's postings after a decision and a reclaim)
- **Paths this task may touch:** `packages/settlement/evm/evm-settlement.ts` and its test, `examples/deal-record.ts`, `examples/deal-record.test.ts`, `examples/deal-record-chain.test.ts`, `examples/seller-invoice.ts` (one comment), `examples/setup.ts` (one note) and `examples/setup-bundle.test.ts`, the generated `site/*.mjs` bundles and `examples/seller-worker-pin.ts`, this file
- **Human gate:** yes. The new postings take effect only when both operators run this code; the record's new check only when the site serves the rebuilt bundles. Both deploys are Rafa's. The change moves the pinned `buy.mjs` (D101).
- **Status:** review
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

- [x] On anvil, an early accept and a default outcome write postings equal to what each address received.
- [x] On SimChain and on anvil, the record of an early accept names `paidTo` and no `refundedTo`; the record of a default outcome names `refundedTo` (on SimChain; on anvil its postings only, see Evidence). Both postings checks pass, for the buyer's and the seller's record.
- [x] A decision on a price of 0 writes the fee's posting, and the record's checks pass on it.
- [x] No schema, route or contract change.
- [ ] One deal on Sepolia through the live guides, after the deploy: its record names the payee and both postings checks pass.

## Evidence

Measured on this machine on 2026-11-26, Node 22.23.4, anvil and forge 1.0.0, unless labelled otherwise.

- **The smoke test's deals were all decisions [measured].** The events of `0xb5eba0fc...0ac0` (template sale), `0xf794d3d8...2c00` (take 1) and `0x59c721be...878a` (`buy.mjs`) on api.crow.direct each read `judgment.decided` then `settlement.released`, with no postings: they settled at 22:26 to 22:31 UTC on 2026-11-25, before T-621 reached the operators.
- **T-621 already closes the two measured gaps for decisions [measured].** The coordinator's smoke deal after the 06:19 UTC deploy, `0xcf593575a6d9ac451b01a3e6604d3f8b14e838fe74df859ed5e56af7b2641c03`, carries the same two postings on both operators: 25,000,000 base units of tUSDC to the payout address `0x0e8ffdfd...9668` ("price to the seller") and 1,000,000 to the primary adjudicator `0x7c40a676...9647`, in transaction `0xd0e102a9...fb5c`.
- **Tests failed first [measured].** On `origin/main`'s `deal-record.ts` and `evm-settlement.ts`, with the new tests: SimChain's early accept and default outcome both read "postings follow the outcome" false; the two new `outPostings` unit tests and the reworded `payeeOf` note failed. 5 failed, 3 passed.
- **After the fix and the rebuild [measured]:** the SimChain record test, the invoice, the setup bundle, `take.test.ts` (its creation-code pin included) and the adapter's tests on anvil, 5 files, 126 of 126 passed. Before the rebuild, only the setup bundle's "is the current bundle" test failed.
- **After the fix, on anvil [measured]:** `packages/settlement/evm/evm-settlement.test.ts` and `examples/deal-record-chain.test.ts`, 55 of 55 passed. In them:
  - an early accept writes "price to the seller" and "fee back to the buyer: no adjudicator judged"; a default outcome writes one posting of price plus fee, "price + fee back to the buyer: default outcome". Each list equals what the token says each address received; every event validates against `event.schema.json`;
  - the record of an early accept made during a held reject (ADR-0051), for the buyer and the seller: `paidTo` the payout address, `refundedTo` null, both postings checks pass, no check fails;
  - the record of a decision on a price of 0: `paidTo` and `refundedTo` null, one posting (the fee to the primary), both postings checks pass.
- **A default outcome's record is measured on SimChain, not on anvil [measured; inferred for anvil].** The anvil world has no clock to move past `judgeBy` and `fallbackBy`. The adapter's anvil test shows the default's posting equals the token's transfer, and SimChain's record of the same shape passes both checks for both parties, so the record on a chain reads it the same way (inferred).
- **Suites [measured]:** `examples/`, `tests/` and `packages/settlement`, without anvil: 148 files, 2,597 passed, 297 skipped, 0 failed. `pnpm build`, `pnpm lint` and `node site/check.mjs` passed. No file under `spec/` or `contracts/` changed.
- **Bundles, against `origin/main` at `52207123` [measured]:**

| File | `origin/main` SHA-256 | This branch SHA-256 |
| --- | --- | --- |
| `site/buy.mjs` | `94e1b860cd631e9500b587c231059ae37212f0bf100606a0696e387bc44176fd` | `fe575234599b4af21f4da0bbd649cb56cf830a663c6438f48303334ed87a1a17` |
| `site/take.mjs` | `9468505cf3bad14bfab5d4f1a564faeab1e7c852168cfc68042776570530ccc4` | `bed4ae7186f88386d750d615723371b465abdc45bd8a67e795aefe703e31def2` |
| `site/setup.mjs` | `a3ae6d815959cd453516a886908402c37201c1e3a8f693497d0070baa71cb89f` | `5d7636bd9f7671523d3436a37e816c1770042e5346e736e5ebd872aa806ed0c9` |
| `site/seller-worker.mjs` | `86d1b081d773fa78133cac242baaf7ea96d14b59c430df4682cc3b99acb9ba92` | `d657b868101c02e281999024215f4fc6d41c5713b8d06fb9d6459cdbc547bb3b` |

  `buy.mjs`, `take.mjs` and `setup.mjs` carry `deal-record.ts`; `setup.mjs` also carries `seller-invoice.ts` and the `payeeOf` note, and `seller-worker.mjs` holds the chain adapter. `try.mjs`, `serve.mjs`, `preflight.mjs` and the `try-*` bundles keep their bytes. The guides name each hash through a placeholder the build fills (`{{BUY_INSTALL}}` in `site/buy.txt`), so no guide source changes.

- **Review** (kind 5, one red team, given the commit, CLAUDE.md, ADR-0033, ADR-0051 and the architecture's postings section, not this file's conclusions): no Critical or High finding; one Medium and three Low. Fixed, test first:
  - M1 (a regression of this change, measured by the red team on SimChain and anvil): `setup.mjs first-deal` waited 2 minutes and failed after a release at a price of 0, whose postings name no payee. `payeeOf` now holds the signed terms' payout address to the answer there;
  - L2: an early accept's postings must pay exactly the price to the payout address and exactly the rest to the payment address.
  After the fixes and the rebuild: the six affected files with anvil, 131 of 131 passed; `pnpm lint` and `node site/check.mjs` passed [measured].

## Decisions

- **The source is the rules contract's logs, as each operator reads them.** The operators already turn `PaymentReleased`, `Refunded` and `FeePaid` into the settled event's postings (T-621). This task adds the three calls T-621 left out. No route, no schema change and no contract change. Each operator reads the chain on its own, and the record keeps a section per operator where they differ, so one operator's word alone does not make the record.
- **The record does not read the chain itself.** It would need an RPC provider, which would learn which deal the party looks at (D35); the record's transactions list lets the party check the token's transfers where it chooses.
- **The early accept and the default are told by the event's `via` and the log.** An early accept is a release with `via: 'early_accept'` and no decision; a default is a refund with `via: 'default_outcome'` after `default.triggered`. On any other release the fee must still go to an adjudicator the terms name.
- **`refundedTo` needs part of the price back.** An early accept returns only the adjudication fee, which is no refund of the price; the seller's invoice already reads `refundedTo` that way and would refuse the record otherwise.
- **`buy.mjs` is re-pinned with Rafa's yes (D101).** Asked in the journeys thread on 2026-11-26, "Re-pin buy.mjs so its deal record handles early accepts and default outcomes?", Rafa answered "Yes, re-pin" (relayed by the journeys session).

## Handoff

**Done:** the adapter's postings for an early accept, a default outcome and a decision on a price of 0; the record's check and `refundedTo`; the review's M1 and L2; the rebuilt bundles.

**What each deploy turns on (the coordinator's batch, Rafa's word):**

- **Both operators, together** (one World, `apps/demo-cloud/wrangler.op2.jsonc`): postings on early accepts, defaults and price-0 decisions that settle afterwards. Deploy both at once: with one operator on this code and the other not, such a deal's settlement sections disagree for good, and the record names no payee (red team L3, inferred).
- **The site:** the new `buy.mjs`, `take.mjs`, `setup.mjs` and `seller-worker.mjs`. The coordinator then rebuilds the partner page that pins `setup.mjs`.
- Records of deals that settled before the deploy keep what their events carry.

**Left open:**

- The Sepolia deal through the live guides after the deploy: one early accept during a held reject (`held-reject.mjs --accept`) or one decided deal, its buyer's and seller's records, both postings checks, and the payee lines with the commitment ID.
- Red team L1 (SimChain only, Low): where one address is both money addresses, a refunded deal's row reads `paidTo` set and `refundedTo` null. On a chain the adapter writes no postings for such a deal, so no deployed path shows it; the invoice refuses the record either way.

**To resume:** `git switch t-627-payee-every-outcome`. The anvil tests need `forge build` in `contracts/` with the submodules checked out as `.github/workflows/ci.yml` does.
