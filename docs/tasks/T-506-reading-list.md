# T-506: a reading list kept as a reference for the project

- **Lane:** research
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 2 (process docs and records); no local checks beyond the pull request's own; no review
- **Depends on:** none
- **Paths this task may touch:** `docs/research/2026-11-18-reading-list.md`, `docs/research/README.md` (one row), this file
- **Human gate:** no
- **Status:** review. The pull request is open on branch `t-506-reading-list`
- **Agent/session:** the reading session, 2026-11-18, branch `t-506-reading-list`
- **Roadmap row:** N171

## Intent

On 2026-11-16 Rafa asked for a session that reads books and essays before the next phase of work is planned. On 2026-11-18, while it ran, he asked that the list of works be saved in this repository as a reference for the project. This task adds that list: each work, whether the session read it or recalled it, where it is freely readable, and which of Crow's principles it bears on.

Non-goals: the session's notes on what the reading suggests for Crow's plans. They are planning material and stay private (`docs/private-materials.md`).

## Context

- `docs/research/README.md`: the index of research files.
- `docs/writing.md`: dated records keep their numbers and addresses.

## Acceptance criteria

- [x] `docs/research/2026-11-18-reading-list.md` lists every work with its status (read or recalled), the share read, and an address where one is lawfully free.
- [x] `docs/research/README.md` has a row for the file.
- [x] The file names no customer, partner or plan.

## Out of scope

- Any change to code, a guide, a schema or a decision.

## Evidence

- Measured, 2026-11-18: every address in the list answered when the session fetched it that day, and the share read is the session's own estimate for each work.
- Measured: `node scripts/id-check.mjs --title "docs(research): a reading list kept as a reference (T-506)" --branch t-506-reading-list --body ""` on this branch; the result is in the pull request.
- Not run: `pnpm verify`. Kind 2 has no local checks; CI is the gate.

## Decisions

- The list goes under `docs/research/` as a dated record, with one row in the folder's index.

## Handoff

Done: the list and its index row. Nothing is left to build. To extend the list later, add a new dated file; this one is a record of 2026-11-18.
