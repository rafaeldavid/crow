# T-584: the approvals runner measures what a buyer learns from the guides

- **Lane:** test (agent access)
- **Phase:** 2 (roadmap stage 2)
- **Depends on:** T-571 (the runner), N213 (the buyer guide lines, PR 749)
- **Paths this task may touch:** `tools/duet/` (the runner, the buyer's brief and fence, the Anthropic provider, their tests and one README row), this file
- **Human gate:** yes for the live run only: it spends Rafa's model keys, so Rafa starts it from his own terminal
- **Status:** review
- **Agent/session:** approvals-runner-buyer, a side session of the coordinator, 2026-11-24, branch `claude/t-n215-approvals-runner-buyer-d4df0b`
- **Roadmap row:** N215
- **Change kind:** 4 (tool code with its tests): duet tests, typecheck, lint; one `reviewer` pass

## What exists

`tools/duet/approvals.ts` runs a buyer by the duet's `direct` brief and counts approvals from the record, as for sellers. The 2026-11-20 buyers (6 and 9 approvals) read no Crow page: the installed command's name and its `--help` were enough, so the runs measured the harness. Every run also spent 1 to 3 approvals on usage probes, and the first Claude pilot stopped on a key scoped to a workspace.

## Intent

Make a buyer run measure `buy.txt`. The buyer starts from crow.direct as the seller does from `llms.txt`. Its brief gives each command's argument order once, and nothing else; a call with no arguments or only `--help` is refused, so no run probes. What the agent needs beyond the argument order (the steps, the answers, the errors) it learns only from the guide. The runner records which guide pages the agent read and how many probes it made, and counts approvals exactly as for sellers. The Anthropic provider sends `anthropic-workspace-id` when `HOLDBACK_AGENT_ANTHROPIC_WORKSPACE_ID` is set. Non-goals: any doc change, a live run, a change outside `tools/duet/`.

## Acceptance criteria

- [x] A buyer run's agent reaches `buy.txt` from crow.direct (the local site copy in tests) and its record lists the guide pages read (`guide_reads`).
- [x] `--help`, `-h` and an empty call are refused with the usage line; `help_probes` counts them.
- [x] Approvals are counted by the same function for both sides.
- [x] An offline test with the scripted buyer covers the path (no key, no network beyond this machine).
- [x] A provider test shows the workspace header is sent only when set.
- [x] `pnpm typecheck`, `pnpm lint` and the duet tests pass.

## Out of scope

- Running a live buyer (Rafa's keys). Comparing buyers with sellers (N214).
- Changing `buy.txt` or `llms.txt`.

## Evidence

- **Measured:** `pnpm typecheck` clean; `pnpm lint` clean; `pnpm exec vitest run tools/duet`: 3 files, 68 tests passed.
- **Not measured:** any live buyer run. The scripted buyer proves the harness path, not that a model can follow the guide.

## Handoff

Run in your own terminal (about USD 0.15 to 0.5 for two buyers, capped at USD 2; the file path is where your keys live, change it if they live elsewhere):

```bash
node --env-file=/Users/rafa/Documents/escrow/.env tools/duet/approvals.ts run --runs claude:buy,deepseek:buy --budget-usd 2
```

For a key scoped to a workspace, add `HOLDBACK_AGENT_ANTHROPIC_WORKSPACE_ID=<id>` to that file. `plan` with the same `--runs` shows the caps and sends nothing. Each run writes `approvals.json` with `approvals`, `guide_reads` (a buyer that read no `/buy.txt` measured the harness again) and `help_probes` (expected 0). Then record the results under `case-studies/approvals-2026-11-19/` in the private repository and close N215's `doneWhen`.

First live run, 2026-11-24 (Rafa, USD 0.15) [measured from `results.jsonl`]: Claude 5 approvals, DeepSeek 10, both Released on both operators, probes 0 and 1 (the refusal worked), but `guide_reads` empty on both: the brief named no docs, and the usage lines plus the seller's page were enough, so they still measured the harness. Fix in this PR: the cold brief now points at `https://crow.direct/llms.txt` (not at `buy.txt`) and says the buyer page's install step is done. Run the same command again; the new run is not yet measured.

Guess: the buyer still needs 1 approval per web read and per command, so the count will stay above 1 until N214.
