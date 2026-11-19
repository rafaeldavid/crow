# T-572: one telemetry deal template, and one deal with it released on Sepolia

- **Lane:** first pilot, with the deal template in `fixtures/` beside the audit template
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 9 (live tests on testnet) with a terms template in `fixtures/` and its test; local checks: `pnpm vitest run tests/telemetry-run-template.test.ts`, `pnpm typecheck`, `pnpm lint`; one reviewer agent on each pull request, as the brief asked
- **Depends on:** nothing new: the check runner of `packages/judgment` and `examples/try-sell.ts` as they are on `main`
- **Paths this task may touch:** `fixtures/terms/telemetry-run.yaml` (new), `fixtures/data/telemetry-run/` (new), `tests/telemetry-run-template.test.ts` (new), `site/ref/checks.txt` (one short section), this file
- **Human gate:** no (test tokens only; the site change needs a deploy, which is Rafa's)
- **Status:** in progress
- **Agent/session:** the T-572 session, 2026-11-19, branch `t-572-telemetry-template`
- **Roadmap row:** N167

## Intent

A buyer that pays for robot telemetry wants to know, before the hold is released, that the file is the run it ordered and that the run is whole. This task writes that as one deal template made only of the check types the check runner has today, tests it on synthetic files, and runs it twice on Sepolia: once with a passing file (Released) and once with a failing file (Refunded). The template is a default parties copy and change. It adds no check type, no command and no protocol rule (D31). What a real telemetry buyer still cannot check goes to the Handoff for triage.

Non-goals: a new check type, any change to the operators, the adjudicators, settlement or `spec/schemas` (T-549 works there), the test seller's quote route, and anything about a design partner.

## The design

The delivery is one CSV file (`text/csv`, kind `dataset`) of readings from one named run: one row per sample, at a fixed rate, integers in fixed units so that every bound is a whole number (ADR-0022).

| Column | Unit | What it holds |
| --- | --- | --- |
| `run_id` | | the run the terms name, the same on every row |
| `t_ms` | ms | time since the run started, on the sampling grid |
| `position_mdeg` | millidegrees | joint position, -360,000 to 360,000 |
| `velocity_mdeg_s` | millidegrees per second | joint speed, -223,000 to 223,000 |
| `current_ma` | mA | motor current, -10,000 to 10,000 |

The template's run: 10 s at 100 Hz, so 1,000 rows and `t_ms` from 0 to 9,990 in steps of 10.

| Check | Type | What a buyer gets |
| --- | --- | --- |
| `columns` | `csv_columns_exact` | the five columns, in order, and nothing else |
| `rows` | `row_count_range` | exactly 1,000 samples |
| `run` | `regex_match_rate_min` | every row names the agreed run |
| `time-grid` | `regex_match_rate_min` | every timestamp is a multiple of 10 ms inside the 10 s run |
| `time-unique` | `unique_key` | no timestamp twice |
| `position` | `regex_match_rate_min` | every position inside the joint's range, none empty |
| `velocity` | `regex_match_rate_min` | every speed inside the arm's limit, none empty |
| `current` | `regex_match_rate_min` | every current inside the drive's range, none empty |

**Duration, rate and gaps from three checks together.** `time-grid` allows 1,000 values, `time-unique` forbids a repeat, and `rows` asks for 1,000 rows. So every point of the grid appears exactly once: the file covers the full 10 s at exactly 100 Hz, with no gap and no duplicate. No check compares two rows; this follows from counting.

**Ranges as patterns.** The check runner has no numeric range check (`site/ref/checks.txt`), so each range is a full-match pattern over integers with no leading zeros. A pattern rejects an empty cell, so a range check also refuses a missing reading.

**Left out on purpose.** `hidden_characters_max` adds nothing here: every cell is held by a pattern of ASCII digits and the header by `csv_columns_exact`, so a hidden character fails one of those first. `null_rate_max` is covered by the range patterns.

## Acceptance criteria

- [ ] The template `fixtures/terms/telemetry-run.yaml` uses only existing check types, and the check library accepts every check.
- [ ] Synthetic files that pass: the sample run, and the same run with values at each range's edge.
- [ ] One failing file per check, each refused by that check's name and by no other.
- [ ] A file at the wrong rate and a file with a gap are refused, and the test shows which checks catch them.
- [ ] Deal 1 on Sepolia: a passing file delivered by a script playing the seller, Released on both operators.
- [ ] Deal 2 on Sepolia: a failing file, Refunded on both operators.
- [ ] Both deals' IDs and transactions in Evidence, labelled measured.
- [ ] A short entry in `site/ref/checks.txt` where the robot episode's checks are, within the site check's budgets.
- [ ] The Handoff lists the checks a real telemetry buyer would still miss, each with the deal it would serve.

## Evidence

(to be filled)

## Decisions

- **CSV, not JSON lines.** The check runner reads CSV and a JSON array of flat objects; JSON lines is neither. CSV keeps a reading per row, as a telemetry log is written.
- **Beside the audit template.** The template is a terms file in `fixtures/terms/`, in the shape of `fixtures/terms/audit-report.yaml`, with its data in `fixtures/data/telemetry-run/` and its test in `tests/`.
- **Live through `examples/try-sell.ts --work --terms`.** The command plays the seller with fresh keys and faucet tokens and sells to Crow's test buyer, which accepts every check type the template uses. It does not call the test seller's quote route.

## Handoff

(to be filled)
