# T-550: a standing delivery without the buyer's envelope

- **Lane:** core
- **Phase:** 2
- **Depends on:** T-544 (ADR-0040). It can run beside T-548.
- **Paths this task may touch:** `packages/core/src/state.ts`, `packages/core/src/` tests, `apps/operator/src/prepare.ts`, `packages/settlement/sim/`, `apps/adjudicator/src/`, `fixtures/` (the fixtures below), `docs/architecture.md` (the two-sided hold's delivery step), this file.
- **Human gate:** no
- **Status:** todo
- **Agent/session:** none yet
- **Roadmap row:** N196
- **Change kind:** 5, settlement and judgment code.

## What exists

- Core requires envelopes for the three adjudicators and the buyer in every delivery (`packages/core/src/state.ts:362-368`), and so does the operator's prepare step (`apps/operator/src/prepare.ts:723-726`).
- On an accept, the primary wraps the content key to the buyer's key from the terms (`apps/adjudicator/src/service.ts:1045`), and the contract refuses an accept without it (`contracts/src/HoldbackRules.sol:310`).
- An early accept and a key-releasing settlement need the buyer's envelope on chain (`HoldbackRules.sol:344`, `:380-381`).

## Intent

Let a delivery leave out the buyer's envelope, so a fixed file's one delivery can serve every take (ADR-0040 section 2). The buyer's key then comes only with an adjudicator's accept, and core refuses an early accept or a key-releasing settlement on such a delivery before relaying it.

## Context

ADR-0040 sections 2 (delivery) and 9 (the fixtures this task owns); ADR-0012 (key release); D81 (an adjudicator that cannot open its envelope). Two open pull requests touch this ground on 2026-11-18: PR 670 edits `packages/core/src/state.ts`, so re-read the cited lines first; PR 669 (T-541) proves that the buyer's envelope opens the held work, which a standing delivery leaves out, so say how the two fit.

## Acceptance criteria

- [ ] Core and the operator take a delivery with envelopes for the three adjudicators and none for the buyer.
- [ ] On such a delivery, core refuses an early accept and a settlement that releases the key, with a stated reason, before they are relayed.
- [ ] Fixtures: `neutrality.seller-offline-standing-take` (the seller is offline from setup on; the buyer posts the delivery; the primary accepts; the buyer opens the file) and `neutrality.store-drops-standing-ciphertext` (the deal ends in the buyer's refund).
- [ ] `docs/architecture.md` states the rule.
- [ ] The formal model is checked for any step that assumes a buyer envelope, and the result is recorded here.

**Done when** a fixed file's standing delivery settles by the primary's accept and the buyer opens the file, and an early accept on it is refused by core and reverts on the local chain.

## Out of scope

- The seller contract (T-548); the take's checks (T-549).

## Evidence

## Decisions

## Handoff
