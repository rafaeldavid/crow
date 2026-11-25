# T-613: A nesting cap that does not depend on the stack

- **Lane:** judgment
- **Kind:** 5, judgment change (`docs/team.md`, Change recipes)
- **Depends on:** T-607 (PR 807, D96: `MAX_CANONICAL_DEPTH` and the charged run), T-610 (PR 809, where the red team found this)
- **Paths this task may touch:** `packages/judgment/src/checks/cost.ts`, `packages/judgment/src/checks/table.ts`, the `TooDeep` line of `runChecks` in `packages/judgment/src/checks/index.ts`, and their tests, a new test `packages/judgment/src/checks/stack.test.ts`, `site/setup.mjs`, `site/take.mjs` and `site/serve.mjs` (rebuilt), `docs/decisions-today.md` (D102), this file
- **Human gate:** no. A deploy of the operators or the site waits for Rafa.
- **Status:** review
- **Agent/session:** column-depth-cap, 2026-11-25
- **Roadmap row:** none; finding 1 of the private triage note `roadmap/triage/2026-11-25-column-depth-and-offer-time-checks.md`

## What exists

- D96 (PR 807) caps canonical forms at `MAX_CANONICAL_DEPTH`, 1,000 levels: `canonical` in `cost.ts` refuses a deeper value. A JSON table cell, `enum`, `const` and `uniqueItems` use it.
- `canonical` still walks the value by recursion, one call per level. A cell under the cap can exhaust a small stack before the cap is reached. Measured on 2026-11-25 with `reports/scratch/depth-cap/probe.mjs` (gitignored), one `row_count_range` check on `[{"a": <n nested arrays>}]`: at `--stack-size=984` (Node's default) and 4000, 1,000 levels pass and 1,001 fail; at `--stack-size=200`, 900 levels fail; at `--stack-size=100`, 500 levels fail.
- A cell past the cap fails with the generic detail `deliverable could not be read as a table`, the same line as a stack overflow.

## Intent

A deterministic check gives one result on one delivery, on every adjudicator. The primary and the fallback may run with different stack sizes, so the depth at which a nested JSON-table cell fails must come from a count, never from the stack. A cell nested past the cap fails with a line that says so.

## Acceptance criteria

- [x] `canonical` walks a value without recursion, so its stack use does not grow with the value's depth, and charges the same units in the same order as before.
- [x] A JSON-table cell nested exactly `MAX_CANONICAL_DEPTH` levels passes a column check; one level more fails with `JSON row <n> has a cell nested deeper than 1000 levels`, and a reference table with `reference: ` before it.
- [x] A test runs the same checks in child processes at `--stack-size=100` and `--stack-size=4000` and gets the same outcomes from both: column checks, `json_schema` `const` and `uniqueItems`, and a reference table.
- [x] D96's charged run is unchanged: `newRun`, `once`, every step charged.
- [x] The pinned bundles rebuilt with `corepack pnpm build && node site/build.mjs`; `buy.mjs` and `try.mjs` unchanged.
- [x] One Opus red team; findings fixed or recorded.

## Decisions

- **Make the walk iterative, keep the cap.** Converting only the columns a check reads would still recurse on a column the check reads; it moves the problem, not removes it. An explicit stack in `canonical` removes it for every caller at once (`enum`, `const`, `uniqueItems` and the table) and keeps 1,000 levels from D96. D102 records it.
- **The detail names the row, not the column.** T-610's rule: detail lines never quote a delivered value or a column name.

## Evidence

Measured on 2026-11-25 on one Mac (Node 22.23.4), unless labelled.

- **Test first:** before the fix, `stack.test.ts` failed all 3 tests: the cap fixtures got `deliverable could not be read as a table`, and the outcomes at `--stack-size=100` differed from those at 4000 (the column checks, `const` and the reference check at 500 and 900 levels).
- **After the fix,** the probe at `--stack-size` 100, 200, 984 and 4000: 500, 900 and 1,000 levels pass `row_count_range`; 1,001 fails with `JSON row 0 has a cell nested deeper than 1000 levels`, at every size.
- **Charges:** a property test (5,000 runs, budgets 0 to 400 units) gives the same text, error and remaining budget as D96's recursive walk. A mutant that spends one extra unit per array entry fails it (`[["",null,null],4]`).
- **Package, contract and site, after the red team's fix:** `corepack pnpm exec vitest run packages/judgment tests/spec.test.ts site`: 32 files, 1,270 passed, 2 skipped. `corepack pnpm typecheck` and `corepack pnpm lint` clean.
- **Neighbours:** `corepack pnpm exec vitest run site apps/adjudicator packages/core examples/mandate.test.ts`: 45 files, 1,500 passed, 4 skipped.
- **Spec and snapshots:** `pnpm validate:spec` 38 of 38, `spec/openapi.json` fresh; `pnpm snap` 62 of 62 after the red team's fix, no snapshot diff.
- **Site:** `corepack pnpm build && node site/build.mjs`, then `node site/check.mjs` passes. `buy.mjs` (`b87e478b…`), `try.mjs` (`71634a90…`) and `take.mjs` (`27bc44db…`) keep their SHA-256. `setup.mjs` changes from `620cd827…` to `fa1db8ee…` and `serve.mjs` from `772c81b5…` to `4bc92987…`, because both embed the judgment code (after the red team's fix).

**Red team** (one Opus pass, given CLAUDE.md, ADR-0006, ADR-0047, the operator threat model and the threat table; probes in the gitignored `reports/scratch/redteam-t613/`). No Critical or High finding, and no Medium in this change. Measured by the red team: identical outcomes at `--stack-size` 54, 100, 984 and 4000 on deliveries 1,000 to 5,000,000 levels deep across nine check kinds and the screen; 100,165 comparisons of `main`'s `canonical` with this branch's, 0 differences in text, error or units left; the old recursive walk put back into a copy fails `stack.test.ts`.

| Finding | Severity | State |
| --- | --- | --- |
| The terms path still recurses: a `json_schema` check with a `default` annotation 500 levels deep passes `parseCommitment` and `commitmentId` at Node's default stack, while at `--stack-size=100` `parseCommitment` refuses it and `commitmentId` throws `RangeError`. The adjudicator recomputes `commitmentId` (`apps/adjudicator/src/service.ts`, `#termsMismatch`) with core's recursive `canonicalJson`. Older code | Medium | Open, for the coordinator: outside this task's paths (`packages/core`) |
| A 10 MiB JSON delivery (one cell of 5,000,000 numbers, 5,000,000 levels, or 873,813 rows) crashes Node with an out-of-memory error at a 256 MB heap and passes at 384 MB; 128 MB for the rows case. A 128 MB host such as a Durable Object would fail every pass where a Node adjudicator decides (inferred). Older code; the old walk failed at the same sizes | Medium | Open, for the coordinator: a heap bound is a separate design question |
| `enum`, `const` and `uniqueItems` on a value past the cap got the generic `check could not be evaluated on this input` | Low | Fixed: `runChecks` names it `a value is nested deeper than 1000 levels`, with a test |
| The charge property compares with a re-implementation whose `forEach` skips sparse-array holes, where the old walk threw | Info | Recorded: `JSON.parse` never makes holes |

## Handoff

- **For the coordinator:** the two older Medium findings above. Both predate this change and need their own tasks: core's `canonicalJson` and `parseCommitment` on deeply nested terms, and a heap bound for stage 1 and the screen.
- **For the partner pages:** `setup.mjs` is now `fa1db8eebcf92166db3e2c8e16f3540dd4bbab61bab62e257ab52aa3b9911b0c` and `serve.mjs` `4bc92987978c81cf579f72378c08c6eb507519c462dfe96a00b32d915f126aa0`; `take.mjs` is unchanged. Republish the pages that pin them after the next site deploy, which waits for Rafa.
- **Deploy notes:** the operators and adjudicators change only the detail line of a cell or value past the cap; no schema, signed type, contract or domain changes.
