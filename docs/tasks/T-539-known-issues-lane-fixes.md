# T-539: the known issues take the lane's contract fixes and the 2026-11-18 deploy

- **Lane:** docs
- **Phase:** 2
- **Kind:** 2, process docs and records (`docs/team.md`, Change recipes)
- **Depends on:** T-533 (the page by kind), T-527, T-528 and T-529 (the contract fixes on the lane), the operators' deploy of 2026-11-18
- **Paths this task may touch:** `docs/audit/known-issues.md`, `docs/decisions-today.md` (D80), `docs/tasks/T-536-duet-adapter-port.md` and `docs/tasks/T-537-envelope-notice.md` (their status), this file
- **Human gate:** no
- **Status:** done
- **Agent/session:** scan-fixes-main, on the coordinator's word of 2026-11-18
- **Roadmap row:** N192

## Intent

The rows of `docs/audit/known-issues.md` that waited on other work now say where each item stands:
- **Part 1.** The contract fixes are merged on the lane `contracts-audit-ready` for the next build: RR-1 (T-528), RR-2 for the beacon only (T-527), the L-1 and I-1 checks (T-529) and OS-5's comment (T-527). RR-5 is documented, with its test (T-529).
- **RR-3.** Its bound takes the lane's measured tests.
- **The deploy.** OS-1, A-4 and the H-2 row note that both operators were deployed on 2026-11-18.
- **D80** states that the four fixes are merged and that the second check waits.
- **T-536 and T-537** read done.

Non-goals: no code, and no row about the deployed contracts changes: they keep the tag's code until the next build's cutover.

## Acceptance criteria

- [x] Each lane fix is named with its task and pull request; RR-2 says why the escrow, collector and token stay unchecked.
- [x] RR-3's bound gives the lane's two measured tests and labels the rest inferred.
- [x] No row is lost (the row script from T-533).
- [x] D80 names the four pull requests and the merge commit `d621291e`, and why the second check waits, without naming the scanning partner.

## Evidence

- **Rows:** the row script against the page at T-533's start: 72 of 72 old rows kept, 90 rows in all [measured].
- **The lane:** pull requests 649, 654, 657 and 659 are merged into `contracts-audit-ready`, the last as `d621291e` [measured: `gh pr view`]. Each status above is the lane task file's own statement [documented: `docs/tasks/T-527-*.md`, `T-528-*.md`, `T-529-*.md` on the lane].
- **The deploy:** both operators deployed 2026-11-18, 17:41 to 17:48 UTC, from `f48afab` [documented: the coordinator's message].

## Handoff

**Done:** the page, D80 and the two task statuses. Nothing waits on this task.
