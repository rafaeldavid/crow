# T-610: Three data check kinds: passes_through, monotonic_column and equal_lengths

- **Lane:** judgment
- **Kind:** 5, judgment change, with 6 for the schema and 10 for the ADR (`docs/team.md`, Change recipes)
- **Depends on:** T-597 (`signature_valid`, PR 795), T-590 (schema v0.13 and `checkKinds`)
- **Paths this task may touch:** `packages/judgment/src/checks/` (three new files and their tests, a shared `series.ts`, registration lines in `index.ts`, three exports in `signature-valid.ts`), `packages/core/src/types.ts` and the generated `validators.generated.ts`, `spec/schemas/`, `spec/examples/`, `spec/README.md`, the generated `spec/openapi.json` and the version in `spec/openapi/paths.json`, `tests/spec.test.ts`, the schema version in `apps/operator/src/server.ts` and its tests, `apps/adjudicator/src/check-kinds.test.ts`, `examples/mandate.test.ts`, `docs/api.md` and `site/ref/` (the version they name), `site/setup.mjs`, `site/take.mjs` and `site/serve.mjs` (rebuilt), `fixtures/`, `docs/decisions/ADR-0047-*`, `docs/decisions-today.md` (D98), this file
- **Human gate:** no. A deploy of the operators or the site waits for Rafa.
- **Status:** review
- **Agent/session:** p04-data-checks, 2026-11-25
- **Roadmap row:** N225

## What exists

- Schema v0.13 holds ten deterministic check kinds. `signature_valid` (ADR-0045) proves that a pinned key signed a recording, not what it shows.
- No kind holds rows in time order, compares two columns row by row, or counts the entries of a JSON array. A CSV can hold a fixed time grid with three checks and a pattern (`site/ref/checks.txt`).
- `checkKinds` and the decline for a kind a build lacks (D92) follow stage 1's registry, so a new kind needs no change there.

## Intent

A robot deal can hold the delivery to the buyer's order: the arm passed through the buyer's waypoints in order, the timestamps never go back, and every telemetry column has one value per sample. Three built-in kinds do it with integers only, charged to the shared work budget, so every adjudicator reaches the same result.

## Acceptance criteria

- [x] `passes_through`, `monotonic_column` and `equal_lengths`, each in its own file with tests, registered in stage 1.
- [x] Shuffled rows, invented arrival points and unequal columns each fail.
- [x] Every bound is an integer: the schema and `validateCheck` refuse a decimal, a string, a negative step and a value beyond the safe range. A decimal delivered sample fails the check.
- [x] Every check charges the shared budget before the work it pays for; an oversized series is inconclusive, never unbounded.
- [x] Schema v0.14 through an ADR (ADR-0047, D98) with the version bump.
- [x] Fixtures: `recorded-path-accepted`, `attack.recorded-path-reordered`, `attack.recorded-path-invented-arrival`, `attack.recorded-path-unequal-columns`, `neutrality.data-checks-primary-offline`.
- [x] The package tests pass.

## Decisions

- **One shared reader, `series.ts`,** for the pointer and column forms, so the three kinds read integers by one rule. It reuses `signature_valid`'s pointer resolver, exported for it.
- **No `strict` flag and no unordered mode.** `minStep` 1 is strict increase for integers; no deal needs an unordered path yet. ADR-0047 lists both as later optional parameters.
- **Detail lines never quote a delivered value or a column name.** They name the series by position and the row by number.
- **The non-integer parameter and the oversized input are tested below the scenario runner.** The runner loads terms through the schema parser, so a terms file with a decimal tolerance never reaches a step (measured: `ScenarioError: ... must have required property 'columns'`). The contract test checks both validators; the unit tests check `validateCheck` and the evaluators. The oversized case needs a delivery past the fixtures' sizes; the unit tests run 200,000 and 300,000 rows.
- **`check-kinds.test.ts` uses `trend_column`** as its kind a later schema may add, since `monotonic_column` now exists.

## Evidence

Measured on 2026-11-25 on one Mac, unless labelled.

- **After merging `main` (PRs 804, 806, 807):** `tsc -b` and `pnpm lint` clean; `npx vitest run packages/judgment site tests/spec.test.ts apps/adjudicator/src/check-kinds.test.ts packages/core` 57 files, 2,355 passed, 2 skipped; `pnpm validate:spec` 38 of 38; `pnpm snap` 62 of 62; `node site/check.mjs` passes; `buy.mjs` and `try.mjs` equal `main`'s.
- **`/verify` after the red team's fixes** (kinds 5 and 6): `pnpm exec vitest run packages/judgment tests/spec.test.ts` 1,186 passed, 2 skipped; `pnpm validate:spec` 38 of 38 and `spec/openapi.json` fresh; `tsc -b` and `pnpm lint` clean; `pnpm snap` 62 of 62. The only snapshot diffs are the two attack fixtures' description lines.
- **Package, before the fixes:** `npx vitest run packages/judgment`: 24 files, 910 passed, 2 skipped.
- **Contract and neighbours:** `tests/spec.test.ts`, `apps/adjudicator/src/check-kinds.test.ts`, the operator's version tests, `examples/mandate.test.ts` and `packages/core`: 30 files, 1,423 passed.
- **Spec:** `pnpm validate:spec`: 38 of 38 examples; `spec/openapi.json` fresh.
- **Snapshots:** `pnpm snap`: 62 of 62.
- **Local chain:** the five new fixtures pass against the contracts on anvil (`pnpm snap --settlement=local <name>`), each with a transcript identical to SimChain's: 484,177 to 560,014 gas over 3 or 4 transactions.
- **Neighbours:** `npx vitest run apps/adjudicator apps/operator apps/test-agents examples site tests`: 174 files, 3,053 passed, 55 skipped.
- **Site:** `node site/build.mjs && node site/check.mjs` passes. `buy.mjs` and `try.mjs` keep their SHA-256 (`b87e478b…` and `71634a90…`). `setup.mjs`, `take.mjs` and `serve.mjs` change, because they embed the schemas or the judgment code.

**Red team** (one Opus pass, given CLAUDE.md, ADR-0006, ADR-0045, ADR-0047 and the threat model; probes in the gitignored `reports/scratch/redteam-t610/`). No Critical or High finding.

| Finding | Severity | State |
| --- | --- | --- |
| The recorded-path terms accept a reversed run whose joint columns are flipped back with the timestamps kept, and a run with one invented sample at the waypoint. No data check can tell; the fixture terms carry no `signature_valid` | Medium | Recorded: ADR-0047 "What the kinds do not prove" and both attack descriptions name it. The live deal pairs the kinds with `signature_valid` (P-22) |
| `toTable` converts every non-scalar JSON-table cell with the recursive `canonicalJson`, so a deeply nested cell fails a column check at a depth that depends on the process's stack size (about 1,000 to 4,400 levels, measured). Older code; every column check shares it | Medium | Closed by PR 807 (D96), merged into this branch: `canonical` refuses past a fixed depth (`MAX_CANONICAL_DEPTH`), so the answer no longer depends on the stack [inferred from `cost.ts`] |
| Terms that pass the schema but contradict themselves (`minStep` above `maxStep`, a waypoint with the wrong number of coordinates) are agreed and funded, then fail at judgment: the buyer pays the fee and the seller gets nothing for good work. Nothing runs `validateCheck` at offer time | Medium | Open: the unbuilt half of ADR-0045 section 10, which T-590 and T-597 left for a later change |
| A column name's length counted UTF-16 units, the schema code points | Low | Fixed: code points, with a test |
| A CSV that repeats a header name read the first column | Low | Fixed: the check fails, with a test |
| A JSON table's number cells (`-0`, `1.0`, `1e2`) passed while the ADR's CSV spelling rule refuses them | Low | Fixed in ADR-0047 section 1: a JSON table's numbers read as the pointer form reads them |
| ADR-0047 estimated the budget at 1,048,576 bytes; the content store's cap is 10,485,760 | Info | Fixed: the red team's measured 8,400,002 units for 15.7 MB |
| A repeated JSON key reads as its last value | Info | Fixed: stated in ADR-0047 section 1 |

## Handoff

- **For P-18 (the site docs batch):** `site/ref/checks.txt` does not name the three kinds yet. ADR-0047 sections 1 to 5 hold the parameters, rules, limits and failure lines.
- **For the coordinator:** the open Medium finding above (no `validateCheck` at offer time). It predates this change and affects every kind.
- **Merged `main` after PRs 804, 806 and 807 (2026-11-25):** the three kinds read through 807's `Run` and charge each series, its pointer or header lookup, each entry and each comparison. `check-kinds.test.ts` renames 804's stand-in to `trend_column`.
- **Deploy notes** (a deploy waits for Rafa): the operators' next deploy serves schema 0.14, and the reference adjudicators list 13 kinds, so the world registers them again with a later `issuedAt` (inferred, as for T-590). No signed type, contract or domain changes.
