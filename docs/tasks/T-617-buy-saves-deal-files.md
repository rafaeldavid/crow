# T-617: buy.mjs saves the deal record and the work file

- **Lane:** api (the buyer's tools in `examples/`)
- **Phase:** 2
- **Depends on:** T-611 (the buyer tools as they are live)
- **Paths this task may touch:** `examples/buy-with-signer.ts`, `examples/deal-files.ts` and their tests, the late-work test in `examples/buyer-signer-settled.test.ts`, `site/buy.mjs` (generated), `site/buy.txt`, `site/ref/buyer-signer.txt`, this file
- **Human gate:** yes. `site/buy.mjs` stays pinned. Rafa, 2026-11-25, as relayed to this session by the coordinator session: "Yes, after re-review". This change may alter `buy.mjs`, for this change only; the pin rule otherwise stands. The re-review is below. The site deploy is Rafa's.
- **Status:** review
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
- [x] The folder is used only when the key store's owner owns it, it is no more open than the store, and it holds no key store's files.
- [x] No file already there is overwritten, no link left in the way is written through, and a file appears whole or not at all. A local program racing the folder is out of reach once the folder rule above holds.
- [x] The outcome is printed before the record is read. An ordinary failure to save changes neither the outcome nor the exit code, and the output names the problem in the tool's own words, never an error's.
- [ ] A very large operator answer cannot change the exit code. It can: see the Handoff.
- [x] Each deal's record is saved as soon as that deal ends. With an operator that never answers, the process ends once the record's 30 s limit passes after the last outcome.
- [x] The record's line carries the count of checks passed, the names of those failed and not run, and the sections the operators differ in.
- [x] The saved record holds no key from the key store, and it has the work's hash check when the operators hold the work.
- [x] Saved late work hashes to the seller's signed hash, a leading byte order mark included.
- [x] `buy.mjs` imports only Node's `fs` and `path` beyond what it did, and no other published bundle changes.
- [x] The buyer's first-deal path is no longer than before.
- [ ] A cold buyer run shows whether the two calls go away.

## Out of scope

- The runner change a measurement needs: its key store sits outside the agent's folder, so the agent could not read the saved files there.

## Evidence

All measured on 2026-11-25 with `origin/main` at `49e7da1f` merged in, unless marked.

- `pnpm typecheck`, `pnpm lint` and `pnpm validate:spec` pass.
- `pnpm exec vitest run examples tests/site-guides.test.ts tests/site-bundles.test.ts tests/site-build.test.ts tools/duet`: 1,038 tests passed, 33 skipped, in 78 files (1 skipped).
- `corepack pnpm build && node site/build.mjs && node site/check.mjs` pass. `site/buy.mjs` has SHA-256 `579788aa6282c3f250ec9b705c08869d5806575ba55d138860455e1d3acc6002`.
- The buyer's first-deal path is 4,956 of 5,000 tokens, the same as `main`. `site/buy.txt` is 1 byte shorter than `main`'s, so open pull request 828, which adds 156 bytes there, still fits [inferred from the sizes].
- On a local simulator world, the built `buy.mjs` passed four funded end-to-end tests: resume in a later process, an operator that never answers a record read, and both late-work settlements. They ran from a temporary copy under `examples/`, where its two packages resolve.
- With one operator never answering `/receipts`, the outcome printed first and the process ended after the record's 30 s limit, with exit code 0.
- `buy.mjs` is the only published bundle that differs from `main`.
- On this Mac, `node site/build.mjs` also rewrites `site/setup.mjs`, `site/seller-worker.mjs` and `examples/seller-worker-pin.ts`, on plain `main` too, and still after removing every `dist/` folder. They are committed as on `main`. Cause not found; CI passed on `main` and on this branch's earlier head.
- Not measured: whether a cold buyer now makes the two calls less often.

## Review

**First review** (one reviewer, commit before the rebase): ISSUES, 1 High, 3 Medium, 2 Low. The High was a record read that kept the command alive; the Mediums were operator answers delaying the final JSON, operator text reaching it through an error, and a guide that could read as passed with checks not looked at. Fixed in the second commit.

**Re-review** of head `7fdab5e5` (a new reviewer, given the first review's four findings and not told what was fixed) and **an Opus red team on file handling** (same head). Neither found a Critical or High finding. Both reported that they could not make any key or watch file be overwritten, truncated or written through.

| Finding | By | Severity | Now |
| --- | --- | --- | --- |
| `resume` saved no record until every deal ended, so a run stopped while one deal waited lost the others' records | re-review | Medium | Fixed: each record starts as its deal ends. Test |
| With several deals, the record limits ran one after another | re-review | part of the first High | Fixed: one limit after the last outcome. Test |
| Step 11 could read as passed with checks not run, and left out `saved.problems` | re-review | Medium | Fixed: the record line names the checks not run, and the guide says to report them and `problems` |
| The `record` command prints an operator's text in an error, and the guide sends the agent there | re-review | Medium | The guide says what it prints, errors included, is others' text. The command itself is unchanged (Handoff) |
| The guide implied the `record` command checks late work's hash; "last stderr line" with several deals; only the record's reasons called untrusted | re-review | Low | Fixed in `buy.txt` and `ref/buyer-signer.txt` |
| A files folder was trusted whatever its owner or mode | red team | Low | Fixed. Test |
| A pipe swapped in between the check and the read could hang the command before the outcome | red team | Low | Fixed: one open handle, no link followed, no waiting. Test with a planted pipe; the race itself was not reproduced |
| A write cut short left a partial file that blocked later saves | red team | Low | Fixed: written beside, then linked to its name. On a drive with no hard links it is written in place and removed if the write fails |
| The files folder could be another deal's key store | red team | Low | Fixed. Test |
| Saved late work could lose a byte order mark | both reviews | Low | Fixed in the saver. End-to-end test. `openDelivery` still returns the text without the mark: it is in `buyer-signer.ts`, also bundled into `take.mjs` |
| A record could be written and then reported unsaved | red team | Informational | Fixed: summarised before it is written. Test |
| Relative paths could mislead an agent in another folder | red team | Low | Fixed: full paths |

**Left open, from the re-review:** a very large operator answer can exhaust memory after the outcome is printed (Handoff).

**These last fixes were not reviewed again.** While writing them, the existing late-work test showed a defect in the first version of the byte order mark fix: it compared hashes in a format a delivery does not use, so no late work would have been saved. The unit tests had passed. It is fixed, and the end-to-end test now covers both late-work cases.

## Decisions

Choices made inside this task. Escalate anything that changes architecture, a contract or a defense to an ADR.

- **Beside the key store, not in it.** The work is the seller's data, and a buyer may pass the folder on. Neither belongs with the keys.
- **The key store is the measure of the folder.** Its owner and mode are the buyer's own, so the rule needs no user ID and holds where modes mean little.
- **Every record is kept** (`record-2.json` and on). A later read may hold less than an earlier one, for example with one operator offline.
- **Saved on every outcome the command reaches,** refunds and settlements too: that is where evidence matters most.
- **The outcome comes first.** A deal's record is read after its outcome is printed, so no operator can hold the outcome back through it. So `saved` in the final JSON names the work only, and the record has its own line.
- **Records of several deals are read side by side.** One at a time was dropped: it saved nothing until the last deal ended, and added the limits up. The cost is more reads at once against the operators' rate limits [inferred; not seen].
- **The command ends the process** once the records are done: a read past its time limit would otherwise keep it open.
- **`record` stays** as the way to read a deal again. Its full command moved to `ref/buyer-signer.txt`, which a buyer needs only when no file was saved.
- **The help text is unchanged.** Editing it also changes `setup.mjs` and `take.mjs`, two more pinned files.

## Handoff

**Done:** the change, its tests, the guide lines and the rebuilt `buy.mjs`, re-reviewed and red-teamed. The pull request is ready for review. The coordinator merges; this session does not.

**Around the merge**

- Rafa's word covers `buy.mjs` for this change only. A decision number in `docs/decisions-today.md`, if wanted, is not added here.
- The site deploy is Rafa's. It changes `buy.mjs`'s hash: republish any sent page that pins the old one.

**Not done: all in `examples/deal-record.ts`,** which is bundled into `setup.mjs` and `take.mjs` as well as `buy.mjs`, so changing it would move two more pinned files.

- **A very large operator answer is not bounded.** It can delay the exit, and running out of memory there ends the process with a signal instead of its exit code, after the outcome is printed. The re-review measured this with a 300 MB heap cap.
- **One operator can cost the record.** A posting amount that is not a number makes the record builder fail, for the `record` command too, and that command prints the operator's text in its error. One operator that never answers a read can run the record past its 30 s limit. A per-operator deadline and a check of amounts would fix both.

**Also not done**

- **No cold buyer run on this.** The duet runner keeps the buyer's key store outside the agent's folder, so its agent could not read the saved files. The runner needs that changed first.
- **Checks not run** are normal on some deals, and a healthy Sepolia record has more of them than a local one. The guide asks the buyer to report their names, not to judge them.
- **No record checks late work's hash.** `resume --delivery` checks the work itself.

**To resume:** branch `t-617-buy-saves-deal-files`.
