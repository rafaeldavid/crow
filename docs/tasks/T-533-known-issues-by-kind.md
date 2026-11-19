# T-533: the known issues read by kind, with the verdict first, and the audit docs take the scan's findings

- **Lane:** docs
- **Phase:** 2
- **Kind:** 2, process docs and records (`docs/team.md`, Change recipes)
- **Depends on:** T-523 (the triage of an outside scan's findings), T-526 (the relay rule, merged), the triage's decisions D-1, D-2 and D-3 (Rafa, 2026-11-18)
- **Paths this task may touch:** `docs/audit/known-issues.md`, `docs/audit/threat-model.md`, `docs/audit/state-model.md`, `docs/decisions/ADR-0031-phase-one-contract-scope.md` and `docs/decisions/ADR-0032-*.md` (text only), `docs/decisions-today.md` (D80 and a pointer in D77), `docs/tasks/T-526-relay-rule.md` (its status), this file
- **Human gate:** no
- **Status:** done
- **Agent/session:** scan-fixes-main, started by the coordinator on 2026-11-18
- **Roadmap row:** N192

## Intent

Rafa, 2026-11-18: the long list "confuses the audit outcome". `docs/audit/known-issues.md` now opens with a one-paragraph verdict and reads in four parts: open code defects fixed in the next build; design limits a party accepts by signing, the ones Crow's own red team rated High first, each with what bounds its loss; off-chain items and open gaps; and fixed history. Three appendices keep the testnet facts, the dated record of where sources disagreed, and what is not in phase one. No row is lost and every row ID is kept.

The page also takes the outside scan's findings as far as D-3 allows: the two documentation-only findings, the two the relay rule closed (T-526 has merged), and the settlement's signer item as an accepted limit with D-1's words. It adds the rows that Crow's own reviews record and the page lacked, corrects the bounds the scan showed too narrow, and fixes the documentation differences the triage lists. D80 records Rafa's change to D77.

Non-goals: no code, no schema, no change to `contracts/`; the public review page of the scan (the triage's section 9) is a later task.

## Acceptance criteria

- [x] The page opens with a one-paragraph verdict and reads by kind; ADR-0031 red team H-1 and H-2 carry a severity.
- [x] No row is lost: a script counts the rows before and after and finds every old row's first cell in the new page.
- [x] The rows D-3 allows are added (OS-1 to OS-5), and nothing else about the scan's findings; the scanning firm is not named.
- [x] The missing rows from Crow's own reviews are added: drand verifier review R-2 to R-5 and R-8 (R-9 joins RR-1), the cross-check's PA-I4, PA-I5 and PA-I9, the second-family review's I-4 to I-6, and ADR-0032 RT-6.
- [x] O-2, O-3 and O-4 read fixed by T-409; A-4 reads "fix in review" until T-530 merges.
- [x] The corrected bound for contract signers (D-2) is in the threat model's signer row and TA-7, the page and ADR-0031 §5; D-1's limit is stated.
- [x] TA-2, ADR-0032 §6 residual 1, AS-4, ADR-0031's early-accept line, `state-model.md` §5.2 and §10 are corrected.
- [x] D80 records the change to D77.
- [x] RR-3 is a design limit, not a fix for the next build: ADR-0033 §2 has the contract compare neither money address with anything, the zero address included (D31). The contract lane found the contradiction; the coordinator relayed it.

## Evidence

Measured on 2026-11-18 in the worktree `t-533-known-issues`, unless marked.

- **No row lost.** `node reports/scratch/t-533-rows.mjs <old> <new>` (the Handoff describes the script), with the page at `origin/main` as the old: rows before 72, rows after 90, old rows kept 72 of 72, new rows 18 (OS-1 to OS-5, the BR-6 residual, ADR-0032 RT-6, DV R-2 to R-5 and R-8, PA-I4, PA-I5, PA-I9, R11 I-4 to I-6).
- **The facts behind the corrections.**
  - `earlyAccept` takes Held and Delivered only (`HoldbackRules.sol:337`), so ADR-0031's "at any time before a decision" was wrong for the early accept.
  - `deploy-sepolia.sh` holds one beacon margin, `BEACON_MARGIN=29` (line 57), for the one chain it serves (RT-6's row).
  - O-2, O-3 and O-4: T-409's tests ran on `main` with T-526's change, 24 of 24 files and 388 of 388 tests passed (T-526's Evidence).
  - The late early accept bullet in `state-model.md` §10 is [inferred] from the code; no test was run.
- **Checks.** `vitest run tests/cut-feature-alignment.test.ts tests/decisions-status.test.ts`: 84 of 84 tests pass. The changed lines hold no whole word of the private deny list (39 terms, 0 hits; the check printed counts only).

## Handoff

**Done:** the page by kind, the rows, the corrections and D80.

**Open:**
- A-4's row changes to fixed when T-530 (pull request 652) merges; that pull request waits for the cause of an intermittent CI failure in `tools/duet`, which has a proposed session of its own.
- `docs/audit/engagement.md` and `docs/audit/scope.md` still describe the audit as reading the tag; D80 changes that once the fixed build exists. They change with the fixed build's freeze, not here.
- The public review page of the scan (the triage's section 9) waits for the contract fixes and Rafa's yes.
- RR-3's bound is the contract lane's reading of the code [inferred]. When the lane's task file merges into `contracts-audit-ready` with its tests, take its exact wording into RR-3's row.

**The row script,** for a later restructure: it reads every table row that is neither a header nor a separator, keys each old row by its first cell, and fails if no new row has a cell with that text. It lives in the session's scratch at `reports/scratch/t-533-rows.mjs` and is not committed.
