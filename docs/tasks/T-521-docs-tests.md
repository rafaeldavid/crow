# T-521: docs pull requests run the five tests that read docs

- **Lane:** infra
- **Phase:** 2
- **Kind:** CI and repository settings (`.github/`), on Rafa's word of 2026-11-18 ("OK", in the coordinator's thread)
- **Depends on:** T-504 (PRs 625 and 628, which edit the same changes job)
- **Paths this task may touch:** `.github/workflows/ci.yml`; the stale lines of `docs/research/2026-11-18-ci-review.md` and `docs/tasks/T-504-ci-review.md`; this file
- **Human gate:** yes, given: Rafa's "OK" covers this one workflow change
- **Status:** done with the merge of this task's pull request
- **Agent/session:** the CI review session (T-504)
- **Roadmap row:** N173

## Intent

A docs-only pull request skips the test shards, but five test files read docs:
- `tests/cut-feature-alignment.test.ts` scans every tracked file;
- `tests/decisions-status.test.ts` reads the decisions' status lines;
- `tests/design-map.test.ts` reads the standing docs;
- `tests/id-check.test.ts` reads the task files;
- `tests/site-guides.test.ts` reads the guides.

A docs change that breaks one of them merges green and fails on main. This task runs those five files, and nothing heavier, on a docs-only pull request, and `check` requires them there.

## What changed

- `ci.yml` gains a job, `docs tests`, that runs when the changes job finds a docs-only pull request (`code == 'false'`). It checks out the repository, installs (`pnpm install --frozen-lockfile`, with the pnpm store cached) and runs `pnpm vitest run` on the five files. There is no build: the five import only from `scripts/` and `site/`. Every action is pinned to the same commits the other jobs use.
- `check` needs the new job. On a docs-only pull request it now passes only when the docs tests passed.
- A push to main is unchanged: since T-504 (PR 628), a docs-only push keeps the static job and the test shards, which run these five files and the rest.
- The CI review report and the T-504 task file stop listing the five merged pull requests as waiting on Rafa.

## Evidence

- `pnpm vitest run` on the five files plus `tests/ci-gated.test.ts` and `tests/metrics/ci-runs.test.ts`, with no build: 245 tests passed (measured, local).
- The docs-only run: this task's docs commit went through its own pull request into the T-521 branch, a docs-only change running the new workflow. Its run, the five tests and its wall time are in the pull request's description.

## Handoff

Nothing left. If another test comes to read docs, add it to the job's file list. Leave out any test that needs a build, or the job stops being light.
