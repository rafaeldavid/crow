# T-593: Tighter compile limits for the pattern engine

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `packages/judgment/src/checks/safe-regex.ts`, `packages/judgment/src/checks/safe-regex.test.ts`, `site/setup.mjs` (rebuilt), `docs/tasks/T-593-pattern-compile-limits.md`
- **Human gate:** no (the deploys that carry it are Rafa's)
- **Status:** review
- **Agent/session:** pattern-compile-limits
- **Roadmap row:** none (security fix, 2026-11-25)

## What exists

Read on 2026-11-25. `packages/judgment/src/checks/safe-regex.ts` compiles a party's pattern to a Thompson NFA and matches it in linear time. It bounds the pattern's length (`MAX_PATTERN_CHARS`), each repeat count (`MAX_REPEAT`) and the NFA's size (`MAX_STATES`), and `StepBudget` bounds matching work per delivery. Nothing bounded the work of compiling itself.

## Intent

Bound the compile of every pattern by a count, so that any pattern a party can write compiles, or is refused, in a few milliseconds, and every adjudicator on the same build reaches the same answer.

- **Inputs:** a pattern from a `regex_match_rate_min` check or a `json_schema` `pattern` keyword.
- **Outputs:** the same compiled matcher as before, or a refusal; `validateCheck` refuses before signing what judging would fail.
- **Non-goals:** no change to the supported syntax, to what any accepted pattern matches, or to how the match budget counts.

## Context

- `CLAUDE.md`, hard rules: commitments are untrusted; acceptance checks are declarative.
- `docs/judgment-and-defenses.md`, stage 1.
- `docs/tasks/T-008-judgment-pipeline-v0.md`, the check budget.

## Acceptance criteria

- [x] Compile work is bounded by a deterministic count (`MAX_COMPILE_STEPS`), never a timer.
- [x] A pattern over the limit fails closed when judged, and `validateCheck` refuses it.
- [x] Every accepted pattern matches the same strings as before, and spends the same match budget.
- [x] Every shipped template and fixture compiles as before (`corepack pnpm snap`).
- [x] A red team looked for another pattern that the new limits miss.

## Out of scope

- How the match budget counts work inside one budget unit (see Handoff).
- The `validateCheck` half of ADR-0045 §10 at offer time (see Handoff).

## Evidence

- **Compile time** [measured, Node 22.23.4, the maintainer's Mac under load from other sessions; one child process per pattern]: every case in the private notes compiles in under 1 ms, and the heaviest accepted pattern found compiles in about 3 ms (mean of 100). The before and after times are in the private notes.
- **Step limit alone** [measured]: with the parser's simplification switched off in a scratch copy, the step limit refuses those cases in under 80 ms each.
- **Steps per state** [measured]: across 200,000 random patterns up to 200 characters, with repeat counts up to 1000, the highest ratio of compile steps to NFA states was 1.7. The red team reached 1.98. No pattern was refused for steps.
- **Same language** [measured]: the old and new engines agree on every distinct pattern logged from `corepack pnpm test` and `corepack pnpm snap` (81 patterns) and on 20,000 random patterns, for `fullMatch` and `search`, for the refusal messages, and for the match budget each spends. Character classes agree with the old engine on every code point, 38 classes.
- **Character classes** [measured]: a class now compiles to merged ranges, tested by binary search. A 190-entry class now costs about the same per budget unit as a 1-entry class (107 ns against 97 ns).
- **Tests added:** a property test that random nested patterns agree with `RegExp`; a test that character classes agree with `RegExp` across the code points.
- **Checks** [measured, 2026-11-25]: `corepack pnpm install --frozen-lockfile`, `build`, `typecheck` and `lint` exit 0. `corepack pnpm test`: 280 files passed, 22 skipped; 5,517 tests passed, 286 skipped. `corepack pnpm exec vitest run packages/judgment`: 707 passed, 2 skipped. `corepack pnpm snap`: 52 passed, 0 failed, no snapshot diff. `node site/build.mjs && node site/check.mjs`: site check PASS.
- **Pinned bundle:** `site/setup.mjs` changes, because it embeds the judgment package's checks (the seller's preflight). No other bundle under `site/` embeds the engine.

## Decisions

- **Both a structural rule and a count.** The parser simplifies the tree without changing its language, so each compile step adds NFA states. The step count stops the rest if the simplification misses a case. The count is set at 10 steps per allowed state, well above the measured 2.
- **Character classes as ranges.** The class change keeps every match result and every budget charge, so no judgment result changes.
- **Patterns newly accepted** [measured]: a few patterns refused before at `MAX_STATES` now compile, because their simplified tree has fewer states. None was refused before for any other reason, and no pattern accepted before is refused now.

## Handoff

Done: the compile limits, the class ranges and their tests. Not deployed.

- **Deploy together.** The adjudicators (holdback-op1 and holdback-op2), the hosted sellers and `site/setup.mjs` all embed this code. Adjudicators on different builds could disagree on a pattern near the limits, so deploy the primary and fallback adjudicators from the same build.
- **Signed deals** [inferred]: a deal already signed with a pattern this change affects is judged under the new limits after the deploy: its check compiles, or fails closed.
- **Follow-up, match budget:** one budget unit can still stand for many internal steps on some accepted patterns. Counting them changes when a check becomes inconclusive, so it needs its own task and decision.
- **Follow-up, ADR-0045 §10:** with compile time bounded, the primary can call `validateCheck` on each check before it accepts an offer. On 1 MiB of `regex_match_rate_min` checks, `validateCheck` took 0.18 s for 7,825 ordinary checks and up to 3.1 s for the heaviest accepted patterns found [measured, under load from the test suite]. An offer-wide step count, or a cache by pattern, would bound that further; the primary may decline an offer it will not run (D29).
