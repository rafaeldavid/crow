# T-625: The held reject's gaps from the partner C rehearsal

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** T-619 (ADR-0051)
- **Paths this task may touch:** `examples/seller-adapter-core.ts`, `examples/seller-adapter-stub.ts`, `examples/setup-seller.ts`, `examples/held-reject.ts`, `examples/deal-record.ts` and their tests, `apps/operator/src/` (registry, server, sim-world), `apps/demo-cloud/src/world.ts` and its test, `spec/openapi/paths.json` and `spec/openapi.json`, `site/` (guides and rebuilt bundles), `docs/decisions/ADR-0051-held-reject.md`, `docs/decisions-today.md` (D109), `docs/api.md`
- **Human gate:** no for the code; the Workers and site deploys are Rafa's
- **Status:** review
- **Agent/session:** Claude Code session in worktree `held-reject-interim-22d9a6`, asked by the coordinator on 2026-11-25
- **Roadmap row:** none

## What exists

ADR-0051 (T-619) holds a rubric deal's reject; `examples/held-reject.ts` runs the buyer's accept or settlement. The rehearsal on the live build `4b6821c` (private record `design-partners/partner-c/DEAL-RERUN-2026-11-25.md`) measured five gaps.

## Intent

Fix four of the gaps: the buyer's accept against an adapter seller; a held record in the buyer's deal record; every judgment record served; a rubric default that never replaces a seller's value. Say why the fifth, a filter abstention's detail on the member entry, waits for a schema version bump. Say what makes the buyer's lone accept reachable.

## Acceptance criteria

- [x] Gap 1: the adapter keeps the signed delivery in key mode and hands it to the deal's buyer only, by `shareDelivery` (`examples/held-reject-adapter.test.ts`).
- [x] Gap 2: "judgment names the delivery" passes for a held record, held and after a settlement in the hold (`examples/deal-record.test.ts`).
- [x] Gap 3: `GET /v1/commitments/{id}/judgments` serves the primary's and the appeal's records, also after a reopen (`apps/demo-cloud/src/world.test.ts`).
- [ ] Gap 4: deferred to the v0.15 schema bump (PR 835); see Handoff.
- [x] Gap 5: a seller's named windows stay on rubric offers (`examples/seller-adapter-terms.test.ts`).
- [x] An Opus red team on gaps 1 and 3, findings fixed (Evidence).

## Evidence

Filled at the PR; see its Verification section.

## Decisions

- **The adapter shares the delivery only with the buyer, and by default only during a held reject.** The body carries the buyer's envelope, so a buyer that gets it can read the work before paying. During a held reject the alternative is a refund, in which the seller keeps the work; the default shares it then only, and a seller may choose `"delivered"` or `"never"` (D32).
- **`/judgments`, not a query on `/judgment`:** the route was already planned in `spec/openapi/paths.json` with that meaning; it now leaves the planned list (OpenAPI revision 0.4).
- **Gap 4 waits:** `judgment.schema.json`'s member entry is closed, and PR 835 moves the same schema to v0.15.

## Handoff

Done: gaps 1, 2, 3 and 5, the docs and the records. Open: gap 4, to add `detail` to the member entry within PR 835's v0.15 (or a v0.16 after it). The deploys are Rafa's.
