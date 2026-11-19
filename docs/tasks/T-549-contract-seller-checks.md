# T-549: operators and adjudicators check a contract seller's and a contract buyer's signature

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** T-548
- **Paths this task may touch:** `spec/` (schema v0.12: every schema's `$id`, `PartySignature` in `common`, `commitment`, `delivery`, `messages` and `appeal`, the examples, `spec/README.md`, the generated `spec/openapi.json`), `tests/spec.test.ts`, `packages/core/src/validators.generated.ts`, the schema version in `apps/operator/src/server.ts` and its tests, `site/ref/` and `site/setup.mjs` (the version they name or bundle), `docs/api.md` (the version), `docs/decisions/ADR-0040-standing-offers.md` (its schema section); `packages/core/src/` (the contract-signer check and the pure take function); `packages/settlement/evm/`, `packages/settlement/sim/`; `apps/operator/src/`; `apps/adjudicator/src/service.ts`; `fixtures/` (the scenario fixtures of ADR-0040 section 9); `docs/neutrality.md` (residual 13's seller case); this file.
- **Human gate:** no. A deploy of the operators waits for Rafa.
- **Status:** in progress
- **Agent/session:** the T-549 session, started 2026-11-19 by the journeys coordinator
- **Roadmap row:** N196
- **Change kind:** 6 (the schema), then 5 (settlement and the adjudicator), in two pull requests.
- **Scope widened, 2026-11-19 (D84):** a contract buyer rides on the same schema version and the same checks. Rafa: "Yes, add it" and "Yes, same change"; and, for a vault owner on a funded deal, "Yes, the owner may" (recorded in D84 and on ADR-0038 point 4; this task builds nothing for it).

## What exists

- Every off-chain check recovers an ECDSA key (`packages/core/src/eip712.ts:613-620`); the EVM node says contract signers "are not read" (`packages/settlement/evm/evm-settlement.ts:2003`).
- `Signature` is exactly 65 bytes (`spec/schemas/common.schema.json:15-19`).
- The operator charges an offer's write budget to `commitment.seller` (`apps/operator/src/server.ts:369-372`).

## Intent

Let the operators, SimChain and the reference adjudicator read a seller that is a contract, as ADR-0040 section 5 states, and a buyer that is a contract, as D84 and ADR-0041 section 4 state, and let the API carry both signatures. A contract buyer is read and admitted by the rules a key buyer gets today, its mandate check included; nothing else changes for it.

## Context

ADR-0040 sections 4 (deployment), 5 (the off-chain check and schema v0.12), 6 (the adjudicator), 7 (public deals only) and 9 (the tests this task owns); `docs/neutrality.md` residual 13.

## Acceptance criteria

- [ ] Schema v0.12: `PartySignature` (non-empty hex bytes) for `signatures.seller` and the seller's delivery `signature`, and for every signature the buyer makes (`signatures.buyer`, `Agree`, `EarlyAccept`, `Dispute`, the buyer's half of `MutualSettlement` and `Publish`, an appeal); the ERC-3009 funding signature and every other signature keep `Signature`; `pnpm validate:spec` passes; the version is bumped from v0.11.
- [ ] The contract-signer rule below applies to `terms.buyer` wherever the buyer's signature is checked: `verifyTerms`, `verifyMessage` and `verifyCoSigned` in core, the EVM node, SimChain and the reference adjudicator.
- [ ] A contract buyer is admitted by the rules a key buyer gets today, its mandate check included. No stop reaches a vault buyer's funded deals, no operator relays a vault's funding, and Crow creates no vault: none is decided (D84).
- [ ] Fixtures for the buyer: a contract buyer accepted end to end on a local chain, and a contract buyer whose take or agreement has a changed field refused before it is relayed.
- [ ] The seller's terms and delivery signatures are checked by ECDSA for a 65-byte signature from an address without code, and by ERC-1271 through `eth_call` otherwise, with a code override for an address the deterministic deployer has not deployed yet.
- [ ] Core has a pure function that builds a take's terms from a template and a fill; a differential test on the local chain pins it to the contract's `termsOf`, and SimChain applies the same rule.
- [ ] An operator stores a take only with the buyer's Agree signature over its ID, and charges the take's write budget to that signer (`attack.take-flood-spends-seller-budget`, `attack.take-flood-names-a-victim-buyer`).
- [ ] The operators refuse a take whose disclosure is not `public` (`attack.standing-take-not-public`).
- [ ] When the seller address has no code, the funding relay reads the code, sends the deployment alone, skips it when code is there, then funds; the funding never carries the deployment (`neutrality.deploy-front-run-take-still-funds`, two first takes close together on the local chain).
- [ ] Every check of a `terms.seller` signature in the EVM node uses the rule: `evm-settlement.ts:936`, `:1058`, `:1092`, `:1138`, `:1212`, `:2065`, `:2326`, `:2529` at `21bb4e54` (re-read first), and SimChain's equivalents (`neutrality.standing-seller-refund-by-agreement`, `neutrality.standing-delivery-carried-by-decision`).
- [ ] The reference adjudicator checks a delivery's seller signature with the same check (`apps/adjudicator/src/service.ts:860`), and checks that the buyer's encryption key decodes before it accepts (`attack.take-with-bad-buyer-key`).
- [ ] An operator deploys a seller contract only for a seller it admits, under a budget it states (`attack.deployment-gas-drain`).
- [ ] Scenario fixtures on SimChain: `attack.take-changes-a-fixed-field`, `attack.take-replayed`, `attack.take-backdated`, `neutrality.operator-refuses-standing-take`. On the local chain: `neutrality.crow-deploys-nothing`.
- [ ] `docs/neutrality.md` residual 13 no longer lists a contract seller.

**Done when** a take posted to an operator on the local chain is accepted by the adjudicator, funded and settled, and a take with a changed field is refused before it is relayed.

## Out of scope

- Adjudicators as contract signers (T-227). Contract buyers came into scope on 2026-11-19 (D84).
- A stop on a vault buyer's funded deals, an operator relay of a vault's funding, and Crow-paid creation of a vault (D84 leaves all three open).
- The delivery rule (T-550).

## Evidence

### Pull request 1: schema v0.12 (kind 6), 2026-11-19

- **The spec validates** [measured]: `pnpm validate:spec` prints 35/35 examples valid and `spec/openapi.json` fresh (43 operations, 196 schemas compiled strictly).
- **`PartySignature` takes any non-empty bytes at every party site and nothing else** [measured, `tests/spec.test.ts`]: 10 sites (the terms' seller and buyer, the delivery, `Offer`, `Agree`, `EarlyAccept`, `Dispute`, the buyer's half of `MutualSettlement` and `Publish`, an appeal) take 1, 64, 65, 66 and 1,000 bytes and refuse `0x`, an odd length, uppercase hex, no `0x` and non-hex. After the review fixes the seller's half of `MutualSettlement` and `Publish` moved to the party sites; the sites that keep exactly 65 bytes are `Decision`, `AdjudicatorAcceptance` in a message and in the terms, the ERC-3009 funding, the fee transfer, `ReadToken`, `Delegation`). The file passes 205 of 205 tests after the review fixes (12 party sites, 7 sites at 65 bytes).
- **No signed struct changes** [measured]: the test of the version keeps `commitment.schemaVersion` at 0.8; the EIP-712 domain stays 0.8.
- **The pinned bundles are byte-identical** [measured, `node site/build.mjs` before and after on the same packages build]: `site/buy.mjs` sha256 `b87e478b1aa9846b67bc5273cb7a26405c90943fdee0d36a7dc1d1a2b38102ee` and `site/try.mjs` sha256 `71634a9021fff0e31bc88b338d942c3e95a46fe698e223b68ba73a09c4fbdfa3`, both before and after. `site/setup.mjs` changes (sha256 `626ec56f…` to `8defb92a…`), because it bundles the schemas; `node site/check.mjs` passes.
- **The whole suite** [measured, `pnpm typecheck && pnpm test` before the site rebuild]: 5,026 passed, 264 skipped, 1 failed: the stale `site/setup.mjs`, which the rebuild fixes (`examples/setup-bundle.test.ts` then passes). `pnpm lint` passes.
- **Today's checks still refuse a contract signature** [inferred, from reading `packages/core/src/eip712.ts:613-620`]: `recoversTo` catches viem's error on any signature that is not 65 bytes and returns false, so until pull request 2 an operator refuses such a signature as `invalid_signature` instead of failing.

### Pull request 2: the contract-signer rule (kind 5), 2026-11-19

- **The rule, in core** (`packages/core/src/signer.ts`) [measured, `signer.test.ts`, 7 of 7]: an address with no code gives a 64- or 65-byte signature, recovered by ECDSA with v 27 or 28; an address with code is asked ERC-1271; an address with no code and a longer signature is asked against planned code only when the reader knows it. A malformed signature is refused before any read; a failed read throws instead of answering no. `verifyTerms`, `verifyMessage`, `verifyCoSigned` and `verifyMutualSettlement` take it as an optional last argument; without it they are ECDSA as before.
- **Every party site uses it** [measured by grep]: in the EVM node, the offer, both agreement paths, the delivery (relay, repost, carried, kept and landed copies), the early accept, the settlement by agreement, and the chain follower's three readings of a step sent through another contract, each at that transaction's block. SimChain checks the offer, agreement, delivery, early accept, appeal and settlement through its table of contract accounts (`genesis.contracts`). The reference adjudicator checks a delivery through its settlement port, under its read time limit, and the operator checks a `Publish` the same way. Adjudicators, principals and ERC-3009 authorizations stay ECDSA.
- **On a local chain** [measured, `packages/settlement/evm/contract-signers.test.ts`, 6 of 6 on anvil]:
  - a take of a standing offer (seller: `HoldbackStandingSeller`, a 1,000-byte-plus ERC-1271 signature) is accepted, funded, delivered with the key's signature, decided by the primary and paid to the payout address; the seller contract holds 0 after it; the contract's own `termsOf` hashes to core's commitment ID;
  - `attack.take-changes-a-fixed-field`: a take with a changed price, payout address, adjudicator or buyer key is refused `invalid_signature` with no transaction sent;
  - `neutrality.standing-seller-refund-by-agreement`: the seller contract approves its key's signature on a full refund, and the deal settles;
  - a contract buyer (`SwitchWallet`, owned by the buyer's key) agrees, funds from its payment address, accepts early and gets its key; another settles by agreement;
  - a contract buyer's agreement with a changed field, and the same agreement while the wallet answers a wrong magic value, are refused with no transaction; honest again, it funds;
  - residual 13: a contract buyer's settlement sent through a forwarder is read at its block and followed (`applied: 1, behind: 0`).
- **On SimChain** [measured, `packages/settlement/sim/contract-signers.test.ts`, 5 of 5]: a contract seller's offer, delivery, acceptance and settlement are read through its wallet; the same signatures are refused when the address is not a contract account, or when another key signs; a party signature of 16,385 bytes is refused `payload_too_large` and one of 16,384 bytes is checked.
- **The reference adjudicator** [measured, `apps/adjudicator/src/simchain-adapter.test.ts`, 21 of 21]: a contract seller's delivery fails an ECDSA check, passes the port's rule, is judged and paid.
- **Review fixes of pull request 1 built here** [measured]: a party signature above 16,384 bytes is refused before any work (both settlement layers); the EVM node checks the seller's delivery and the buyer's early accept off chain before any simulation; `attack.offer-v-flip-front-run`: a copy of a key's signature with v of 0 or 1 is refused by the rule (core test).
- **T-550's hand-over** [measured, `packages/settlement/evm/standing-delivery.test.ts` on anvil]: an early accept, or a settlement that releases a key, of a delivery with no buyer envelope now answers core's reason before any simulation, not `contract revert BadKeyProof()`. Its two fixtures are listed in `docs/neutrality.md`.
- **The pinned bundles** [measured, `node site/build.mjs`]: `site/buy.mjs` `b87e478b…02ee`, `site/try.mjs` `71634a90…dfa3` and `site/setup.mjs` `c217a4a1…` are the same before and after this pull request; the rule is in a module the bundles never import.

## Decisions

- **Two pull requests became three** (pull request 2). The contract-signer rule is one function for both parties, so it goes to every buyer and seller site at once: splitting the buyer off would mean leaving ECDSA in place on purpose at half the call sites. What makes the second pull request large is the take machinery, which is the seller's alone: the code override of a seller contract not yet deployed, the deployment before funding and its budget, the take's write budget, the public-only refusal, core's pure take function and SimChain's standing seller, the adjudicator's key check at acceptance, and their fixtures. That goes to a third pull request (Handoff).
- **The rule follows SignatureCheckerLib, not ADR-0040's shorter wording** (both reviews of pull request 1): a key may give 64 bytes, and a 65-byte one must carry v 27 or 28, as the precompile takes. The ECDSA default of the verify functions, which the pinned bundles' own check mirrors, is unchanged.
- **A failed read is not a "no".** An RPC error throws, so the request fails with a server error that can be retried, and the chain follower's pass fails and runs again instead of putting a deal behind [inferred from the callers; no test injects an RPC error into a check]. A revert, an out-of-gas call or a wrong answer is no.
- **Reads on anvil** set the scenario's second on the pending block (`EvmChain.callAt`), since anvil 1.0 refuses block overrides in `eth_call` [measured]. A live chain reads the node's newest block (T-232); the follower reads the transaction's own block.

- **Which signatures widen (pull request 1).** Every signature a party makes takes `PartySignature`: the buyer's (D84), the seller's terms signature (in the terms and in `Offer`) and its delivery signature (ADR-0040 §5), an appeal's, since its appellant is a party, and the seller's half of `MutualSettlement` and `Publish`. The brief kept the last two at 65 bytes; both reviews of pull request 1 found that a contract seller other than ADR-0040's (a Safe) could then offer and deliver through the API but never settle by agreement through it, and 65 bytes is a subset, so they widen (ADR-0040 §5 amendment). `ReadToken` and `Delegation` stay 65 bytes: a per-deal key or a long-term agent key signs them in a private deal, and standing offers are public only (ADR-0040 §7).
- **The rule follows SignatureCheckerLib exactly** (both reviews): it branches on code, not length. An address with no code gives a 64-byte (EIP-2098) or 65-byte signature with v 27 or 28; an address with code is asked ERC-1271. The schema's description says so.
- **A relay limit, not a schema cap** (red team of pull request 1): each operator relays a party signature of at most 16,384 bytes and says so in `site/ref/limits.txt`, since a node keeps a few copies of each signature in a deal's record and a Durable Object row holds 2 MiB. A longer one still goes straight to the contract (D31). Pull request 2 enforces it.
- **No length cap in the schema** (D31): the operators' request-size limits bound it, as ADR-0040 §5 says.

## Handoff

### After pull request 1 (schema v0.12)

- **Deploy only with pull request 2 and T-550.** On its own, v0.12 admits signatures today's checks refuse, and a very long delivery or early-accept signature made the EVM node answer 500 instead of refusing (red team of pull request 1, finding 1, measured from about 90,000 bytes). Pull request 2 checks both off chain before any simulation and refuses a party signature above 16,384 bytes. The operator deploy is the coordinator's, and Rafa's to approve.
- **Paths beyond the task's list:** `examples/mandate.test.ts` (its schema IDs), `site/ref/limits.txt` (the relay limit), `spec/examples/operator-status.example.json` (its version).
- **For pull request 2:** `site/ref/signing.txt` still says 65 bytes; residual 13 in `docs/neutrality.md`.

### After pull request 2 (the contract-signer rule)

**Done:** every acceptance criterion about reading a contract signer, for the seller and the buyer, on the EVM node, SimChain, the reference adjudicator and the operator's Publish check; schema v0.12; residual 13's contract-signer case for parties; T-550's hand-over.

**Not done, for pull request 3 (the takes), in this order:**
1. **Core's pure take function:** `takeTerms(template, fill, sellerContract)`, the template's EIP-712 hash and the derived nonce, from the types pinned in `packages/core/src/eip712.vectors.test.ts`; a differential test on anvil against `termsOf` (the helper `take()` in `packages/settlement/evm/contract-signers.test.ts` builds the same offer through the contract and can become that test).
2. **SimChain's standing seller:** a `standing_seller` kind in `SimContract` that decodes a take or standing-delivery blob and decides by the pure function, then the scenario fixtures `attack.take-changes-a-fixed-field`, `attack.take-replayed`, `attack.take-backdated`, `neutrality.operator-refuses-standing-take`, `attack.funded-take-flood`.
3. **The operator's take rules** (`apps/operator/src/server.ts`, `signerOf`): store a take only with the buyer's Agree signature over its ID and charge its write budget to that signer (`attack.take-flood-spends-seller-budget`, `attack.take-flood-names-a-victim-buyer`); refuse a take whose disclosure is not public (`attack.standing-take-not-public`).
4. **A seller contract not yet deployed:** `SignerReads.plannedCode` for the EVM node (recover the key from the take's template signature under the seller contract's domain, check the CREATE2 address through `0x4e59b44847b379578588920cA78FbF26c0B4956C` at salt 0, simulate the creation code with that key); the funding relay reads the code, sends the deployment alone, skips it when code is there, then funds; a stated deployment budget for admitted sellers only (`neutrality.deploy-front-run-take-still-funds`, `attack.deployment-gas-drain`, `neutrality.crow-deploys-nothing`). The node needs the seller contract's creation code: from `contracts/out` on anvil, and pinned in the package for Sepolia.
5. **The reference adjudicator checks the buyer's encryption key at acceptance** (`attack.take-with-bad-buyer-key`), and `neutrality.standing-delivery-carried-by-decision` with a standing delivery blob.
6. **The done-when test:** a take posted to an operator on anvil, accepted by the reference adjudicator, funded and settled, after `apps/operator/src/standing-delivery.test.ts` (T-550).

**Known limits left as they are:**
- **The chain follower stores what the chain took.** A party signature of any length that lands in a readable call is applied and kept, as before this task; only the API path has the 16,384-byte limit. A Durable Object world that keeps a deal's record in one row can then overflow it (red team of pull request 1, finding 2, by reading). For the triage list: check a book's size before writing it.
- **A take's `createdAt` must be at or before the newest block's time**, since the seller contract refuses a take dated ahead (`createdAt <= block.timestamp`) and the node reads its newest block. T-551's command dates a take a block back.
- **Reference tools still assume 65 bytes:** `examples/agent.ts:221` refuses a longer slot signature; `examples/try.ts`, `examples/goal-kit.ts` and `examples/e2e-run.ts` recover the seller by ECDSA and throw on a contract seller's signature (fail closed); `examples/buyer-signer.ts` is pinned in `site/buy.mjs`. T-551's new command reads a contract seller.

**T-551 can start** on its parts that need only a deployed seller contract (the card entry, the template check, posting and funding a take): the operators read such a take after this pull request. Its first take that must deploy the contract, and its use of core's pure take function, wait for pull request 3.

