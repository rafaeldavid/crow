# T-503: the seller signs a full refund a buyer can countersign

- **Lane:** demo (the seller adapter in `examples/`, which the hosted sellers bundle)
- **Phase:** 2
- **Depends on:** T-329 (the ready credential), T-434 (the adapter core), T-501 (deal 1 closed when its job moved to deal 2)
- **Paths this task may touch:** `examples/seller-adapter-core.ts`, `examples/seller-adapter-refund.test.ts` (new), `apps/hosted-sellers/src/worker.ts` (its header comment), `site/ref/seller-adapter.txt` (one paragraph), `site/setup.mjs` (rebuilt: it bundles the adapter core), this file.
- **Human gate:** yes, for the redeploy of `pilot-scan-1` only (Rafa). The code stays inside the repository.
- **Status:** done (merged as `9501b84c`, PR 627; `pilot-scan-1` deployed 2026-11-18 08:08 UTC, version `2e297344…`)
- **Agent/session:** session zealous-jepsen, 2026-11-18, branch `t-503-seller-refund`.
- **Roadmap row:** N134 (its leftover: the second buyer's deal 1)
- **Change kind:** moves money: the examples' and the hosted sellers' tests, one red-team pass.

## Intent

Restated in my own words.

The second buyer's first deal (`0x07c01cc0…54c9`) is Held with nothing delivered: the seller refused the partner's report, and the same job was delivered in deal 2. Rafa wants buyer and seller to agree a refund together (2026-11-18), before the deal refunds itself after `deliverBy`, 2026-11-24 07:00:59 UTC.

The buyer can already settle over the public API. The seller cannot: its signing key is the `HOLDBACK_KEY` Worker secret of `pilot-scan-1`, made by the secrets step and never shown, so only code in that Worker can sign for it. This task adds the one thing missing: a route that makes the seller sign a full refund.

- **Input:** `POST <base>/deals/<commitmentId>/refund`, no body, with the ready credential (`redelivery.readyAuth`).
- **Output:** the `MutualSettlement` with `sellerSignature` filled and `buyerSignature` empty, where to submit it, and its `expiresAt`. The buyer prepares the same message over the API, signs its slot and submits both.
- **Non-goals:** no buyer command (the buyer follows `ref/after-funding.txt`; `buy.mjs` is pinned and unchanged); no seller-side submit; no split other than all to the buyer; no change to the contracts, the operators or the schemas.

## Acceptance criteria

- [x] The route signs only a full refund: one payout of the whole price to the terms' `buyerPaymentAddress`, no delivery named, no key released. It checks what it signed once more and recovers the signature to the terms' seller.
- [x] It signs only while every operator reads the deal `Held`, and never for a deal the adapter is delivering or delivered.
- [x] It works for a deal the journal shows as closed, and closes an open one, so the adapter delivers nothing into a deal it agreed to refund. The deal loop skips the deal while the route signs.
- [x] It is behind the ready credential, POST only, and absent with no ready credential.
- [x] Idempotent: asked again while 10 minutes or more of the signed refund remain, it answers the same settlement; two requests at once get one settlement.
- [x] The settlement is logged in full and kept in the journal (`deal.refund`).
- [x] One operator that prepares another refund (another payout, another expiry) is passed over for the next; with every operator lying, nothing is kept and the deal stays open.
- [x] Every signed refund raises an `ALERT … refund.signed` line and the alert callback, when one is set.
- [x] A SimChain test countersigns as the buyer over the public API and reads `Settled` with the price paid to the buyer and no key released.

## Evidence

- `pnpm vitest run examples/seller-adapter-refund.test.ts`: 7 passed [measured].
- Red team (one pass, 2026-11-18, fixtures in the git-ignored `reports/scratch/t-503-redteam/`): the property held; no input or operator answer made the seller sign another payout, a key release, another commitment or a delivered deal. Forge copies measured that `HoldbackRules` refuses a no-delivery settlement after a delivery (`InvalidMessage`), and that a Held refund pays the price and the whole adjudication fee to the buyer's payment address [measured]. Findings and what changed:
  - Medium: the ready credential now also refunds and closes an undelivered deal, with no alert. Fixed in part: each refund now raises an alert. The separate credential is left for triage (below).
  - Low: one operator could prepare a refund that expires in seconds, and the deal still closed. Fixed: the seller refuses any expiry but its own and passes to the next operator [measured: the fixture now passes].
  - Low (neutrality): a lie at the first operator stopped the refund although the second was honest. Fixed: preparing, checking and signing run per operator, so the route falls over [measured: the fixture now passes].
  - Info: the operator fee, a separate transfer at funding, is not refunded (pilot fees are 0); the log holds the half-signed settlement, which only the buyer can complete.
- `/verify`, kind 5 by risk (it moves money), after the red-team fixes: `pnpm vitest run examples/seller-adapter apps/hosted-sellers site`, 235 tests passed; `pnpm typecheck` and `pnpm lint` clean; `node site/build.mjs && node site/check.mjs` PASS. No scenario fixture or snapshot changed [measured].
- `node site/build.mjs && node site/check.mjs`: PASS. `buy.mjs` keeps SHA-256 `ce610626…311d`; only `setup.mjs` changed, since it bundles the core [measured].

## Decisions

- **The seller signs first and does not submit.** The route takes no input, so nothing a caller sends shapes the message. A stolen credential can only make the seller give the buyer its money back, and close the seller's own deal.
- **23 hours to sign.** `verify.ts` takes a settlement's `expiresAt` up to 24 hours ahead; 23 hours leaves the buyer a working day. A new request after that signs a fresh refund under a new nonce. Only one can settle, since a settled deal is no longer Held.

- **The ready credential, not a new one.** A refund credential of its own would need a new Worker secret and a configuration change for `pilot-scan-1`, with the deal's own clock running. The ready credential already lets its holder steer the seller's deals; a refund adds only giving the buyer its money back. Each refund now alerts. A separate `refundAuth` goes to triage.

## Triage (not in this task)

- A refund credential of its own (`redelivery.refundAuth`), so the ready credential a seller wires into its automation cannot close deals.
- A contract unit test that a no-delivery settlement reverts after a delivery (the red team's `test_t503_noDeliveryRefund_refusedAfterAPostedDelivery`), in `contracts/test/unit/MutationGaps.t.sol`.
- SimChain applies `adjudicatorFeeShareAfterDeliveryBps` to a settlement from `Held` too (simchain.ts, about lines 952 to 963); phase one requires 0, so nothing live changes.

## Handoff

After merge: Rafa redeploys `pilot-scan-1`. Then the seller's operator calls the route for deal 1, the buyer's agent on `buyer-1` countersigns over the API and submits, and the agent reads `Settled` on both operators and the refund on chain.
