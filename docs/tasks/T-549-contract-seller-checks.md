# T-549: operators and adjudicators check a contract seller's signature

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** T-548
- **Paths this task may touch:** `spec/schemas/common.schema.json`, `spec/schemas/commitment.schema.json`, `spec/schemas/delivery.schema.json`, `spec/examples/` (schema v0.12); `packages/core/src/` (the contract-signer check and the pure take function); `packages/settlement/evm/`, `packages/settlement/sim/`; `apps/operator/src/`; `apps/adjudicator/src/service.ts`; `fixtures/` (the scenario fixtures of ADR-0040 section 9); `docs/neutrality.md` (residual 13's seller case); this file.
- **Human gate:** no. A deploy of the operators waits for Rafa.
- **Status:** todo
- **Agent/session:** none yet
- **Roadmap row:** N196
- **Change kind:** 6 (the schema), then 5 (settlement and the adjudicator), in two pull requests.

## What exists

- Every off-chain check recovers an ECDSA key (`packages/core/src/eip712.ts:613-620`); the EVM node says contract signers "are not read" (`packages/settlement/evm/evm-settlement.ts:2003`).
- `Signature` is exactly 65 bytes (`spec/schemas/common.schema.json:15-19`).
- The operator charges an offer's write budget to `commitment.seller` (`apps/operator/src/server.ts:369-372`).

## Intent

Let the operators, SimChain and the reference adjudicator read a seller that is a contract, as ADR-0040 section 5 states, and let the API carry its signature.

## Context

ADR-0040 sections 4 (deployment), 5 (the off-chain check and schema v0.12), 6 (the adjudicator), 7 (public deals only) and 9 (the tests this task owns); `docs/neutrality.md` residual 13.

## Acceptance criteria

- [ ] Schema v0.12: `PartySignature` (non-empty hex bytes) for `signatures.seller` and the seller's delivery `signature`; every other signature keeps `Signature`; `pnpm validate:spec` passes; the version is bumped from v0.11.
- [ ] The seller's terms and delivery signatures are checked by ECDSA for a 65-byte signature from an address without code, and by ERC-1271 through `eth_call` otherwise, with a code override for an address the deterministic deployer has not deployed yet.
- [ ] Core has a pure function that builds a take's terms from a template and a fill; a differential test on the local chain pins it to the contract's `termsOf`, and SimChain applies the same rule.
- [ ] An operator stores a take only with the buyer's Agree signature over its ID, and charges the take's write budget to that signer (`attack.take-flood-spends-seller-budget`, `attack.take-posted-without-buyer-signature`).
- [ ] The operators refuse a take whose disclosure is not `public` (`attack.standing-take-not-public`).
- [ ] When the seller address has no code, the funding relay reads the code, sends the deployment alone, skips it when code is there, then funds; the funding never carries the deployment (`neutrality.first-takes-race-the-deployment`, two first takes close together on the local chain).
- [ ] The reference adjudicator checks a delivery's seller signature with the same check (`apps/adjudicator/src/service.ts:860`).
- [ ] Scenario fixtures on SimChain: `attack.take-changes-a-fixed-field`, `attack.take-replayed`, `attack.take-backdated`, `neutrality.operator-refuses-standing-take`. On the local chain: `neutrality.crow-deploys-nothing`.
- [ ] `docs/neutrality.md` residual 13 no longer lists a contract seller.

**Done when** a take posted to an operator on the local chain is accepted by the adjudicator, funded and settled, and a take with a changed field is refused before it is relayed.

## Out of scope

- Buyers and adjudicators as contract signers (T-227).
- The delivery rule (T-550).

## Evidence

## Decisions

## Handoff
