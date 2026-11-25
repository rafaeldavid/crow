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
- [x] No file already there is overwritten, and no link is written through.
- [x] A failure to save, or a record not read within 30 s, changes neither the outcome nor the exit code; the output names the problem.
- [x] The output carries the record's check counts and the sections the operators differ in.
- [x] The saved record holds no key from the key store, and it has the work's hash check.
- [x] `buy.mjs` imports nothing new, and no other published bundle changes.
- [x] The buyer's first-deal path stays within 5,000 tokens.
- [ ] A cold buyer run shows whether the two calls go away.

## Out of scope

- The runner change a measurement needs: its key store sits outside the agent's folder, so the agent could not read the saved files there.

## Evidence

All measured on 2026-11-25 unless marked.

- Commands run and results: see Handoff.

## Decisions

- **Beside the key store, not in it.** The work is the seller's data, and a buyer may pass the folder on. Neither belongs with the keys.
- **Every record is kept** (`record-2.json` and on). A later read may hold less than an earlier one, for example with one operator offline.
- **Saved on every outcome the command reaches,** refunds and settlements too: that is where evidence matters most.
- **`record` stays** as the way to read a deal again.
- **The help text is unchanged.** Editing it also changes `setup.mjs` and `take.mjs`, two more pinned files.

## Handoff

Filled in after the checks and the review.
