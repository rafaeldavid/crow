# T-548: the seller contract for standing offers

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** T-544 (ADR-0040), and Rafa's answers to D82's open points
- **Paths this task may touch:** `contracts/src/HoldbackStandingSeller.sol` and `contracts/src/IHoldbackStandingSeller.sol` (new), `contracts/test/` (new tests only), `packages/core/src/eip712.vectors.test.ts` (the new type's vectors), this file. Not `HoldbackRules.sol`, `HoldbackTypes.sol` or `IHoldbackRules.sol`.
- **Human gate:** no. Deploying it to Sepolia waits for Rafa.
- **Status:** todo
- **Agent/session:** none yet
- **Roadmap row:** N196
- **Change kind:** 7, smart contracts.

## What exists

- The rules contract checks contract signers through ERC-1271 (`contracts/src/HoldbackRules.sol:567-571`), tested in `contracts/test/crosscheck/Erc1271*.t.sol`.
- A spike of this contract and its 10 tests, run against the unchanged rules contract: `docs/research/2026-11-18-standing-offers/` (ADR-0040 research, section 2). The spike is a measurement, not a starting point to copy unreviewed.

## Intent

Build the contract ADR-0040 section 1 describes: a seller's address that says yes, through ERC-1271, to the seller's key, to a take of a template the key signed, and to a template's standing delivery. It holds no money and has no admin.

## Acceptance criteria

- [ ] One constructor argument, the key; one mapping, `revoked`; `isValidSignature`, `revoke`, and view helpers only. A selector allowlist test, like `contracts/test/fuzz/NoAdmin.fuzz.t.sol`, fails on any other external function.
- [ ] The template is an EIP-712 struct, `StandingOffer`, under the contract's own domain, with vectors generated in the repository.
- [ ] The commitment ID and the delivery hash come from `HoldbackTypes`, and the digest from the named rules deployment.
- [ ] Every contract-level test of ADR-0040 section 9 passes, under its name, in `contracts/test/attack/StandingSeller.t.sol`; the blob decoder is fuzzed.
- [ ] A deployment through the deterministic deployment proxy gives one address whoever pays, tested.
- [ ] Runtime size and the gas of a take's `agreeAndFund` against a plain one are measured and recorded here.
- [ ] `git diff origin/main -- contracts/src/HoldbackRules.sol contracts/src/HoldbackTypes.sol contracts/src/IHoldbackRules.sol` is empty.
- [ ] One review, and a red-team pass, as the change recipe and ADR-0040 ask.

**Done when** `forge test` passes every test above and the rules contract's sources are unchanged.

## Out of scope

- Any off-chain code (T-549), the delivery rule (T-550), deployment to a public chain.

## Evidence

## Decisions

## Handoff
