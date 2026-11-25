# T-587: Docs and dependency clean-up

- **Lane:** infra
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `docs/` (never a record file's content), `README.md`, `CONTRIBUTING.md`, `SECURITY.md`; `site/` only to fix a link to a file this task moves; tests only to follow a moved file
- **Human gate:** no
- **Status:** review
- **Agent/session:** a side session, 2026-11-25
- **Roadmap row:** N173

## What exists

- `docs/private-materials.md` lists what moved to the private repository, and says dated records stay as written.
- `tests/cut-feature-alignment.test.ts` reads every tracked file and lists which folders are history.
- `.github/workflows/ci.yml` has a `docs tests` job that runs five test files on a docs-only pull request (T-521).
- The N173 CI review of 2026-11-24 (kept privately) found more tests that read `docs/` than that job runs.

No page or script classifies the docs today.

## Intent

Say which docs describe the system now, which are dated records, and which are stale, orphaned or duplicated. List every test, script and build step that reads a doc, with the CI job that runs it. Then change only what is safe without a CI edit: archive orphaned docs under `docs/archive/` and fix links and statements that point at removed or renamed things.

Non-goals: no change under `.github/`, `.claude/` or to `CLAUDE.md`; no edit to a record's content; nothing about the `/demo/` and learn-more site pages, which another session retires; no deploy and no merge.

Output: this change, and a report in the private repository with the classification table, the dependency table and a plan in three batches (safe now, needs a CI edit, decisions for Rafa).

## Context

- `docs/writing.md`; `docs/team.md`, Change recipes (kinds 2 and 11).

## Acceptance criteria

- [ ] Every file under `docs/` and the three root docs has a class.
- [ ] Every test, script and build step that reads a doc is listed with the CI job that runs it.
- [ ] No record file's content changes.
- [ ] A test that reads a moved file is updated in the same commit, or the file stays.
- [ ] Typecheck, lint, tests, the site build and check, and the docs tests pass.

## Out of scope

- The CI edit itself (Rafa's).

## Evidence

On the branch, over `main` at `10f1e638`, 2026-11-25:

- **Passed [measured]:** `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `node site/build.mjs && node site/check.mjs` (the build left no change in `site/`), and one run of the 18 test files that read docs (489 tests passed, 2 skipped).
- **Full `pnpm test` [measured]:** 5445 passed, 11 failed, 288 skipped, on a Mac whose load average read 206 on 8 cores just after the run, with other sessions working. The failures were in `examples/seller-invoice.test.ts` (9), `examples/e2e-chain.test.ts` (1) and `packages/judgment/src/preflight.test.ts` (1). Run again on their own, the first two files passed. `preflight` passed its other tests and timed out at 30 s in one, and did the same on unchanged `main` at a load of 301. The change touches no code or test file. That machine load is the cause is inferred. CI is the gate.
- **No test reads the moved file [measured by `git grep`].**
- **No broken relative Markdown link or heading anchor** outside task files and records, before and after [measured by script].

## Decisions

- **One file archived,** `docs/feature-map.md`: no live page led to it, and it repeated the scenario index in `docs/plan.md`. One proposed check in `docs/team.md` named it.
- **Edited only statements the code or the repository contradicts:** commands, CI jobs, fixture names, formats and behaviour that a later change replaced. Statements where the code may be the thing to change, such as defenses the judging doc lists and the code lacks, stay as written and go to Rafa.
- **No record edited.** The research index (`docs/research/README.md`) is a live index, not a record; it gained the four notes it lacked.

## Handoff

- **Done:** batch (a), the safe fixes.
- **Not done:** batch (b), the CI edit that runs every doc-reading test on a docs-only pull request (Rafa's, under `.github/`), and batch (c), the decisions for Rafa. Both are in the private report `roadmap/triage/2026-11-25-docs-cleanup.md`, with the classification and dependency tables.
- **Found in passing:** `site/check.mjs` checks the trust page's repository links with a pattern that names the old repository, so it matches no link. All links resolve today [measured]. The fix is in `site/`, which this task may not change.
- **Left to another session:** everything about the `/demo/` and learn-more pages, including the sentence in `docs/demo.md` that names the demo page.
- **Resume:** read the report's three batches.
