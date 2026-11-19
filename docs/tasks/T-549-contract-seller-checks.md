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

## Decisions

- **Which signatures widen (pull request 1).** Every signature a party makes takes `PartySignature`: the buyer's (D84), the seller's terms signature (in the terms and in `Offer`) and its delivery signature (ADR-0040 §5), an appeal's, since its appellant is a party, and the seller's half of `MutualSettlement` and `Publish`. The brief kept the last two at 65 bytes; both reviews of pull request 1 found that a contract seller other than ADR-0040's (a Safe) could then offer and deliver through the API but never settle by agreement through it, and 65 bytes is a subset, so they widen (ADR-0040 §5 amendment). `ReadToken` and `Delegation` stay 65 bytes: a per-deal key or a long-term agent key signs them in a private deal, and standing offers are public only (ADR-0040 §7).
- **The rule follows SignatureCheckerLib exactly** (both reviews): it branches on code, not length. An address with no code gives a 64-byte (EIP-2098) or 65-byte signature with v 27 or 28; an address with code is asked ERC-1271. The schema's description says so.
- **A relay limit, not a schema cap** (red team of pull request 1): each operator relays a party signature of at most 16,384 bytes and says so in `site/ref/limits.txt`, since a node keeps a few copies of each signature in a deal's record and a Durable Object row holds 2 MiB. A longer one still goes straight to the contract (D31). Pull request 2 enforces it.
- **No length cap in the schema** (D31): the operators' request-size limits bound it, as ADR-0040 §5 says.

## Handoff

### After pull request 1 (schema v0.12)

- **Deploy only with pull request 2 and T-550.** On its own, v0.12 admits signatures today's checks refuse, and a very long delivery or early-accept signature made the EVM node answer 500 instead of refusing (red team of pull request 1, finding 1, measured from about 90,000 bytes). Pull request 2 checks both off chain before any simulation and refuses a party signature above 16,384 bytes. The operator deploy is the coordinator's, and Rafa's to approve.
- **Paths beyond the task's list:** `examples/mandate.test.ts` (its schema IDs), `site/ref/limits.txt` (the relay limit), `spec/examples/operator-status.example.json` (its version).
- **For pull request 2:** `site/ref/signing.txt` still says 65 bytes; residual 13 in `docs/neutrality.md`.
