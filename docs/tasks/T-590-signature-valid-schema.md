# T-590: schema v0.13 for the `signature_valid` check kind, and the decline for a kind a build does not run

- **Lane:** spec
- **Kind:** 6, schema and API contract, then 5 for the acceptance change (`docs/team.md`, Change recipes)
- **Depends on:** T-585 (ADR-0045)
- **Paths this task may touch:** `spec/schemas/`, `spec/examples/`, `spec/README.md`, the generated `spec/openapi.json` and `spec/openapi/paths.json` (the version), `tests/spec.test.ts`, `packages/core/src/validators.generated.ts` and `packages/core/src/types.ts`, the schema version in `apps/operator/src/server.ts` and its tests, `examples/mandate.test.ts`, `docs/api.md` and `site/ref/` (the version they name), `site/setup.mjs` and `site/take.mjs` (they embed the schemas; the coordinator's yes to each, 2026-11-25), `apps/adjudicator/` and `fixtures/` (scope widened by the coordinator, 2026-11-25), `packages/testkit/src/stub-settlement.ts` (one rule the fixture needs; see Decisions), this file
- **Human gate:** no. A deploy of the operators or the site waits for Rafa.
- **Status:** review
- **Agent/session:** p01-schema-bump, 2026-11-25
- **Roadmap row:** N225

## What exists

- Schema v0.12 holds nine deterministic check kinds. `DeterministicCheck` is a closed `oneOf`, so a node refuses terms that name any other kind.
- ADR-0045 (D90) designs the tenth, `signature_valid`, and a `checkKinds` list on the adjudicator record. It changes no schema file itself.
- The adjudicator's acceptance path does not ask whether its build runs the kinds an offer names. Under v0.12 the schema made that question moot.

## Intent

Put ADR-0045's two schema changes into the API contract as version 0.13, with examples that pass and tests for what the schema refuses. `main` is what a deploy publishes, so it must never hold 0.13 without a primary that declines a kind it does not run. So the reference adjudicator also publishes the kinds it runs and declines the others (ADR-0045 section 10, the check-kind half). The evaluator is a later task.

## Acceptance criteria

- [x] `DeterministicCheck` has one `signature_valid` branch with ADR-0045 section 1's parameters, closed at every level. It refuses an unknown `alg`, `ed25519` with `der`, a pointer that is not RFC 6901 and any numeric parameter.
- [x] The adjudicator record takes an optional `checkKinds` list of unique names, beside `policy`.
- [x] Every `$id` and the operator's schema version read 0.13. The EIP-712 domain version and `commitment.schemaVersion` stay 0.8.
- [x] The primary signs no `AdjudicatorAcceptance` for an offer that names a kind outside its `checkKinds`, required or optional, and the offer's `notices` say why.
- [x] The reference adjudicator's record lists the nine kinds it runs, and not `signature_valid`.
- [x] `neutrality.adjudicator-lacks-check-kind`: the primary declines, the offer expires unfunded, no funds move.
- [x] Stage 1 and the fallback and appeal turns are unchanged.
- [x] `pnpm validate:spec`, the contract tests and the checks the brief names pass. Evidence records the full suite's result.

## Out of scope

- The evaluator, its `DeterministicCheck` type and its entry in stage 1's registry (P-03).
- The check-validation half of ADR-0045 section 10. It follows in a separate change.
- The parties' preflight on all three adjudicators' `checkKinds` (ADR-0045 section 10).
- `spec/test-vectors/signature-valid/` (T-589, a parallel task) and `site/ref/checks.txt`.

## Evidence

All measured on 2026-11-25 on one Mac that other sessions were loading, unless labelled.

- **Contract:** `pnpm validate:spec` passes: 37 of 37 examples, and `spec/openapi.json` is fresh.
- **Vectors:** the `check` objects of the 95 vectors in `spec/test-vectors/signature-valid/vectors.json` (T-589, merged into this branch from `main`) agree with both validators, Ajv over `spec/schemas` and the compiled core parsers. 11 of them expect a refusal.
- **Over HTTP, on the SimChain operator:** `GET /v1/adjudicators/{address}` serves the nine kinds. Preparing an offer with the operator's default primary answers 400 with the decline's reason. With the primary named, the prepare and post answers carry the reason in `notices`, and the offer stays `Offered`.
- **Bundles,** SHA-256 on `main` to SHA-256 here. Two change, because they embed the schemas:
  - `site/setup.mjs`: `e422f778de7de70e20bec1d97bcd400a3cbbf30b10ef9b64b2ca58995c09d630` to `7cb29b1c3fa10515163d94aefd93f177a7a8a2dcf165ad43981de3f0abdb31b4`.
  - `site/take.mjs`: `01a171a2166c63378b15c0df220607bd380a24ea7ba8ca3e64fbafb497d25984` to `e374077946d239c0645f6c1a8768139a0f964d389e145a168c9bed26bcbce15a`.
  - `buy.mjs`, `try.mjs`, `try-sell.mjs`, `try-judged.mjs`, `try-reclaim.mjs` and `preflight.mjs` match `main` byte for byte.
  - PR 787 also changes `setup.mjs`. Whichever merges second merges `main` and runs `node site/build.mjs`; a bundle conflict is never resolved by hand.
- **Checks on the merged tree:** `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm validate:spec` and `node site/build.mjs && node site/check.mjs` pass.
- **Full suite, final tree:** `pnpm test` passes: 301 files passed and 2 skipped, 5,848 tests passed and 7 skipped. `pnpm snap`: 53 of 53.
- **Local chain:** `neutrality.adjudicator-lacks-check-kind` and `neutrality.adjudicator-never-accepts` pass against the contracts on anvil, with 0 transactions and a transcript identical to SimChain's.
- **An earlier full run failed 10 tests,** at a load average near 300 on 8 cores. One was this change: the new fixture's `expire` step uses a feature phase one cut, and `tests/cut-feature-alignment.test.ts` said so. The step now carries the guard's "SimChain only" mark. The other 9 sit in five files this change does not edit: time limits, and four `seller-invoice` tests that reported the two operators gave different answers. The five files then passed alone, 182 of 182, at a load near 8, and again in the final full run. That they come from load is inferred.
- **Names:** a whole-word scan of the added lines and commit messages against the private deny list found 0 terms.

**Review** (one pass, on the schema change): no defect in the schema. Fixed: `spec/README.md` claimed that every deal on an unrun kind is rejected (an optional check does not reject it), one example still read 0.12, and one sentence here overstated what an older reader accepts. Left: the comment at `apps/test-agents/src/buyer-rules.ts:13` says the test buyer takes every kind in the schema. Its list lacks `signature_valid`, which is right today, and already lacked `iso8601_date_column`.

**Red team** (on the decline): it found no way for the reference primary to accept a kind its build does not run (inferred from the code). It did not run a standing take end to end or a restart probe.

| Finding | Severity | State |
| --- | --- | --- |
| A fallback that takes over an outside primary's deal on a kind it does not run rejects it. A reject keeps the adjudicator's fee and a default returns it (`docs/api.md`, "Who gets what"). ADR-0045 section 10 says the money moves the same way, which leaves out the fee. `declines` for the fallback and appeal roles gives no warning either, so an operator can fill them in as defaults for such terms | Medium | Open: needs a decision. Judging stays as it was, by instruction |
| The check-validation half of section 10 is not built | Medium-low | Follows in a separate change |
| After a rollback to the previous build, its primary would accept an offer on the new kind that is still `Offered` (inferred, not run) | Low | In the PR's deploy plan |
| The fixture exercises the scenario runner's copy of the rule, not the service | Low | The fixture's header says so; `apps/adjudicator/src/check-kinds.test.ts` tests the service |

One further finding concerns code older than this change. It went to the coordinator privately.

## Decisions

- **`checkKinds` items are a pattern, not an enum** (`^[a-z0-9_]{1,40}$`). A reader on 0.13 or later then accepts a record that lists a kind added after its version. A 0.12 reader refuses any record with `checkKinds`.
- **`checkKinds` holds at most 100 names,** as `affiliations` does. The ADR sets no cap; a stored public record needs one.
- **The four pointers share one `$defs/JsonPointer`,** marked `x-holdback-untrusted`: a party writes them.
- **The length limits on resolved strings (1,024 and 256 characters) are not in the schema.** They bound delivered values, which the schema never sees.
- **`packages/core/src/types.ts` gains `checkKinds` and not the `signature_valid` type.** Stage 1's registry must name every kind in the type's union, so the type arrives with the evaluator.
- **The reference adjudicator reads `checkKinds` from stage 1's registry,** so the list cannot claim a kind the build lacks. There is no setting that narrows it.
- **`packages/testkit` gains the same one-line rule.** The scenario runner accepts offers with its own code, so without it the fixture's primary accepts. The widened scope did not name this path.

## Handoff

- **Done:** the schema, the examples, the version, the rebuilt `site/setup.mjs` and `site/take.mjs`, the published `checkKinds`, the primary's decline and its fixture. Pull request open; not merged.
- **For P-03 (the evaluator):**
  - Add `signature_valid` to `DeterministicCheck` and to stage 1's registry. The record's `checkKinds` and the decline then follow on their own.
  - `neutrality.adjudicator-lacks-check-kind`, `apps/adjudicator/src/check-kinds.test.ts` and the "not `signature_valid`" assertion will fail then, as they should. The fixture needs another way to give a primary fewer kinds.
  - `validateCheck` must refuse `ed25519` with `der` (ADR-0045 section 5). Today the schema does.
  - Follow ADR-0045 on decimals: a signed part may hold them.
- **Deploy notes** (a deploy waits for Rafa):
  - The operators' next deploy from `main` serves schema 0.13. Until both nodes run it, `preflight.mjs` reports that their schemas differ and tells the agent not to sign.
  - The demo adjudicators' records gain `checkKinds`, so the world registers them again with a later `issuedAt` (inferred from `registerOwn`). `policyHash` does not move. No signed type, contract or domain changes.
  - A client that holds its own 0.12 copy of the adjudicator schema refuses the new records. No bundle Crow publishes checks them against the schema (inferred from a search of `setup.mjs`, `buy.mjs`, `try.mjs` and `take.mjs`: `take` compares selected fields of a record across the operators).
  - A rollback restores a primary without the decline. An offer on the new kind that is still `Offered` could then be accepted.
- **For Rafa or the coordinator:** the Medium finding above, before D90 is settled. ADR-0045's two open questions stay open.
