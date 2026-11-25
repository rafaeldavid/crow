# T-592: The seller tool does not start after the deadline

- **Lane:** api
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `examples/seller-adapter-core.ts`, `examples/seller-adapter-job-api.test.ts`, `examples/seller-adapter-job-stub.ts`, `site/setup.mjs`, `docs/tasks/T-592-adapter-start-after-deadline.md`
- **Human gate:** no
- **Status:** review
- **Agent/session:** adapter-start-deadline
- **Roadmap row:** N167

## Intent

The seller adapter checks the hold and the deadline before every start. Before this change it checked them only for a start that cannot repeat. A repeatable start that failed (the seller API answered 503) went out again at every poll, with no read of `Held` or `deliverBy`, so the seller's runner could start work after the buyer reclaimed the hold.

## Acceptance criteria

- A repeatable start is not sent after `deliverBy` has passed or the hold is no longer `Held`; the deal closes with the note it already uses for the one-shot start.
- A repeatable start is still retried while the hold is `Held` and `deliverBy` is ahead.
- No other behaviour changes.

## Evidence

- Measured: with the new test and the old code, the first test failed (the stub made a run after `deliverBy`); with the fix both pass, and the 8 `seller-adapter*` test files pass (141 tests).
- Measured: `node site/build.mjs` leaves `site/buy.mjs` and `site/try.mjs` unchanged and rebuilds `site/setup.mjs`, which bundles the adapter core.

## Handoff

Deploying the new `site/setup.mjs` is Rafa's gate. The change is deliberate; the bundle's hash changes.
