# T-504: CI review against measured runs

- **Lane:** infra
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `scripts/metrics/ci-runs.mjs`, `tests/metrics/ci-runs.test.ts`, `tests/ci-gated.test.ts`, `examples/signer-anvil.test.ts` (its header comment), `docs/research/2026-11-18-ci-review.md`, this file; `.github/workflows/ci.yml` for the one approved line only. Every other workflow change opens as its own pull request, unmerged, for Rafa.
- **Human gate:** yes for workflow changes beyond the three Rafa approved on 2026-11-17; no for the rest
- **Status:** done (the report's pull request); the proposals are Rafa's
- **Agent/session:** the CI review session started by the coordinator on 2026-11-18
- **Roadmap row:** N173

## Intent

Measure what a change waits for and spends in CI, by kind of change, with a script anyone can rerun. Judge the seven practices of the OpenClaw CI report against those numbers. Land the changes that pay and need no further word. Open the other workflow changes as unmerged pull requests, each with its saving and its risk, for Rafa.

Inputs: GitHub's records of the runs, jobs and pull requests of `rafaeldavid/holdback` (read only). Outputs: `scripts/metrics/ci-runs.mjs` with its test, the report `docs/research/2026-11-18-ci-review.md`, and the approved CI line below.

Non-goals: no change to the required checks (`check`, `gitleaks`, `id-check`), the rulesets or repository settings; no dropped invariant, money, contract or settlement suite; no rerun of a failing check before its cause is found.

## Context

- Rafa approved three CI changes on 2026-11-17. The third is this task's first pull request: `examples/signer-anvil.test.ts` (T-439's token-level attacks on the signer) joins the anvil job's `world` leg, and its exemption in `tests/ci-gated.test.ts` goes. The other two are crow-private's (T-505).
- Related rows: T-256 (the CI wait), N32 (merge on green, fewer required checks), N145 (the secret scan's range, skipped anvil tests), N50 (dependency update pull requests with a release-age wait).

## Acceptance criteria

- [ ] The anvil job's `world` leg runs `examples/signer-anvil.test.ts`, and `tests/ci-gated.test.ts` no longer exempts it; the leg passes with no skipped test.
- [ ] `node scripts/metrics/ci-runs.mjs` prints the baseline tables from GitHub's records; `tests/metrics/ci-runs.test.ts` checks every number on a fixture and that its patterns match `ci.yml`'s changes job.
- [ ] The report judges each of the seven practices with file and line, the smallest change, the expected saving from the baseline, the risk and whether it needs a workflow change.
- [ ] Each workflow change beyond the approved line is its own unmerged pull request, listed in the report for Rafa.

## Out of scope

- Repository settings, rulesets, required checks and CodeQL's default setup: proposals only.
- `apps/hosted-sellers`, `examples/seller-adapter-core.ts`, `examples/seller-adapter-api.ts`, `packages/`, `contracts/src/`: the first pilot is live on them.

## Evidence

- **The signer's line (measured):** [PR 623](https://github.com/rafaeldavid/holdback/pull/623), merged 2026-11-18 06:51 UTC after every check passed. Its `world` leg ran `examples/signer-anvil.test.ts` (6.4 s, 9 of 9 files passed, none skipped). The leg took 5 min 57 s, against a median of 6 min 03 s over 114 runs before. `pnpm vitest run tests/ci-gated.test.ts`: 2 passed.
- **The script (measured):** `scripts/metrics/ci-runs.mjs` read 3,547 runs and their jobs (30 days) and 622 pull requests from GitHub. `tests/metrics/ci-runs.test.ts`: 10 passed, on a fixture worked by hand. It also checks that the script's two patterns are the ones in `ci.yml`'s changes job.
- **The report:** `docs/research/2026-11-18-ci-review.md`, with the baseline, the seven practices judged, the changes and the list for Rafa.
- **Proposals for Rafa, unmerged (measured what-ifs):** [625](https://github.com/rafaeldavid/holdback/pull/625) (the model check and forge test on their inputs), [626](https://github.com/rafaeldavid/holdback/pull/626) (cancel overtaken runs), [628](https://github.com/rafaeldavid/holdback/pull/628) (docs-only pushes), [629](https://github.com/rafaeldavid/holdback/pull/629) (compile cache on push), [630](https://github.com/rafaeldavid/holdback/pull/630) (Dependabot's 14-day wait).
- **Crow-private (T-505):** [crow-private 94](https://github.com/rafaeldavid/crow-private/pull/94).

## Decisions

1. The signer's test joins the `world` leg, not a new leg: the leg already starts anvil worlds from `examples/e2e-world.ts`, and a new leg would repeat about 2 minutes of setup (checkout, submodules, Foundry, install, build).

2. The baseline uses the window since `ci.yml` last changed its jobs (2026-11-14 10:40 UTC, T-410). The 30 days mix three earlier layouts, such as the combined contracts-and-anvil job, which would describe a CI that no longer exists.
3. A what-if ends a run when its last remaining job ends. It leaves out the shorter queues, so each saving is a floor.
4. Each workflow proposal is its own pull request on main, so Rafa can take any one alone. PRs 625 and 628 both edit the changes job, so the second to merge needs a rebase.

## Handoff

- **Done:** the signer's line (merged), the script and the report (this pull request), five workflow proposals (open, unmerged), crow-private's T-505.
- **Waiting on Rafa:** PRs 625, 626, 628, 629 and 630; CodeQL's default setup (a setting); PR 616 on or after 2026-11-28.
- **Follow-up, not started:** three flaky example tests went green only on a rerun between 2026-11-14 and 2026-11-16: `examples/signer.test.ts` (A7, a clock shift), `examples/setup-bundle.test.ts` (eight concurrent runs) and `examples/buyer-signer-addresses.test.ts` (a refund to the payment address). Each needs its root cause found.
- **To measure again:** run the report's command with a later `--since`. After a proposal merges, the same window shows its effect.
- **Out of date by one:** `docs/team.md`'s Rules and checks row for `tests/ci-gated.test.ts` counts the exempt files; this task removed one, and the row is another lane's doc.
