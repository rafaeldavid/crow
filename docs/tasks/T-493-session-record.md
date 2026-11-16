# T-493: a real agent session's numbers, from its transcript

- **Lane:** first pilot (the benchmark's tools in `tools/one-click/` and the metrics schemas)
- **Phase:** 2
- **Depends on:** T-412 (the benchmark harness and its record)
- **Paths this task may touch:** `tools/one-click/session-record.mjs` (new), `tools/one-click/README.md` (one section), `scripts/metrics/schemas/agent-session.schema.json` (new), `tests/metrics/session-record.test.ts` (new), `tests/metrics/schemas.test.ts` (the schema list), this file. Nothing under `spec/schemas/`, `examples/`, `site/`, `apps/` or `packages/`.
- **Human gate:** none for the merge. Running it on a pilot transcript is Rafa's or his agent's, on the machine that holds the transcript.
- **Status:** review
- **Agent/session:** the expo/exact review session, 2026-11-16, on Rafa's "Yes, build it", branch `t-493-transcript-record`.
- **Roadmap row:** N165
- **Change kind:** 4 is the nearest (a tool of the benchmark); one `reviewer` pass, since it reads transcripts that can hold secrets and must write none.

## Intent

Restated in my own words.

The pilot's two scans are real purchases run by agents for a person, who reads each offer and approves it. The benchmark harness cannot run them: it answers every approval "yes" itself. So the pilot produced no approvals, tokens or agent time, the headline metrics. This task adds a read-only converter that takes the session's Claude Code transcript afterwards and writes one record of numbers: approvals counted as the benchmark counts them, tokens per model, wall time and time without the user, tool calls by name. It writes no text from the transcript, which may hold the second buyer's repository and a credential.

The record is its own small schema, `crow.metrics.agent-session/1`, not the benchmark's version 2. Version 2 is built around the harness's scenarios and fields only the harness knows, and filling it would mean inventing values.

Non-goals: reading the records into the summary or Crow Control (the next step); measuring the partner's side.

## Acceptance criteria

1. Approvals: a person's tool permission (`source` `user_*` and not a stored rule), a question answered, and a message after the first, mid-turn messages included. A stored rule, the settings and an injected message (a subagent's report, a task notification) do not count.
2. Tokens: each model call once, by model.
3. Time: wall time, and waiting on a person measured from the agent's last activity.
4. The record holds no transcript text, matches its schema, and names in `gaps` the marks a transcript lacks.

## Evidence

All measured on 2026-11-16 in the worktree.

- `pnpm exec vitest run tests/metrics`: 13 files passed and 2 skipped; 271 tests passed and 17 skipped.
  - `tests/metrics/session-record.test.ts` (new, 5 tests): a made-up transcript with each kind of decision, a doubled model call, two models, a question, an idle reply, a mid-turn message, a task notification and a subagent report. It holds a planted credential, scope and address; none reaches the record.
  - `tests/metrics/schemas.test.ts`: the schema list gains `agent-session`.
- On real transcripts, numbers only, kept in `reports/scratch/` (git-ignored):
  - This session: 30 approvals, all messages; 0 tool approvals in auto mode; 378 model calls; 12,195 s wall, 5,181 s without the user.
  - An older session: 180 tool approvals, the same as its 180 `user_temporary` decisions counted by hand; 73 messages.
- The first real run read 2 s of waiting in 3.4 h, because the wait was measured from a queue entry written when the person types. It is now measured from the agent's last assistant entry or tool result, and the test pins it.
- `eslint` on the new files: no findings.

## Handoff

- **Next, not in this task:** `scripts/metrics/one-click-summary.mjs` reads a folder of these records, and Crow Control shows them beside the benchmark's. Size: hours.
- **The pilot run sheet** (crow-private `design-partners/partner-a/kit/run-sheet.md`, "Measuring each scan") names this converter and its record.
- **Assumption that can break:** the fields read are Claude Code's own, as written on 2026-11-16, and they can change. A version that drops them makes the record say so in `gaps`.
