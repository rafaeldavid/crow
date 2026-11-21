# T-529: the contract refuses signed fields phase one cannot use

- **Lane:** contracts
- **Phase:** 2
- **Kind:** 7, smart contracts, with a red team (new refusals in the funding and decision paths)
- **Depends on:** T-527 (merged into the lane), T-523's plan, group G4 (L-1, I-1, RR-5)
- **Paths this task may touch:** `contracts/src/HoldbackRules.sol`, `contracts/src/IHoldbackRules.sol`, `contracts/src/HoldbackTypes.sol` (two NatSpec blocks, comments only), `contracts/scripts/mutants-lane.json` (the mutants of the changed lines), `contracts/test/unit/SignedFieldsRefused.t.sol`, `contracts/test/attack/CarriedDeliveryRevert.t.sol` (G1's documenting test), `contracts/test/attack/SignedFieldRefusalsAttack.t.sol` (the red team's tests), `contracts/test/unit/ZeroAddressOutcomes.t.sol` (RR-3's documenting tests), the two test files that pinned the old behaviour (`contracts/test/crosscheck/R11Review.t.sol`, `contracts/test/attack/PhaseOneRedTeam.t.sol`), this file
- **Human gate:** no for the lane; every deploy of the next build is Rafa's (Handoff)
- **Status:** done (merged in PR 659, 2026-11-18)
- **Agent/session:** the scan-fixes contract lane session (T-525)
- **Roadmap row:** N190

## Intent

An outside scan's findings in group G4 repeat entries of Crow's own register: signed fields the state model says to refuse reach settlement unchecked (`docs/audit/state-model.md` §8.3). This task adds three comparisons, each refused with `InvalidMessage`:
- `agreeAndFund` refuses terms whose `disputeBy`, `disputeJudgeSec` or `disputeFallbackSec` is not 0. These fields belong to optimistic mode, which phase one does not run (L-1).
- `decide` refuses a primary's decision with any beacon field set (source, round, value or proof), because the primary proves no beacon round (I-1).
- `decide` refuses the appeal adjudicator's decision on an escalation when it names an appeal ground, because phase one has no party appeal (I-1).

RR-5 (`triggerFallback` after `fallbackBy`) gets the doc line the plan recommends, and a test that shows the default follows at once.

**Left out:**
- **A settlement naming its signers** (the plan's D-1). Rafa decided on 2026-11-18 that it waits for the rebuilt contracts. `MutualSettlement` is unchanged, and the session on `main` documents the limit.
- **RR-3 (zero addresses at funding): decided by ADR-0033 and D31, no refusal added.** ADR-0033 §2 says the contract compares neither money address with anything, the zero address included. D31's reason applies: the operators warn, and the party may still choose. Rafa answered that ADR's open points himself (D62). A review's suggestion does not amend an accepted decision; the coordinator confirmed this on 2026-11-18, and Rafa may overrule. What each zero does today:
  - A zero buyer, seller or primary adjudicator can never fund: Solady's signature checker returns false for a zero signer [inferred from reading].
  - A zero `buyerPaymentAddress` can never fund: no ERC-3009 signature comes from the zero address [inferred from reading].
  - A zero `sellerPayoutAddress` funds. An accept on the test token sends the price to the zero address, and the decider gets its fee [measured: `test_zeroPayoutAddress_funds_andAnAcceptSendsThePriceToTheZeroAddress`]. The demo's TestUSDC uses the same Solady transfer [inferred from reading].
  - A zero fallback adjudicator funds. No fallback decision verifies, and the path ends in the default refund of price + fee [measured: `test_zeroFallbackAdjudicator_funds_andTheFallbackPathEndsInTheDefaultRefund`]. A zero appeal adjudicator behaves the same way after an escalation [inferred].

**Also here: G1's documenting test.** G1's fix is off chain, in the operators. `CarriedDeliveryRevert.t.sol` records the contract's side of it, which the next build keeps.

## Before the change: what the senders send

Each new refusal could stop live deals on the next deployment if a sender filled the field. I checked each sender by reading [inferred from reading the code]:
- **Dispute fields.** `packages/core/src/eip712.ts:360-362` encodes absent dispute fields as 0. The commitment schema allows them in optimistic mode only (`spec/schemas/commitment.schema.json`, `allOf[0]`). Core refuses every settlement mode but `guaranteed_on_decision` (`packages/core/src/parse.ts:102`, `state.ts:240`). The EVM encoder copies core's values (`packages/settlement/evm/encode.ts:81-83`).
- **A primary's beacon fields.** The reference adjudicator attaches a beacon only for the fallback and the appeal roles (`apps/adjudicator/src/service.ts`, the seed step, and `...(pre.beacon ? …)` at the decision). Core encodes an absent beacon as an empty source, round 0, value 0 and proof `0x` (`eip712.ts:438-440`), and the contract's new check compares exactly those.
- **An escalation decision's appeal ground.** The reference adjudicator adds `appealGround` only when its task carries one (`service.ts:962`). On the EVM, only SimChain's adapter and the sim set a task's ground (`simchain-adapter.ts:173`, `_sim.ts`). Core refuses a ground on any decision but an appeal (`state.ts:479`).

## Acceptance criteria

- [x] Each refusal has a test that fails on the lane's code before the change.
- [x] The three tests that pinned the old behaviour are replaced, and say where their refusals are now tested.
- [x] `forge test` passes on the whole suite.
- [x] One review and the red team; blocking findings fixed.
- [x] Merged into the lane after every check has passed.

## Evidence

**Tests** (`contracts/test/unit/SignedFieldsRefused.t.sol`), run before the change on the T-527 branch's head `99c23c8c` (the same tree as the lane at T-527's merge, `c6706e55`), then after it:

| Test | Before | After |
| --- | --- | --- |
| `test_termsWithDisputeBy_refused` | FAIL: next call did not revert as expected | PASS |
| `test_termsWithDisputeJudgeSec_refused` | FAIL: next call did not revert as expected | PASS |
| `test_termsWithDisputeFallbackSec_refused` | FAIL: next call did not revert as expected | PASS |
| `test_termsWithZeroDisputeFields_fund` | PASS | PASS |
| `test_primaryDecisionWithBeaconSource_refused` | FAIL: next call did not revert as expected | PASS |
| `test_primaryDecisionWithBeaconRound_refused` | FAIL: next call did not revert as expected | PASS |
| `test_primaryDecisionWithBeaconValue_refused` | FAIL: next call did not revert as expected | PASS |
| `test_primaryDecisionWithBeaconSignature_refused` | FAIL: next call did not revert as expected | PASS |
| `test_primaryDecisionWithEmptyBeaconFields_settles` | PASS | PASS |
| `test_escalationDecisionWithAppealGround_refused` | FAIL: next call did not revert as expected | PASS |
| `test_escalationDecisionWithEmptyAppealGround_settles` | PASS | PASS |
| `test_triggerFallbackAtFallbackBy_leadsStraightToTheDefault` (RR-5, documenting) | PASS | PASS |

[measured, 2026-11-18, `forge test --match-path test/unit/SignedFieldsRefused.t.sol`]

**Replaced:** `test_r11_issue_disputeFieldsAreSignedAndNotRefused` and `test_r11_issue_primaryDecisionMayCarryUnprovenBeaconFields` (`R11Review.t.sol`), and `test_issue_escalationDecisionAcceptsAnyAppealGround` (`PhaseOneRedTeam.t.sol`). Each pinned the defect and fails once it is fixed (`InvalidMessage()`) [measured]. `docs/audit/known-issues.md` §2 cites the three names (Handoff).

**G1's documenting test:** `test_carriedDecision_revertsWhenTheSellerDeliversFirst_andItsSeedStaysTheOnlySeed` (`contracts/test/attack/CarriedDeliveryRevert.t.sol`), PASS on the lane's code and after the change [measured]. Its steps:
- The primary's reject carries the first delivery.
- The seller posts a second delivery first.
- The carried decision reverts with `InvalidMessage`, after its seed was in the calldata.
- A decision on the posted delivery with another seed reverts with `BadSeed`.
- The decision with the published seed settles.

**The change:**
- `HoldbackRules.sol`: three comparisons and their comments.
- `IHoldbackRules.sol`: the refusal lists of `agreeAndFund` and `decide`, and RR-5's line on `triggerFallback`.
- No event, function, signed type or admin path changes.

**Review (kind 7, one reviewer, 2026-11-18): ISSUES, one blocking finding, fixed.**
- **Blocking, fixed:** `HoldbackTypes.sol`'s NatSpec for `Timing` and `Decision` still called the dispute fields, the escalation's appeal ground and the primary's beacon fields "signed only". The two blocks now state the new rules; the change is comments only.
- **Checks that held:**
  - The reviewer ran the new tests against the parent's sources: all 8 refusal tests failed and the 4 positive tests and G1's test passed, which reproduces the table above.
  - Exactly the three old tests were removed.
  - The compiled rules ABI equals `abis.json`'s.
  - The differential and invariant suites pass, and their handlers never fill the refused fields [measured by the review].
- **Non-blocking, fixed:**
  - The lane's mutant list: M047 is retargeted, because its line now also stands in `_escalationDecision`; L008 is retargeted; and L042 to L044 cover the three new comparisons. Each `find` now matches exactly once [measured]. The mutants were not run.
  - The doc spots listed in the Handoff.
  - The late-fallback test now shows that a fallback decision is past its deadline.
  - The zero-dispute test asserts its fields.
- **Non-blocking, left as they are:**
  - The invariant handler does not fuzz the refused fields.
  - `PinnedSource.t.sol` reads the default `out/` folder, so it fails under a separate `--out`. That comes from how the suite is run, not from this change.

**Red team (2026-11-18): no Critical, High or Medium finding; one Low and four Info.**
- **What held [measured by its tests]:**
  - Every refused field sits inside a signature. A relayer or funder that alters one gets a revert, and the untouched message still settles or funds.
  - After each refusal, every stage keeps its exit: the fallback path from Delivered, a corrected carried call from Held, and the default from Escalated.
  - A fuzz test shows that a primary's decision settles exactly when all four beacon fields are empty.
  - The fallback's `beaconSourceHash` stays signed only.
  - Its whole-suite run with its own file passed 534 of 534 tests.
- **Its 11 tests are kept as regression tests:** `contracts/test/attack/SignedFieldRefusalsAttack.t.sol`.
- **Low, off chain (L-1):** core and the schema accept two things the contract now refuses: a `beacon` object on a primary's decision, and an `appealGround` on the appeal adjudicator's decision on an escalation. An outside adjudicator that sends either has its decision refused in the operator's simulation, with a bare `invalid_terms`. The deal then goes on by its timeouts. It is not a neutrality break, because either adjudicator could already stall by not signing. The fix is one rule each in core's phase-one checks, on `main` (Handoff).
- **Info, fixed here:**
  - `SignedFieldsRefused.t.sol`'s `@notice` overstated who builds decisions.
  - `CarriedDeliveryRevert.t.sol` compared a seed with itself; it now uses the published seed explicitly.
- **Info, recorded:**
  - A tampered beacon field reverts `InvalidMessage` before the signature check, while a tampered ground reverts `BadSignature` after it. Both change nothing.
  - Terms built in code that skip the schema can carry dispute fields past core and are then refused at funding, with no funds moved.
  - `state-model.md:179` and `threat-model.md` TA-11 are stale (Handoff, item 5).

**Full suite:** see the pull request.

## Handoff

**RR-3** is settled by ADR-0033 and D31 (Intent). Refusing zero addresses later would amend ADR-0033 §2 and the operators' warnings in `apps/operator/src/prepare.ts`, and would be its own task.

**For Rafa: what a redeploy of the next build needs.** I deploy nothing. The lane's tip after this task carries T-527, T-528 and T-529. The steps are `docs/redeploy-contracts.md`'s, each with its go-ahead.
1. **Bring `main` into the lane again before the freeze.** The session on `main` is landing G1's relay rule, the G8 fixes and the docs batch. Then tag the lane's tip `contracts-phase-one-2` (point of no return 2 is Rafa's).
2. **The beacon takes one constructor argument** (T-528). `deploy-sepolia.sh` sets `PAIRING_GAS=250000` and passes it, checks it back, and writes it into the record (`contracts.DrandQuicknetBeacon.args`). Rehearse the deploy on anvil first (`scripts/deploy-rehearsal.mjs`). The anvil suites ran in CI only.
3. **The ABI grows.**
   - The rules contract gains `BadBeacon`; `packages/settlement/evm/abis.json` is regenerated on the lane.
   - The beacon gains `MIN_PAIRING_GAS()`, `PAIRING_GAS()`, `NotEnoughGas` and `PairingGasBelowFloor`.
   - `packages/settlement/evm/errors.ts` maps neither beacon error. Through `decide`, a `NotEnoughGas` reaches an agent as "unknown error" (`invalid_state`). A one-line map entry on `main` would name it (off chain, not done here).
4. **New refusals** in `agreeAndFund` and `decide`. No sender fills the refused fields (above). Step 7's live rounds on the new deployment prove it on Sepolia.
   - **Off-chain follow-up on `main` (the red team's L-1):** core's phase-one checks should refuse a primary decision that carries a `beacon` and an escalation's appeal decision that carries an `appealGround`, with a named reason, so an outside adjudicator learns why before the relay simulates. One rule each in `packages/core/src/state.ts`.
5. **Docs that change with this build** (the `docs/audit/` owner's, after the merge):
   - `known-issues.md` §10: RR-1 is fixed, RR-2 is fixed for the beacon (the other three addresses stay with the deploy script, Rafa 2026-11-12 and 2026-11-18), and RR-5 is documented.
   - `known-issues.md` §2: the "three checks not built" row is now built, and it cites the three replaced test names.
   - `state-model.md:179` ("It does not refuse the dispute fields"), §8.1 (the dispute fields "never read"), §8.2 (the escalation ground and the primary's beacon "not checked") and §8.3, and the drand rows that quote 250,000 gas as a constant.
   - `functions.md:86` and `:88` (the dispute fields and the primary's beacon fields "signed only"), and `threat-model.md` TA-11 ("It does not refuse the dispute fields").
   - `contracts/README.md`.
6. **Verification.** `scripts/sourcify-verify.mjs` zeroes immutables and compares the creation code as a prefix, so the beacon's argument needs no change there [inferred from reading].
7. **Not in this build:** D-1 (the settlement's signer binding, with the rebuilt contracts), RR-3 (decided by ADR-0033 and D31; documented by tests), and RR-4 (high-`s` signatures, accepted and documented).
