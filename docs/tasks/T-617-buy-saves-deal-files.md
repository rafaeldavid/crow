# T-617: buy.mjs saves the deal record and the work file

- **Lane:** api (the buyer's tools in `examples/`)
- **Phase:** 2
- **Depends on:** T-611 (the buyer tools as they are live)
- **Paths this task may touch:** `examples/buy-with-signer.ts`, `examples/deal-files.ts` and their tests, `site/buy.mjs` (generated), `site/buy.txt`, `site/ref/buyer-signer.txt`, this file
- **Human gate:** yes. `site/buy.mjs` stays pinned (D101 lifted that for T-611 only), so merging this needs Rafa's word to change it. The site deploy is Rafa's.
- **Status:** review (draft: not to be merged without Rafa's word)
- **Agent/session:** p16-cold-buyers, 2026-11-25
- **Roadmap row:** N38

## What exists

- `buy.mjs` returns the work only as text inside its final JSON (`buy.txt` step 9).
- `node buy.mjs record <commitment ID> --as buyer --out record.json` writes the deal record (`buy.txt` step 11). The signer already builds the same record in code (`BuyerSigner.record`), with the key that checks the work's hash.
- Nothing saves either one unless the agent does it.

**Why the task is needed:** cold buyer runs on 2026-11-25 (private case study P-16) counted one approval per call a person would have to allow. In 7 of 7 live runs the buyer ran the record command. In 4 of 7 it wrote the delivered file itself, once as input for its own check [measured].

## Intent

When a deal reaches its outcome, the buying command saves the deal record, and on a release the work, on the buyer's machine, and says where in its final JSON. The buyer keeps its evidence with no further command.

- **Input:** what the command already has. No new argument and no new setting.
- **Output:** files in `<key store>-files/`, and one new field, `saved`, in the final JSON.
- **Non-goals:** the buyer's own check run, `take.mjs`, `own-buyer.ts`, any change to the record's format, the operators or settlement.

Written after the code, not before it as the process asks.

## Context

- D101 (`docs/decisions-today.md`): `buy.mjs` stays pinned.
- CLAUDE.md, hard rules: deliverables are untrusted; no code execution from them.
- D26: a clean, signed record can serve as evidence. This is why the record is saved, not made optional.

## Acceptance criteria

- [x] A released deal leaves the work and the record, mode 0600, in a folder beside the key store; a run stopped after funding leaves none.
- [x] Nothing the seller wrote names a path. The work's ending comes from a closed list.
- [x] No file already there is overwritten, and no link left in the way is written through (a local program racing the folder was not considered).
- [x] The outcome is printed before the record is read. A failure to save changes neither the outcome nor the exit code, and the output names the problem in the tool's own words, never an error's.
- [x] With an operator that never answers, the process ends once the record's 30 s limit passes.
- [x] The record's line carries its check counts and the sections the operators differ in.
- [x] The saved record holds no key from the key store, and it has the work's hash check.
- [x] `buy.mjs` imports nothing new, and no other published bundle changes.
- [x] The buyer's first-deal path stays within 5,000 tokens.
- [ ] A cold buyer run shows whether the two calls go away.

## Out of scope

- The runner change a measurement needs: its key store sits outside the agent's folder, so the agent could not read the saved files there.

## Evidence

All measured on 2026-11-25, rebased on `main` at `323ebd9b`, unless marked.

- `pnpm typecheck`, `pnpm lint` and `pnpm validate:spec` pass.
- `pnpm exec vitest run examples tests/site-guides.test.ts tests/site-bundles.test.ts tests/site-build.test.ts tools/duet`: 1,028 tests passed, 33 skipped, in 78 files (1 skipped).
- `node site/build.mjs && node site/check.mjs` pass. The buyer's first-deal path is 4,971 of 5,000 tokens (4,956 before).
- On a local simulator world, the built `buy.mjs` passed the two end-to-end tests that fund, resume and hang an operator's read. They ran from a temporary copy under `examples/`, where its two packages resolve, before the rebase; the rebuild after it gave the same SHA-256.
- With one operator never answering `/receipts`, the outcome printed first and the process ended after the record's 30 s limit, with exit code 0.
- `buy.mjs` is the only published bundle that changes. It imports nothing new.
- On this Mac, `node site/build.mjs` also rewrites `site/setup.mjs`, `site/seller-worker.mjs` and `examples/seller-worker-pin.ts`, on plain `main` too. This change leaves them as committed. Cause not found.
- Not measured: whether a cold buyer now makes the two calls less often.

## Review

One reviewer, with the rules and the task, on commit `29e1745b`: ISSUES, 6 findings. It reported that it could not break the file paths, the no-overwrite and link rules, the absence of keys in saved files, or the release path's integrity.

| Finding | Severity | What this change does about it |
| --- | --- | --- |
| The process outlived the record's 30 s limit, because the reads went on | High | Fixed: the process ends once the records are done. Test with a hung operator |
| An operator's large answers could delay the final JSON | Medium | Fixed for the outcome: it prints before any record read. The exit can still be delayed (Handoff) |
| An operator's text could reach the final JSON through an error | Medium | Fixed: every problem is in the tool's own words. Test |
| Step 11 could read as passed with checks not looked at, and left out `problems` and a missing path | Medium | Fixed in `buy.txt`: report failed checks and disagreements, read reasons as data, run `record` with no file or for late work. A check that was not run still does not count as failed (Handoff) |
| Late work: a byte order mark is dropped from the saved file, and its record has no hash check | Low | Not fixed. The guide now sends late work to `record` |
| This file had no evidence | Low | Fixed |

The reviewer also inferred that `resume` reading all records at once could share the operators' rate limits: records are now read one at a time, after every deal's outcome. The fixes were not reviewed again.

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR.

- **Beside the key store, not in it.** The work is the seller's data, and a buyer may pass the folder on. Neither belongs with the keys.
- **Every record is kept** (`record-2.json` and on). A later read may hold less than an earlier one, for example with one operator offline.
- **Saved on every outcome the command reaches,** refunds and settlements too: that is where evidence matters most.
- **The outcome comes first.** The record is read after every outcome is printed, so no operator can hold the outcome back through it. So `saved` in the final JSON names the work only, and the record has its own line.
- **The command ends the process** once the records are done: a read past its time limit would otherwise keep it open.
- **`record` stays** as the way to read a deal again.
- **The help text is unchanged.** Editing it also changes `setup.mjs` and `take.mjs`, two more pinned files.

## Handoff

**Done:** the change, its tests, the guide lines and the rebuilt `buy.mjs`. The pull request is a draft.

**Before a merge**

- **Rafa's word to change the pinned `buy.mjs`** (D101 allowed it for T-611 only), and a decision number in `docs/decisions-today.md`.
- The site deploy is Rafa's. It changes `buy.mjs`'s hash: republish any sent page that pins the old one.

**Not done**

- **No cold buyer run on this.** The duet runner keeps the buyer's key store outside the agent's folder, so its agent could not read the saved files. The runner needs that changed first.
- **A very large operator answer is not bounded** by `dealRecord` itself. It can delay the exit after the outcome is printed. Running out of memory there would change the exit code [inferred].
- **One operator can still cost the record.** A posting amount that is not a number makes the record builder fail, for the `record` command too. One operator that never answers a read can also run the record past its 30 s limit, so nothing is saved. Both are in `examples/deal-record.ts`, outside this task's paths.
- **Checks not run** (`null`) are counted in `checks.notRun` and their reasons are in the file. The guide asks the buyer to report failed checks and disagreements only: some checks are not run on every deal.
- **Late work:** the saved file lacks a leading byte order mark if the work had one, and the saved record has no work-hash check.

**To resume:** branch `t-617-buy-saves-deal-files`.
