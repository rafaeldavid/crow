# T-525: the next contract build carries the outside scan's contract fixes

- **Lane:** contracts
- **Phase:** 2
- **Kind:** 7, smart contracts (the fixes); this pull request is a merge with no source change
- **Depends on:** T-523 (the triage and its plan), D77 (fixes land in the next build)
- **Paths this task may touch:** the lane `contracts-audit-ready` only: `contracts/src/HoldbackRules.sol`, `contracts/src/IHoldbackRules.sol`, `contracts/src/DrandQuicknetBeacon.sol`, `contracts/src/IHoldbackBeacon.sol`, `contracts/script/deploy-sepolia.sh` (the beacon's one new argument), tests under `contracts/test/`, and the task files T-525, T-527, T-528 and T-529
- **Human gate:** no for the lane's pull requests; every deploy of the next build is Rafa's
- **Status:** in progress
- **Agent/session:** the scan-fixes contract lane session (session A of T-523's plan), started 2026-11-18
- **Roadmap row:** N190

## Intent

An outside scan read the phase-one contracts at the tag `contracts-phase-one-1`. T-523 sorted its findings into cause groups. Four groups are contract defects that the next build fixes: G2 (the constructor checks only for zero), G6 (one wrong comment), G3 (the beacon's pairing gas) and G4 (signed fields the contract should refuse). This task carries them onto the lane `contracts-audit-ready`, one reviewed pull request per group, each with a test that fails on the lane's code before the fix. The deployed contracts and `main`'s `contracts/src/` stay as they are.

The order: this pull request brings `main` into the lane (D77's first step); then T-527 (G2 with G6), T-528 (G3) and T-529 (G4, with a red team). G1's fix is off chain, in the operators (the session on `main`); the lane adds a test that documents G1's on-chain behaviour.

## Acceptance criteria

- [ ] `origin/main` is merged into the lane, and `contracts/src/` is unchanged by the merge.
- [ ] G2 with G6, G3 and G4 are merged into the lane, each with its failing test written first (T-527, T-528, T-529).
- [ ] G4 has had its red team before it merges.
- [ ] `forge test` passes on the lane's tip.
- [ ] The last task's Handoff lists what a redeploy of the next build needs.

## Evidence

**Main into the lane (this pull request).** Branch `t-525-main-into-lane`, from the lane at `3b99a79d`, with one merge commit of `origin/main`. The merge had no conflict.

- `git diff --stat origin/contracts-audit-ready HEAD -- contracts/src` prints nothing [measured, 2026-11-18].
- `git diff --stat contracts-phase-one-1 HEAD -- contracts/src` prints nothing: the lane's sources are still the tag's [measured].
- `git diff --stat origin/main HEAD` prints nothing: after the merge, the lane's tree equals `main`'s [measured]. The lane's own commits (the cutover's record) were already on `main`.
- `forge test` on the merged tree: see the pull request.

## Handoff

**Next:** T-527 (G2 with G6) branches from the lane once this merges.
