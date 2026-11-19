# T-571: approvals per deal measured again, with two outside models, on the new contracts and today's docs

- **Lane:** test (agent access)
- **Phase:** 2 (roadmap stage 2: "An outside agent completes a deal on its own terms, buyer-start and seller-start, with 1 approval each")
- **Depends on:** T-412 (the 2026-11-14 benchmark and its definition of an approval), T-391 (the duet harness), T-560 (the duet's `installed` option)
- **Paths this task may touch:** `tools/duet/approvals.ts`, `tools/duet/approvals.test.ts`, one row of `tools/duet/README.md`, this file; in the private repository, `case-studies/approvals-2026-11-19/`.
- **Human gate:** yes for the live runs only. They spend Rafa's model keys, so Rafa starts them from a terminal tab, after his go on the spend.
- **Status:** in progress
- **Agent/session:** a side session of the coordinator, 2026-11-19, branch `t-571-approvals-rerun`
- **Roadmap row:** T-252 (and N38's "approvals per deal")
- **Change kind:** 4 (tool code with its tests): the duet tests, the folder's typecheck, eslint; one `reviewer` pass

## Intent

The last measure of approvals per deal is six live runs of 2026-11-14: 8 to 28, median 11, against a target of 1. The contracts and the guides have changed since. Restated: run each of two outside models, Claude and DeepSeek, as a cold agent that has only the public docs, once as a buyer that starts a deal and once as a seller that starts one, on Sepolia against the live operators; count the approvals under the same definition as 2026-11-14, so the new number compares with 11; and rank what caused each approval above 1, each with its smallest fix.

Non-goals: fixing the causes (follow-up work, chosen from the list); a new benchmark harness; any deploy.

## The definition of an approval (kept from 2026-11-14)

On 2026-11-14 an approval was each point where a person in the agent's seat had to say yes before the agent could go on: every permission request Claude Code made in its default permission mode (a `curl`, `node` or `npm` through Bash, a Write, a WebFetch, a Monitor), every question card and every chat reply, counted from the run's log (`tools/one-click/bench-live.mjs`, T-412). Reads of files in the working folder asked nothing. This task keeps that definition and maps it to the duet's fenced tools: each `fetch_url` (a web read), each `run_command` (a command) and each `write_file` (a file write) is one approval; `read_file`, `list_files`, `wait` and `finish` are none. The count comes from the run's `record.jsonl`, never from the agent's report. The approval stop of the buyer's signer, which the company's pre-set policy answers, is reported apart as `policy_approvals`.

**What differs from 2026-11-14, and moves the number down:** the duet's agents have the client commands installed (`buy-with-signer`, `try-sell` and the rest) and no shell, so they never download, install or write a script. On 2026-11-14, 20 of 103 requests were `npm install` and the agents' own scripts.

## Acceptance criteria

- [x] `node tools/duet/approvals.ts plan` prints the runs, the caps and the budget, and sends nothing.
- [x] `run` enforces a hard USD budget over every run of one invocation, checked before every model turn; a test shows a turn that could pass it is never sent.
- [x] The seller's sell command takes the seller's own `--work` and `--terms` files only; a test shows `--sample`, `--buyer`, `--outcome` and a file outside the folder refused.
- [x] The approvals, tokens, cost, seconds and both operators' final states come from the record; a test checks the count and the states.
- [x] Scripted runs of both directions reach Released on Sepolia against the live operators.
- [ ] The pilot (one run per model, budget USD 2) and the batch (four runs, budget USD 8), on Rafa's go.
- [ ] The results in the private repository, `case-studies/approvals-2026-11-19/`, with `results.json`.
- [ ] One `reviewer` pass, its findings fixed.

## Evidence

- **Scripted, buyer-start, on Sepolia** [measured, 2026-11-19 21:34 UTC]: the duet's scripted buyer from the direct brief against its scripted seller, through `api.crow.direct` and `api2.crow.direct`: Released on both, 57 s from the buyer's start to the release, 6 approvals (4 web reads, 2 commands), 1 policy approval. A first scripted run through `pnpm duet` at 21:31 UTC also ended Released.
- **Scripted, seller-start, on Sepolia** [measured, 21:33 UTC]: the scripted seller sold the 12-row data file to Crow's test buyer through `try-sell --work --terms`: Released on both operators, 42 s, 3 approvals (1 web read, 1 file write, 1 command).
- **The tests** [measured]: `pnpm exec vitest run tools/duet/approvals.test.ts`: 8 passed. `pnpm exec tsc -p tools/duet/tsconfig.json` and eslint on the two files: no output.

## Handoff

The live runs are Rafa's (the private repository, `case-studies/approvals-2026-11-19/README.md`, "How to run").
