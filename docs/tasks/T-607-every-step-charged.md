# T-607: Every judgment step is charged to the check budget

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** T-593, T-599 (PR 799) and T-597 (PR 795), all merged; this branch merges `origin/main` `91430b55`
- **Paths this task may touch:** `packages/judgment/src/checks/` (`cost.ts` new, `index.ts`, `json-schema.ts`, `safe-regex.ts`, `table.ts`, `csv.ts` and their tests), `packages/judgment/src/normalize.ts`, `site/setup.mjs` and `site/serve.mjs` (rebuilt), `docs/decisions-today.md` (D96), `docs/tasks/T-607-every-step-charged.md`
- **Human gate:** no (the deploys that carry it are Rafa's)
- **Status:** done (merged in pull request 807, 2026-11-25)
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
- [x] Work shared by several checks (the table, the hidden-character count, a reference) is done once per run, and a reference is kept only while a later check needs it.
- [x] Canonical forms refuse a value nested deeper than `MAX_CANONICAL_DEPTH`, a fixed count instead of the engine's stack.
- [x] Terms constants are prepared when a schema compiles, and a check compiles once per run.
- [x] A schema's patterns together hold at most `MAX_SCHEMA_STATES` states, refused in `validateCheck`.
- [x] A `pattern` binds `^` and `$` to the first and last top-level alternative, as `RegExp` does.
- [x] Charges are counts, never timers.
- [x] No judgment result changes on any check and delivery the tests and snapshots use (measured below).
- [x] A red team looked for an input where one budget unit still costs much more time or memory than ordinary input.

## Out of scope

- Charging the run's one JSON parse (T-597): `signature_valid`'s charges are part of its kind (ADR-0045, section 6). The JSON table now reads that parse instead of parsing again.
- The budget's size.

## Evidence

- **Results unchanged** [measured]: a scratch build ran `origin/main` (`91430b55`) beside this branch on every `runChecks` and `validateCheck` call of `corepack pnpm test` (2,595 runs) and `corepack pnpm snap` (48 runs). No outcome, detail or inconclusive list differed at the default budget, apart from one artefact: an adjudicator test adds a check kind to `CHECK_TYPES` at run time, which the scratch copy of the old module cannot see. The other differences are this task's new tests, which run on a 100-unit budget on purpose. The largest conclusive run in the tests spends 4.0% of the budget, as on main. The same comparison before the merge, against `b4a0a2d8`: 2,233 and 45 runs, 0 differences.
- **Random comparison** [measured]: 20,000 random sets of checks on random CSV and JSON deliveries, with references, against `origin/main`: 0 differences. The same against `b4a0a2d8`: 0 differences.
- **Time per unit** [measured, Node 22.23.4, the maintainer's Mac under load from other sessions]: the shapes the old code spent the most time on now cost about as much per budget unit as ordinary deliveries in the same run. The shapes and the times are in the private notes.
- **Tests added:** the canonical form equals `canonicalJson` and throws where it throws (property), and refuses past a fixed depth; `codePoints` equals spreading the string (property); the CSV parser agrees with a character-by-character reading, errors included (property); `isNullish` agrees with trimming code points (property); `^` and `$` beside alternation agree with `RegExp` (property); the subject cap counts code points; each check kind and the charged schema keywords run out on a small budget; a reference is read once per run; the state limit; `required` reports the first missing name; `unique_key` gives the same answer with a column named twice.
- **Red team** [measured]: a `red-teamer` subagent ran on the first commit. It found no correctness difference in 860,000 comparisons apart from deeply nested values, now refused at a fixed depth (D96), confirmed that the anchor binding matches `RegExp`, and confirmed that charges use no timer. It found five more costs in the first commit, all fixed in this branch, and two that T-599 and T-597 fixed on main. The inputs and figures are in the private notes.
- **Checks** [measured, 2026-11-25, after merging `origin/main` `91430b55`; re-run after merging `4dbb7632` below]: `corepack pnpm build`, `typecheck` and `lint` exit 0. `corepack pnpm test`: 289 files passed, 26 skipped; 5,792 tests passed, 315 skipped, 0 failed. `corepack pnpm snap`: 57 passed, 0 failed, no snapshot diff. `node site/build.mjs && node site/check.mjs`: site check PASS. Under load from other sessions, the existing property test of random nested patterns timed out once at 30 s; its time goes to `RegExp`, not the engine (measured), and it passed in the final run. After merging `4dbb7632`: 290 files passed, 26 skipped; 5,803 tests passed, 315 skipped, 0 failed; snap 57 passed; lint, typecheck and the site check pass.
- **Pinned bundles:** `site/setup.mjs` and `site/serve.mjs` change, because they embed the judgment package's checks. sha256 on `origin/main` `4dbb7632`: setup `3c8f1c0cb81b7e521cac37538ecfae05f372aab1cbabe725edae5a487ebeac53`, serve `faf1df138198f35c900219c0e36aa02d6b764f72f7d49cba6dc8388b2fa84095`. On this branch: setup `7ae4ca61caaf241954e2552525140979af2a9f0090bb969f1cbadd5c71e2f679`, serve `85b67a57c741ad9ed96eb334eaf41d97d80f059f02a4354b1ffe07b0e5de1102`. No other bundle under `site/` changes.

## Decisions

- **D96: charge every step, do shared work once, bound compiled patterns before signing, and bind anchors as `RegExp` does.** No caps on the size of terms constants (D31). See `docs/decisions-today.md`.

## Handoff

Done: the charges, the shared per-run work, the compact table, the state limit, the anchor binding and their tests. Not deployed.

- **Deploy together.** The adjudicators, the hosted sellers and `site/setup.mjs` embed this code. Adjudicators on different builds could disagree on a check near the budget, so deploy the primary and the fallback adjudicator from one build.
- **Merging main.** PRs 795 and 799 are merged in. If `origin/main` moves before this lands, merge it (no rebase) and rebuild the bundles; never hand-resolve a bundle.
- **Signed deals** [inferred]: a deal already signed is judged under the new charges after the deploy. A check far below the budget finishes with the same result.
