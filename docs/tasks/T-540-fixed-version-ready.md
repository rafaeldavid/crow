# T-540: the fixed contract version is ready for its deploy

- **Lane:** settlement, core and docs, on `main` and on the contract lane `contracts-audit-ready`
- **Phase:** 2
- **Kind:** 5 (settlement and core code: one review each), 2 (docs), and a merge of `main` into the lane
- **Depends on:** T-527, T-528 and T-529 (merged into the lane, tip `d621291e`); T-529's Handoff
- **Paths this task may touch:** `packages/settlement/evm/errors.ts` and its test; `packages/core/src/state.ts` and its test, and the decision case of `packages/settlement/evm/evm-settlement.ts`, on the lane; `docs/audit/` and `contracts/README.md` on the lane; `docs/redeploy-contracts.md`; this file. Never `contracts/src/`.
- **Human gate:** no for these pull requests; the review of the fixes, the tag and every deploy are Rafa's (Handoff)
- **Status:** in review
- **Agent/session:** the lane-ready session, started by the coordinator on 2026-11-18
- **Roadmap row:** N187

## What exists

- T-529's Handoff lists what a redeploy of the fixed version still needs. `docs/redeploy-contracts.md` is the runbook, and `scripts/deploy-rehearsal.mjs` rehearses steps 2.1 to 3.3 on anvil.
- `packages/settlement/evm/errors.ts` maps contract errors to the API's problem types by name.
- Core's phase-one profile (`packages/core/src/state.ts`) mirrors what the phase-one contracts settle.

## Intent

Make the fixed contract version ready for Rafa's deploy, without tagging it, deploying it or changing one byte of `contracts/src/` on the lane:
1. The operators name the beacon's two new errors.
2. Core refuses, with a named reason, the two decisions the fixed contract now refuses.
3. The audit docs on the lane describe the fixed version.
4. The lane holds `main`, with `contracts/src/` unchanged.
5. The deploy is rehearsed on a local chain from the lane's new tip, and the runbook's errors are fixed.

**Non-goals:** any contract change, the tag, any deploy or live transaction, `known-issues.md` (updated on `main` on 2026-11-18).

## Acceptance criteria

- [x] Item 1: the beacon's errors reach an agent by name, with a test.
- [x] Item 2: core and the relay refuse a primary's decision with a beacon and an escalation decision with an appeal ground, by name, where the operators serve the fixed contract.
- [x] Item 3: the audit docs on the lane describe the fixed version.
- [x] Item 4: `main` merged into the lane; the tree hash of `contracts/src` is the same before and after.
- [x] Item 5: the anvil rehearsal passes from the lane's new tip; the runbook's errors are fixed.
- [ ] Each pull request merged after its checks pass and its review findings are fixed.

## Evidence

### Item 1: the beacon's errors, on `main`

**Where, and why `main`.** The task's premise was that the lane's regenerated ABI already carries the errors. It does not: `packages/settlement/evm/abis.json` has no beacon entry on either branch (rules, token, escrow, multicall, collector) [measured]. `HoldbackRules` calls the beacon with a high-level call, so the beacon's revert reaches the relay unchanged, and the relay decodes it against the rules, escrow, collector, token and multicall ABIs only (`evm-settlement.ts`, `this.abi`). So on both branches every beacon error, the first version's `InvalidSignature` included, reached an agent as `the contract reverted with unknown error 0x…` [inferred from reading].

The fix is a fixed list of the beacon's three errors in `errors.ts` (`BEACON_ERRORS`), added to every ABI the two decoders read, plus two map entries. It belongs on `main` because it is harmless there: the first build's beacon never reverts with `NotEnoughGas` or `PairingGasBelowFloor`, so the new entries never match. Its `InvalidSignature`, a bad drand proof in a fallback or escalation decision, now reads by name, and its type changes from `invalid_state` (409) to the existing map's `invalid_signature` (401). The detail, `contract revert InvalidSignature()`, says which signature failed; no code branches on the type [measured by the review]. It reaches the lane with item 4's merge.

**The map:** `NotEnoughGas` is `invalid_state`, named in the detail: the relay sent too little gas, and the same signed message with more gas goes through. It is not `relay_refused`, which answers for the relayer's own budget or gas cap. In practice it surfaces only when a deployment's `PAIRING_GAS` is above what a simulation can forward, a deploy fault [inferred by the review]. `PairingGasBelowFloor` is the beacon's constructor's refusal and never answers a deal's call; it maps to `invalid_state` too.

**Review (kind 5, 2026-11-18): PASS.** No selector of the three clashes with any error in `abis.json` on `main` or the lane [measured by the review with viem]. No caller branches on the new names or types. The drift test runs in CI's anvil leg, which fails on a skip. Two wording notes, fixed: the comment's reason for not using `relay_refused`, and the type change above.

**Tests** (`packages/settlement/evm/errors.test.ts`) [measured, 2026-11-18]:
- The three errors, encoded as the beacon reverts them and decoded through an ABI with no beacon in it, each give their name and type: 3 tests.
- A drift check: every error the built beacon declares is in `BEACON_ERRORS`. It reads `contracts/out` and skips without it. Run against the first build's beacon (`InvalidSignature` only) and the fixed build's (from the T-529 worktree: `InvalidSignature`, `NotEnoughGas`, `PairingGasBelowFloor`), it passes both: 16 of 16 tests each time.
- `pnpm typecheck` and `eslint` on both files pass.

### Item 2: core's refusals, on the lane

**Decided: the lane, not `main`.** T-529's red team proposed one rule each in core's phase-one checks on `main`. That would make core stricter than the deployed first version, which accepts both fields [documented: `functions.md`, "signed only"; T-529's replaced tests `test_r11_issue_primaryDecisionMayCarryUnprovenBeaconFields` and `test_issue_escalationDecisionAcceptsAnyAppealGround`]. Core's phase-one step also mirrors what the chain settled: a decision that landed on the first contract and that core refuses moves the deal behind the chain on that node (`EvmSettlement.step`, `fallBehind`) [inferred from reading]. On the lane, core and the fixed contract refuse the same thing, and after the cutover each Worker serves the new world only (`docs/redeploy-contracts.md`, steps 1 and 6).

**No sender of Crow's fills the fields** [inferred from reading, 2026-11-18]:
- The reference adjudicator attaches a beacon only after its seed step for the fallback or the appeal role (`apps/adjudicator/src/service.ts`: the primary returns before the beacon read; `...(pre.beacon ? …)` at the decision).
- It adds `appealGround` only when its task carries one, and only the open-appeal branch of `simchain-adapter.ts` and `_sim.ts`'s `fileAppeal` set one. An `Escalated` task never does.
- The test helpers attach a beacon only when they pass a round (`packages/settlement/evm/testing.ts`, `packages/testkit/src/stub-settlement.ts`).

**Also in the relay.** `EvmSettlement` simulates a call before core steps it, so a rule in core alone would never answer first on a chain. The decision case asks core's `phaseOneDecisionProblem` before anything else, and nothing is sent.

**Pull request 670** into the lane [measured, 2026-11-18]:
- Two core tests (`state.test.ts`, "phase_one profile"): each refusal on `phase_one`, and the same message taken on the full profile. Without the change: 2 failed, 307 passed; with it, 309 of 309.
- One anvil test (`evm-settlement.test.ts`): both decisions refused by name, with no transaction and no new block. Without the relay's check it fails with `invalid_terms: contract revert InvalidMessage()`, the bare answer an agent got before.
- `pnpm vitest run packages/settlement/evm packages/core apps/adjudicator`, with anvil and the lane's `forge build`: 1,571 passed, 1 skipped (the drand fork test, which needs a Sepolia RPC). `eslint` on the five files: clean.

**Review (kind 5, 2026-11-18): PASS**, no blocking finding. The reviewer checked that both rules match the contract's empty-hash checks through every encoding path (`eip712.ts`, `decisionView`, `decisionFrom`), so a decision the chain accepted is never rebuilt with either field, and confirmed the senders above [inferred by the review; measured on anvil with the check off: an escalation decision with the right round and a ground reverts `InvalidMessage`, and without the ground settles]. Fixed: the anvil test's escalation decision used round 1, so it also failed its seed; it now uses the escalation's round, and the same decision without the ground settles. Recorded for triage, not done: the relay could also refuse a first decider's appeal ground before it simulates, which predates this task. SimChain worlds on the `phase_one` profile (the demo-cloud default, `sim-bin.ts`, `tools/duet`) refuse both fields too, as the chain does.

### Item 3: the audit docs, on the lane

**Where, and why the lane.** `docs/audit/README.md` on `main` says the pages describe the tag `contracts-phase-one-1`, which is deployed. D80 has the outside audit read the next build, so its description belongs with that build, on the lane [documented: D77, D80, `docs/audit/README.md`]. Nothing in those three says otherwise. `known-issues.md` is not touched.

**Pull request 671** into the lane changes:
- `state-model.md`: the primary's and the escalation's `decide` rows; §6.3, with the dispute fields refused; §8.1 and §8.2; §8.3 rows 2 to 4, 8 and 11, and the paragraph on the three checks, now built.
- `functions.md`: a section "The fixed build" with the rows that differ from the tag, and the three "signed only" rows and the 250,000-gas cell. The rest stays the dated record of the tag.
- `threat-model.md` TA-11 and the deployer's row; `scope.md`, the deployer's choices; the audit README, one paragraph and the deployer's arguments; `contracts/README.md`, the lane's next build and the beacon's errors in the ABI pipeline.

Each claim was read against `git diff contracts-phase-one-1 contracts-audit-ready -- contracts/src` and the lane's deploy script. `pnpm vitest run tests/`: 1,183 of 1,183 passed after one fix: `tests/design-map.test.ts` refuses an ID range in a standing doc [measured]. No page quotes the fixed 250,000 gas outside `functions.md` and `known-issues.md` [measured: `grep -n 250,000 docs/audit/*.md contracts/README.md`].

### Item 4: `main` into the lane

Pull request 668 merged `origin/main` (`21bb4e54`) into the lane with no conflict; 66 files changed, none under `contracts/src`. The lane's new tip is `df82c860`. [measured, 2026-11-18]:

| Commit | `git rev-parse <commit>:contracts/src` |
| --- | --- |
| `d621291e`, the lane's tip before | `c4edcfb1185a34f5a205d9170e0ae690c758c157` |
| `df82c860`, the lane's tip after | `c4edcfb1185a34f5a205d9170e0ae690c758c157` |

`git diff --quiet d621291e df82c860 -- contracts/src` exits 0, and `git merge-base --is-ancestor origin/main df82c860` exits 0. All of the pull request's checks passed; the forge, docs and formal jobs skip by their path filters when `contracts/` does not change.

### Item 5: the rehearsal, at the lane's tip `df82c860`

`node scripts/deploy-rehearsal.mjs --keep` in a worktree at `df82c860`, after `forge build` there [measured, 2026-11-18]:

```
step 0.4  pass  the runtime hashes at this build: HoldbackRules 20786 bytes 208704ee…2721; DrandQuicknetBeacon 3491 bytes 5b99156c…d8d8
step 2.1  pass  the chain id: 31337, the local chain (Sepolia's is 11155111)
step 2.2  pass  keep the live record under its dated name: contracts/deployments/sepolia-2026-11-18T2026Z-domain-0.8.json
step 2.3  pass  deploy the contracts: 5 creations; the record's rules contract is 0x9d15…69b0, its commit df82c86
step 2.4  pass  the rules contract's EIP-712 domain: name "Holdback", version "0.8"
step 3.1  pass  write the record's copies: pass: 12 value(s) replaced, 0 retired, none left outside the history files
step 3.2  pass  the read-only check, and the runtime hashes on the chain: the record matches the chain and the build; both runtime hashes equal step 0.4's
step 3.3  pass  the source check before Sourcify: 5 of 5 exact; nothing was sent
deploy-rehearsal: pass: 8 steps, 1 run(s); nothing was sent to a network
```

**The beacon's argument:**
- **Passed:** `create DrandQuicknetBeacon … 'constructor(uint256)' "$PAIRING_GAS"`, with `PAIRING_GAS=250000` (`deploy-sepolia.sh`), and step 3.2's creation-code check encodes the same argument.
- **Read back:** the script's `expect "beacon PAIRING_GAS"` reads `PAIRING_GAS()` on chain and stops the run on a difference. It runs in the deploy and in `--check`, so steps 2.3 and 3.2 both passed it.
- **Recorded:** the kept record's `contracts.DrandQuicknetBeacon.args` is `["250000"]`, and its `commit` is `df82c860…`.

`HoldbackRules`'s runtime is 20,786 bytes on the fixed build, against 20,502 at the tag and the EIP-170 limit of 24,576 [measured: step 0.4 above; the tag's figure from `docs/audit/README.md`].

**Again at the lane's final tip `ded4b5ba`** (after pull requests 670 and 671): `deploy-rehearsal: pass: 8 steps`, the same two runtime hashes, the record's `commit` `ded4b5b…` [measured]. `contracts/src` there has tree `c4edcfb1185a34f5a205d9170e0ae690c758c157`, and `git diff --quiet d621291e ded4b5ba -- contracts/src` exits 0 [measured].

**What the deploy script and the runbook still got wrong for the fixed build** [inferred from reading; fixed in this task's last pull request on `main`]:
- **The runbook named no check of the beacon's argument.** Step 2's "It must show" now says how to read it in the record and on chain.
- **The anvil rehearsal cannot show the move from the first build's record.** Its stand-in live record is a first local deployment by the checkout's own script, so its old beacon already took the argument. On Sepolia the live record's beacon takes none. Step 1.1 now says so, and step 1.2's fork run, which keeps the real record, is where that move is rehearsed. Nothing in the repository reads the beacon's `args` besides the script [measured: `git grep`].
- **"The audit's fixes."** The runbook named `contracts-phase-one-2` the version with the audit's fixes; under D80 it carries an outside scan's fixes, and the audit reads it. The introduction, step 0.1 and the tag's message now say so; decision 2 keeps its words with a dated note.
- The deploy script itself needed no change: the rehearsal passes, and `scripts/sourcify-verify.mjs` reads constructor arguments from the creation transaction (T-529's Handoff, item 6).

## Decisions

- Item 1 lands on `main` as a fixed list of the beacon's errors, not as a beacon entry in `abis.json`: a fixed list works on both builds today, and its drift check fails if a later beacon declares an error the list lacks.
- Item 2 lands on the lane (Evidence).
- All pull requests of this task name T-540 in their branches, so no further number was reserved. Each needs the task file on its base branch for the ID check, so the lane's pull requests follow item 4's merge.
- The task file changes on `main` only, so the lane takes it with the next merge of `main`, with no conflict.
- The runbook's fixes land on `main`, where it is read, and reach the lane by the merge of `main` that runbook step 0.5 requires.

## Handoff

**Done:** items 1 to 5, in pull requests 667 (`main`), 668, 670 and 671 (the lane) and this task's last on `main`. `contracts/src` on the lane is unchanged. Lower-priority finds are in the triage note `reports/scratch/t-540-triage.md` (main checkout, untracked): three rows, none blocking.

**Steps left for Rafa, in order.** Every step after the first is `docs/redeploy-contracts.md`'s, each with its own go-ahead.
1. **The review of the fixes.** The reviewers read the lane's `contracts/src` against the tag: `git diff contracts-phase-one-1 <lane tip> -- contracts/src` lists `DrandQuicknetBeacon.sol`, `HoldbackRules.sol`, `HoldbackTypes.sol` and `IHoldbackRules.sol` [measured]. A finding that changes `contracts/src` goes on the lane by pull request, and the rehearsal (runbook step 1.1) runs again after it.
2. **Bring `main` into the lane again** by a pull request, once `main` has stopped moving (runbook step 0.5). `main` has this task's last pull request and other sessions' work that the lane lacks. Then name the frozen commit (step 0.1).
3. **Rehearse on a fork of Sepolia** (runbook step 1.2), at the frozen commit. It is the one rehearsal that moves from the live first-build record, whose beacon took no constructor argument, to a fixed-build record. Nobody has run that sequence whole.
4. **The deploy by the runbook:** steps 1 (the quiet), 2 (Rafa's keystore: the contracts; check the beacon's argument as step 2's "It must show" says), 3 (the record and every pin, Sourcify), 4 (the fork suites) and 5.
5. **The Workers' redeploy:** step 6 (both operators, one smoke deal), then step 8 (the test agents).
6. **The live rounds:** step 7, in Rafa's terminal.
7. **The merge into `main`:** step 11.1, point of no return 2, first part.
8. **The re-pin of the buyer bundles and the site:** step 3.1's copies re-pin the bundles' contract addresses in the cutover's commit; step 9 deploys the site from `main` and checks the hashes of `try.mjs` and `buy.mjs`, point of no return 1.
9. **The tag:** step 11.3, `contracts-phase-one-2` on step 11.1's merge commit, pushed by Rafa. The runbook tags after the deploy, not before it: the tag names the commit that is deployed and merged. T-529's Handoff put the tag before the deploy; the runbook's order holds.
10. **The records:** step 11.4, `docs/audit/scope.md` names the new tag; the line numbers in `docs/audit/` still cite the first tag's sources (pull request 671 says so on each page) and are worth a refresh before the outside audit reads the fixed build.

**Open:** nothing blocks the review. The second scan of the fixed build (D80) waits for Rafa's go.
