# T-482: The benchmark on an isolated machine for each simulated party

- **Lane:** test (the benchmark harness, `tools/one-click/`)
- **Phase:** 2
- **Depends on:** T-473 (the setup scenarios and the count of requests before the first deal).
- **Paths this task may touch:** `tools/one-click/` (a remote mode: `bench-remote.mjs`, new; `bench.mjs`, `bench-record.mjs`, `probes.mjs`, `README.md`), `tools/one-click/machine/` (new: the image's build notes and the create and destroy scripts), `scripts/metrics/schemas/one-click.schema.json`, `tests/metrics/`, this file.
- **Human gate:** yes. Creating machines spends money on Rafa's account and uses a token of his; the model key on the machine is his to issue. The session builds and tests the scripts against a stand-in; Rafa starts every real run.
- **Status:** todo
- **Agent/session:** not started; starts after T-473 merges
- **Roadmap row:** N160
- **Change kind:** 4 (tool code and its tests). Local checks: `pnpm exec vitest run tests/metrics`.
- **Review:** one `red-teamer` pass (a model key and a cloud token leave the maintainer's machine) and one `reviewer` pass.
- **Token budget:** 200,000 tokens, a target.

## Intent

Restate this in your own words before writing code.

Rafa, 2026-11-15: the benchmark needs "a truly isolated environment" to simulate sellers and buyers. Today every run is a sandboxed process on the maintainer's Mac: one machine, one public address, one user's files behind a fence. A run there cannot show that two parties are apart, and it shares the faucet's and the test agents' limits by address with every other run.

This task gives each run a machine of its own: created from one small image, driven over SSH, destroyed after. The design recommends DigitalOcean Droplets in a team of their own (`docs/research/2026-11-15-setup-design.md`, "An isolated machine for each simulated party"), and names the two things to measure first.

Non-goals: a second vendor; a hostname with HTTPS for a seller that publishes (T-477's measured run uses a domain Rafa provides); moving the six deal scenarios, which stay on the sandbox until this mode has run the two setup scenarios.

## Context

- The design's seven requirements for a simulated party's machine, and the vendor table.
- The harness: `tools/one-click/README.md`, "What a live run is"; `tools/one-click/bench-live.mjs`.
- What one deal reveals by address: `docs/privacy-baseline.md`.

## Acceptance criteria

- [ ] **The two first measurements, recorded in Evidence before anything else is built** (Rafa runs them): the seconds from the create call to a working SSH session on a Droplet made from the image; and whether the benchmark team's token can list or change a Droplet of another team. If the token reaches another team's machines, the task stops and says so in Handoff.
- [ ] One command makes a machine from the image, runs one scenario on it and destroys it, whatever the run's outcome. A run that is killed leaves a machine that the next start finds and destroys.
- [ ] **Nothing of Crow's is readable by the assistant on the machine.** The assistant runs as its own user with an empty folder. The harness's driver and probes live under another user. A test on a stand-in machine tries to read them as the assistant's user and fails.
- [ ] The image holds Node, the assistant's command-line tool and nothing else of Crow's: no repository, document or credential. Its build notes are in `tools/one-click/machine/`.
- [ ] **The model key** reaches the machine for one run only, is a key issued for the benchmark with a spending cap, and is in no record, log or image. The cloud token never reaches the machine.
- [ ] The record names the mode (`remote`), the machine's public address family and region, and the seconds the machine took to be ready. It does not record the address itself.
- [ ] The count of requests before the first deal (T-473) works in this mode: the probes run on the machine.
- [ ] Two runs at the same time get two addresses, and the faucet's per-client limit counts them apart. Evidence shows it from the two records.
- [ ] `tools/one-click/README.md` says how to run a scenario in this mode, what it costs, and what to do when a machine is left behind.
- [ ] The red-team pass covers: the model key or the cloud token in a log, a record, the image or a process list; a machine left running; an assistant that reads the driver.

## Out of scope

- An address check by a third service. The record states what the cloud's API reports.
- A fleet. One machine per run, one or two runs at a time.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- The two first measurements:
- Commands run and results:

## Decisions

Choices made inside this task.

## Handoff

Not started. It needs from Rafa: a DigitalOcean team for the benchmark with its own token, and a spend-capped model key for the runs.
