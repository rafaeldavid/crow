# T-607: Every judgment step is charged to the check budget

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** T-593 (merged); runs beside T-599 (PR 799) and T-597 (PR 795), which touch the same files
- **Paths this task may touch:** `packages/judgment/src/checks/` (`cost.ts` new, `index.ts`, `json-schema.ts`, `safe-regex.ts`, `table.ts`, `csv.ts` and their tests), `packages/judgment/src/normalize.ts`, `site/setup.mjs` (rebuilt), `docs/decisions-today.md` (D96), `docs/tasks/T-607-every-step-charged.md`
- **Human gate:** no (the deploys that carry it are Rafa's)
- **Status:** review
- **Agent/session:** work-budget-gaps
- **Roadmap row:** none (security fix, 2026-11-25)

## What exists

Read on 2026-11-25 at `origin/main` `b4a0a2d8`. Stage 1 (`packages/judgment/src/checks/`) evaluates a deal's declarative checks under one work budget per delivery (`StepBudget`, 50,000,000 units, `CHECK_BUDGET`). The pattern engine and the schema node visits charged it. The column checks, the schema keywords' own work, the table build, the reference read and the hidden-character count did not, and some of that work repeated once per check.

## Intent

Make the budget bound the whole of stage 1: every step a check takes on a party's delivery or terms is charged, so a delivery's checks finish, or run out of budget, in about the same time whatever the terms and the delivery hold. The rule stays a count, so every adjudicator on one build reaches the same answer.

- **Inputs:** a deal's deterministic checks and a delivery, with any references.
- **Outputs:** the same check results; budget charges for every step.
- **Non-goals:** no new check kind, no change to the budget's size, to what a check accepts, or to the schema contract.

## Context

- `CLAUDE.md`, hard rules: deliverables and commitments are untrusted; acceptance checks are declarative.
- `docs/judgment-and-defenses.md`, stage 1.
- `docs/decisions-today.md`, D31 (parametrize, don't restrict) and D93 (the match budget counts every engine step).

## Acceptance criteria

- [x] Every column check charges each cell it reads; every scan charges its length; set entries, key sorts and canonical forms are charged (`cost.ts`).
- [x] Work shared by several checks (the table, the hidden-character count, a reference) is done once per run.
- [x] Terms constants are prepared when a schema compiles, and a check compiles once per run.
- [x] A schema's patterns together hold at most `MAX_SCHEMA_STATES` states, refused in `validateCheck`.
- [x] A `pattern` binds `^` and `$` to the first and last top-level alternative, as `RegExp` does.
- [x] Charges are counts, never timers.
- [x] No judgment result changes on any check and delivery the tests and snapshots use (measured below).
- [x] A red team looked for an input where one budget unit still costs much more time or memory than ordinary input.

## Out of scope

- The one JSON parse per check of a `json_schema` check, which T-597 (PR 795) makes one per run.
- The budget's size.

## Evidence

- **Results unchanged** [measured]: a scratch build ran the old code beside the new on every `runChecks` and `validateCheck` call of `corepack pnpm test` (2,233 runs) and `corepack pnpm snap` (45 runs). No outcome, detail or inconclusive list differed. The largest conclusive run spends 2.1% of the budget (1.4% under the old charges). The six runs that ran out of budget under the old code run out at the same check.
- **Random comparison** [measured]: 20,000 random sets of checks on random CSV and JSON deliveries, with references, against the old build: 0 differences.
- **Time per unit** [measured, Node 22.23.4, the maintainer's Mac under load from other sessions]: the shapes the old code spent the most time on now cost about as much per budget unit as ordinary deliveries in the same run. The shapes and the times are in the private notes.
- **Tests added:** the canonical form equals `canonicalJson` and throws where it throws (property); `codePoints` equals spreading the string (property); the CSV parser agrees with a character-by-character reading, errors included (property); `isNullish` agrees with trimming code points (property); `^` and `$` beside alternation agree with `RegExp` (property); the subject cap counts code points; each check kind and the charged schema keywords run out on a small budget; a reference is read once per run; the state limit; `required` reports the first missing name.
- **Red team:** see Handoff.
- **Checks** [measured, 2026-11-25]: see Handoff.
- **Pinned bundle:** `site/setup.mjs` changes, because it embeds the judgment package's checks. sha256 before `8103e24d1f2d5c773e4f8aa88bab95292c3240679ea74d0e192d496af74e5b07`, after `dba2054581c2c390b6dcebf676de1f0aaa9e7c8672e2d1fbdf3d4a28c1833ebb`. No other bundle under `site/` changes.

## Decisions

- **D96: charge every step, do shared work once, bound compiled patterns before signing, and bind anchors as `RegExp` does.** No caps on the size of terms constants (D31). See `docs/decisions-today.md`.

## Handoff

Done: the charges, the shared per-run work, the compact table, the state limit, the anchor binding and their tests. Not deployed.

- **Deploy together.** The adjudicators, the hosted sellers and `site/setup.mjs` embed this code. Adjudicators on different builds could disagree on a check near the budget, so deploy the primary and the fallback adjudicator from one build.
- **Merging with PRs 795 and 799.** Both touch `packages/judgment/src/checks/` and `site/setup.mjs`. Merge `origin/main` into this branch after either lands, then rebuild the bundles; never hand-resolve a bundle. PR 795's per-run JSON parse can then feed the table as well.
- **Signed deals** [inferred]: a deal already signed is judged under the new charges after the deploy. A check far below the budget finishes with the same result.
