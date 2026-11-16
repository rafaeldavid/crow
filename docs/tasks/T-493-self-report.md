# T-493: agents report their own numbers in the first-deal report

- **Lane:** first pilot (the report form in `site/ref/limits.txt`)
- **Phase:** 2
- **Depends on:** T-491 (the first-deal report and the live report route)
- **Paths this task may touch:** `site/ref/limits.txt`, this file.
- **Human gate:** the site deploy, Rafa's.
- **Status:** review
- **Agent/session:** the expo/exact review session, 2026-11-16, branch `t-493-self-report`.
- **Roadmap row:** N165
- **Change kind:** 1 (an agent page).

## Intent

Restated in my own words.

Rafa wants the pilot's purchases to give data for analysis: approvals, time and tokens. A first design read each agent session's transcript with a converter (PR 596, closed unmerged). Rafa: "Can you simplify? Basically ask the agent to opt-in and have them self-report?" So the first-deal report form, which an agent sends only with its principal's yes, now asks for four more lines: the approvals it asked of its principal, its minutes from start to end, its tokens in and out (or unknown), and its product and model, which also go in `client`. The numbers are the agent's own, and nothing checks them.

## Acceptance criteria

1. The report form in `ref/limits.txt` asks for `approvals`, `minutes`, `tokens` and `agent`, says to write `unknown` for a count the agent cannot see, and fills `client`.
2. `node site/build.mjs && node site/check.mjs` passes.

## Evidence

- `node site/build.mjs && node site/check.mjs`: PASS, 2026-11-16 [measured]. `ref/limits.txt` is outside every budgeted first-deal path, so no budget moves.

## Handoff

- The pilot run sheet (crow-private `design-partners/partner-a/kit/run-sheet.md`, "Measuring each scan") uses this report; Rafa reads reports with `apps/demo-cloud/scripts/feedback.ts list received`.
- Self-reported numbers are estimates: an agent that cannot see its tokens writes `unknown`. A measured count, from the transcript, stays on the closed PR 596's branch `t-493-transcript-record` if wanted later.
