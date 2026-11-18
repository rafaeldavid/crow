# T-493: agents report their own numbers in the first-deal report

- **Lane:** first pilot (the report form in `site/ref/limits.txt`)
- **Phase:** 2
- **Depends on:** T-491 (the first-deal report and the live report route)
- **Paths this task may touch:** `site/ref/limits.txt`, this file.
- **Human gate:** the site deploy, Rafa's.
- **Status:** done (pull request 597, merged 2026-11-16 as `ee3adb3d`; live since the site deploy of 09:56 UTC)
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

- **CI, first run:** `apps/test-agents/src/try-goals.test.ts` (try-reclaim) failed with "operators disagree on settlement-layer time". It was not rerun. The cause is in the test and already on `main`: it jumped the world's clock 310 s while the command read both operators' time in parallel, beyond the command's 5 s tolerance. The test now moves the clock in steps of at most 4 s, 50 ms apart, and it passes [measured]. Repeating it in one test world cannot reproduce the race, because the test seller allows 3 requests an hour; the cause is read from the log and the code [inferred].

## Handoff

- The pilot run sheet (crow-private `design-partners/partner-a/kit/run-sheet.md`, "Measuring each scan") uses this report; Rafa reads reports with `apps/demo-cloud/scripts/feedback.ts list received`.
- Self-reported numbers are estimates: an agent that cannot see its tokens writes `unknown`. A measured count, from the transcript, stays on the closed PR 596's branch `t-493-transcript-record` if wanted later.
