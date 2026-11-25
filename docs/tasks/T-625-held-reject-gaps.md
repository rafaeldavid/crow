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
- [ ] For Rafa: the sharing default, `"held-reject"` or `"never"` (D35's minimal disclosure; the red team's design note).

## Evidence

All measured on the branch after merging `origin/main` (D108, T-624), 2026-11-26:

- `pnpm test`: 6,558 passed, 3 expected fail, 1 failed: `apps/own-seller/src/frozen.test.ts`, T-478's branch check, which fails locally on any branch touching `packages/` or the seller adapter's core and which CI's shallow checkout skips.
- `pnpm snap`: 73 passed. Typecheck and lint pass. `node site/build.mjs && node site/check.mjs` pass; first-deal paths 4,995 and 4,994 of 5,000 tokens (estimate).
- New tests: `examples/held-reject-adapter.test.ts` (2) and `examples/held-reject-adapter.attack.test.ts` (6, the red team's, turned to assert the fixes), the held case in `examples/deal-record.test.ts`, the named-windows case in `examples/seller-adapter-terms.test.ts`, the `/judgments` case in `apps/demo-cloud/src/world.test.ts`, and the contract test's call of `listJudgments`.
- **Red team (Opus):** H1 (one stale or lying operator made the adapter share a refunded deal's work) fixed: every operator must agree, and the record must be the primary's signed reject of this delivery with its hold not ended. M1 (shared rejects that were not held) fixed with ADR-0051's rule. M2 (each request cost two reads, no limit) fixed: one decision in flight per deal, a refusal reused 10 s, 10 decisions a minute, then 429. M3 (a re-sent delivery recorded other bytes) fixed: a kept delivery is re-sent with no new fetch. L1 (a signed URL worked as a bearer link) fixed: a nonce, each request answered once, no future times. L2 (a timing oracle) fixed: the signature is recovered before the journal is read. L4 (a deal in flight at the deploy lost the primary's record) fixed in `publishRecord`, not covered by a test. L6 (a superseded record passed) fixed. L3 (contract-wallet buyers cannot sign the request) and L5 (which record decided) documented.
- **Bundles that move:** `setup.mjs` `7f19918f39b8aa56c4e5dbf5235d322daff3f4eed5a454e9acb012f0a2cebda2`, `serve.mjs` `711cf5cc550b095ad490988f8100ec6e413d129634d9b1b0f7fef050854fbc4b`, `seller-worker.mjs` `32d22a5dc2da8af9998801daccd1e8ec06786b5498e96348586162199dd1a0d3`, `buy.mjs` `94e1b860cd631e9500b587c231059ae37212f0bf100606a0696e387bc44176fd` and `take.mjs` `34df35dcd2805b56da832cd129281ac2cb0e31fb27a57b97959f82ba8ef1e644` (both carry `deal-record.ts`). `try.mjs` is unchanged.

## Decisions

- **The adapter shares the delivery only with the buyer, and by default only during a held reject.** The body carries the buyer's envelope, so a buyer that gets it can read the work before paying. During a held reject the alternative is a refund, in which the seller keeps the work; the default shares it then only, and a seller may choose `"delivered"` or `"never"` (D32).
- **`/judgments`, not a query on `/judgment`:** the route was already planned in `spec/openapi/paths.json` with that meaning; it now leaves the planned list (OpenAPI revision 0.4).
- **Gap 4 waits:** `judgment.schema.json`'s member entry is closed, and PR 835 moves the same schema to v0.15.

## Handoff

Done: gaps 1, 2, 3 and 5, the docs and the records. Open: gap 4, to add `detail` to the member entry within PR 835's v0.15 (or a v0.16 after it); Rafa's choice of the sharing default. The deploys are Rafa's.
