# T-473: The benchmark's setup scenarios, and the count of requests before the first deal

- **Lane:** test (the benchmark harness, `tools/one-click/`)
- **Phase:** 2
- **Depends on:** T-471 (the design). To start: nothing. To unblock its two scenarios: T-472 (the seller's setup) and T-475 (the buyer's).
- **Paths this task may touch:** `tools/one-click/scenarios.mjs`, `tools/one-click/scripted/` (new scripts), `tools/one-click/bench.mjs`, `bench-local.mjs`, `bench-live.mjs`, `bench-record.mjs`, `probes.mjs`, `tools/one-click/README.md`, `scripts/metrics/schemas/one-click.schema.json`, `scripts/metrics/schemas/one-click-summary.schema.json`, `scripts/metrics/one-click-summary.mjs`, `tests/metrics/`, this file. Nothing under `examples/`, `site/` or `apps/`.
- **Human gate:** yes, for the live runs only: they spend a model key, so Rafa starts them (`tools/one-click/README.md`). The merge has no gate.
- **Status:** todo
- **Agent/session:** not started; can run in parallel with T-472
- **Roadmap row:** N160
- **Change kind:** 4 (tool code and its tests). Local checks: `pnpm exec vitest run tests/metrics`.
- **Review:** one `reviewer` pass. No red team: the harness's fence and key handling do not change. If the task must widen the sandbox's hosts or the environment filter, it stops and says so in Handoff.
- **Token budget:** 150,000 tokens, a target.

## Intent

Restate this in your own words before writing code.

Row N160 is done only when setting up is measured: approvals, minutes and tokens from one sentence to a first settled test deal, as a seller and as a buyer, and proof that nothing went to Crow before the first deal. Today no scenario sets a party up, and the harness records calls by host without their order.

This task adds two scenarios and one count:

- **s7, set up as a seller.** The goal sentence names `https://crow.direct/setup.txt`, a job API the harness serves on the loopback address, and a price. It ends `Released` with Crow's test buyer.
- **s8, set up as a buyer.** The goal names `setup.txt` and two limits. It ends `Released` with Crow's test seller.
- **Requests before the first deal.** For each run: every request made before the first one that carries the party's address, by host, split into reads of public files and requests that name the party.

Non-goals: the setup command itself; the live runs; Crow Control's reader of the records (the private repository; the coordinator's); a scenario for a deploy on a party's own account, which the harness's network fence cannot hold.

## Context

- The design: `docs/research/2026-11-15-setup-design.md`, "The measure", with the targets.
- How a scenario is added: `tools/one-click/README.md`, "Add a scenario".
- What the harness cannot see today: `docs/research/2026-11-15-setup-baseline.md`, "The benchmark's numbers".
- The job API of another shape: `examples/seller-adapter-job-stub.ts` (read, not changed).

## Acceptance criteria

- [ ] `scenarios.mjs` has `s7` and `s8`, each with a goal that carries every answer a person would give (the price; the two limits), because the harness answers every question "yes".
- [ ] Until the setup command exists, each new scenario is `blockedBy` its task and still writes a valid record. When T-472 lands, s7's scripted agent runs the setup command in the in-process world and ends `Released`; the same for s8 when T-475 lands. This task's pull request may land before either, with the scenarios blocked.
- [ ] For a live s7 run the harness serves a job API on the loopback address inside the run's fence, priced in the settlement layer's token, and names its address in the goal. No host is added to the sandbox's allow-list.
- [ ] The record gains `setup.requestsBeforeFirstDeal`: by host, the count of GETs of public files and the count of requests that carry an address the agent made. The record's schema version moves, and the summary reads both versions.
- [ ] The summary reports s7 and s8 apart from the six deal scenarios, so the headline of approvals per deal does not move when they are added.
- [ ] `tests/metrics` covers: a scripted record with the new field; a run whose setup step calls the faucet before the first deal, which the count shows as 1; the summary with and without the new scenarios.
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

Not started. The first question to settle is where "the first deal" starts in a run's call log: the design proposes the first request that carries an address the agent made. If the probes cannot tell an address the agent made from any other, write the rule you used here.
