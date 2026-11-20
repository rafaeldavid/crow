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
  - a take of a standing offer (seller: `HoldbackStandingSeller`, an ERC-1271 signature longer than 65 bytes) is accepted, funded, delivered with the key's signature, decided by the primary and paid to the payout address; the seller contract holds 0 after it; the contract's own `termsOf` hashes to core's commitment ID;
  - `attack.take-changes-a-fixed-field`: a take with a changed price, payout address, adjudicator or buyer key is refused `invalid_signature` with no transaction sent;
  - `neutrality.standing-seller-refund-by-agreement`: the seller contract approves its key's signature on a full refund, and the deal settles;
  - a contract buyer (`SwitchWallet`, owned by the buyer's key) agrees, funds from its payment address, accepts early and gets its key; another settles by agreement;
  - a contract buyer's agreement with a changed field, and the same agreement while the wallet answers a wrong magic value, are refused with no transaction; honest again, it funds;
  - residual 13: a contract buyer's settlement sent through a forwarder is followed (`applied: 1, behind: 0`); that it is read at the end of its block, not the latest, is inferred from the code, since the test never changes the wallet's answer afterwards;
  - `attack.follower-signer-read-fails-open`: a key parties' settlement sent through a forwarder is followed while every code read fails with an HTTP 429.
- **On SimChain** [measured, `packages/settlement/sim/contract-signers.test.ts`, 5 of 5]: a contract seller's offer, delivery, acceptance and settlement are read through its wallet; the same signatures are refused when the address is not a contract account, or when another key signs; a party signature of 16,385 bytes is refused `payload_too_large` and one of 16,384 bytes is checked.
- **The reference adjudicator** [measured, `apps/adjudicator/src/simchain-adapter.test.ts`, 21 of 21]: a contract seller's delivery fails an ECDSA check, passes the port's rule, is judged and paid.
- **Review fixes of pull request 1 built here:** a party signature above 16,384 bytes is refused before any work [measured on SimChain for `signatures.seller`; inferred for the EVM node and the other fields, which run the same helper, and for the operator's Publish check]; the EVM node checks the seller's delivery and the buyer's early accept off chain before any simulation; `attack.offer-v-flip-front-run`: a copy of a key's signature with v of 0 or 1 is refused by the rule (core test).
- **T-550's hand-over** [measured, `packages/settlement/evm/standing-delivery.test.ts` on anvil]: an early accept, or a settlement that releases a key, of a delivery with no buyer envelope now answers core's reason before any simulation, not `contract revert BadKeyProof()`. Its two fixtures are listed in `docs/neutrality.md`.
- **The pinned bundles** [measured, `node site/build.mjs`]: `site/buy.mjs` `b87e478b…02ee`, `site/try.mjs` `71634a90…dfa3` and `site/setup.mjs` `c217a4a1…` are the same before and after this pull request; the rule is in a module the bundles never import.

### Pull request 3: the takes (kind 5), 2026-11-20

- **Core's take function** (`packages/core/src/standing.ts`) [measured, `eip712.vectors.test.ts`, 26 of 26]: from a template in JSON, core computes T-548's six pinned vectors (template hash, template digest, take nonce, take commitment ID, take terms digest, standing delivery hash) and the same terms the vectors build. `templateFrom` builds a template from terms a seller chose; `takeTerms` builds a take's terms; `encodeStandingSignature` builds the blob the contract decodes.
- **The differential test on anvil** [measured, `packages/settlement/evm/contract-signers.test.ts`, 8 of 8]: for every take the tests build, the contract's `templateHash` equals core's, and the commitment ID of the contract's own `termsOf` equals core's `takeTerms`. `neutrality.standing-delivery-carried-by-decision`: a take's standing delivery, signed only by the template (kind `STANDING_DELIVERY`), is carried by the primary's accept and the deal is released.
- **SimChain's standing seller** [measured, `packages/settlement/sim/standing.test.ts`, 10 of 10 after the reviews]: `attack.funded-take-flood` (three funded takes the seller never delivers each end in the buyer's refund, and the buyer has its whole balance back); `attack.take-under-another-deployment` (a template naming another rules deployment approves nothing); a take is accepted, funded, delivered and released; `attack.take-changes-a-fixed-field` (price, payout address, adjudicator, disclosure, a date), `attack.take-replayed` (one take offers once; another seed is another take), `attack.take-backdated` (an offer already expired is refused `deadline_passed`; backdated by less than the window, it is offered), a take dated ahead, a revoked, retired or expired template, a forged template signature, a template that pays the contract, and the standing delivery (another file refused, the template's own accepted and released).
- **The operator's take rules** [measured, `apps/operator/src/take.test.ts`, 7 of 7 after the reviews]: `attack.take-flood-names-the-seller-as-buyer` (two takes naming the seller contract as buyer leave the seller two offers of its own in a budget of three); a take posted with its buyer's signature over the terms is relayed; `attack.take-flood-spends-seller-budget` (three buyers' takes leave the seller's own budget whole, and one buyer's third take is over its own); `attack.take-flood-names-a-victim-buyer` (a take signed by another key than its buyer's is refused `invalid_signature` on `signatures.buyer`, and the victim then makes five takes of its own); a take with no buyer signature is refused naming the field; `attack.standing-take-not-public` (a sealed take at `private` is refused on `disclosure.level`, and nothing reaches the chain); `neutrality.operator-refuses-standing-take` (op-1 refuses, op-2 relays the same take).
- **The pinned bundles** [measured, `node site/build.mjs`]: `site/buy.mjs` `b87e478b…`, `site/try.mjs` `71634a90…` and `site/setup.mjs` are byte-identical to main. `setup.mjs` imports core, so the new module keeps no code at load time (its types are a function, its constants literals) and the bundler drops it.
- **The full suite** [measured, load average about 13]: 5,616 passed, 3 failed: the stale `setup.mjs`, fixed above, and two `examples/seller-invoice.test.ts` tests ("the operators gave different answers"), which pass alone 3 of 3 and failed the same way in pull request 2's run, before this code existed (in the triage note).
- **The reference adjudicator** [measured, `apps/adjudicator/src/simchain-adapter.test.ts`; the package 331 passed and 1 skipped in its own run]: `attack.take-with-bad-buyer-key`: the primary declines an offer whose buyer encryption key does not decode, or is a low-order point no key can be wrapped to, and calls no judge.
- **Core** [measured, `packages/core/src/standing.test.ts`, 3 of 3]: a take blob is a take on a chain and on SimChain; a standing delivery, a key's and a 2-of-n multisig's signature are not; a template carries no settlement; dates that are not whole seconds after createdAt are refused. On anvil a template with dispute offsets passes the differential check at two take times (9 of 9).

## Decisions

- **The buyer's agreement on a take is its signature over the terms** (pull request 3). ADR-0040 §9 asks for "the buyer's Agree signature over its ID"; the commitment's own `signatures.buyer` is the buyer's signature over the whole terms, whose hash is the ID, so it binds the same thing with no schema change. A take posted as a hold carries the buyer's Agree, as today.
- **A take is an offer whose seller signature decodes as a take** (pull request 3, after both reviews): kind `TAKE` as the seller contract decodes it, or SimChain's JSON blob. A multisig's or another contract seller's long signature is charged to the seller and may be private, as any offer. A take that names the seller contract as its buyer stays on the caller's own budget: the contract approves its own blob as either party.
- **A template carries no settlement** (red team of pull request 3, L3): the seller contract builds every take as guaranteed_on_decision in the price token, so core does too.
- **SimChain's take blob is the template in JSON**, not the ABI blob (pull request 3): SimChain runs no EVM, and the JSON form lets it decide by the same core functions the anvil test pins to the contract. Tools that target a chain build the ABI blob (`encodeStandingSignature`); a SimChain world takes `encodeSimStandingSignature`.
- **Two pull requests became three** (pull request 2). The contract-signer rule is one function for both parties, so it goes to every buyer and seller site at once: splitting the buyer off would mean leaving ECDSA in place on purpose at half the call sites. What makes the second pull request large is the take machinery, which is the seller's alone: the code override of a seller contract not yet deployed, the deployment before funding and its budget, the take's write budget, the public-only refusal, core's pure take function and SimChain's standing seller, the adjudicator's key check at acceptance, and their fixtures. That goes to a third pull request (Handoff).
- **The rule follows SignatureCheckerLib, not ADR-0040's shorter wording** (both reviews of pull request 1): a key may give 64 bytes, and a 65-byte one must carry v 27 or 28, as the precompile takes. The ECDSA default of the verify functions, which the pinned bundles' own check mirrors, is unchanged.
- **A failed read is not a "no".** An RPC error throws, so a request fails with a server error that can be retried. The chain follower catches it and puts the deal behind, so it reads a step the chain already took by its keys first: a signature that recovers to the party's key needs no read, and only a contract party's step depends on the RPC (red team of pull request 2, M1, measured: a forwarded settlement of key parties is followed while every code read fails, `attack.follower-signer-read-fails-open`). A revert, an out-of-gas call or a wrong answer is no.
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

**From the red team of pull request 2, for pull request 3** (no Critical or High; M1, L1 and L3 are fixed here):
- **M2, the node asks a wallet outside the chain's context** [measured by the red team]: `eth_call` from address 0 at gas price 0, where the chain asks by `staticcall` from the rules contract. A wallet that says yes only at gas price 0 passes the node's check and its simulation, and the relayer's transaction reverts at the operator's gas, again and again; a wallet that says yes only to the rules contract is refused by the node and funds directly. The fix the red team proposes fits pull request 3's code override: run SignatureCheckerLib itself, by an `eth_call` to the rules address with its code overridden by a small checker, so `msg.sender`, the static context and the gas rule match; simulate at a non-zero gas price; refuse a signer after a relay of its that reverts after a passing simulation.
- **L2:** the follower reads a contract's answer at the end of the transaction's block, not at the transaction; `docs/neutrality.md` now says so.
- **L4:** the reference adjudicator and the node's join of a landed delivery read the seller's answer now, not at the block where the contract took the delivery. A seller contract that turns its answer off after delivering stops its own judgment and gets the default; with bonds on a chain this would need the delivery's block.

**Known limits left as they are:**
- **The chain follower stores what the chain took.** A party signature of any length that lands in a readable call is applied and kept, as before this task; only the API path has the 16,384-byte limit. A Durable Object world that keeps a deal's record in one row can then overflow it (red team of pull request 1, finding 2, by reading). For the triage list: check a book's size before writing it.
- **A take's `createdAt` must be at or before the newest block's time**, since the seller contract refuses a take dated ahead (`createdAt <= block.timestamp`) and the node reads its newest block. T-551's command dates a take a block back.
- **Reference tools still assume 65 bytes:** `examples/agent.ts:221` refuses a longer slot signature; `examples/try.ts`, `examples/goal-kit.ts` and `examples/e2e-run.ts` recover the seller by ECDSA and throw on a contract seller's signature (fail closed); `examples/buyer-signer.ts` is pinned in `site/buy.mjs`. T-551's new command reads a contract seller.

**Deploy gate (review of pull request 2, finding 3):** deploy the operators with this pull request only together with pull request 3's item 3, the take rules. Until then an operator accepts a take of a deployed seller contract but charges its write budget to the seller (`apps/operator/src/server.ts`, `signerOf`), so any buyer could spend a standing seller's budget with takes, and a take that is not public is not refused. The operator deploy is the coordinator's, and Rafa's to approve.

**T-551 can start building** its parts that need only a deployed seller contract (the card entry, the template check, posting and funding a take) against a local chain: the EVM node reads such a take after this pull request. A take that must deploy the contract, core's pure take function, and any use against a deployed operator wait for pull request 3.

**Also from the review of pull request 2:**
- **Paths beyond the task's list:** `apps/adjudicator/src/settlement-port.ts`, `simchain-adapter.ts` and its test (the port carries the rule to `service.ts`); `packages/settlement/src/interface.ts`, `util.ts` and `index.ts` (the port method and the relay limit); `docs/neutrality.md` beyond residual 13 (T-550's two fixtures, as its hand-over asked).
- **`site/ref/signing.txt:20` still says 65 bytes:** the one-clause fix put the plain-HTTP buyer's path over its budget (9,474 of 9,450 tokens, measured), so it waits for T-551, which writes the contract seller's and buyer's agent text. `site/ref/limits.txt` already says contract signatures travel, up to 16,384 bytes.
- **Not tested, inferred:** a contract buyer on SimChain (only a contract seller is), a contract buyer without a mandate refused (`scopeFor(terms.buyer, …)` applies to it as to a key), and the relay limit on the EVM node.
- **A dry run reports an RPC failure as a refusal** (`apps/operator/src/server.ts`, the validate route maps every throw to `invalid_terms`); with the rule a failed read in a dry run reads as a no. Low; for triage.


### After pull request 3 (the takes)

**Done:** core's pure take function and its differential test on anvil; SimChain's standing seller and the scenario rows of ADR-0040 §9 that run on SimChain, as named tests (`packages/settlement/sim/standing.test.ts`); the operator's take rules (the buyer's signature, the budget, public only) and `neutrality.operator-refuses-standing-take`; the adjudicator's key check at acceptance; `neutrality.standing-delivery-carried-by-decision` on anvil.

**The deploy gate of pull request 2 is met** by the take rules here. One risk stays for pull request 4: red team M2 of pull request 2, a wallet that answers yes only to the node's `eth_call` makes a relay revert at the operator's gas. Whether the operators deploy before pull request 4 is the coordinator's and Rafa's call; the cost is test ETH.

**Not done, for pull request 4 (a seller contract not yet deployed):**
1. `SignerReads.plannedCode` on the EVM node: recover the key from the take's template signature under the seller contract's domain, check the CREATE2 address through `0x4e59b44847b379578588920cA78FbF26c0B4956C` at salt 0, and simulate the creation code with that key. The node needs the creation code: `contracts/out` on anvil, pinned in the package for Sepolia.
2. The funding relay reads the seller address's code, sends the deployment alone, skips it when code is there, then funds; a stated deployment budget for admitted sellers only (`neutrality.deploy-front-run-take-still-funds`, `attack.deployment-gas-drain`, `neutrality.crow-deploys-nothing`).
3. Red team M2: check through SignatureCheckerLib itself (an `eth_call` to the rules address with its code overridden by a small checker), simulate at a non-zero gas price, and refuse a signer after a relay of its that reverts after a passing simulation.
4. The done-when test: a take posted to an operator on anvil, accepted by the reference adjudicator, funded and settled, after `apps/operator/src/standing-delivery.test.ts`.

**T-551 can use** `templateFrom`, `takeTerms`, `templateDigest` and `encodeStandingSignature` from `@holdback/core` now, and post a take with `signatures.buyer` to an operator. Its first take of a seller contract not yet deployed waits for pull request 4.

**From the reviews of pull request 3, for pull request 4:**
- **SimChain checks a take's seller signature at the offer only** (red team L1, measured): the rules contract checks it again at funding, so a template that expires or is revoked between the offer and the funding funds on SimChain and is refused on a chain. Re-checking at funding needs SimChain to keep the offer's seller signature in its deal record, which changes what a SimChain world persists.
- **A take dated now on Sepolia** is likely refused for up to a block, since the seller contract refuses `createdAt` after the block's time and the node reads its newest block [inferred]. T-551 dates a take a block back.
- **Paths beyond the task's list:** `apps/adjudicator/src/simchain-adapter.test.ts` (the key check's test), `packages/settlement/sim/actors.ts` (the terms override of `Deal`), `docs/decisions/ADR-0040-standing-offers.md` §9 (the amendment above).

