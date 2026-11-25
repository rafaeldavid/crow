# T-585: ADR for the `signature_valid` check kind

- **Lane:** research
- **Kind:** 10, research and decisions (`docs/team.md`, Change recipes)
- **Depends on:** T-582 (the research note)
- **Paths this task may touch:** `docs/decisions/ADR-0045-signature-valid-check.md`, `docs/decisions-today.md` (D90 only), this file
- **Human gate:** no
- **Status:** review
- **Agent/session:** n225-adr, 2026-11-25
- **Roadmap row:** N225

## What exists

- Nine deterministic check kinds, each built-in code in `packages/judgment/src/checks/index.ts`. None verifies a signature (`site/ref/checks.txt`, "Writing checks for a robot episode").
- The research note `docs/research/2026-11-24-delivery-proofs.md` recommends four new kinds, `signature_valid` first, and sketches its parameters. It leaves the key's place, the canonical form and discovery open for the ADR.
- No ADR decides the kind. This task writes it.

## Intent

Decide, in one ADR, everything the build of `signature_valid` needs: its parameters, the signed bytes' form, the verification steps, failures, limits, the library, the vectors, the schema bump, how a party learns which kinds an adjudicator runs, the neutrality default, and what the two-part release (N226) reuses. Design and documentation only.

## Acceptance criteria

- [x] ADR-0045 decides each point above, with rejected alternatives and the tests the build must add.
- [x] D90 records it in `docs/decisions-today.md` as proposed, waiting for Rafa.
- [x] No file under `spec/schemas/` and no code changes.
- [x] No partner or customer name is in a public file.
- [x] Every claim carries a label.

## Out of scope

- The schema file, the evaluator, the vectors and the reference page: the build task.
- The other three kinds' parameters (`passes_through`, `monotonic_column`, `equal_lengths`).
- The proof field on the delivery (N226).

## Evidence

- **Docs tests** [measured, 2026-11-25]: the five files of CI's `docs tests` job passed, 5 files and 297 tests: `pnpm vitest run tests/cut-feature-alignment.test.ts tests/decisions-status.test.ts tests/design-map.test.ts tests/id-check.test.ts tests/site-guides.test.ts`.
- **Names** [measured]: a whole-word scan of the three changed files against the private deny list found 0 terms.
- **Not run:** no signature was checked and no library call was made. Claims about the key encodings, the library's options and Project Wycheproof are recalled and labelled so in the ADR.

## Decisions

- **Exact bytes, not RFC 8785.** The worked example's signer prints decimals as Python does, which no ECMAScript canonicaliser reproduces (ADR-0022).
- **`message.jsonEquals` is added to the research note's sketch,** so the existing `json_schema` checks read signed fields. It is an open question for Rafa.
- **`checkKinds` sits on the adjudicator's record beside `policy`,** so `policyHash` does not move.
- **The status line in D90 reads "needs Rafa".** The decisions' status test allows no "proposed" state; the entry's text says proposed.

## Handoff

- **Done:** ADR-0045, D90, this file. Pull request open; not merged.
- **Not done:** the build. It needs a task of its own (kinds 5 and 6): schema v0.13, the evaluator, the vectors, the fixtures, `site/ref/checks.txt`.
- **To resume:** read ADR-0045's "Open questions". Two wait for Rafa: whether `jsonEquals` stays, and whether the laboratory's export will write the signed text beside the manifest object.
- **For the triage list:** a check kind that hashes one field and compares it with another (the telemetry against the hash in the signed manifest). The ADR's worked example names the gap.
