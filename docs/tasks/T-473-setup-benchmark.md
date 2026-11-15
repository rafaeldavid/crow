# T-473: The benchmark's setup scenarios, and the count of requests before the first deal

- **Lane:** test (the benchmark harness, `tools/one-click/`)
- **Phase:** 2
- **Depends on:** T-471 (the design). To start: nothing. To unblock its two scenarios: T-483 (a seller's own API) and T-475 (the buyer's setup).
- **Paths this task may touch:** `tools/one-click/scenarios.mjs`, `tools/one-click/scripted/` (new scripts), `tools/one-click/bench.mjs`, `bench-local.mjs`, `bench-live.mjs`, `bench-record.mjs`, `probes.mjs`, `tools/one-click/README.md`, `scripts/metrics/schemas/one-click.schema.json`, `scripts/metrics/schemas/one-click-summary.schema.json`, `scripts/metrics/one-click-summary.mjs`, `tests/metrics/`, this file. Nothing under `examples/`, `site/` or `apps/`.
- **Human gate:** yes, for the live runs only: they spend a model key, so Rafa starts them (`tools/one-click/README.md`). The merge has no gate.
- **Status:** todo
- **Agent/session:** not started; can run in parallel with T-472
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

- [ ] **Probed first:** whether an agent inside the harness's sandbox can reach a job API on the loopback address. The sandbox's allow-list names no local address. If it cannot without a change to the fence, the task says so in Handoff and s7's live run waits for T-482's machine; the scripted run does not depend on it.
- [ ] `scenarios.mjs` has `s7` and `s8`, each with a goal that carries every answer a person would give (the price and the payout address; the two limits), because the harness answers every question "yes".
- [ ] Until the setup command exists, each new scenario is `blockedBy` its task and still writes a valid record. When T-483 lands, s7's scripted agent runs the setup command in the in-process world and ends `Released`; the same for s8 when T-475 lands. This task's pull request may land before either, with the scenarios blocked.
- [ ] **s7 succeeds only with an outside buyer:** the commitment's buyer is the test buyer's address. A deal the setup command bought itself is recorded as not successful.
- [ ] The record gains `setup.requestsBeforeFirstDeal` (by host, the count of requests that name the party before the marker) and `setup.guideFilesFetched`. A run with no marker records both as unknown, never as 0. The record's schema version moves, and the summary reads both versions.
- [ ] The summary reports s7 and s8 apart from the six deal scenarios, so the headline of approvals per deal does not move when they are added.
- [ ] `tests/metrics` covers: a scripted record with the new fields; a run whose setup step posts to the faucet before the marker, which the count shows as 1; a run with no marker; the summary with and without the new scenarios.
- [ ] `tools/one-click/README.md` lists the two scenarios and the commands for their live runs. Its stale line that the seller scenario of `run.mjs` waits for the test buyer is corrected.

## Out of scope

- A person's own steps (a login, a DNS record, a secret typed at a prompt). The design says how T-477 and T-478 are measured by hand.
- New targets on Crow Control's Steering rows. The coordinator sets them from the design's table once runs exist.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- Metrics:

## Decisions

Choices made inside this task.

## Handoff

Not started. The marker's form is this task's to fix with T-472: one line on the setup command's standard error and one file in its folder is the proposal.
