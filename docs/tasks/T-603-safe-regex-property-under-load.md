# T-603: the safe-regex property test fails under load

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `packages/judgment/src/checks/safe-regex.test.ts`; this file.
- **Human gate:** no.
- **Status:** done (merged in pull request 802, 2026-11-25)
- **Agent/session:** flaky-safe-regex, 2026-11-25; branch `fix-flaky-safe-regex`
- **Roadmap row:** none (flaky test, 2026-11-25)
- **Change kind:** tests only

## Intent

Remove the intermittent failure of "agrees with RegExp on random nested patterns (property)" in `safe-regex.test.ts`. The test failed once in a full run on PR 795 and timed out under load.

## Cause (measured)

The test is deterministic: fixed seed (25), 2000 runs, so every run checks the same 2000 cases. One case takes 7.4 to 7.6 s in native `RegExp`, the comparison oracle, on a subject that does not match (pattern `(?:(()*?(|)*?((|b){2}b?b*?)*?){0}|(?:b{0,1}[ab]*|((|b){1,3}(|b){2,}(|b){1,3}){2}(){2}){1,1}){2,}`, subject `aabbbbcc`). The other 1999 cases take under 36 ms each. Our engine takes 18 ms to compile and 6 ms to match all 2000 cases. So the file took 9 s alone, 7.5 s of it in one native backtrack, and a loaded machine multiplies that past the 30 s `testTimeout` (the 5 s figure in the red team's report does not match `vitest.config.ts`, which sets 30 s).

## Change

The oracle runs in a `node:vm` context with a 250 ms timeout, which stops a running regex. A pattern that hits it is skipped with `fc.pre`, never compared. The generator, seed, run count and timeout are unchanged. The engine is untouched, so PR 799 does not conflict.

## Evidence

- Before, alone: file 9.1 s (measured). After, alone: 1.0 s (measured).
- Before, 10 concurrent runs of the file: 10 pass, 18 s each. 25 concurrent runs: 25 of 25 fail on the property test with "Test timed out", 40 s each (measured).
- After, 10 concurrent runs: 10 pass, 2.5 to 2.7 s each. 25 concurrent runs: 25 pass, 5.8 to 6.8 s each (measured).
- `vitest run packages/judgment`: 707 passed, 2 skipped. `pnpm typecheck` and eslint on the file: clean (measured).
- Engine: no slow accepted pattern found in these 2000 cases (measured). Other seeds are not swept (not measured).

## Not done

- The property now skips patterns native `RegExp` cannot finish in 250 ms; it compares 1999 of the 2000 pinned cases. A skip depends on time, but it only removes a comparison and never creates a failure.

## Handoff

Merge after CI. No follow-up.
