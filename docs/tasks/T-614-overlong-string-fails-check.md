# T-614: A string too long to match fails the check that meets it

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** T-593, T-599, T-607 (merged); T-612 (PR 816), whose page and test this task changes
- **Paths this task may touch:** `packages/judgment/src/checks/` (`safe-regex.ts`, `index.ts`, `json-schema.ts` and their tests), `fixtures/` (one `attack.*` scenario with its terms and data), `examples/check-terms.ts` and its test, `site/ref/checks.txt`, `tests/checks-guide.test.ts`, the rebuilt `site/setup.mjs` and `site/serve.mjs`, `docs/decisions-today.md` (D103), this file
- **Human gate:** no (the deploys that carry it are Rafa's)
- **Status:** review
- **Agent/session:** overlong-pattern, 2026-11-25; branch `t-614-overlong-string-fails-check`
- **Roadmap row:** none (security fix, 2026-11-25)

## What exists

Read on 2026-11-25 at `origin/main` `b02ccd8a`. The pattern engine (`checks/safe-regex.ts`) reads at most 10,000 code points of a string. For a longer string, `fits()` made `search` and `fullMatch` answer "no match". In `json_schema`, `not` turns that answer into a pass, so `{"not": {"pattern": "..."}}` passes any string over the cap, whatever it holds. `oneOf` can pass the same way: a branch that should also match counts as not matching. T-612 (PR 816) found this and documented `maxLength` 10000 beside the `not` as a workaround.

The engine already has the right model for a value it cannot read: it throws, no schema keyword catches, and `runChecks` records the check as not passed (an unreadable `enum` or `const` value, an exhausted budget).

## Intent

A string the pattern engine does not read has no answer, so it must not become part of any pass. A `json_schema` check whose pattern meets such a string fails, wherever the pattern sits. A buyer's "must not contain" rule then holds against padded work without the buyer knowing the cap.

- **Inputs:** a deal's deterministic checks and a delivery.
- **Outputs:** the same results, except that a `json_schema` check whose pattern meets a string over 10,000 code points now fails.
- **Non-goals:** no change to the cap, to what a pattern matches within it, to the budget's charges, to the schema contract, or to the check kinds.

## Context

- `CLAUDE.md`: deliverables are untrusted; acceptance checks are declarative; agreed terms bind (D28).
- `docs/judgment-and-defenses.md`, stage 1.
- `docs/decisions-today.md`: D93, D96 (the budget counts every step), D99 (checks are not a kept version).

## Acceptance criteria

- [x] A failing test first: a string over the cap passes `not`, `anyOf` and `oneOf` rules on the old code.
- [x] A `json_schema` check whose pattern meets a string over the cap fails, under `not`, `anyOf`, `oneOf`, `allOf` and any nesting, whether or not the check is required.
- [x] The engine fails closed by default: a new caller that does nothing gets a failed check, not "no match".
- [x] `regex_match_rate_min` keeps counting such a cell as not matching, and a test shows why that cannot help it pass.
- [x] The rule is a count, never a timer, and no step is charged differently.
- [x] Where key order can decide pass or fail (under `not`, `anyOf`, `oneOf`), either key order gives one result, since the commitment ID hashes sorted keys. Elsewhere the read order is unchanged.
- [x] An `attack.*` fixture ends refunded.
- [x] `site/ref/checks.txt` and `tests/checks-guide.test.ts` state the new rule; `examples/check-terms.ts` gives the new reason.
- [x] `site/setup.mjs` and `site/serve.mjs` are rebuilt.
- [x] One red team, blocking findings only.

## Out of scope

- The cap's size. A buyer who needs a pattern on a longer string has none today either.
- Deploys.

## Evidence

All measured on 2026-11-25, Node 22.23.4, on the maintainer's Mac under load from other sessions.

- **Failing test first:** on `origin/main` `b02ccd8a`, 16 of the 20 tests first written in `subject-cap.test.ts` failed. The 4 that passed pin behaviour this change keeps.
- **Attack fixture:** `attack.padded-past-pattern-limit` on the old source ends `decide: accept`, Released, so the seller is paid. On this change it ends reject, Refunded.
- **Checks** (`/verify`, after merging `origin/main` `423ffcd9`, which holds PRs 816 and 818): `build`, `typecheck`, `lint` and `validate:spec` exit 0. Vitest on `packages/judgment`, `apps/adjudicator` and the five test files that read the checks: 46 files passed, 2 skipped; 1,429 tests passed, 6 skipped. `pnpm snap`: 63 passed, 0 failed; the one new snapshot is `attack.padded-past-pattern-limit`, and no other snapshot changes. On the contracts on a local anvil chain, after `forge build`, `pnpm snap --settlement local attack.padded-past-pattern-limit` passes with a transcript identical to SimChain's. `node site/build.mjs && node site/check.mjs`: PASS.
- **Bundles:** `node site/build.mjs && node site/check.mjs`: PASS. sha256, `main` to this branch: `setup.mjs` `fa1db8eebcf92166db3e2c8e16f3540dd4bbab61bab62e257ab52aa3b9911b0c` to `b59bc7217bf019ba55b787281d65935642079547922b7a996fc582a6182bc31c`; `serve.mjs` `4bc92987978c81cf579f72378c08c6eb507519c462dfe96a00b32d915f126aa0` to `b743465d031d6858a1a23ec866c6c77090439ce0e9d06726a97d99b9d2724f1f`; `take.mjs` is unchanged (`27bc44db124881f72ce048cd5629ac8848dac9f417ae8668de3dd6e29760d05b`).
- **Cost of the signal:** a thrown preallocated object cost about 0.9 microseconds, a new `Error` subclass 9 to 13 (load average 57). So the signal is one instance, and `countsAsMatch` does not throw for a cell whose length alone decides.
- **Red team** (one `red-teamer` subagent on Opus, 91,886 tokens): no route by which an unread string, or any other value a check cannot read, ends in a pass. One blocking regression in the first build: sorting every key put `properties` ahead of `required`, so a seller could spend the budget first and turn a reject into an escalate. Fixed: the fixed order applies only under `not`, `anyOf` and `oneOf`, test first (2 tests failed on the first build). Its other blocking item, bundles not yet rebuilt, is done. A Sonnet red team started first was stopped before it reported, on the coordinator's word that this review runs on Opus.
- **The red team's comparison, rerun on the fix:** its 8,804,407-byte input rejects with `schema: missing must`, as on `main`. 20,000 random cases under the cap: 0 differences in result or line. 20,000 cases with long strings: 0 pass now that failed on `main`, 13 changed result, and the red team's run showed such changes go from pass to fail. 20,000 cases with the keys reversed, each with a small and the default budget: 0 changes in whether a check passes, and 0 in pass, fail or inconclusive at the default budget (2,453 line or small-budget differences, outside the three keywords). 32,365 schemas without them: 0 differences from `main` in result, line or charge.

## Decisions

- **D103: a pattern that meets a string too long to match fails the check.** See `docs/decisions-today.md`.

## Handoff

Done: the engine change, the fixed read order, the tests, the attack fixture, the docs and the bundles. Not merged, not deployed.

- **Deploy the judging nodes before or with the site.** `ref/checks.txt` now says a long string fails the check. An adjudicator on the old build still passes it, so a buyer who dropped the old `maxLength` guard on the page's word would be unprotected.
- **One build.** The primary, fallback and appeal adjudicators, the hosted sellers, `setup.mjs` and `serve.mjs` embed this code.
- **Partner pages** pin `setup.mjs` and `serve.mjs`: republish them after the site deploy, which is Rafa's.
- **Signed deals** are judged under the new rule after the deploy.

Follow-ups, none blocking:

- Under `not`, `anyOf` and `oneOf`, the compiler sorts a `properties` object's names before the 2,000-subschema limit can refuse it (inferred from the code).
- `packages/judgment/scripts/mutants.mjs` has a mutant whose search text is not in `checks/index.ts`, on `main` too (red team).
- `site/ref/checks.txt` on `main` holds a `%% T-612` editor note that asks for a bullet on the JSON-table nesting cap (PR 818, now merged). The build strips the note; the bullet is not written.
