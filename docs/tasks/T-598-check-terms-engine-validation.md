# T-598: check-terms uses the engine's check validation

- **Lane:** api
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `examples/check-terms.ts`, `examples/check-terms.test.ts`
- **Human gate:** no; `check-terms` is in no pinned bundle, so no hash changes
- **Status:** review
- **Agent/session:** check-terms-validate
- **Roadmap row:** none (plan P-09 follow-up)

## What exists

`examples/check-terms.ts` (T-588) warns before signing, but it judges patterns by length alone. It does not use the judgment engine's `validateCheck`.

## Intent

Run every check in the terms through `validateCheck`. A check the engine refuses gives one warning that names the check's id and the engine's reason. The command still exits 0 (D31) and stays silent on every shipped template.

## Acceptance criteria

- [x] A pattern the engine refuses (over the state limit) gives a warning with the engine's reason.
- [x] A well-formed check gives none; the shipped templates, unfilled and filled, stay silent.
- [x] A check that already has a length warning gets no second one.
- [x] In a seller template, a check that holds a placeholder is not judged until it is filled.
- [x] `node site/build.mjs && node site/check.mjs` pass; `buy.mjs` and `try.mjs` are unchanged.

## Out of scope

- A malformed `signature_valid` check: it gets its warning from `validateCheck` when P-03 adds the check type, with no change here.

## Evidence

See the PR body.

## Handoff

None.
