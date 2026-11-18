# T-509: measure how many published security reviews pass today's form at first presentation

- **Lane:** research
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 10 (research and decisions); no local checks beyond the pull request's own; review by one reviewer agent, as the brief asked
- **Depends on:** none
- **Paths this task may touch:** `docs/research/2026-11-18-report-corpus.md`, `docs/research/2026-11-18-report-corpus/` (scripts, sources, manifest, results), `docs/research/README.md` (one row), this file
- **Human gate:** no
- **Status:** done with the merge of pull request 635 on 2026-11-18, after CI passed and the review's 6 findings were fixed
- **Agent/session:** the T-509 session, 2026-11-18, branch `t-509-report-corpus`
- **Roadmap row:** N180

## Intent

On 2026-11-18 Rafa chose to pursue a standard form for one kind of work, the security review, and asked first for a measurement: gather 20 or more real review reports from three or more firms, and count how many pass today's checks as published. He added that the product must stay simple, so this task measures and changes no product file. Its numbers decide whether later work, such as a revised form or a way to deliver with named defects, is needed at all.

Non-goals: a new or revised form, a converter in the product, and forms for any other kind of work. Kinds other than the security review get small scouting sets only.

## Context

- `examples/seller-adapter.template.json`: the security-review form and its five checks.
- `examples/check-delivery.ts`: the adjudicator's first stage, run offline.
- `examples/report-converter.ts`: the seller's JSON-to-JSON mapping. Published reports are Markdown or PDF, so this task's converter is its own script.
- An earlier private pass on 2026-11-11 measured eight public reports; the research note says what it answered.

## Acceptance criteria

- [x] 20 or more public security review reports from three or more firms, each with its address, reuse terms, SHA-256, firm and date: 24 reports from 4 firms in `docs/research/2026-11-18-report-corpus/manifest.json`.
- [x] A design set and a held-out set fixed before any report was read; the held-out set holds every report of one firm and has its own file (`heldout.json`).
- [x] A script anyone can rerun (`measure.mjs`) counts the reports that map with no finding lost, those that pass today's checks, and each failing cause, on both sets; it says how each report is converted and counts what the conversion lost.
- [x] Scouting sets for robot training data, robot task execution, non-official legal review and product review, and one source for each other kind on the target list, with what a delivery looks like and what a check could test, and no form.
- [x] Half a page on what the numbers say.
- [x] No report text and no private name in the public repository.

## Out of scope

- Any change to `examples/`, `spec/`, `contracts/`, a template or a check.
- The design partner's own reports, which the private repository covers.

## Evidence

- Measured, 2026-11-18: `node docs/research/2026-11-18-report-corpus/fetch.mjs /Users/rafa/Documents/escrow/reports/scratch/corpus/security` fetched the 24 files at their pinned commits and wrote `manifest.json`.
- Measured, 2026-11-18: `node docs/research/2026-11-18-report-corpus/measure.mjs /Users/rafa/Documents/escrow/reports/scratch/corpus/security /Users/rafa/Documents/escrow/reports/scratch/corpus/converted`, on this branch after `pnpm install --frozen-lockfile && pnpm build`, Node 22.22.2. It wrote `results.json`.
- Design set (18 reports, 182 findings), measured: 5 map with no finding lost; 1 of those passes the default terms and 1 passes with no proof term; with four check-level limits lifted, 12 of 18 accept.
- Held-out set (6 reports), measured: 0 map and 0 pass, because the converter's rules recognise no finding in that firm's layout.
- Not run: `pnpm verify`. Kind 10 has no local checks; CI is the gate.

## Decisions

- The corpus is chosen by a fixed rule (each firm's six newest reports in its own public repository), so no report was picked for how it would score.
- The converter changes no word and never asks a model. A step only a model could do, such as cutting a recommendation out of a description, leaves the finding unmapped and is counted as its own cause.
- The deal's terms use the report's own commit and files, so a report is tested against the scope it claims.

## Handoff

Done: the corpus, the split, the script, the measurement on both sets, the scouting sets and the note `docs/research/2026-11-18-report-corpus.md`.

Next, for Rafa: decide whether to revise the finding object as one change (the note's "What the numbers say"). A later task that changes the form or the converter reruns `measure.mjs` and reports both sets; it must not read the held-out reports or tune on them. The copies stay in `reports/scratch/corpus/` on the maintainer's machine; `fetch.mjs` rebuilds them anywhere.
