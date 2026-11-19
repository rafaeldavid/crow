# T-557: measure how often genuine security reports trip the adjudicator's screen

- **Lane:** research
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 10 (research and decisions); local checks: the count script, `pnpm lint`, `node --check` on the script; review by one reviewer agent
- **Depends on:** T-509 and T-534 (the report corpus and its converter, holdback pull requests 635 and 661)
- **Paths this task may touch:** `docs/research/2026-11-19-screen-flags-on-real-reports.md` (new), `docs/research/2026-11-19-screen-flags-on-real-reports/` (new: `count.mjs`, `results.json`), this file
- **Human gate:** no; the recommended screen change is a decision for Rafa and is not made here
- **Status:** review: pull request 696 passed CI and one review; it waits for the T-563 merge freeze, then takes `origin/main` and merges
- **Agent/session:** the T-557 session, 2026-11-19, branch `t-557-screen-flag-count`
- **Roadmap row:** N40

## Intent

On 2026-11-19 the screen flagged a genuine fix review of Crow's contracts that was delivered through a Crow deal. It raised 3 signals (private triage, `roadmap/triage/2026-11-19-fix-review-deal.md`, item 6). The deal had no rubric, so the flag only added a reason. On a deal with a rubric the same flag would escalate honest work. This task counts how often that happens on genuine reports before anyone changes the screen. It then says what follows. It changes no screen rule, check, form, schema or pinned policy (ADR-0036).

## Acceptance criteria

- [x] The screen's entry point, its signals, and how a flag changes a deal's path with and without a rubric, cited by file and line.
- [x] The screen, as the adjudicator runs it, over every corpus report that converts to the form, both as published and as converted, and over the public copy of the genuine fix review, by a script kept with the note.
- [x] A table: reports screened, reports with a signal, each signal's count, the most common triggers for each signal, and the share of flagged reports a person would call honest, each labelled.
- [x] One paragraph on a deal with a rubric, and one recommendation, with the false-flag rate before and the expected rate after.

## Evidence

All on 2026-11-19, from the worktree at `origin/main` commit `d9da8a00`, Node 22, after `pnpm install --frozen-lockfile && pnpm build`.

- **The run (measured):** `node docs/research/2026-11-19-screen-flags-on-real-reports/count.mjs reports/scratch/corpus/security reports/scratch/t-557-out`. It ran the corpus converter for each set (about 15 minutes) and screened each report with every kept screen. It wrote `results.json`. A second run with `--reuse` gave the same counts.
- **Attribution (measured):** the script's copy of the phrase patterns found exactly the phrase ids the screen reported, on every report: 0 differences.
- **Headline (measured, screen-1):** the screen flags 16 of 24 reports as published, 12 of 24 converted, and 8 of 24 as form deliveries (converted, zero-width characters stripped).
  - Among the form deliveries, 7 flag on NFKC alone (`…`, superscript digits and signs) and 1 on an `override` phrase in quoted code.
  - A person reading each trigger's line would call all of them honest (inferred).
- **The fix review (measured):** the redacted public copy (`docs/audit/outside-scan/fix-review.json`) raises the triage's 3 signals:
  - 6 NFKC characters;
  - `verdict-claim` in the text, on "verdict that is not an accept";
  - `verdict-claim` in the JSON string values, on the same phrase.
- **What-if (measured, not product code):** with the NFKC signal counting only characters that fold to a letter, 1 of 24 form deliveries flags.

## Handoff

- **Done here:** the note `docs/research/2026-11-19-screen-flags-on-real-reports.md`, its script and its results.
- **Waiting on Rafa:** the decision the note proposes. The NFKC signal would count only characters whose NFKC form holds a letter, as a new screen version (`screen-2`) carried beside `screen-1` under ADR-0036. If he says yes, a new task makes that change test first, with a red-team pass, and updates `packages/judgment/src/screen.test.ts:143`.
- **Known limits the note records, with no change proposed:**
  - `verdict-claim` on reviews of an adjudication system;
  - `override` on quoted code;
  - mixed script on `Δ` in formulas;
  - Morse on table-of-contents dot leaders.
- **To repeat:** fetch the corpus with `docs/research/2026-11-18-report-corpus/fetch.mjs`, then run `count.mjs` as above.
