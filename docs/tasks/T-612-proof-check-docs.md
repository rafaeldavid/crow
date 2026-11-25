# T-612: One site docs batch for the proof checks (plan item P-18)

- **Lane:** demo (the site's agent docs)
- **Phase:** 2
- **Depends on:** T-597 (`signature_valid`), T-610 (the three data kinds), T-593 and T-599 (pattern and match budgets)
- **Paths this task may touch:** `site/ref/checks.txt`, `docs/api.md` ("Acceptance: checks and rubric"), `tests/checks-guide.test.ts` (new), this file
- **Human gate:** no for the merge. The site deploy is Rafa's.
- **Status:** review
- **Agent/session:** p18-check-docs
- **Roadmap row:** N225, T-252

## What exists

- `site/ref/checks.txt`, "Checking a signature" (T-597): `signature_valid`'s parameters, the exact-bytes rule, base64 and size limits, two example failure lines. It had no full list of failure lines, no vector link and no work units.
- The page did not name `passes_through`, `monotonic_column` or `equal_lengths`. Its telemetry section said no check compares the step between rows.
- It gave patterns one limit, 200 characters. The compile budgets (T-593) and the match budget (T-599) were not on it.
- ADR-0045 and ADR-0047 hold the rules; they are not agent pages.
- `docs/api.md` listed nine of the 13 kinds.

## Intent

An outside seller or buyer writes terms from the agent docs alone. The page must give each proof kind's parameters, rules, limits, failure lines and what it does not prove, with every statement matching the code and the schema. Agents read the page on demand, so nothing goes into `llms.txt`, `sell.txt` or `buy.txt`, whose paths are at their token budgets. Non-goals: no change to code, schema or bundles; no deploy.

## Context

ADR-0045 (D90, D92), ADR-0047 (D98), D93, D96; `packages/judgment/src/checks/`; `spec/schemas/commitment.schema.json`, `$defs/DeterministicCheck`, `Series`, `JsonPointer`; `spec/test-vectors/signature-valid/`.

## Acceptance criteria

- [x] `ref/checks.txt` covers the four kinds: parameters, rules, limits, failure lines, what each does not prove.
- [x] It states the compile limits, the match charges and the shared budget, and what running out does.
- [x] It links the signed-form test vectors.
- [x] Its list of check types equals stage 1's registry, held by a test.
- [x] `llms.txt`, `sell.txt` and `buy.txt` are unchanged.
- [x] `node site/build.mjs && node site/check.mjs` and `tests/site-guides.test.ts` pass.

## Out of scope

- The site deploy.
- Changing what the engine does (see Handoff).

## Evidence

- **Read against the code** (measured, 2026-11-25): `checks/index.ts`, `series.ts`, `passes-through.ts`, `monotonic-column.ts`, `equal-lengths.ts`, `signature-valid.ts`, `signature.ts`, `safe-regex.ts`, `json-schema.ts`, `table.ts`, `csv.ts`, `cost.ts`, `aggregate.ts` (`preDecision`, `signedOutcome`), `apps/adjudicator/src/service.ts` (the check-kind refusal), and the schema's three new branches and `signature_valid`.
- **Edge cases run on the built evaluators** (measured): the data kinds' failure lines; `-0` and `01` CSV cells; a repeated CSV header; and a `json_schema` `not` + `pattern` rule, which passes a string of 10,001 code points and fails it once `maxLength` 10000 sits beside it.
- **Nothing validates checks at the offer** (measured by search): under `apps/`, nothing calls `validateCheck` or compiles a pattern or schema outside a judging pass.
- **The outcome of a check that runs out** (inferred from `preDecision` and `signedOutcome`, not run on a deal): the primary or fallback escalates; the appeal adjudicator on the same build also finds it inconclusive and signs nothing; the default outcome follows.
- **`tests/checks-guide.test.ts`:** the page's list equals the registry; its signature and data examples pass the schema and `validateCheck`; the data examples pass one recording and fail a changed one with the lines the page describes; the stated limits equal the code's constants; the `not` + `pattern` statement holds.

## Decisions

- The `checkKinds` rule moved from the signature section to the list of check types, since it covers all four new kinds.
- `docs/api.md` gets one table row for each new kind and a pointer to the agent page for the budgets, not a second copy of them.
- A line each fixed two statements the new kinds made wrong: the telemetry section's "no check compares the step between rows", and the robot section's "next section" pointer.

## Handoff

Done: the page, the `docs/api.md` rows and the test. Not done: the site deploy (Rafa's), so crow.direct serves the old page.

Follow-ups, not fixed here:

1. A `json_schema` `not` + `pattern` rule passes a string over 10,000 code points. The page tells the buyer to add `maxLength`. The engine could fail the check instead; that changes judgment and needs a task of its own.
2. No operator or adjudicator runs `validateCheck` at the offer (ADR-0045 section 10, second half; T-610's note).
3. The page's `hidden_characters_max` line does not say that a JSON delivery's string escapes are decoded before the count (D99).
4. The page does not say that check IDs must be unique (D100).
