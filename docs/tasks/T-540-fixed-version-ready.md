# T-540: the fixed contract version is ready for its deploy

- **Lane:** settlement, core and docs, on `main` and on the contract lane `contracts-audit-ready`
- **Phase:** 2
- **Kind:** 5 (settlement and core code: one review each), 2 (docs), and a merge of `main` into the lane
- **Depends on:** T-527, T-528 and T-529 (merged into the lane, tip `d621291e`); T-529's Handoff
- **Paths this task may touch:** `packages/settlement/evm/errors.ts` and its test; `packages/core/src/state.ts` and its test, and the decision case of `packages/settlement/evm/evm-settlement.ts`, on the lane; `docs/audit/` and `contracts/README.md` on the lane; `docs/redeploy-contracts.md`; this file. Never `contracts/src/`.
- **Human gate:** no for these pull requests; the review of the fixes, the tag and every deploy are Rafa's (Handoff)
- **Status:** in progress
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

- [ ] Item 1: the beacon's errors reach an agent by name, with a test.
- [ ] Item 2: core and the relay refuse a primary's decision with a beacon and an escalation decision with an appeal ground, by name, where the operators serve the fixed contract.
- [ ] Item 3: the audit docs on the lane describe the fixed version.
- [ ] Item 4: `main` merged into the lane; the tree hash of `contracts/src` is the same before and after.
- [ ] Item 5: the anvil rehearsal passes from the lane's new tip; the runbook's errors are fixed.
- [ ] Each pull request merged after its checks pass and its review findings are fixed.

## Evidence

### Item 1: the beacon's errors, on `main`

**Where, and why `main`.** The task's premise was that the lane's regenerated ABI already carries the errors. It does not: `packages/settlement/evm/abis.json` has no beacon entry on either branch (rules, token, escrow, multicall, collector) [measured]. `HoldbackRules` calls the beacon with a high-level call, so the beacon's revert reaches the relay unchanged, and the relay decodes it against the rules, escrow, collector, token and multicall ABIs only (`evm-settlement.ts`, `this.abi`). So on both branches every beacon error, the first version's `InvalidSignature` included, reached an agent as `the contract reverted with unknown error 0x…` [inferred from reading].

The fix is a fixed list of the beacon's three errors in `errors.ts` (`BEACON_ERRORS`), added to every ABI the two decoders read, plus two map entries. It belongs on `main` because it is harmless there: the first build's beacon never reverts with `NotEnoughGas` or `PairingGasBelowFloor`, so the new entries never match, and its `InvalidSignature` now reads by name too. It reaches the lane with item 4's merge.

**The map:** `NotEnoughGas` is `invalid_state`, named in the detail: the relay sent too little gas, and the same signed message with more gas goes through. It is not `relay_refused`, because that answer pauses every timeout the operators send (`timeouts.ts`). `PairingGasBelowFloor` is the beacon's constructor's refusal and never answers a deal's call; it maps to `invalid_state` too.

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

To be filled when the lane's pull request lands.

### Item 3: the audit docs

To be filled.

### Item 4: `main` into the lane

`contracts/src` at `d621291e`: tree `c4edcfb1185a34f5a205d9170e0ae690c758c157` [measured: `git rev-parse d621291e:contracts/src`]. The new tip's: to be filled.

### Item 5: the rehearsal

To be filled.

## Decisions

- Item 1 lands on `main` as a fixed list of the beacon's errors, not as a beacon entry in `abis.json`: a fixed list works on both builds today, and its drift check fails if a later beacon declares an error the list lacks.
- Item 2 lands on the lane (Evidence).
- All pull requests of this task name T-540 in their branches. Each must have the task file on its base branch for the ID check, so the lane's pull requests follow item 4's merge.

## Handoff

To be written at the end: the exact steps left for Rafa, in order.
