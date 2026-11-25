# T-582: research note on proofs that travel with a delivery

- **Lane:** research
- **Kind:** 10, research and decisions (`docs/team.md`, Change recipes)
- **Paths this task may touch:** `docs/research/2026-11-24-delivery-proofs.md`, this file
- **Human gate:** no
- **Status:** done (merged in PR 767, 2026-11-24)
- **Agent/session:** n225-research, 2026-11-24
- **Roadmap row:** N225

## What exists

- A delivery can carry a device signature inside its JSON document today, and the checks pin the key and the message's format. No check verifies the signature, compares neighbouring rows, or finds a waypoint in a recorded path (`site/ref/checks.txt`, "Writing checks for a robot episode").
- T-498 listed the missing check kinds in its Handoff. T-541 built an unconnected zero-knowledge prototype for the key envelope.
- No design says which proofs Crow supports or where each is checked. This task writes it.

## Intent

Answer the roadmap row's five questions in one design note: which proofs a seller's agent can make, where each is checked, what the schema and API need, what stays out, and what a worked example and its neutrality fixture look like. Recommend the smallest addition that lets release depend on a seller-side proof. Research and a plan only: no schema, code or ADR change.

## Acceptance criteria

- [x] The note answers the five questions, with a robotics laboratory's signed recording as the worked example and no partner or customer name.
- [x] It compares new check kinds with a typed proof field on the delivery and recommends one.
- [x] It says what stays out (D26, D32), what never reaches the chain (D35), and what the two-part release (N226) needs.
- [x] Every claim carries a label.

## Out of scope

- Any change to `spec/schemas/`, code, contracts or an ADR.
- A run on Sepolia.

## Evidence

- **Docs tests** [measured, 2026-11-24, in the worktree]: `pnpm vitest run tests/cut-feature-alignment.test.ts tests/decisions-status.test.ts tests/design-map.test.ts tests/id-check.test.ts tests/site-guides.test.ts`, the five files CI's `docs tests` job runs. 5 files and 293 tests passed.
- **Name scan** [measured]: the two new files hold no whole-word match for any term in the maintainers' private deny list.
- **Sources** [measured]: read at `b1fa6028`; the note's Scope section lists them. Nothing was run against a service, and no outside page was opened.

## Decisions

None taken. The note ends in a recommendation Rafa can overrule: four deterministic check kinds now, no proof field on the delivery until the two-part release changes the contract.

## Handoff

- **Done:** the note, `docs/research/2026-11-24-delivery-proofs.md`.
- **Not done:** the ADR, the schema change, the evaluators, the test vectors, the Sepolia example and the neutrality fixtures. Each waits for Rafa's word on the recommendation.
- **To resume:** start from the note's "Open questions for the ADR". Build `signature_valid` first.
- **For the coordinator:** `docs/research/README.md` has no row for this note; this task edits no shared doc.
