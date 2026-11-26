# T-623: the approvals runner buys from the test seller and reads the saved deal files

- **Lane:** test (the approvals runner, `tools/duet/`)
- **Phase:** 2
- **Depends on:** T-617 (the buying command saves the deal's files), T-611 (the buyer names the seller)
- **Paths this task may touch:** `tools/duet/`, this file
- **Human gate:** no. A live run spends model keys and test tokens; this change runs none.
- **Status:** done
- **Agent/session:** p16-cold-buyers, 2026-11-25
- **Roadmap row:** N38
- **Change kind:** 4 (tool code with its tests): the runner's tests, typecheck, lint; one `reviewer` pass

## What exists

- `tools/duet/approvals.ts` runs a cold buyer against a seller the runner scripts on this machine, and a cold seller against Crow's test buyer. `--front-page` serves a draft `llms.txt` to a sell run.
- The five and two buyer runs of 2026-11-25 (P-16, private case study) used a `--test-seller` flag and a `CROW_SELLER` setting from two local commits.
- Since T-617 the buying command saves the deal's work and record in `<key store>-files/`. The runner keeps the key store outside the agent's folder, so its agent could not read them.

**Why the task is needed:** T-617 is live, and no run has measured whether it removes the buyer's record call and its own copy of the work. A run is fair only if the agent can read what the command saved.

## Intent

Make the runner able to measure a buyer on the live pages: buy from Crow's live test seller, let the buyer read what its buying command saved, and let one draft page stand in for `buy.txt` in a later set.

- **Input:** the live site and operators, the test seller's quoted product, and optionally a draft `buy.txt`.
- **Output:** each run's record and measures, with three new fields: calls of the record command, files the agent wrote, saved files it read.
- **Non-goals:** any change outside `tools/duet/`, any change to a guide or a published file, and the live runs themselves.

## Context

- `examples/deal-files.ts` (T-617): where the files go and what they may hold. No key reaches them.
- `tools/duet/README.md`, "What an agent can do": each tool is a fence in code.

## Acceptance criteria

- [x] `--test-seller` runs a buy run with the cold brief for the test seller's quoted product, under the same fences and the same count. Tested offline: the brief and the policy, whose checks equal the quote's. The run itself needs the live service.
- [x] The record command is counted however a run asks for it, `record` through the buy command included, refused calls too; writes tried and refused are listed apart.
- [x] A buyer may give `CROW_SELLER` before the buy command; every other setting is refused.
- [x] A buyer reads and lists `<key store>-files/`, and a command may read a file there. The key store and the rest of the company stay out of reach, through a link, a `..` or another spelling too. Nothing is written there. A seller gets no such reach.
- [x] On a local simulator world, the shipped buy command saves both files and the agent reads both by the paths the command prints.
- [x] `--buy-page <file>` serves the draft as `buy.txt` and passes every other read to the live site; it is refused without `--test-seller` or without a file.

## Out of scope

- A draft of any other page.
- The live runs: their results go to the private repository.

## Evidence

All measured on 2026-11-25 on `main` at `e0957759`.

- `pnpm exec vitest run tools/duet tests/id-check.test.ts`: 285 tests passed in 4 files. `pnpm typecheck` and `pnpm lint` pass.
- One test runs a whole deal on a local simulator world: the shipped buy command saves the work and the record, and the scripted buyer reads both by the paths the command printed.
- The new measures, run over the seven buyer records of the 2026-11-25 case study, give the hand count: one record call in each run, `squares.csv` written in four, the seller named in one, and no approval count changed.
- Seven live runs of 2026-11-25 used the first two commits' `--test-seller` flag (private case study). No live run has used this branch yet.

## Review

One `reviewer` pass on the change: ISSUES. It found no way past the fence, for reads or writes, by `..`, links, other spellings, command arguments, settings or the draft server. Seven findings, all fixed, each with a test:

| Finding | Severity |
| --- | --- |
| The guides' own `record` through the buy command was refused and not counted | Medium |
| A command given in another shape ran uncounted; a call not run was counted | Low |
| A write tried and refused left no trace in the measures | Low |
| A saved file given to a command did not count as read | Low |
| A help probe carrying a setting was not counted | Low |
| `seller_named` could come from a call that did not make the deal | Low |
| No test covered the test seller's brief or policy, and this file had no evidence | Low |

## Decisions

- **The agent is told what it may read.** The two file tools say that a buyer may read a file a command says it saved for it, by that path. A buyer's own agent has such files in its folder; here they sit outside it, so without the sentence the agent might not try. It changes the harness, so counts before and after it are not like for like in this one sentence.
- **Read-only.** The runner lets the agent read the saved files and never write there: a real buyer's copy is its evidence.
- **The measures do not judge content.** They list what was written. Whether a write is the work file is read from the record.

## Handoff

**Done:** the two flags, the setting, the read access, the measures and their tests. **Not done:** no live run on this branch; the runs and their results go to the private repository.

**To resume:** branch `t-623-duet-test-seller-saved-files`.
