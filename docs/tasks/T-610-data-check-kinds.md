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

- **Package:** `npx vitest run packages/judgment`: 24 files, 910 passed, 2 skipped.
- **Contract and neighbours:** `tests/spec.test.ts`, `apps/adjudicator/src/check-kinds.test.ts`, the operator's version tests, `examples/mandate.test.ts` and `packages/core`: 30 files, 1,423 passed.
- **Spec:** `pnpm validate:spec`: 38 of 38 examples; `spec/openapi.json` fresh.
- **Snapshots:** `pnpm snap`: 62 of 62.
- **Site:** `node site/build.mjs && node site/check.mjs` passes. `buy.mjs` and `try.mjs` keep their SHA-256 (`b87e478b…` and `71634a90…`). `setup.mjs`, `take.mjs` and `serve.mjs` change, because they embed the schemas or the judgment code.

## Handoff

- **For P-18 (the site docs batch):** `site/ref/checks.txt` does not name the three kinds yet. ADR-0047 sections 1 to 5 hold the parameters, rules, limits and failure lines.
- **Deploy notes** (a deploy waits for Rafa): the operators' next deploy serves schema 0.14, and the reference adjudicators list 13 kinds, so the world registers them again with a later `issuedAt` (inferred, as for T-590). No signed type, contract or domain changes.
