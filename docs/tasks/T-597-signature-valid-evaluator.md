# T-597: The signature_valid evaluator

- **Lane:** judgment
- **Kind:** 5, judgment change (`docs/team.md`, Change recipes)
- **Depends on:** T-585 (ADR-0045), T-589 (the vectors), T-590 (schema v0.13)
- **Paths this task may touch:** `packages/judgment/src/checks/`, `packages/judgment/package.json`, `pnpm-lock.yaml`, `packages/core/src/types.ts` (the check's type), `apps/adjudicator/src/` (D92: `service.ts`, `check-kinds.test.ts`), `apps/operator/src/prepare.ts` and its test, `packages/testkit/src/` (the rule and `lacks_check_kinds`), `docs/decisions-today.md`, `docs/decisions/ADR-0045-*`, `docs/decisions/ADR-0046-*` (one line), `docs/api.md`, `docs/neutrality.md`, `fixtures/`, `spec/README.md`, `spec/test-vectors/signature-valid/README.md` (one sentence), `site/ref/checks.txt`, `site/setup.mjs` (rebuilt), this file
- **Human gate:** no. A deploy waits for Rafa.
- **Status:** review
- **Agent/session:** p03-signature-valid, 2026-11-25
- **Roadmap row:** N225

## Intent

Stage 1 runs the `signature_valid` check as ADR-0045 specifies, so a deal can release on a seller-side signature that a pinned key made. The primary's `checkKinds` then lists the kind and it stops declining offers that name it.

## Acceptance criteria

- [x] The evaluator reads exact bytes at a JSON pointer, decodes `utf8` or `base64` strictly, checks the key's fingerprint against the terms, verifies P-256 or Ed25519 with every strictness option named, and applies `message.jsonEquals` when set.
- [x] `validateCheck` refuses a malformed check; an unknown algorithm fails closed.
- [x] Every input has a size limit and the shared work budget bounds the rest. No timer, clock or network call.
- [x] `signature_valid` is in stage 1's registry, so the adjudicator's `checkKinds` lists it.
- [x] Every vector in `spec/test-vectors/signature-valid/` gives its expected result in the evaluator.
- [x] Attack cases fail: random signature bytes, a wrong key, oversized input, a number respelled after signing, a non-integer parameter, an unknown algorithm, a `jsonEquals` mismatch, malformed base64.
- [x] D92: an adjudicator signs no decision on a kind it does not run, at any role; operators warn when a named adjudicator's `checkKinds` lacks one.
- [x] Fixtures: `signed-manifest-accepted`, `attack.signed-manifest-tampered`, `neutrality.signature-check-primary-offline`, `neutrality.fallback-lacks-check-kind` (SimChain only).

## Decisions

- **`@noble/curves` is a direct dependency of `packages/judgment` at exactly 1.9.1,** the version the adjudicator app and the root already pin. The lockfile already held 1.9.1 (published 2025-05-14); only the importer entry is new.
- **The pure verifier is its own file** (`signature.ts`): strict base64, the PEM reader, the key-shape check and `verifySignature`. N226 can call it.
- **`neutrality.adjudicator-lacks-check-kind` is removed.** No schema v0.13 kind is left that a build lacks. The scenario file gains `lacks_check_kinds`, which `neutrality.fallback-lacks-check-kind` uses. The decline rule stays, with its tests (`apps/adjudicator/src/check-kinds.test.ts`) now using a kind a later schema may add.
- **Work units:** 1 per message byte decoded (base64) or hashed, 200,000 per verification, 1 per value `jsonEquals` visits. The record's guess, kept; not yet measured at the store's limit (see Handoff).
- **The detail lines are ADR-0045 section 5's, and the vectors' README fixes the open ordering questions** by following section 4's steps (publicKey, then message, then signature).

## Handoff

- Not built: the decline for a check that `validateCheck` refuses (ADR-0045 section 10, second half). For `signature_valid` the schema already refuses every malformed shape before an offer exists.
- Open: the work-unit rates are still the record's guess.
- Deferred: `neutrality.proof-check-both-offline` and a fixture that runs the kind twice and compares records byte for byte (the unit test `gives the same outcome and the same remaining budget on every run` covers the second).
- Second review by a model of another family is advised for this judgment change: Wycheproof edge cases, base64 and PEM second spellings, budget at the store limit.
