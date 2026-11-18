# T-523: triage the findings of an outside scan of the phase-one contracts

- **Lane:** test
- **Phase:** 2
- **Kind:** Process docs and records (this file); the triage and the plan are private
- **Depends on:** T-499 (the audit package), D77 (fixes land in the next build)
- **Paths this task may touch:** this file. The triage table, the plan and the scan's report live in the private repository only
- **Human gate:** no for the triage and the plan; the decisions the plan names are Rafa's
- **Status:** in progress
- **Agent/session:** the scan-findings triage session, started by the coordinator on 2026-11-18
- **Roadmap row:** N187

## Intent

An outside scan read Crow's phase-one contracts at the tag `contracts-phase-one-1`. This task reads every finding against the code, sorts each into a confirmed defect, a known issue, not a defect or out of scope, and writes one plan that resolves them all. The plan groups the findings by cause, so one fix closes every finding that shares it, and orders the work so that anything that could move held funds outside the signed terms goes first.

Unfixed findings stay private until the next build fixes them, so this file names none. The triage table and the plan are in the private repository.

Non-goals: no change to `contracts/src/` in this task, no deployment, no key.

## Where the next contract build lives (for the fix sessions)

Read on 2026-11-18 at about 14:50 UTC [measured unless marked].

- **The code under review does not change.** `contracts/src/` at the tag `contracts-phase-one-1` (`27ab44e8`) is deployed on Sepolia, and `main`'s `contracts/src/` equals it (`git diff --stat contracts-phase-one-1 origin/main -- contracts/src` prints nothing). D77: every fix lands in the next build.
- **The next build is the contract lane `contracts-audit-ready`,** a protected branch that takes only pull requests with `check` and `gitleaks` passing and no force push (`docs/redeploy-contracts.md`, "What binds"). Its tip is `3b99a79d` (2026-11-13, the cutover's record), and its `contracts/src/` equals the tag's. It is 678 commits behind `origin/main`.
- **The first pull request into the lane brings `main` into it** (D77), before any fix. Fix pull requests then branch from `origin/contracts-audit-ready` as `t-<id>-<slug>` and target it, one cause per pull request.
- **Each fix is test first.** The failing Foundry test goes in the same pull request as the fix, under `contracts/test/unit/` or `contracts/test/attack/`. Local check: `forge test` in `contracts/`, after the three submodule commands in `contracts/README.md` (never `--recursive`). A change to an EIP-712 type also changes `Vectors.t.sol` and `packages/core`, which makes it a signed-message change: an ADR first.
- **Review.** Smart contracts are kind 7 in `docs/team.md` (Change recipes): `forge test` and one review. A change to how settlement moves funds also gets the `red-teamer` role before merge. A fix stays the smallest change that closes the finding; one that needs a design change becomes a decision for Rafa, not a patch.
- **Hard rules no fix may break:** no owner, pause, freeze, blacklist or upgrade proxy; no event removed; money in integer base units.
- **Release.** The lane's tip becomes the next frozen commit, tagged `contracts-phase-one-2`, and `docs/redeploy-contracts.md` takes it through the deploy and the switchover on a `cutover-contracts-phase-one-2` branch (roadmap rows N24 and N152). Each deploy step waits for Rafa.

## Acceptance criteria

- [ ] Every finding of the scan has a row in the private triage table, with an outcome and a reason.
- [ ] Critical, high and medium findings are confirmed or dismissed by reading the code, with a test where a doubt remained.
- [ ] The private plan groups the findings by cause, orders the fixes, names the review each needs and the decisions that are Rafa's.
- [ ] The plan proposes the roadmap rows and the fix sessions to the coordinator.

## Evidence

_Filled when the triage closes._

## Handoff

_Filled when the triage closes._
