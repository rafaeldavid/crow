# T-572: one telemetry deal template, and one deal with it released on Sepolia

- **Lane:** first pilot, with the deal template in `fixtures/` beside the audit template
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 9 (live tests on testnet) with a terms template in `fixtures/` and its test; local checks: `pnpm vitest run tests/telemetry-run-template.test.ts`, `pnpm typecheck`, `pnpm lint`; one reviewer agent on each pull request, as the brief asked
- **Depends on:** nothing new: the check runner of `packages/judgment` and `examples/try-sell.ts` as they are on `main`
- **Paths this task may touch:** `fixtures/terms/telemetry-run.yaml` (new), `fixtures/data/telemetry-run/` (new), `tests/telemetry-run-template.test.ts` (new), `site/ref/checks.txt` (one short section), this file
- **Human gate:** no (test tokens only; the site change needs a deploy, which is Rafa's)
- **Status:** review, in pull request (opened 2026-11-19)
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

- [x] The template `fixtures/terms/telemetry-run.yaml` uses only existing check types, and the check library accepts every check.
- [x] Synthetic files that pass: the sample run, and the same run with values at each range's edge.
- [x] One failing file per check, each refused by that check's name and by no other.
- [x] A file at the wrong rate and a file with a gap are refused, and the test shows which checks catch them.
- [x] Deal 1 on Sepolia: a passing file delivered by a script playing the seller, Released on both operators.
- [x] Deal 2 on Sepolia: a failing file, Refunded on both operators.
- [x] Both deals' IDs and transactions in Evidence, labelled measured.
- [x] A short entry in `site/ref/checks.txt` where the robot episode's checks are, within the site check's budgets.
- [x] The Handoff lists the checks a real telemetry buyer would still miss, each with the deal it would serve.

## Evidence

**Local checks (measured, 2026-11-19, from the worktree at `origin/main` commit `46b590c6`, after `pnpm install --frozen-lockfile && pnpm build`):**
- `pnpm vitest run tests/telemetry-run-template.test.ts`: 20 of 20 passed, 2.0 s.
- `pnpm typecheck` and `pnpm lint`: exit 0.
- `node site/build.mjs && node site/check.mjs`: PASS. The first-deal paths are unchanged, since `ref/checks.txt` is on neither: buyer 4,881 of 5,000 tokens, seller 4,504 of 5,000 (estimate, bytes divided by four).
- `pnpm vitest run packages/testkit/src/fixture-files.test.ts apps/operator/src/guide-pointers.test.ts tests/design-map.test.ts`, the tests that read `fixtures/terms/` or `ref/checks.txt`: 79 of 79 passed.
- The diff holds none of the terms in the private deny list (measured with `grep -F -f`).

**The synthetic files (measured):** `run.csv`, 1,000 rows and 35,390 bytes, a 10 s sine sweep of one joint; `run.gap.csv`, the same without the row at 5,000 ms, 35,358 bytes. A scratch script made both; the test pins `run.gap.csv` to `run.csv` less that one row. SHA-256: `run.csv` `af92a8d0…24b1e4`, `run.gap.csv` `48b55295…9f3a34`.

**The live deals (measured, 2026-11-19, Sepolia, chain 11155111).** Both ran through `https://api.crow.direct` and `https://api2.crow.direct`, rules contract `0xaaf8a86e54b1cb867c00bd452c78981664153d56`, token tUSDC `0xf1a4b68b201e9eddef8a054fb6a931b849d18504` (6 decimals). The terms file for `try-sell` holds the template's price, deliverable and eight checks, copied from `fixtures/terms/telemetry-run.yaml` by `loadTermsFile`. The command made a fresh seller key in memory, took 1,000 tUSDC from the faucet and sold to Crow's test buyer (`0xd0a29422c5515a0ee31586a379a649803821dc29`). Each deal held 11.00 tUSDC: the 10.00 price and the 1.00 adjudication fee. The primary adjudicator `0x7c40a6762e59a3a14f9dd9d1a3a302cf54579647` decided both; no panel sat.

**Deal 1: Released.**
- Run: `node examples/try-sell.ts --work fixtures/data/telemetry-run/run.csv --terms <terms.json>`, exit 0, "Released in 63 s".
- Commitment `0xfe4e47f325edca6b5f9b0545d5624d0292dd9306dddd362bc4ff48b14fb2bb49`. Seller `0xfdf8829dad34b18094886fea38942ac50f0a28f0`.
- Times (operator events, UTC): offered 21:34:49, adjudicator accepted 21:34:51, agreed and funded 21:35:00, delivered 21:35:12, decided accept and Released 21:35:24. Funding to final: 24 s.
- Checks: all eight passed; decision accept. The test buyer reports `released`.
- Transactions:
  - funding `0xccc7c4f74c02676b924e1ed5dc09196c8612aead82aa7525c987a5ae5adf8bfe`, block 12171055;
  - delivery `0x813510516738402c9fd22dc0dc62c56e5314c8b37492b0818496a8d39e1e99a3`, block 12171056;
  - decision `0xa3a38c81d0d6aca12b460ed353680211ae9a0c08125eec9f93aa6075992c836d`, block 12171057.
- Money, from the decision receipt's two token transfers: 10.00 tUSDC to the seller, 1.00 to the adjudicator. The seller's balance read 1,010 tUSDC after.
- `GET /v1/commitments/<id>` on both operators: `Released`, delivery hash `0x148b1236…2e4d`.
- The buyer's own check run, `node examples/check-delivery.ts <signed terms from api2> run.csv`: exit 0, accept.

**Deal 2: Refunded.**
- Run: the same command with `run.gap.csv`, exit 1, "the deal ended Refunded, not Released": with `--work` the command expects Released and prints no transactions or full ID on any other end. The ID came from the operators' event stream and the transactions from `GET /v1/commitments/<id>/events`.
- Commitment `0x5eb77fe38cb7eac2baf0f326bedb4b574e24b5421c846256062d2d03112d392f`. Seller `0x084a2d015636d45dd4ba357c0f47919c841db087`.
- Times (operator events, UTC): offered 21:35:52, adjudicator accepted 21:35:54, agreed and funded 21:36:00, delivered 21:36:12, decided reject and Refunded 21:36:36. Funding to final: 36 s.
- Checks: `rows` failed (999 rows; expected 1,000), the other seven passed; decision reject.
- Transactions:
  - funding `0x5aeaf6709a1e77d879dc3af3998f6afb91921564ba4d35e0cd937d563a675ed8`, block 12171060;
  - delivery `0x32d603b440a346ea9686861bfcf429a3d71cfee783bc33495eed404c0171025d`, block 12171061;
  - decision `0x75ded697a8b9919aedf3d22c194af2b13aa02b052dfc2d1807c0bba95858b904`, block 12171062.
- Money, from the decision receipt's two token transfers: 10.00 tUSDC back to the buyer, 1.00 to the adjudicator.
- `GET /v1/commitments/<id>` on both operators: `Refunded`, delivery hash `0x11cafcd9…5dbd`.
- The buyer's own check run on the gap file: exit 1, "The required check rows fails".

**Approvals a person would have given (inferred):** 1 per deal, the seller's yes to the offer; the test buyer agreed by its standing rules.

## Decisions

- **CSV, not JSON lines.** The check runner reads CSV and a JSON array of flat objects; JSON lines is neither. CSV keeps a reading per row, as a telemetry log is written.
- **Beside the audit template.** The template is a terms file in `fixtures/terms/`, in the shape of `fixtures/terms/audit-report.yaml`, with its data in `fixtures/data/telemetry-run/` and its test in `tests/`.
- **Live through `examples/try-sell.ts --work --terms`.** The command plays the seller with fresh keys and faucet tokens and sells to Crow's test buyer, which accepts every check type the template uses. It does not call the test seller's quote route.

## Handoff

- Done: the template, its files and test, the two live deals, and the short section in `site/ref/checks.txt`. The site section goes live with the next site deploy, which is Rafa's.
- Rerun, from a checkout at this task's merge, after `pnpm install --frozen-lockfile && pnpm build`:
  1. write `terms.json` as `{"price", "deliverable": {"kind", "description", "format"}, "checks"}` from `fixtures/terms/telemetry-run.yaml` (its `price.amount`, its `deliverable` and its `acceptance.deterministicChecks`);
  2. `node examples/try-sell.ts --work fixtures/data/telemetry-run/run.csv --terms terms.json`: Released;
  3. the same with `run.gap.csv`: Refunded, exit 1.

**Checks a real telemetry buyer would still miss, for triage.** None was added: each is listed with the deal it would serve and the stand-in this template uses today.

| Missing check | The deal it serves | Today's stand-in |
| --- | --- | --- |
| Rows in time order (a column sorted ascending) | any log a buyer feeds to a replay or a training loader without sorting | none; the buyer sorts |
| A sampling interval within a tolerance (each step between two rows, such as 7 to 9 ms at 125 Hz) | a real controller's clock, which jitters, so a fixed grid forces the seller to resample | an exact grid; the seller writes nominal times |
| A numeric range (`min`, `max` on a column) | every sensor column; a pattern per range is long and easy to get wrong | a full-match pattern, tested value by value |
| A rate of change between rows (a bound on the step of one column) | a position log with no jumps, a speed that agrees with the position | none |
| Two columns compared (one derived from another) | a speed that is the change in position, a current that matches the torque | none; a rubric could judge it |
| A signature over the file by a device key | proof that a registered recorder signed the run | none in a CSV; the JSON robot episode pins the key and the message format, not the signature |
| A run ID the buyer draws, with a start time after the order | freshness: an old recording fails | a run ID in the terms, chosen before the offer |

**Found on the way, for triage (not this task's lane):**
- Low · `examples/try-sell.ts` with `--work` exits 1 on a refund and prints neither the transactions nor the full commitment ID, so a seller that sells failing work on purpose has to read them from the operators.
- Low · On deal 2 Crow's test buyer reported "the price and the adjudication fee came back", while the decision receipt shows the 1.00 tUSDC fee paid to the adjudicator and the 10.00 price returned. The test seller's own page says the fees do not come back. The text is in `apps/test-agents/src/buyer.ts` (the `refunded` status, line 690 at `46b590c6`), and should say the fee went to the adjudicator.
