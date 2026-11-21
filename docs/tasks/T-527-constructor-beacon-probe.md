# T-527: the constructor asks the beacon for one round, and two comments are corrected

- **Lane:** contracts
- **Phase:** 2
- **Kind:** 7, smart contracts
- **Depends on:** T-525 (main in the lane), T-523's plan, group G2 with G6
- **Paths this task may touch:** `contracts/src/HoldbackRules.sol`, `contracts/src/IHoldbackRules.sol`, `contracts/test/unit/BeaconProbe.t.sol`, `contracts/test/unit/Vectors.t.sol` (its placeholder beacon), `packages/settlement/evm/abis.json` (regenerated: the new error), this file
- **Human gate:** answered: Rafa kept the beacon probe on 2026-11-18 (below)
- **Status:** done (merged in PR 654, 2026-11-18)
- **Agent/session:** the scan-fixes contract lane session (T-525)
- **Roadmap row:** N190

## Intent

An outside scan's findings in group G2 say the constructor checks its four addresses only for zero. Of the four, only the beacon has a liveness effect: `triggerFallback`, the only timeout exit from Delivered, asks the beacon for a round. A beacon that cannot answer leaves a delivered deal whose primary stays silent waiting for the escrow's expiry, unless the buyer accepts early or both parties settle. This task makes the constructor ask the beacon for one round and refuse with `BadBeacon` when the call fails. It also corrects two comments: the constructor's note about a per-chain margin table (G2), and the bound on the escrow's expiry in `agreeAndFund` (G6).

**Left out on purpose: a code check on the escrow, the collector and the token.** RR-2 and T-523's plan propose one. Rafa questioned that check on 2026-11-12: "Is this industry standard? I've never heard of this before. The depoy script should check this but unsure if smart-contract should." The check was then withdrawn (T-380, Non-goals), and `test_tokenWithoutCode_deploys` pins its absence. The coordinator kept that word on 2026-11-18. The deploy script checks the three addresses instead: each creation's input against this build, and the token's code at the deploy's check and at the operators' start-up (CU-1, T-383).

**Decided by Rafa on 2026-11-18: the probe, for the beacon only.** The coordinator asked him whether the contract should refuse to deploy when the beacon address does not answer, with the recommendation "Yes, for the beacon only. Leave the other three addresses to the deploy script, as you said on 2026-11-12." He answered "Yes, all six" (decision 1 of six, in the coordinator's private summary). Read together with his question of 2026-11-12, the rule is: the contract checks only the address whose mistake traps a live deal, the beacon; the deploy script checks the rest.

## Acceptance criteria

- [x] A test fails on the lane's code before the fix and passes after it.
- [x] `forge test` passes on the whole suite.
- [x] One review (kind 7).
- [x] Rafa's answer on the probe: kept, for the beacon only (2026-11-18).

## Evidence

**Tests** (`contracts/test/unit/BeaconProbe.t.sol`).

| Test | Before the fix (lane at T-525's merge, with the `BadBeacon` declaration only) | After |
| --- | --- | --- |
| `test_beaconWithoutCode_refused` | FAIL: "a beacon with no code deploys" | PASS |
| `test_beaconThatReverts_refused` | FAIL: "a beacon whose roundAt reverts deploys" | PASS |
| `test_simBeacon_deploys` | PASS | PASS |
| `test_drandBeacon_deploys` | PASS | PASS |
| `test_beaconWithShortAnswer_refused` | added after the review; refused with `BadBeacon` | PASS |
| `test_beaconWithoutCode_leavesADeliveredDealNoTimeoutExit` | written after the fix: it removes the beacon's code after deploy to show what the probe prevents; a demonstration that holds with or without the probe | PASS |

[measured, 2026-11-18, `forge test --match-path test/unit/BeaconProbe.t.sol`]

**The change.** The constructor makes one `staticcall` to `roundAt(block.timestamp)` and refuses with `BadBeacon` when the call fails or returns fewer than 32 bytes. One new error, `BadBeacon`, in `IHoldbackRules.sol`. Two comments corrected: the constructor's NatSpec (the deploy script holds one margin for the chain it serves, not a table), and `agreeAndFund`'s bound on the escrow's expiry, which holds only for an `EXPIRY_MARGIN` up to 281,217,279,356,221 s (2^48 − 1 − 253,402,387,139 − (2^32 − 1)) [measured by arithmetic]. No event, function or signed type changes.

**Also changed by the probe.** `Vectors.t.sol` deployed the rules contract with a placeholder beacon address that has no code; it now puts a sim beacon's code there. The digest depends on the domain alone, so the vector is unchanged. `packages/settlement/evm/abis.json` is regenerated (`node scripts/evm-abis.mjs`), because `abis.test.ts` holds it equal to the build and the build gained `BadBeacon`.

**Runtime code.** The probe sits in the constructor, so the runtime code is the parent's apart from the metadata hash: 20,502 bytes on both sides; the creation code grew from 21,266 to 21,411 bytes [measured by the review].

**Full suite:** at `86396cc7`, 508 passed and 2 failed: `test_termsDigest_matchesCore`, run by `Vectors` and by `RoleVectors`, which inherits it. The placeholder beacon was the cause, and `21211de9` fixes it. The two vector suites then pass 20 of 20 [measured]. CI runs the whole suite on the pull request.

**Review (kind 7, one reviewer, 2026-11-18).** One blocking finding: `abis.json` lacked the new error, so `abis.test.ts` would fail in CI. Fixed by regenerating the file. Two non-blocking findings were fixed as well:
- "The only exit from Delivered" now reads "the only timeout exit": the primary's decision, an early accept and a settlement still leave Delivered.
- A test now covers a beacon that returns short data.

Left as it is (non-blocking): a beacon that answers a 32-byte word above `uint64` passes the probe and would still revert in `triggerFallback`. So would a precompile address such as 0x04. The deploy script compares the beacon's code hash with the compiled verifier, which rules out both on Crow's own deploys.

## Handoff

**Next:** T-528 (G3, the beacon's pairing gas) branches from the lane after this merges.
