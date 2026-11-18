# T-508: the refund test's seller stops watching deals nobody funds

- **Lane:** test
- **Phase:** 2
- **Depends on:** T-504 (the CI review that found the reruns, PR 631)
- **Paths this task may touch:** `examples/buyer-signer-addresses.test.ts`, this file
- **Human gate:** no
- **Status:** review
- **Agent/session:** flaky-tests session `local_56a7ced9-ea7f-4f5c-9ab6-4e759abe1daf`, started by the coordinator on 2026-11-18
- **Roadmap row:** N173

## Intent

The CI review of 2026-11-18 found three runs between 2026-11-14 and 2026-11-16 that went green only when someone reran the same commit. Each was a different test in `examples/`. This task finds each cause and fixes it there: no skip, no retry, no longer timeout. One pull request per test. A test counts as fixed when it passes 50 repeated local runs under load. This file covers the third failure, which needed a change, and records what was found for the other two, which `main` had already fixed.

## Context

- `docs/research/2026-11-18-ci-review.md`, "Failures and reruns".
- The operator's read throttle: `apps/operator/src/server.ts` (`admit`, `charge`, a fixed 60 s window per client); its budget: `apps/demo-cloud/src/limits.ts` (`DEFAULT_RATE.reads`, 1,200 a minute per client and node).
- The deal record marks reads it could not get: `examples/deal-record.ts` (check "every read answered": "fields such as refundedTo may read null").

## Acceptance criteria

- [x] Each of the three failures has its cause named from the first attempt's log and a local reproduction or the commit that fixed it.
- [x] `examples/buyer-signer-addresses.test.ts` passes 50 of 50 runs under load, where it failed before the fix.
- [x] `examples/signer.test.ts` and `examples/setup-bundle.test.ts` pass 50 of 50 runs under load on `main`.
- [x] No skip, retry, longer timeout or larger rate budget.

## Out of scope

- The same unbounded seller watch in `examples/buyer-signer.test.ts` and `examples/signer-world-kit.ts` (Handoff).
- The operator's fixed window when the world's clock moves back (Handoff).

## What each failure was

### 3. `examples/buyer-signer-addresses.test.ts`, "a rejected delivery refunds the price" (PR 594, run 43817814772): fixed here

- **The log (measured):** the balances were right (the refund landed), but the deal record's row read `refundedTo: null`.
- **The cause (measured):** this file's operator nodes throttle reads at 1,200 a minute per client, and every request in the file comes from 127.0.0.1, so the buyer, the seller stand-in and the test share one budget. The seller stand-in started a watch for every offer it made and polled that deal about every 100 ms until it saw `Held`. Seven deals in the file are never funded, so seven watches ran until the file ended. Counting reads at the world: by the start of the last test, node 0 had answered 1,111 reads, with no load. Under load the file runs longer, the budget runs out, and the last test's reads get `429 rate_limited`. The deal record retries a refused read, then records the gap ("every read answered" fails), and its row reads `refundedTo: null`. That is the CI failure. Locally the same budget failed the same test at an earlier step too: `checkOffer` got 429, or `openDelivery` saw only one node's `Refunded` for 30 s.
- **Inferred, from reading the throttle:** the test before this one, L-3, moves the world's clock 5 min ahead and back. A window that starts while the clock is ahead does not reset until that future start time is 60 s past, so the count runs on through the last test. Seven watches at about 9 reads a second each spend 1,200 reads in about 19 s, less time than the last test takes under load.
- **The fix:** each watch ends when the seller delivers, or when the test that made the deal ends (`seller.forget()` in `afterEach`). The budget, the poll interval and the timeouts are unchanged.

### 1. `examples/signer.test.ts`, A7 (PR 556, run 43615794747): already fixed on `main` by T-442

- **The log (measured):** the signer answered 200 to the case meant to send a 601 s funding window. It sent `offerExpiresAt` 16:40:47Z and `fundBy` 16:45:47Z.
- **The cause (measured from the test at PR 556's head, `191b5980`):** the case took `now` once to build the deadline, and `termsFor` read the clock again for `createdAt`. When the second read fell in the next second, the window sent was 600 s, which rule B8 allows. The signer was right; the test was wrong.
- **The fix:** T-442 (PR 568, commit `9e2bad55`, 2026-11-14 16:50 UTC) builds every date in A7 from one second and tests every B8 bound with the signer's clock injected. It landed 12 min after this failure. The CI review counted this rerun without that link.

### 2. `examples/setup-bundle.test.ts`, eight runs at once (PR 589, run 43714612138): already fixed on `main` by T-486

- **The log (measured):** one of eight runs ended with `secrets` failing: `ENOENT: no such file or directory, stat '/tmp/crow-setup-NN5N1E/party/crow.lock'`.
- **The cause (measured, recorded in T-486's CI faults):** the secrets check listed the folder, another run removed its `crow.lock`, and the check's read of that file threw.
- **The fix:** T-486 (commit `e0b8e7f5`, 2026-11-15 12:58 UTC) passes over a file that is gone when it is read, keeps `crow.lock` in the scan, and tests this through a file-system stand-in. It landed 20 min after this failure.

## Evidence

All local, on a Mac with 8 cores, from this branch. "Under load": 8 runs of the whole file at once, plus 4 busy loops in Node, by a runner script in the session's scratch folder.

- **Reproduced (measured):** before the fix, `examples/buyer-signer-addresses.test.ts` passed 32 of 40 runs under load. All 8 failures were the refund test: `rate_limited` in `checkOffer`, or one node's `Refunded` for 30 s in `openDelivery`.
- **Read counts (measured, at the world, no load, at the start of the refund test):** node 0 answered 1,111 GET requests before the fix and 565 after.
- **Fixed (measured):** after the fix, `examples/buyer-signer-addresses.test.ts` passed 50 of 50 runs under load, in 108 s.
- **The other two (measured, `main` at `9501b84c`):** `examples/signer.test.ts` passed 50 of 50 runs under load, in 539 s; `examples/setup-bundle.test.ts` passed 50 of 50 runs under load, in 236 s. No pull request for these two: `main` already holds their fixes.
- **Checks (measured):** `pnpm exec eslint examples/buyer-signer-addresses.test.ts` and `pnpm exec tsc --noEmit -p examples` pass.

## Decisions

- **The budget stays at 1,200 reads a minute.** Raising it for tests would hide the leak, as a longer timeout would. The fix removes the reads that should not happen.
- **Watches end with their test, not when the deal leaves the funding states.** The unfunded deals in this file stay `AcceptedByAdjudicator` until `fundBy`, minutes after the file ends, so a state rule would not end them.

## Handoff

Done: the fix, the evidence and this file. Not done: nothing in this task.

- **Follow-up, the same pattern:** `examples/buyer-signer.test.ts` (`deliverWhenHeld`, line 55) and `examples/signer-world-kit.ts` (line 44) also start a seller watch per offer that runs until the file ends. Neither has failed in CI yet. Same fix if either does.
- **Follow-up, read, not run:** the operator's fixed window (`apps/operator/src/server.ts`, `window`) resets only when `now - start >= windowMs`. A world whose clock moves back, as tests do, keeps one window until the future start time passes. Real clocks do not jump back by minutes, so this is a test-world effect.
- **T-507 was reserved for the setup race and is not used:** T-486 had already fixed it.
