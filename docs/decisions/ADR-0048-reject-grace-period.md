# ADR-0048: A reject returns the price after a grace period the terms set

- **Status:** Accepted, 2026-11-25 (Rafa: "Yes, adopt it"), with the research note's defaults for the open points; built with the next contract version (D85), not on its own. Rafa can overrule any default below.
- **Date:** 2026-11-25
- **Raised by:** Rafa, 2026-11-25: "if the judges fail due to logic complexity buyer and seller should be able to agree to settle so there's needs to be a window between judge decision and buyer accepting the outcome anyways." A design partner's deal was refunded that day although every check and every valid verdict passed the work.
- **Research:** a research note in the maintainers' private repository (`docs/private-materials.md`): what each stage allows today, with line references; seven options against the litmus tests; the changes layer by layer.
- **Builds on:** ADR-0001 (neutrality), ADR-0002 (the hold), ADR-0006 (defended judgment), ADR-0012 (the two-sided hold), ADR-0019 (settlement by agreement), ADR-0031 (phase one: a decision is final), ADR-0039 (the waiver), ADR-0043 (no one-family decision), ADR-0046 (the committed key); D26, D28, D29, D31, D32, D62, D81, D85.
- **Amends when accepted:** ADR-0031 section 8, where a reject is final when written. Under this rule a reject with a grace period above 0 is final when the period ends. An accept stays final when written.
- **Changes when built, by later tasks:** a new version of `contracts/src/` on the next-version branch, a version bump of `spec/schemas/`, `packages/core`, `packages/settlement`, `apps/operator`, `site/`, `formal/`, `fixtures/`, `docs/neutrality.md`, `docs/api.md` and `docs/audit/`. This record changes none of them.

Labels: **measured** (read at `origin/main` `6adfc937`, or in the deal's records), **documented**, **inferred**, **guessed**.

## Summary

1. **The terms gain `timing.rejectGraceSec`,** a number of seconds. The parties choose it. Terms that leave it out get 0.
2. **With 0, a reject refunds in its own transaction, as today.**
3. **With more than 0, a reject holds the price for that long.** The decider's fee is paid at the reject.
4. **During the period the buyer alone may accept** the posted delivery at the agreed price. The seller is paid and the buyer gets the key in one call.
5. **During the period both parties may sign a settlement** with any split of the price.
6. **When the period ends, anyone triggers the refund.**
7. **An accept is never delayed.**
8. **It ships with the next contract version,** which D85 already requires. It is not a reason to redeploy on its own.

## Context

- **The case** [measured, the private deal record of 2026-11-25]. A buyer funded 26 tUSDC for a brand kit. All three deterministic checks passed. Four of eight judge seats over two rounds returned output that the verdict schema filter rejected. The primary escalated. The appeal adjudicator, which accepts a flagged case only unanimously (D27a), signed a reject. The refund landed in the reject's transaction. The buyer wanted the work and had no step left.
- **Today a decision and its money move are one transaction** [measured]. `_firstInstance` and `_escalationDecision` write `Released` or `Refunded` (`HoldbackRules.sol:303`, `:314`), and `_settleDecision` moves the funds in the same call (`:332`, `:333`). After that, `earlyAccept` and `mutualSettle` revert `WrongStage` (`:353`, `:382`).
- **The contract refuses an appeal window above 0** (`:177`; D62).
- **A window exists before a decision.** Both parties may settle in `Held`, `Delivered`, `FallbackJudging` and `Escalated` (`:382`). The buyer alone may accept in `Held` and `Delivered` only (`:353`). The case was `Escalated` for 48 s.
- **After a refund the parties can open a second deal** and sign the settlement that names the delivery and releases its key (ADR-0039's waiver). It needs six signatures (the offer, the adjudicator's acceptance, the agreement, the funding and the two on the settlement) and two transactions, and about 572,704 gas to fund the second hold [measured on Sepolia, 2026-11-13, `docs/operations.md`].
- **A reject can come from the adjudicator's own fault.** ADR-0043 section 4 names the flagged appeal as the place where a silent seat rejects passing work. D81 states the concern: a reject is final, and the failure can be the adjudicator's own.
- **Contract practice has the same step.** A buyer may accept goods that fail the contract (UCC §2-601, §2-606) [documented in general; not opened on 2026-11-25]. Kleros Escrow leaves a settlement period before a dispute (ADR-0019, prior art).
- **The next contract version is due** (D85). ADR-0046, Proposed, already plans EIP-712 domain 0.9 for it.

## Decision

### 1. The term

```json
"timing": { "...": "...", "appealWindowSec": 0, "appealDecideSec": 300, "rejectGraceSec": 600 }
```

- **Meaning:** the seconds a reject holds the price before the refund.
- **Range:** 0 to 2^32 − 1, the range `appealDecideSec` has. A larger value is unrepresentable and refused for that reason only (D31). No other cap, and no minimum.
- **Silent terms:** `prepare/offer` writes 0. The signed terms always carry the field, because EIP-712 hashes it.
- **An integer,** so ADR-0022 holds.
- **A club may narrow the value in its rulebook,** as it narrows the other windows.
- **A new field, not `appealWindowSec`.** D62 fixed that field at 0 because phase one honours no appeal. The two periods mean different things and will differ when appeals return.

### 2. A reject with a grace period

When the primary, the fallback or the appeal adjudicator signs a reject and `rejectGraceSec` is above 0:

- The contract captures the fee for the decider and emits `Decided`, `JobRejected` and `FeePaid`, as today.
- It does not void the price. The deal moves to a new stage, `Rejected`, and stores the block time.
- The key is not released.
- The period ends at that block time plus `rejectGraceSec`. One internal function computes the instant, so the calls that need "before" and the timeout that needs "at or after" split time at the same second (the rule of T-375, RF-3).

With `rejectGraceSec` 0 the contract takes today's path: capture, void, `Refunded`.

### 3. The buyer accepts

- **Who signs:** the buyer, with today's `EarlyAccept` message. It names the attempt and the posted delivery's hash (ADR-0029).
- **Who relays:** anyone. The call carries the key proof for the buyer's envelope, as an early accept does.
- **What moves:** the whole price to the seller's payout address. The buyer's key is released in the same call. Under ADR-0046's rule it is the key the delivery committed.
- **The fee:** stays with the decider. It judged.
- **The deal closes `Released`,** with a closing reason and a key-release path of their own, so a reader can tell this from an early accept and from an adjudicator's accept.
- **Why the seller signs nothing:** the price and the delivery are the ones it already signed. The buyer waives the reject; nothing new is asked of the seller.

### 4. Both parties settle

- `mutualSettle` takes the `Rejected` stage before the period ends, with today's message and both signatures.
- The payouts sum to the price and name the two money addresses only (ADR-0031 section 4).
- The fee stays with the decider. In every other stage a settlement returns the fee to the buyer, because nobody decided.
- `releaseKey` works as today.

### 5. The refund

- From the period's end, anyone calls a new timeout. It voids the price to the buyer's payment address and closes the deal `Refunded`, decided by the adjudicator that signed the reject.
- The operators relay it when due, as they relay `reclaim` and the default. A buyer can send it itself.
- From the same instant the accept and the settlement revert.

### 6. The escrow's expiry

`_escrowExpiry` adds `rejectGraceSec`: `fallbackBy + appealDecideSec + rejectGraceSec + EXPIRY_MARGIN`. A reject signed at the last possible second still leaves the whole period for a capture. The payment address's own reclaim on the escrow after the expiry stays as the backstop (ADR-0003).

### 7. The buyer's accept before a decision (separable)

`earlyAccept` also takes `FallbackJudging` and `Escalated`, the two stages where a settlement is allowed and the buyer's accept is not. The fee returns to the buyer, as in `Delivered`. Rafa may strike this section; sections 1 to 6 stand without it.

### 8. What does not change

- **An accept:** paid in the decision's transaction, whatever the period.
- **A deal decided by checks alone:** unchanged at 0. With a period, a pass is still paid at once; a failed check waits, and the buyer may waive it.
- **`reclaim` and `triggerDefault`:** refund price and fee at once. Nobody decided, so no period follows.
- **The fallback's turn, the beacon rounds, `judgeBy`, `fallbackBy`.**
- **Judging:** no panel, registry or aggregation rule.
- **No admin key, no owner, no pause.** Every new entry point is permissionless.
- **Events:** none removed.

### 9. SimChain and the full protocol

- The `phase_one` profile of `packages/core` gains the `Rejected` state, the two moves in it and the timeout, exactly as the contract takes them.
- The full profile takes the same term. A reject there starts the appeal window and the grace period together. A filed appeal ends the grace period, and the hold follows the appeal [inferred; the formal model checks it before the build].

### 10. Schema, API and model

- **Schema:** the next version after the one live at the build. `commitment.schema.json` gains `timing.rejectGraceSec`; `commitment-state.schema.json` gains `Rejected`; the read model gains the period's end among `deadlines`. The EIP-712 `Timing` type gains the member, so the domain version moves with the contract.
- **API:** `POST /v1/commitments/{id}/accept` and `/settlements` take `Rejected`. `invalid_state.needs` lists it. `POST /v1/commitments/{id}/triggers/<kind>` gains the refund's kind. `finalAt` is empty until the deal closes.
- **Formal model:** a `Rejected` state and a grace clock. `SettleOnce`, `EscrowMatchesState`, `PaidAsClosed` and `ReasonRules` are restated for a fee paid before the price. Liveness is checked with each named actor halted. New broken variants must fail: an accept after the period, a refund before it, a fee paid twice.
- **Fixtures:** `reject-grace-buyer-accepts`, `reject-grace-settled-split`, `reject-grace-expires`, `neutrality.reject-grace-operator-offline`, `neutrality.reject-grace-seller-offline`, `attack.accept-after-grace`, `attack.refund-before-grace`.

## Alternatives considered

- **Reuse `appealWindowSec` as the period.** No signed type changes. Refused: the name promises an appeal that phase one does not run, and one field cannot hold two periods when appeals return.
- **Only a settlement by both parties in the period.** It keeps one way to change an outcome. Refused as the only move: a seller must be online to be paid a price it already agreed to.
- **Only the buyer's accept, no settlement.** It keeps the outcomes to full price or full refund, so no low offer after a reject. Not chosen, because two signatures end a deal in every other open stage (ADR-0019). Rafa may choose it; section 4 is separable.
- **No contract change: a second deal with the waiver (ADR-0039).** It works today and stays the answer on the frozen contracts. As the only answer it costs a second hold, an adjudicator's acceptance and about 572,704 gas more [measured for the funding].
- **Off protocol: the buyer pays the seller directly (D26).** No code. Refused as the product's answer: one side trusts the other with the key or the money, which the hold exists to remove.
- **Accept unless clearly broken, at judgment time.** Refused. D27's red team measured sellers paid by steering, splitting and silencing a panel; this rule pays them again, with the buyer's money and no appeal.
- **A period after an accept too, as `settle_after_window` describes.** Refused for phase one: it delays every seller's payment and gives the buyer nothing, since no party appeal exists.
- **No reject on a judge fault (the judgment lane).** A panel that cannot return valid verdicts signs nothing, and the deal waits in `Escalated`, where a settlement is already allowed. It may be right and needs no contract. It belongs to the filter investigation and changes D27a, so it is not decided here.

## Consequences

- **A buyer can take work the panel rejected, with one signature,** and gets the key in the payment's transaction.
- **A reject with a period costs one more transaction when nobody rescues it** [guessed: 60,000 to 100,000 gas; `GasPerDeal.t.sol` measures at the build].
- **The buyer's refund waits the period.** The buyer agreed to the value; 0 keeps today's speed.
- **A deal's word needs one more stage and one more closing reason.** The storage stays one word [inferred from the `Deal` layout, `IHoldbackRules.sol:113`].
- **The audit reads more code:** one stage, one timeout, two widened stage checks and one changed expiry sum. The size check runs against 24,576 bytes; the phase-one runtime is 20,502 bytes [documented, `docs/audit/README.md:192`], and ADR-0046 and D85 draw on the same room.
- **A new signed field** means new EIP-712 vectors and a domain version that agents pin again. It lands once, with the other changes of that version.
- **Residual: a low offer after a reject.** A buyer may offer a small split. The seller may decline and keep the work. The pressure exists before a decision today.
- **Residual: a buyer that provokes a reject.** A brief or rubric written to trip the judges would let a buyer bargain afterwards. The seller signs the terms and tests them before signing (D32), and D28's exception for gamed judgment applies.
- **Residual: no delivery, no accept.** If neither the operator nor the seller hands over the signed delivery, nobody can build the key proof. The refund still pays at the period's end.

## Litmus tests

- **Neutrality (ADR-0001): holds.** No single party gains a way to stop a settlement or move held funds outside the terms. The buyer's signature moves only the buyer's own refund, only to the seller's payout address, and only at the agreed price. A split needs both signatures. The refund's trigger is permissionless, so an offline operator, seller or adjudicator cannot hold the price past the period. The adjudicator gains no power: its fee is paid at the reject, as today. New fixtures: `neutrality.reject-grace-operator-offline`, `neutrality.reject-grace-seller-offline`.
- **The hold (ADR-0002): holds.** The price stays locked on the settlement layer during the period, and neither party can take it alone except the buyer paying the seller. The period has an end, the escrow's expiry covers it, and every move stays idempotent by the deal's stage. The key still travels only with payment (`KeyOnlyWithPayment`, `RefundedNeverReleasedKey`).
- **Defended multi-model judgment (ADR-0006): unchanged.** Checks run first, the panel decides as before, and no verdict is re-rolled. The buyer waives a reject; it does not overturn one. Phase one's set-aside line (no party appeals, no bonds; D57) stays set aside.

## Open points for Rafa

1. **The field's name:** `rejectGraceSec`, or another word agents already know.
2. **Section 4, the settlement in the period:** keep it, or the buyer's accept only.
3. **Section 7, the buyer's accept in `FallbackJudging` and `Escalated`:** keep it or strike it.
4. **What Crow's own kits write for a deal with a rubric: decided (Rafa, 2026-11-25: "Default for rubric deals").** Crow's setup tools and templates write `rejectGraceSec: 86400` (one day) into every deal whose terms carry a rubric, so buyer and seller have a day to settle, or the buyer to accept, after a reject caused by the panel. Deals decided by checks alone get 0, so their release is never delayed for nothing. It is a default the parties can change, not a protocol minimum (D31): the protocol's value for silent terms stays 0, and the contract accepts any value the encoding can represent.
5. **A buyer's early close of the period,** by a signed message that takes the refund at once: left out here to keep the surface small. Reopen it if buyers ask.
