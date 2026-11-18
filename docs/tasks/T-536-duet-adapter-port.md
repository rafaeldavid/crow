# T-536: the duet runner gives the seller adapter a port no other socket can take

- **Lane:** test
- **Phase:** 2
- **Kind:** 4 by its checks (`docs/team.md`, Change recipes): the package's own tests, `pnpm exec vitest run tools/duet`; no review
- **Depends on:** T-391 (the duet harness)
- **Paths this task may touch:** `tools/duet/run.ts`, `tools/duet/duet.test.ts`, this file
- **Human gate:** no
- **Status:** in review
- **Agent/session:** duet-bad-offer, started by the scan-fixes session on 2026-11-18
- **Roadmap row:** none (a CI defect that blocked PR 652)

## What exists

The scripted duet tests in `tools/duet/duet.test.ts` run four scenarios on a local phase-one world. `runDuet` in `tools/duet/run.ts` picks the seller adapter's port before the run, and the seller agent starts `examples/seller-adapter.ts` on that port. Nothing kept the port free between the pick and the bind.

## Intent

PR 652's CI failed once at `tools/duet/duet.test.ts:45`: in the bad-offer run `decisionRight` was false, after 32,569 ms where the other scenarios took about 9.5 s. Find the cause and remove it, with a test that fails before the fix.

Non-goals: no change to the seller adapter, the scripted agents or the measures.

## Root cause

The runner picked the adapter's port with `listen(0)`, closed it at once, and the adapter bound it seconds later, after the seller agent read the guides and the adapter took its mandate. `listen(0)` returns a port from the operating system's own range, the one it also gives to every other `listen(0)` and to outgoing connections. CI runs test files in parallel, so in that window another socket can get the same port. The adapter then stops with EADDRINUSE. The seller agent's script goes on and publishes its page, the buyer's quote reaches nothing that answers it, the buyer's script turns the offer down without having seen one, and the seller waits out the 30 s grace. The measures read that run as "no offer reached the buyer's approval stop".

## Fix

`pickAdapterPort` draws the port at random below the operating system's range (from 10000 up to the range's first port: 32768 on a default Linux runner, 49152 on macOS) and checks that it binds. The operating system never hands out such a port by itself, so only a socket that names the same number can take it. `ephemeralFirst` reads the range from `/proc/sys/net/ipv4/ip_local_port_range` on Linux and `sysctl net.inet.ip.portrange.first` on macOS, and otherwise assumes 49152. The scenario test's `decisionRight` assertion now prints the summary's `why`, so a failure names its reason in the CI log.

## Acceptance criteria

- [x] A test fails before the fix and passes after it: the adapter's port is below the range the operating system hands out, and it binds.
- [x] A second test checks the range reading against the operating system: 20 `listen(0)` ports are all in it.
- [x] `pnpm exec vitest run tools/duet` passes.

## Evidence

- Measured: CI job 134934300211 (PR 652, run 44342001725, shard 3/4) failed `bad-offer` at line 45 with `expected false to be true`, in 32,569 ms. The job ID in the brief, 134925114781, is shard 4/4 of the commit before, which failed another test (`tests/cut-feature-alignment.test.ts`).
- Measured: with a temporary edit that held the adapter's port with an HTTP server answering 404, one scripted bad-offer run gave `decisionRight` false, why "expected the buyer to see the offer and refuse it; no offer reached the buyer's approval stop", ends `seller: ended (its counterparty finished 30 s earlier)` and `buyer: finished (Turned the offer down)`, in 37,321 ms on this Mac. The adapter's log read `listen EADDRINUSE: address already in use 127.0.0.1:<port>`. The edit was then reverted.
- Measured: 16 concurrent scripted bad-offer runs on this Mac before the fix all passed (about 150 s each). Load alone does not cause the failure; the taken port does.
- Inferred: CI's run took the same path. Its duration matches world start (about 2.5 s) plus the 30 s grace, and no other path in the bad-offer script ends with the buyer finished and no offer seen. The CI log does not keep the run's record, so the EADDRINUSE line itself was not seen there.
- Measured, before the fix: `pnpm exec vitest run tools/duet/duet.test.ts -t T-536`: 1 failed, 1 passed; `expected 55488 to be less than 49152`.
- Measured, after the fix: `pnpm exec vitest run tools/duet`: 2 files, 48 tests passed. `pnpm exec tsc -p tools/duet --noEmit` and `pnpm exec eslint` on both files: clean.

## Handoff

Done when this PR merges. Another socket can still take the port only by binding its exact number in the window, for example a second duet run on the same machine that drew the same random port: about 1 chance in 22,768 per pair of runs at once on Linux [inferred]. If that ever shows, the runner can hold the port open until it starts the adapter.
