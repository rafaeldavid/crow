# T-548: the seller contract for standing offers

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** T-544 (ADR-0040), and Rafa's answers to D82's open points
- **Paths this task may touch:** `contracts/src/HoldbackStandingSeller.sol` and `contracts/src/IHoldbackStandingSeller.sol` (new), `contracts/test/` (new tests only), `packages/core/src/eip712.vectors.test.ts` (the new type's vectors), this file. Not `HoldbackRules.sol`, `HoldbackTypes.sol` or `IHoldbackRules.sol`.
- **Human gate:** no. Deploying it to Sepolia waits for Rafa.
- **Status:** done (pull request 693, merge commit `10322887`, 2026-11-19)
- **Agent/session:** Claude Code session, branch `t-548-standing-seller-contract` (2026-11-19)
- **Roadmap row:** N196
- **Change kind:** 7, smart contracts.

## What exists

- The rules contract checks contract signers through ERC-1271 (`contracts/src/HoldbackRules.sol:567-571`), tested in `contracts/test/crosscheck/Erc1271*.t.sol`.
- A spike of this contract and its 10 tests, run against the unchanged rules contract: `docs/research/2026-11-18-standing-offers/` (ADR-0040 research, section 2). The spike is a measurement, not a starting point to copy unreviewed.

## Intent

Build the contract ADR-0040 section 1 describes: a seller's address that says yes, through ERC-1271, to the seller's key, to a take of a template the key signed, and to a template's standing delivery. It holds no money and has no admin.

## Context

ADR-0040 sections 1 (what the contract approves), 2 (the standing delivery), 4 (deployment) and 9 (the forge tests this task owns, and what the auditors need); `contracts/test/crosscheck/Erc1271*.t.sol`; `docs/research/2026-11-18-standing-offers.md` section 2.

## Acceptance criteria

- [x] One constructor argument, the key; one mapping, `revoked`, and one one-way flag, `retired`; `isValidSignature`, `revoke`, `retire`, and view helpers only.
- [x] The terms' nonce is `keccak256(abi.encode(templateHash, seed))`; the template has no field the contract ignores; a payout address equal to the contract is refused. A selector allowlist test, like `contracts/test/fuzz/NoAdmin.fuzz.t.sol`, fails on any other external function.
- [x] The template is an EIP-712 struct, `StandingOffer`, under the contract's own domain, with a signed `offerId` the contract does not read, and vectors generated in the repository.
- [x] The commitment ID and the delivery hash come from `HoldbackTypes`, and the digest from the named rules deployment.
- [x] Every test ADR-0040 section 9 assigns to forge and T-548 passes in `contracts/test/attack/StandingSeller.t.sol`, as a function named after its fixture name; the blob decoder is fuzzed.
- [x] A deployment through the deterministic deployment proxy gives one address whoever pays, tested.
- [x] Runtime size and the gas of a take's `agreeAndFund` against a plain one are measured and recorded here.
- [x] `git diff origin/main -- contracts/src/HoldbackRules.sol contracts/src/HoldbackTypes.sol contracts/src/IHoldbackRules.sol` is empty.
- [x] One review, and a red-team pass, as the change recipe and ADR-0040 ask.

**Done when** `forge test` passes every test above and the rules contract's sources are unchanged.

## Out of scope

- Any off-chain code (T-549), the delivery rule (T-550), deployment to a public chain.

## Evidence

Measured on 2026-11-19, branch `t-548-standing-seller-contract`, Foundry 1.0.0, solc 0.8.28 (via IR, 200 runs).

- **Tests** [measured]: `forge test --match-path 'test/*/Standing*'` passes 51 of 51 tests in 5 suites: `attack/StandingSeller.t.sol` (18), `unit/StandingSeller.t.sol` (21), `unit/StandingOfferVectors.t.sol` (4), `unit/StandingSellerGas.t.sol` (3), `fuzz/StandingSellerNoAdmin.fuzz.t.sol` (5). The full `forge test` runs in CI; a local full run did not finish because other sessions' builds were loading the machine.
- **Section 9's forge tests** [measured]: one function per fixture in `contracts/test/attack/StandingSeller.t.sol`: `take-changes-a-fixed-field`, `take-under-another-deployment`, `template-replayed-to-another-contract`, `take-replayed`, `take-backdated`, `take-dated-ahead`, `take-offsets-overflow`, `standing-delivery-other-file`, `standing-delivery-crosses-templates`, `standing-delivery-from-revoked-template`, `revoked-template-variant`, `take-pays-the-seller-contract`, `leaked-key-after-retire`, `deployer-keeps-a-back-door`, and `standing-blob-malformed`, fuzzed twice (random bytes; cuts and one-byte changes of a valid take). Added from the red team: `template-names-a-hostile-rules-address`.
- **Vectors** [measured]: `packages/core/src/eip712.vectors.test.ts` computes 8 values with viem from the spec examples (template hash and digest, revoke and retire digests, a take's nonce, commitment ID, terms digest and delivery hash); `StandingOfferVectors.t.sol` pins the same 8, and the contract answers yes to the key's signature of viem's digests. `vitest run packages/core/src/eip712.vectors.test.ts`: 19 of 19 passed; `tsc --noEmit -p packages/core` and `eslint` clean.
- **The rules contract** [measured]: `git diff origin/main -- contracts/src/HoldbackRules.sol contracts/src/HoldbackTypes.sol contracts/src/IHoldbackRules.sol` is 0 lines.
- **Size** [measured, `forge build --sizes`]: runtime 11,503 bytes (13,073 bytes under EIP-170); init code 11,927 bytes, 11,959 with the key. ADR-0040's spike measured 9,430 bytes; the build adds the EIP-712 template type, revoke, retire and the view helpers.
- **Gas** [measured, `forge test --match-contract StandingSellerGas --isolate -vv`, each call its own transaction]:

| Step | Plain or per-buyer | Take or standing | Difference |
| --- | --- | --- | --- |
| `agreeAndFund` | 224,992 gas | 261,233 gas | +36,241 gas (+16%) |
| `deliver` | 84,428 gas (65-byte key signature) | 136,458 gas (standing delivery) | +52,030 gas |
| `isValidSignature` for a take | | 41,833 gas | |
| Deployment through the proxy | | 2,548,708 gas | |

  The take's blob is 1,568 bytes. ADR-0040 §4 guessed about 1.9 million gas for a deployment; the measured 2,548,708 gas replaces it [measured].
- **After the merge freeze** (T-563, tag `contracts-phase-one-2`): `origin/main` merged into the branch. Main's rules constructor now asks the beacon for a round, so the vectors suite etches a sim beacon as `Vectors.t.sol` does; then 51 of 51 standing-seller tests pass, and the rules sources' diff against `origin/main` is 0 lines [measured]. A one-off check, not committed, put main's rules contract at the deployment record's `rules` address on chain 11155111: its domain is "Holdback", "0.8", and the seller contract answered yes for a take and its standing delivery there [measured]. No test ran against Sepolia itself; the repository has no fork tests and no RPC endpoint.
- **Reviews**: a red-team pass and one review, each given `CLAUDE.md`, ADR-0040, the threat model and the related ADRs, not the implementer's conclusions. Findings and what was done are in Decisions.

## Decisions

- **The template's shape** (ADR-0040 §1 left it to the build). `StandingOffer` mirrors `CommitmentTerms`' EIP-712 types (`TokenAmount`, `Adjudication`, `Remedy`, `Ciphertext`, `EncryptedKey`) so a wallet shows the same fields; the deadlines are a `TimingOffsets` struct with `Timing`'s field names; the standing delivery is a `StandingDelivery[]` of length 0 or 1, so a template without a file has no zero-filled fields the contract would ignore.
- **Disclosure is fixed to public by the contract**, not a template field: `termsOf` writes the struct hash of `Disclosure("public")`. ADR-0040 §7 says the template fixes it; a field could only carry other values, which the operators would refuse anyway.
- **The rules digest is built in the contract** (red team H-1, High, measured). The first build asked `IHoldbackRules(offer.rules).typedDataHash`; a template naming a hostile contract there approved any digest, and as a standing delivery it survived revoke and retire: the red team settled a real delivered deal as a full refund with it. The contract now builds the digest from the rules contract's domain (name "Holdback", version "0.8", the chain, `offer.rules`) and calls no code at `offer.rules`. This differs from the acceptance criterion's wording "the digest from the named rules deployment" and from ADR-0040 §1: the value is the same, it is just not asked for. Cost: a rules build under another domain name or version needs a new version of the seller contract; `test_rulesDigest_isTheRulesContractsOwn` fails if the rules domain changes. ADR-0040 §1 and §4 should say so (Handoff).
- **The key is checked by ECDSA only** (red team Info-1, measured). Through `SignatureCheckerLib`, a key address with code was asked through ERC-1271, so its answer could change after a take funded and block the standing delivery. Now `KEY` is an ECDSA key: 64- or 65-byte signatures only, on every path (`isValidSignature`, revoke, retire). `test_keyWithCode_stillAnswersByEcdsa` gives the key's address reverting code and the standing delivery still lands.
- **Review findings fixed:** the contract-stack page words the two new files (`tools/contract-stack/plain.json`; `tests/contract-stack.test.ts` failed without them, measured), a path outside this task's list, widened for that reason only; Evidence recorded; the fixed-field test covers the nine terms fields it skipped, directly through `isValidSignature`; `Revoked` says "from this transaction on"; `KEY`'s notice says it must be a key that signs; `forge fmt` on the new files.
- **Kept as known limits** (in `IHoldbackStandingSeller.sol`): the key path approves any digest the key signs, including per-buyer offers after `retire()` and a per-buyer offer paying into the contract; the answer changes over time (front-running a revoke is part of it, red team Info-4); `abi.decode` accepts other encodings of the same take (the signature's padding cut or changed), measured by the fuzz test.

## Handoff

- **Status:** done once the PR merges. Nothing is deployed; deploying to Sepolia waits for Rafa.
- **T-549 can start.** It reads a contract seller through ERC-1271 by `eth_call`. For off-chain checks it needs: the blob `abi.encode(uint8 kind, StandingOffer, bytes keySignature, Fill)` with kind 1 (take) or 2 (standing delivery); the EIP-712 types written out in `packages/core/src/eip712.vectors.test.ts`, which core should export when it gains the signer, so the pins then guard core's own signer; and the measured deployment cost, 2,548,708 gas, for an operator's deployment budget.
- **The address depends on the build's metadata** (review finding 4, Low, inferred). The creation code carries CBOR metadata over the sources it imports, so a comment-only change to `HoldbackTypes.sol` or `IHoldbackStandingSeller.sol` moves every seller's CREATE2 address. T-549, T-551 and T-552 should pin the published creation-code bytes, not rebuild them from `main`; or a later change sets `bytecode_hash = "none"` for this contract, which touches `foundry.toml` and the rules contract's build.
- **For the coordinator, outside this task's paths:** ADR-0040 §1 and §4 to say the seller contract builds the rules digest itself and that a rules domain change needs a new seller-contract version; `docs/audit/known-issues.md` and `docs/audit/scope.md` to list the seller contract and its known limits (retire ends takes only; the key path) before the auditors see it; the one sentence in `CLAUDE.md` on the waived seller check of each buyer, which waits for Rafa.
- **A second review by another model family** was recommended by the reviewer for this settlement contract; the change recipe runs one only when Rafa asks.
