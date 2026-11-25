# T-596: The seller tool's deadline test under load

- **Lane:** api
- **Phase:** 2
- **Depends on:** T-592
- **Paths this task may touch:** `examples/seller-adapter-job-api.test.ts`, `docs/tasks/T-596-adapter-deadline-test-under-load.md`
- **Human gate:** no
- **Status:** review
- **Agent/session:** adapter-deadline-flaky
- **Roadmap row:** N167

## Intent

The test "a repeatable start whose API is down is not sent again once deliverBy has passed" failed on CI once and on a local run under load. Make it deterministic, with no timeout raise, skip or retry.

## Cause

The test brought the API back (`startsUp`) right after advancing the clock. A poll pass that had read `Held` and a deadline still ahead before the advance can be sending its start at that moment, and the stub then accepted it. The adapter checks and then sends, so this window exists in any such gate; the fix from T-592 is not wrong (inferred from the code and the failure rate). A fixed 400 ms wait did not cover it.

## Fix

The test keeps the API down until the deal is `closed`, then brings it back and asserts that no start follows and no run exists. It waits on events, not on a delay.

## Evidence

- Measured: 20 concurrent runs of the test, 4 batches before the change: 2 of 80 runs failed with "expected ... length of +0 but got 1". After the change, 4 batches: 0 of 80.
- No code under `examples/seller-adapter-core.ts` changed; no bundle changed.

## Handoff

None.
