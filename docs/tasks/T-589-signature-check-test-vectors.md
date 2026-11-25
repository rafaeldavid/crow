# T-589: Signature check test vectors

- **Lane:** judgment
- **Kind:** 5, settlement and judgment code (`docs/team.md`, Change recipes): tests follow the code they test. No judgment code changes
- **Depends on:** the design in ADR-0045 (T-585, pull request 775, read at `31195a89`); the files stand without its merge
- **Paths this task may touch:** `spec/test-vectors/signature-valid/`, `tests/signature-vectors.test.ts`, this file, and `package.json` with `pnpm-lock.yaml` (one exact root development dependency)
- **Human gate:** no
- **Status:** review
- **Agent/session:** p02-test-vectors, 2026-11-25
- **Roadmap row:** N225

## What exists

- ADR-0045 decides the `signature_valid` check: the exact bytes at a JSON pointer, two algorithms, a pinned key fingerprint. No evaluator, schema branch or vector exists yet.
- `apps/adjudicator` already pins `@noble/curves` 1.9.1.

## Intent

Give the evaluator's builder, and any seller, documents signed in Python with known results, and a script that checks them in Node without this repository's code. A second implementation that gives the same results runs the same check.

## Acceptance criteria

- [x] A document signed in Python verifies in a standalone Node script, with P-256 and with Ed25519.
- [ ] A float in the signed part fails. **Not met as worded:** ADR-0045, section 2, allows decimals in the signed bytes. The vectors follow the ADR. They fail a number respelled after signing and a number in the readable object that differs from the signed one, and they refuse a number in the check. The folder's README, open question 1, holds the question.
- [x] For both algorithms: vectors for a good signature, a wrong key, a flipped byte, random signature bytes, floats, oversized input and an unknown algorithm, each with its expected result.
- [x] A test runs the Node verifier over every vector in CI.
- [x] No private key is committed.

## Out of scope

The evaluator (the build task for `packages/judgment/src/checks/`), schema v0.13, `site/ref/checks.txt`, the Project Wycheproof cases, a Node-signed vector and the work-budget case.

## Evidence

All measured on 2026-11-25.

- **`/verify`, the kind's local checks:** `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint` and `pnpm validate:spec` passed.
- **Docs and rules tests:** `tests/spec.test.ts`, `tests/install-rules.test.ts` and the five files of CI's docs tests job passed.
- **Secrets and names:** `gitleaks dir` found no leak in the new files. A whole-word scan of the new files and the manifest changes against the private deny list found no term.
- **Verifier:** `node spec/test-vectors/signature-valid/verify.mjs` gave every vector its expected result and exited 0.
- **Test:** `pnpm vitest run tests/signature-vectors.test.ts` passed.
- **Do the vectors catch a broken verifier?** A scratch script broke `verify.mjs` one way at a time. The vectors caught: the lenient `zip215` default; a required low s; the DER check removed; the fingerprint not compared; a stripped byte order mark; no surrogate check; lenient base64; no `jsonEquals`; no length limits; no signature check; no refusal of a malformed check. They did not catch one: the library's `format` option left out while the DER check stays. Only a 64-byte signature that also reads as DER would show it, and random signing does not produce one (inferred).
- **Python beside Node:** `cryptography` 50.0.2 accepts the signature in `ed25519/small-order-key`; the verifier refuses it.
- **Dependency:** `@noble/curves` 1.9.1 was already in the lockfile. The change adds one root importer entry and no new package.
- **Python packages:** the pins in `requirements.txt` were published on 2026-09-30, 2026-08-03 and 2026-10-22 (PyPI), and PyPI listed no advisory for them.

## Decisions

- **The ADR wins over the task's float line.** The task named the ADR as the design source.
- **The root takes `@noble/curves` at the exact version,** so the script in `spec/` resolves it. The evaluator's build adds its own entry in `packages/judgment` (ADR-0045, section 7).
- **New keys on each run,** because ADR-0045 commits no private key. A regenerated file therefore differs in every signature.

## Handoff

- **Done:** the vectors, the generator, the verifier, the README, the test, this file. The pull request is open and not merged.
- **To resume:** read the README's open questions. Question 1 needs an answer before the evaluator's brief, which repeats the float line.
- **For the evaluator's build:** run `vectors.json` through the evaluator; read the README's section "For the evaluator's builder".
