# T-528: the beacon's pairing gas is set at deploy, and too little gas has its own error

- **Lane:** contracts
- **Phase:** 2
- **Kind:** 7, smart contracts
- **Depends on:** T-525 (main in the lane), T-523's plan, group G3 (RR-1, R-9)
- **Paths this task may touch:** `contracts/src/DrandQuicknetBeacon.sol`, `contracts/script/deploy-sepolia.sh` (the new argument only), `contracts/test/unit/BeaconPairingGas.t.sol`, the tests that deploy the beacon (the argument only), the two anvil tests that deploy it outside `contracts/` (the argument only), this file
- **Human gate:** no; deploying a build with this beacon is Rafa's (`docs/redeploy-contracts.md`)
- **Status:** in review
- **Agent/session:** the scan-fixes contract lane session (T-525)
- **Roadmap row:** N190

## Intent

An outside scan's findings in group G3 repeat two known issues of the beacon. The gas it forwards to the pairing precompile is a constant of 250,000 (RR-1), so a repricing above it would fail every proof for the deployment's life. And a valid proof sent with too little gas reverts with the same `InvalidSignature` as a bad proof (R-9), so a relayer cannot tell the two apart. This task makes the pairing gas a constructor argument with a floor at two pairs' price, 102,900 gas, and reverts `NotEnoughGas` when a failed pairing was given too little gas. The deploy script passes 250,000, today's value.

## Acceptance criteria

- [x] Tests fail on the lane's beacon before the change and pass after it.
- [x] The drand vector suites pass with only the new argument added (`DrandAllRounds`, `DrandEncodings`, `DrandRedTeam`, `DrandVerifierReview`, `DrandSecondRead`).
- [x] `forge test` passes on the whole suite.
- [ ] One review (kind 7).
- [ ] Merged into the lane after every check has passed.

## Evidence

**Tests** (`contracts/test/unit/BeaconPairingGas.t.sol`). The beacons are deployed from their creation code with the value appended, so the same test compiles against the old beacon and the new one.

| Test | Before (the lane's beacon, with the two new errors declared only) | After |
| --- | --- | --- |
| `test_pairingGasBelowTheFloor_refused` | FAIL: "a beacon with less than two pairs' price deploys" | PASS |
| `test_pairingGas_isTheConstructorValue` | FAIL: "the beacon does not state its pairing gas" | PASS |
| `test_validProofWithTooLittleGas_neverRevertsInvalidSignature` | FAIL: at 42,000 gas a valid proof reverted `InvalidSignature` (`0x8baa579f`) | PASS |
| `test_pairingGasAtTheFloor_verifiesARealRound` | PASS | PASS |
| `test_wrongRoundWithEnoughGas_revertsInvalidSignature` | PASS | PASS |

[measured, 2026-11-18, `forge test --match-path test/unit/BeaconPairingGas.t.sol`]

**The change.**
- `DrandQuicknetBeacon`: `constructor(uint256 pairingGas)` refuses a value below `MIN_PAIRING_GAS` (102,900) with `PairingGasBelowFloor`. `PAIRING_GAS` becomes a public immutable.
- `beaconValue`: when the pairing fails and the gas left is at most 1/63 of `PAIRING_GAS`, it reverts `NotEnoughGas`. A call forwards at most 63/64 of the gas left (EIP-150), so that condition means the pairing got less than the cap, or the cap with almost nothing to spare. It is the check OpenZeppelin's `MinimalForwarder` (v4) makes after its call [from memory; not re-read for this task]. A proof judged with the full cap still reverts `InvalidSignature`.
- Four new names in the ABI: `MIN_PAIRING_GAS`, `PAIRING_GAS`, `NotEnoughGas` and `PairingGasBelowFloor`.
- No change to the verification itself: the D04 mutant's line is untouched.
- **The deploy script** (`deploy-sepolia.sh`) sets `PAIRING_GAS=250000` in one place. It passes the value at the create line and to the creation-code check, appends it to the init code for the runtime-hash check, reads `PAIRING_GAS()` back, and writes it into the record's `args` for the beacon. That is more than the one line the plan guessed: the runtime hash and the creation check both need the argument.
- **Tests outside `contracts/`** that deploy the beacon pass the same value: `apps/adjudicator/src/drand-contract.redteam.test.ts` (`args: [250_000n]`), and the two creation shims of `packages/settlement/evm/deploy-script.test.ts`.
- **The tests in `contracts/test/` that deploy the beacon** pass 250,000: ten files and two harnesses that inherit it, plus T-527's `BeaconProbe.t.sol` after the lane merged in. One harness getter turns from `pure` to `view`, because it reads the immutable.
- **Two existing tests changed with the behaviour:**
  - `NoAdmin.fuzz.t.sol`'s reviewed ABI allowlist for the beacon gains `MIN_PAIRING_GAS()` and `PAIRING_GAS()`, both read-only.
  - `DrandRedTeam.t.sol`'s `test_attack_break_validDecisionWithTooLittleGas_revertsAndSettlesOnRetry` pinned R-9: it required some gas limit to make a valid proof say `InvalidSignature`. It now requires the opposite, through the rules contract's `decide`: no gas limit makes the valid proof say `InvalidSignature`, and some say `NotEnoughGas`. Measured from 60,000 to 600,000 gas in steps of 5,000: 19 limits said `NotEnoughGas`, none said `InvalidSignature`, and the decision first settled at 275,000 gas [measured, `-vv`].

**Review (kind 7, one reviewer, 2026-11-18): PASS, no blocking finding.**
- **The reviewer's own measurements:**
  - Run against the lane's beacon, the tests failed the same way as recorded above.
  - The full suite passed 516 of 516 tests on the branch.
  - The vector suites change only by the argument.
  - No other code deploys the beacon without the argument.
  - `--check` round-trips the record it wrote.
- **Non-blocking, fixed:**
  - **The precompile calls before the pairing.** A valid proof still said `InvalidSignature` when the gas ran out there: at 9,469 to 10,811 gas directly, and at 24,114 to 25,476 gas through `decide` [the review's measurement]. The test's claim, "never `InvalidSignature`", was therefore false below its first gas value.
    - `_call` now applies the same 1/63 rule as the pairing: a failed MODEXP, MAP_FP_TO_G1 or G1ADD call that leaves 1/63 of the gas before it or less reverts `NotEnoughGas`. Any other failure stays `InvalidSignature`, including a precompile that reverts and returns its gas, which `test_attack_fork_mapOrAddAnswerOfAnotherLength_refused` covers. A missing precompile's empty answer also stays `InvalidSignature`.
    - Both sweeps now start at 1 gas: steps of 1 up to 40,000 directly, and steps of 3 up to 60,000 through `decide`.
    - After the fix, no gas limit in either sweep makes a valid proof say `InvalidSignature`. Through `decide`, 683 limits said `NotEnoughGas`, and the decision first settled at 275,001 gas [measured].
  - **The comments:** the NatSpec of `NotEnoughGas` and `beaconValue` now say when the error comes, and `PAIRING_GAS` notes what a very large value does.
  - **`deploy-script.test.ts`** now asserts the beacon's record args, `['250000']`.
- **Non-blocking, left as they are:**
  - The EVM adapter does not name the beacon's errors (T-529's Handoff, item 3).
  - On `--check`, a pairing-gas mismatch fails with the generic "creation input differs" message, but it still fails closed.
  - Under Fusaka's MODEXP prices, the gas band before the pairing is wider. The fix covers it by the same rule, but forge 1.0.0 on Prague cannot measure it [inferred].

**Full suite:** see the pull request. The anvil suites that run the deploy script run in CI only; they were not run locally (no `node_modules` in the worktree).

## Handoff

**Next:** T-529 (G4) branches from the lane after this merges. Docs that state the constant 250,000 (`docs/audit/`, `contracts/README.md`) belong to the docs session and the redeploy's records; they are listed for the redeploy in T-529's Handoff.
