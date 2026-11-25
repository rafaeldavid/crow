# T-622: The known-key CPU attack test counts body work instead of timing it

- **Lane:** shipping (tests)
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `apps/demo-cloud/src/limits.attack.test.ts`; this file.
- **Human gate:** no.
- **Status:** review
- **Agent/session:** limits-attack-flake, 2026-11-25; branch `t-622-known-key-count`
- **Roadmap row:** none (flaky test, 2026-11-25)
- **Change kind:** tests only

## Intent

Remove the intermittent failure of `attack.t422-known-key-cpu` in `limits.attack.test.ts`. The test failed once in a full `pnpm test` run on PR 824, and the file then passed 12 of 12 alone. The test guards the operator's limits against T-422's known-key CPU attack, so its result must not depend on how busy the machine is.

## Cause

**The test's time bound was wrong. The operator's counts behaved as designed under load.**

- The test sent 30 other bodies under a known Idempotency-Key, then 30 under an unknown key. It required the first loop's mean time to be under twice the second's.
- The operator refuses both loops before it reads a body. The replay budget refuses the first loop, and the write budget refuses the second. Both loops read 0 of 30 bodies, at a load average of about 313 (measured, with a temporary probe).
- So the test compared two means of the same work. Machine noise decided the ratio. Over 300 runs its median was 1.04 and its range 0.45 to 2.88 (measured, from times rounded to 1 ms).
- The noise went both ways. The known-key loop took more than twice as long as the other in all 9 failures. In 7 other runs the unknown-key loop took at least twice as long (measured).
- The replay budget is a count per window, which the operator checks and charges before its first `await`. It is not a measure of CPU time (read in code, `knownKey` and `throttle` in `apps/operator/src/server.ts`). Load can change a count only when a run outlasts the window.
- That window was a second dependence on the clock: 60 s, in this test and in `attack.t422-replay-cpu`. A run slower than that would open the counts again. No run here failed that way (measured for this case); the risk is inferred.

## Change

Test code only. No product code changes.

- `attack.t422-known-key-cpu` counts the bodies the operator parses, as T-574 did for `attack.t422-replay-cpu`. With a write budget of 2 and that budget spent, it expects:
  - 2 body reads for the 2 requests that the replay budget admits, which also shows that the counter sees the operator's reads;
  - 0 body reads for 30 more bodies under the known key;
  - 0 body reads for 30 bodies under an unknown key;
  - status 429 for all 62.
- Both tests set a window of 3,600 s, longer than any test's timeout.
- Both tests share one counter, `countBodyReads`.
- The test's title and its `describe` title now state the defense. The case ID is unchanged.

## Acceptance criteria

- [x] The failure reproduces under load before the change, with a rate.
- [x] The result no longer depends on measured time or on the throttle window.
- [x] The new test fails when the replay budget is removed, and when the write budget is charged after the body read.
- [x] 0 failures in 300 runs under load after the change.

## Evidence

All runs are on 2026-11-25, on one 8-core Mac (measured). Other sessions' jobs ran on it too, so the load average is the whole machine's.

| Run | Concurrency | 1-minute load average | Failures |
| --- | --- | --- | --- |
| Before: the case alone, unchanged test | 8 | 66 to 432 | 9 of 300 |
| After: the case alone | 8 | 286 to 482, median 445 | 0 of 300 |
| After: the whole file | 4 | 405 to 459 | 0 of 20 |

- Local checks after the change (measured): `pnpm exec vitest run apps/demo-cloud`: 18 files and 211 tests passed, 7 files and 21 tests skipped. `pnpm typecheck` and ESLint on the changed file pass.
- To repeat a rate, run `pnpm exec vitest run apps/demo-cloud/src/limits.attack.test.ts -t t422-known-key-cpu` that many times, at the concurrency above.

- Each of the 9 failures was the time assertion, for example `expected 22.9 to be less than 21.0` (ms).
- All 300 runs after the change read 2 of 2, 0 of 30 and 0 of 30 bodies.
- **Mutation 1:** with the replay budget's `throttle` line removed from `knownKey`, the new test fails: 30 of 30 bodies read past the budget. All 30 statuses stay 429, so only the count shows this fault. Reverted.
- **Mutation 2:** with the write budget of an unknown key charged after the body read, the new test fails: 30 of 30 bodies read under the unknown key. Reverted.

## What the test does not prove

- It counts calls to `JSON.parse` on bodies of about 1 MB. A change that read or hashed raw bytes before the throttle, without parsing them, would not show. The operator's fingerprint takes the parsed body (read in code).
- It covers the faucet route only.
- The cost of one body read, in ms, is T-422's measurement. No test bounds it now.

## Handoff

The pull request waits for CI. The coordinator merges it. No deploy: the change is test code. To repeat the check, run `pnpm build`, then `pnpm exec vitest run apps/demo-cloud/src/limits.attack.test.ts`.
