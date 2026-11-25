# T-599: The match budget counts every engine step

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** T-593 (merged)
- **Paths this task may touch:** `packages/judgment/src/checks/safe-regex.ts`, `packages/judgment/src/checks/safe-regex.test.ts`, `site/setup.mjs` (rebuilt), `docs/decisions-today.md` (D93), `docs/tasks/T-599-match-budget-every-step.md`
- **Human gate:** no (the deploys that carry it are Rafa's)
- **Status:** done (merged in pull request 799, 2026-11-25)
- **Agent/session:** match-budget-fix
- **Roadmap row:** none (security fix, 2026-11-25)

## What exists

Read on 2026-11-25. `packages/judgment/src/checks/safe-regex.ts` matches a party's pattern with a Thompson NFA. The match budget (`StepBudget`, 50,000,000 units per delivery, `CHECK_BUDGET` in `checks/index.ts`) charged one unit per code point and one per state in the current set. It did not charge the empty moves the engine follows between code points, and each call allocated visit marks of the pattern's size. T-593's Handoff named this as a follow-up.

## Intent

Make one budget unit stand for about the same work on every pattern, so that a delivery's checks finish, or run out of budget, in about the same time whatever the terms say. The rule stays a count, so every adjudicator on the same build reaches the same answer.

- **Inputs:** a pattern from a `regex_match_rate_min` check or a `json_schema` `pattern` keyword, and a delivery.
- **Outputs:** the same match results; a budget charge that now includes each empty move.
- **Non-goals:** no change to the supported syntax, to what any pattern matches, to the budget's size, or to the check types.

## Context

- `CLAUDE.md`, hard rules: deliverables and commitments are untrusted; acceptance checks are declarative.
- `docs/judgment-and-defenses.md`, stage 1.
- `docs/tasks/T-593-pattern-compile-limits.md`, Handoff.

## Acceptance criteria

- [x] The match budget charges one unit per empty move, beside the existing charges.
- [x] A call allocates nothing of the pattern's size: one set of visit marks serves every pattern.
- [x] The rule is a count, never a timer.
- [x] Every accepted pattern matches the same strings as before.
- [x] No judgment result changes on any pattern and delivery the tests and snapshots use (measured below).
- [x] A red team looked for an input where one budget unit still costs much more time than ordinary input.

## Out of scope

- The budget's size and the other check types' charges.

## Evidence

- **Results unchanged** [measured]: a scratch build charged by the old rule and counted the empty moves beside it, over `corepack pnpm test` and `corepack pnpm snap`. It logged 1,288 distinct patterns and every `runChecks` call. No check changed between passed, failed and inconclusive. The largest conclusive run would spend 2.4% of the budget under the new rule. The runs that already ran out of budget (scenario 5a among them) run out at the same check.
- **Time per unit** [measured, Node 22.23.4, the maintainer's Mac]: the old and new engines side by side. After the change, the heaviest shapes found cost about as much per budget unit as ordinary patterns. The shapes and the times are in the private notes.
- **Tests added:** exact charges for a pattern without empty moves (unchanged) and with one; charges grow with each optional part; an empty subject runs out of budget; a property test that one compiled pattern gives `RegExp`'s answers over many calls.
- **Red team** [measured]: a `red-teamer` subagent found no correctness bug in the counting or the shared visit marks: 109,252 comparisons against `RegExp`, including runs cut short by budget exhaustion and runs across the generation reset, with 0 mismatches. It found one cost this change added, visit marks held by each compiled pattern, which the shared marks remove. Its other findings concern work outside the regex engine's budget and predate this change; they are kept privately as follow-ups.
- **Checks** [measured, 2026-11-25]: `corepack pnpm install --frozen-lockfile`, `build`, `typecheck` and `lint` exit 0. `corepack pnpm test`: 286 files passed, 25 skipped; 5,622 tests passed, 311 skipped. `corepack pnpm exec vitest run packages/judgment`: 711 passed, 2 skipped. `corepack pnpm snap`: 53 passed, 0 failed, no snapshot diff. `node site/build.mjs && node site/check.mjs`: site check PASS. In an earlier full run, the existing property test of random nested patterns timed out at 30 s while the Mac's load average was 106 to 121. Run alone, it takes 7.5 to 9 s on the old engine and on the new one, so the change does not cause it.
- **Pinned bundle:** `site/setup.mjs` changes, because it embeds the judgment package's checks. sha256 before `8103e24d1f2d5c773e4f8aa88bab95292c3240679ea74d0e192d496af74e5b07`, after `e3d9f92de9c0a6c2b795803429974cc6dc88c56164eca3d24a2e4861a3f7f840`. No other bundle under `site/` changes.

## Decisions

- **D93: count the empty moves; no compile-time bound.** A bound on how deep optional groups nest would refuse patterns the tests use and still miss shapes that cost as much without nesting. Counting covers every shape by construction and changes no result measured. See `docs/decisions-today.md`.

## Handoff

Done: the counting, the shared visit marks and their tests. Not deployed.

- **Deploy together.** The adjudicators (holdback-op1 and holdback-op2), the hosted sellers and `site/setup.mjs` all embed this code. Adjudicators on different builds could disagree on a check near the budget, so deploy the primary and fallback adjudicators from the same build.
- **Signed deals** [inferred]: a deal already signed is judged under the new count after the deploy. A check far below the budget still finishes with the same result. A check near the limit, or one whose pattern takes many empty moves, may now run out and escalate instead of passing or failing.
