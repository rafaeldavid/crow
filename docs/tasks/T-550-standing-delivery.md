# T-550: a standing delivery without the buyer's envelope

- **Lane:** core
- **Phase:** 2
- **Depends on:** T-544 (ADR-0040). It can run beside T-548.
- **Paths this task may touch:** `packages/core/src/state.ts`, `packages/core/src/` tests, `apps/operator/src/prepare.ts`, `packages/settlement/sim/`, `apps/adjudicator/src/`, `fixtures/` (the fixtures below), `docs/architecture.md` (the two-sided hold's delivery step), this file.
- **Human gate:** no
- **Status:** in review: the pull request waits for the merge freeze of 2026-11-19 (T-563) to lift
- **Agent/session:** the T-550 session, 2026-11-19, branch `t-550-standing-delivery`
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

- [x] Core and the operator take a delivery with envelopes for the three adjudicators and none for the buyer.
- [x] On such a delivery, core refuses an early accept and a settlement that releases the key, with a stated reason, before they are relayed.
- [x] Fixtures: `neutrality.seller-offline-standing-take` (the seller is offline from setup on; the buyer posts the delivery; the primary accepts; the buyer opens the file) and `neutrality.store-drops-standing-ciphertext` (the deal ends in the buyer's refund).
- [x] `docs/architecture.md` states the rule.
- [x] The formal model is checked for any step that assumes a buyer envelope, and the result is recorded here.

**Done when** a fixed file's standing delivery settles by the primary's accept and the buyer opens the file, and an early accept on it is refused by core and reverts on the local chain.

## Out of scope

- The seller contract (T-548); the take's checks (T-549).

## Evidence

Measured on 2026-11-19 in the branch's worktree, on the machine of the T-550 session.

- **The rule, in core** (`packages/core/src/state.ts`). `deliver` requires the three adjudicators' envelopes only. `withBuyerEnvelope` refuses, as `invalid_terms` with the reason, an early accept and a settlement with `releaseKey` on a posted delivery that holds no envelope for the buyer, in Delivered, FallbackJudging and Escalated. The late-work settlement in Held already refused it. Each check comes last, after the checks it shares with the contract, as `_requireKeyProof` does (`HoldbackRules.sol:360`, `:396-397` in the fixed build of tag `contracts-phase-one-2`) [measured by reading; the reviewer confirmed the order].
- **Core tests:** the new block in `state.test.ts` has 14 tests. 13 of them failed against the old `state.ts` and pass now; the guard that a delivery with the buyer's envelope keeps every path passes on both [measured]. With the refusal disabled, 6 core tests fail [measured by the reviewer]. One old case changed on purpose: "a delivery without a key for the buyer" became three cases, one for each adjudicator. `state.test.ts`: 323 of 323 passed [measured].
- **Done when, on SimChain over the operator API** (`apps/operator/src/standing-delivery.test.ts`, the reference adjudicator, real x25519 and AES-GCM): the seller signs the delivery right after the offer and acts no more. The buyer funds and posts it. The early accept and a `releaseKey: true` settlement both get 400 `invalid_terms` with core's reason. The primary accepts, and the buyer unwraps the released key with its own secret key and decrypts the CSV [measured, 2 of 2 passed].
- **Done when, on the local chain** (`packages/settlement/evm/standing-delivery.test.ts`, anvil, the unchanged rules contract): an early accept on the standing delivery reverts in the simulation with `BadKeyProof`, both posted and carried in Held, and so does a key-releasing settlement. Nothing is sent, the stage stays Delivered (or Held), and the buyer has no key. The primary's accept then releases the price and the buyer's key, and `replayCheck` is ok [measured, 2 of 2 passed]. On this path the agent reads `contract revert BadKeyProof()`, not core's reason, because the adapter simulates before it steps core; core's own step on the same state gives the reason [measured]. That gap is in the Handoff.
- **Fixtures:** `neutrality.seller-offline-standing-take` ends Released, with the price paid to the offline seller and the buyer's key opening the delivered file; it refuses the early accept with core's reason. `neutrality.store-drops-standing-ciphertext` ends Refunded through the fallback and the default, and no key reaches the buyer. `pnpm snap`: 50 of 50 passed, and no existing snapshot changed [measured].
- **Red team** (three `*.redteam.test.ts` files, kept in the change): 12 SimChain cases, 6 adjudicator cases with real encryption, 4 anvil cases. A seventh adjudicator case filed a party appeal, a feature phase one cut; CI's `tests/cut-feature-alignment.test.ts` caught the new use, and the case was removed, since the escalation case already covers the appeal adjudicator's accept. They cover the fallback, escalations, appeals on SimChain, the default, late work in Held, partial settlements, and an operator that strips the buyer's envelope, which the seller's signature refuses. All passed; nothing blocking [measured].
- **Every existing path:** `pnpm typecheck` and `pnpm lint` pass. 47 test files over core, the testkit, SimChain, the change's tests, the red team's and the operator's `sim-world.test.ts`: 1,321 of 1,321 passed [measured]. The kind's local check, after the review's fixes, at a load average of about 32: `vitest run packages/settlement apps/operator apps/adjudicator` with anvil, 975 passed, 1 skipped, 0 failed in 66 files [measured]. The reviewer ran `packages/core`, `packages/settlement` and `packages/testkit` with anvil (1,561 of 1,561 passed) and `apps/operator` (321 of 321 passed) [measured]. The full `pnpm test` gave 1 failure in 5,238 tests, `apps/demo-cloud/src/limits.attack.test.ts`. That test compares the wall-clock time of two request loops, under a load average of about 130 from other sessions and a `forge build`; alone it passed, 12 of 12. It reads no delivery code [measured; the cause inferred]. CI is the gate for the full suite.
- **The formal model needs no change** [inferred, by reading `formal/Holdback.tla`]. The model has no delivery envelopes. `EarlyAccept` (:414) and `MutualSettle(c, s, TRUE)` (:446) are enabled whatever the delivery holds, so a standing delivery only removes behaviours. Safety invariants such as `KeyOnlyWithPayment` (:826) hold on any subset of behaviours. Fairness (:699-704) names only timeouts and crashes, so the liveness properties `FundedSettles`, `FundedFinal`, `OfferEnds` and `BondsFreed` (:1057-1068) do not depend on either action. The model was not rerun, since it did not change.
- **Untouched:** `contracts/`, `spec/` and `formal/` have no diff [measured].

## Decisions

- **Paths widened, for tests only.** The two fixtures need the scenario runner to post a delivery with no buyer envelope, by the buyer: `buyer_envelope: none` and `by: buyer` in `packages/testkit/src/scenario.ts` and `stub-settlement.ts` (the test lane's files; no other session had them open on 2026-11-19). The local-chain test reuses the EVM adapter's own helpers, so it is a new file, `packages/settlement/evm/standing-delivery.test.ts`; no source file of `packages/settlement/evm` changed. The operator test is a new file beside `prepare.ts`.
- **No change to SimChain or the adjudicator.** Both already follow core's `step`: SimChain releases a held buyer envelope only on an early accept or a key-releasing settlement, which core now refuses on a standing delivery, and the reference adjudicator wraps the content key to the terms' encryption key on an accept (`apps/adjudicator/src/service.ts:1045`), never reading the buyer's envelope.
- **The prepare step cannot see the posted delivery's envelopes** (`ctx.delivery` returns the hash and attempt only). So prepare says in its check lines that a standing delivery refuses an early accept and `releaseKey: true`, and core refuses them with the reason at submit.
- **How T-541 fits** (PR 669, the seller's proof that the buyer's envelope opens the held work): it proves something about the buyer's envelope, so it applies to deliveries that hold one, for a waiver before a key-releasing settlement. A standing delivery holds none, and none of those paths is open on it; the buyer's key comes from the adjudicator that opened and judged the work. The two do not overlap.
- **The rule ships on schema v0.11, before T-549's v0.12.** ADR-0040 section 8 lists it with v0.12. It needs no schema change: `delivery.schema.json` already takes three envelopes (`minItems: 3`), and the change only widens what core takes, so every delivery that was valid stays valid. An old buyer tool refuses an early accept when it finds no envelope for itself (`site/buy.mjs:795`), which is the right answer on a standing delivery. The schema's description of the buyer's envelope ("for early acceptance") is T-549's to update with v0.12.
- **The EVM adapter is left as it is.** Giving an agent core's reason on chain needs a check before the simulation in `packages/settlement/evm/evm-settlement.ts`, which T-549 edits for the same cases (the contract-signer check). So it is handed off, not done here. Nothing is sent and no gas is spent either way.
- **The prepare step adds a notice** when a delivery holds no envelope for the buyer, so a seller that leaves the buyer out by mistake is told (red team finding, Low).
- **The red team's three test files stay in the change** (`*.redteam.test.ts` in `packages/settlement/sim/`, `apps/adjudicator/src/` and `packages/settlement/evm/`), as the repository keeps its other red-team tests.

## Handoff

**State:** the change is complete and in review, on branch `t-550-standing-delivery`. The pull request waits for the merge freeze of 2026-11-19 (T-563, the fixed contracts' deployment). After the coordinator says the deployment's tag is pushed: merge `origin/main` into the branch, rerun the suites against the new deployment record, and merge by hand once every check has passed.

**For T-549** (contract-seller checks, schema v0.12, `packages/settlement/evm/`, `docs/neutrality.md`):
1. In `evm-settlement.ts`, step core before the simulation for `early_accept`, and for `mutual_settle` with `releaseKey`, when the delivery holds no envelope for the buyer (`keyProof` returns undefined). Then the agent gets core's reason, not `contract revert BadKeyProof()`. Do it as the phase-one payout check at `:1064-1068` does. Then change the two assertions in `packages/settlement/evm/standing-delivery.test.ts` from the revert to core's reason.
2. With v0.12, update `delivery.schema.json`'s description of `encryptedKeys`: the buyer's envelope is optional, and without it the buyer's key comes only with an adjudicator's accept.
3. Add the two new fixtures to `docs/neutrality.md`'s control-point table: `neutrality.seller-offline-standing-take` in the seller agent's row, `neutrality.store-drops-standing-ciphertext` in the adjudicator's row.
4. The events name the seller as the actor of `delivery.submitted` even when the buyer posts the delivery, on SimChain and on chain. That is defensible, since the delivery carries the seller's signature.

**For T-551** (the buyer's take command):
- A standing delivery holds no envelope for the buyer. So the command must not try an early accept on it, and it cannot preview the file before the accept. It waits for the primary's decision and opens the file with the key that decision wraps to the terms' `buyerEncryptionPublicKey` (`GET /v1/commitments/{id}/key?recipient=<buyer>`), as `apps/operator/src/standing-delivery.test.ts` does.
- Anyone may post the standing delivery, so the command can post it itself after funding (`POST /v1/commitments/{id}/deliveries` with the seller-signed body).
- A settlement on such a deal may only keep the key (`releaseKey: false`).

**Scenario runner:** `deliver` now takes `buyer_envelope: none` (a standing delivery) and `by: buyer` (the buyer posts the delivery the seller signed at setup; only with `buyer_envelope: none`).
