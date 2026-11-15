# T-473: The benchmark's setup scenarios, and the count of requests before the first deal

- **Lane:** test (the benchmark harness, `tools/one-click/`)
- **Phase:** 2
- **Depends on:** T-471 (the design). To start: nothing. To unblock its two scenarios: T-483 (a seller's own API) and T-475 (the buyer's setup).
- **Paths this task may touch:** `tools/one-click/scenarios.mjs`, `tools/one-click/scripted/` (new scripts), `tools/one-click/bench.mjs`, `bench-local.mjs`, `bench-live.mjs`, `bench-record.mjs`, `probes.mjs`, `tools/one-click/README.md`, `scripts/metrics/schemas/one-click.schema.json`, `scripts/metrics/schemas/one-click-summary.schema.json`, `scripts/metrics/one-click-summary.mjs`, `tests/metrics/`, this file. Nothing under `examples/`, `site/` or `apps/`.
- **Human gate:** yes, for the live runs only: they spend a model key, so Rafa starts them (`tools/one-click/README.md`). The merge has no gate.
- **Status:** in progress
- **Agent/session:** a sub-session of the coordinator, 2026-11-15, branch `t-473-setup-benchmark`
- **Roadmap row:** N160
- **Change kind:** 4 is the nearest recipe (tool code and its tests). Local checks: `pnpm exec vitest run tests/metrics`.
- **Review:** one `reviewer` pass. No red team: the harness's fence and key handling do not change. If the task must widen the sandbox's hosts or the environment filter, it stops and says so in Handoff.
- **Token budget:** 150,000 tokens, a target.

## Intent

Restate this in your own words before writing code.

Row N160 is done only when setting up is measured: approvals, minutes and tokens from one sentence to a first settled test deal, as a seller and as a buyer, and proof that nothing went to Crow before the first deal. Today no scenario sets a party up, and the harness records calls by host without their order.

This task adds two scenarios and two counts:

- **s7, set up as a seller.** The goal sentence names `https://crow.direct/setup.txt`, a job API the harness serves on the loopback address, a price and a payout address. It ends `Released` with Crow's test buyer as the buyer.
- **s8, set up as a buyer.** The goal names `setup.txt` and two limits. It ends `Released` with Crow's test seller.
- **Requests before the first deal.** The first deal starts when the setup's `first-deal` command starts; that command writes a marker the harness reads. Before the marker, the record counts, by host, the requests that name the party: any request to a Crow-run host that is not a GET, and any request whose path holds an address. The probes record method, host, path and status and no body (`tools/one-click/probes.mjs`), so the rule needs none.
- **Guide files fetched:** the count of GETs of crow.direct's text files, from the same call log.

Non-goals: the setup command itself; the live runs; Crow Control's reader of the records (the private repository; the coordinator's); a run on a machine of its own (T-482).

## Context

- The design: `docs/research/2026-11-15-setup-design.md`, "The measure", with the targets.
- How a scenario is added: `tools/one-click/README.md`, "Add a scenario".
- What the harness cannot see today: `docs/research/2026-11-15-setup-baseline.md`, "The benchmark's numbers".
- The job API of another shape: `examples/seller-adapter-job-stub.ts` (read, not changed).

## Acceptance criteria

- [x] **Probed first:** whether an agent inside the harness's sandbox can reach a job API on the loopback address. The sandbox's allow-list names no local address. If it cannot without a change to the fence, the task says so in Handoff and s7's live run waits for T-482's machine; the scripted run does not depend on it.
- [x] `scenarios.mjs` has `s7` and `s8`, each with a goal that carries every answer a person would give (the price and the payout address; the two limits), because the harness answers every question "yes".
- [x] Until the setup command exists, each new scenario is `blockedBy` its task and still writes a valid record. When T-483 lands, s7's scripted agent runs the setup command in the in-process world and ends `Released`; the same for s8 when T-475 lands. This task's pull request may land before either, with the scenarios blocked.
- [x] **s7 succeeds only with an outside buyer:** the commitment's buyer is the test buyer's address. A deal the setup command bought itself is recorded as not successful.
- [x] The record gains `setup.requestsBeforeFirstDeal` (by host, the count of requests that name the party before the marker) and `setup.guideFilesFetched`. A run with no marker records both as unknown, never as 0. The record's schema version moves, and the summary reads both versions.
- [x] The summary reports s7 and s8 apart from the six deal scenarios, so the headline of approvals per deal does not move when they are added.
- [x] `tests/metrics` covers: a scripted record with the new fields; a run whose setup step posts to the faucet before the marker, which the count shows as 1; a run with no marker; the summary with and without the new scenarios.
- [x] `tools/one-click/README.md` lists the two scenarios and the commands for their live runs. Its stale line that the seller scenario of `run.mjs` waits for the test buyer is corrected.

## Out of scope

- A person's own steps (a login, a DNS record, a secret typed at a prompt). The design says how T-477 and T-478 are measured by hand.
- New targets on Crow Control's Steering rows. The coordinator sets them from the design's table once runs exist.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
  - `pnpm exec vitest run tests/metrics`: 234 passed, 17 skipped, 14 files, in 10 s [measured, 2026-11-15]. The new file `tests/metrics/one-click-setup.test.ts` has 31 tests.
  - `node tools/one-click/bench.mjs --scenario all`: eight valid records. s1, s3, s4 and s6 settle; s2 and s5 blocked on N70; s7 blocked on T-483, s8 on T-475, each with `setup` reading `markerSeen: false` and both counts `null` [measured].
  - `pnpm exec eslint tools/one-click scripts/metrics tests/metrics` and `pnpm typecheck`: clean [measured].
  - The rehearsal of s7's scripted path (`tests/metrics/fixtures/setup-rehearsal.ts` through `playScripted`): a faucet post before the marker counts 1, on the in-process operator's origin; without it, 0; both end `Released` with the test buyer as the buyer [measured]. It found one bug before merge: the operator serves `/terms` as the terms object itself, so the buyer is its top-level `buyer`.
- **The probe** (criterion 1). The pinned Claude Code (`@anthropic-ai/claude-agent-sdk` 0.3.318) writes a macOS sandbox profile that allows outbound connections to `localhost:*` only when `allowLocalBinding` is set; otherwise only to its own proxy's ports [inferred: read from the profile builder in the pinned binary]. `bench-live.mjs` sets no `allowLocalBinding`, and its domain allow-list names no local address [measured, the file]. Rehearsed with `sandbox-exec` against a server on 127.0.0.1:48731: under a profile that allows only another localhost port, `curl` fails to connect (exit 7); under the `localhost:*` rule, it answers [measured]. So an agent in the harness's sandbox cannot reach a job API on the loopback address without a wider fence, and `allowLocalBinding` would open every local port, in and out. The fence is unchanged; s7's live run waits for T-482.
- Metrics: no live run; none was in scope. The setup numbers in the summary read `missing` until Rafa's first runs.

## Decisions

- **The marker** (fixed here, for T-472): when `first-deal` starts, before it sends anything, it prints `crow-setup: first-deal started <ms since the epoch>` on standard error and writes the same line to `first-deal.started` in its folder. The harness takes the earliest marker inside the run's own time: from the script's standard error in a scripted run; from the agent's command output (the time only) and from that file anywhere under the run's two folders in a live run. A time outside the run is ignored.
- **The request rule's edges.** A call with no time counts as before the marker, and curl's time is to the second, so the count can read high, never low. A Crow-run host is crow.direct and its subdomains, and escrow.stream; in the in-process world, the world's own operator and test-agent origins, so the party's own job API on 127.0.0.1 is not one. An address is `0x` and 40 hex digits not inside a longer hex run, so a commitment ID is not one.
- **Guide files** count over the whole run, as the design's "13 for a seller with its own API" does; they read unknown with no marker, as the criterion asks.
- **The record's version** moves to 3 by sharing one `Bench` definition between versions 2 and 3; version 2 records stay valid and refuse a `setup` block or s7 and s8.
- **The summary's version stays 1:** `setup` is an optional field, as `sandboxAuto` was in T-441. The headline and `byScenario` take the six deal scenarios only; `setup` holds s7 and s8, each with the four numbers in both permission modes and the medians of the two counts over the runs that saw a marker. The headline's rule (one median over every deal scenario) is unchanged.
- **The goals.** s7: a job API at `{jobApi}`, 20 tUSDC (under the test buyer's 50 tUSDC limit), and `{payout}`, a fresh random 20-byte address per run whose key no one holds. s8: 40 tUSDC per deal and 100 tUSDC per day, above the test seller's 25 tUSDC dataset. A live run whose goal still names a placeholder the harness cannot serve stops before it sends anything.
- **s7's buyer check** applies to s7 only. s3 and s6 could take it too (follow-up below).
- **The scripted world's part of a run** moved from `bench.mjs` to `bench-local.mjs` (`playScripted`), so the tests drive the same path.

## Handoff

**State: built; s7 and s8 are blocked, as this task allows.** What waits, and how each blocker's session switches it on:

- **T-472 (the setup command):** print and write the marker as in Decisions. With the sandbox, a live agent can write only in the run's two folders, so the setup folder must be one the person names inside the working folder, or the default `~/.crow/<name>` fails in a live run (inferred from `bench-live.mjs`'s write list).
- **T-483 (a seller's own API) switches s7's scripted run on:** add a script under `tools/one-click/scripted/` that runs the setup command against `CROW_BENCH_JOB_API` (key in `CROW_BENCH_JOB_API_KEY`, payout in `CROW_BENCH_PAYOUT`; or `{jobApi}` and `{payout}` in its arguments), prints the command's standard error, and ends with `done      commitment <id> Released`. Then set s7's `scripted` to `{ script, args, needs: 'buyer', jobApi: true }`. `tests/metrics/one-click-bench.test.ts` then expects s7 to complete: change its runnable list and drop s7 from the blocked list. Open question for T-483: how a live run gives the job API's credential, since the design keeps secrets out of the chat and `secret` is a person's step.
- **T-475 (the buyer's setup) switches s8 on:** the same, with `needs: 'seller'`, and remove s8's `live.blockedBy`. s8's live run can then run on this Mac.
- **T-482 (a machine of its own) switches s7's live run on:** serve the job API beside the agent on that machine, fill `{jobApi}` there, and remove s7's `live.blockedBy`. Until then `bench.mjs --scenario s7 --live` exits 2 and sends nothing.
- **For Rafa, the first live runs** (once unblocked): the commands are in `tools/one-click/README.md`, "The two setup scenarios"; the same spend-capped `HOLDBACK_AGENT_ANTHROPIC_API_KEY` as the deal scenarios, one run at a time.
- **For the coordinator, Crow Control's reader** (the private repository, out of this task's scope): read records of `crow.metrics.one-click/3` beside `/2`, the scenario IDs s7 and s8, the record's `setup` block, and the summary's optional `setup` field.

**Follow-ups, not built:**

- s3 and s6 sell to the test buyer too, and could take s7's buyer check, so a deal a script bought from itself never counts there either.
- `run.mjs`'s own message still says the seller scenario waits for T-222; the README now says it runs. `run.mjs` is outside this task's paths.
