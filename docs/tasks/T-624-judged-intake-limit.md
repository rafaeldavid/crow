# T-624: A judged-intake limit so every host judges alike

- **Lane:** judgment
- **Kind:** 5, judgment change (`docs/team.md`, Change recipes)
- **Depends on:** T-613 (PR 818, where the red team found this), T-607 (PR 807, the charged run), T-614 (PR 821, the long-string rule)
- **Paths this task may touch:** `packages/judgment/src/intake.ts`, `packages/judgment/src/normalize.ts` (the memo, red team H2) and a new `normalize.test.ts`, `packages/judgment/src/references.ts`, the reference-size line of `readReference` in `packages/judgment/src/checks/index.ts`, their tests, the tests that relied on 10 MiB deliveries (`pipeline.test.ts`, `preflight.test.ts`, `redteam.test.ts`, `references.test.ts`), a new test `packages/judgment/src/heap.test.ts`, `packages/judgment/scripts/mutants.mjs` (one mutant's text), `apps/operator/src/server.ts` (one discovery field) and its test, `apps/demo-cloud/src/world.test.ts`, `spec/openapi/paths.json` and the generated `spec/openapi.json`, `examples/check-terms.ts` and its test, `examples/check-delivery.test.ts` (one test's delivery size), `site/ref/limits.txt`, `site/ref/http-seller.txt`, `site/ref/checks.txt`, `docs/api.md`, `docs/judgment-and-defenses.md` (T17), the rebuilt bundles under `site/`, `docs/decisions-today.md` (D108), this file
- **Human gate:** no. A deploy of the operators or the site waits for Rafa.
- **Status:** review
- **Agent/session:** heap-bound, 2026-11-25
- **Roadmap row:** none; finding 2 of the private triage note `roadmap/triage/2026-11-25-terms-nesting-and-heap-bound.md`

## What exists

- Intake refused plaintext over `MAX_PLAINTEXT_BYTES`, 10 MiB, the most a content store keeps. Stage 1 (the deterministic checks) and the screen then read the whole delivery.
- **Where judgment runs (measured from the code).** Crow's three demo adjudicators (primary, fallback, appeal) run inside the World Durable Object (`apps/demo-cloud/src/world.ts`), a 128 MB isolate, and read deliveries only from the World's own store, which keeps at most 1,048,576 ciphertext bytes (`DEMO_MAX_CIPHERTEXT_BYTES`). Node hosts are `apps/operator`'s sim world, the `apps/demo` CLI, a seller's preflight (`setup.mjs`, `serve.mjs`, `examples/check-delivery.ts`) and any third-party adjudicator built on `@holdback/adjudicator`; their store may keep up to 10 MiB (`limits.maxCiphertextBytes`, at most 10,485,760).
- The live default screen is `screen-1` (`apps/adjudicator/src/kept-policies.json`); `screen-0` and `screen-2` are kept too. A kept version is frozen in behaviour (`kept.ts`).

## Intent

A delivery's judgment must not depend on the adjudicator's memory. The primary on a 128 MB host and the fallback on a large one must reach the same result, so a seller cannot crash one adjudicator to be judged by another (ADR-0001). The fix bounds what judgment reads by a fixed size that every shape fits in a small heap, refuses a larger delivery on the existing seller-fault path, and publishes the number before anyone signs. It changes no kept screen version, no schema in `spec/schemas/` and no contract. It does not lower the store cap.

## Acceptance criteria

- [x] Measured first: where judgment runs and each host's memory, and the heap that stage 1 and the screen need per shape and size.
- [x] Intake refuses plaintext over `JUDGED_MAX_PLAINTEXT_BYTES` (1,048,576 bytes) as `payload_too_large`, naming the limit; the adjudicator rejects it without a panel (`mapIntakeError`, unchanged), and the seller's preflight refuses it the same way.
- [x] A reference over the same limit is unavailable to the adjudicator (it does not accept the terms) and fails its check by name.
- [x] Test first: `heap.test.ts` runs intake, stage 1 and every kept screen in child processes at `--max-old-space-size=64`, `=128` and `=512`, on eight shapes at the limit (the three of the triage note scaled to it, among them) and three one byte past it, and gets identical records; it fails when the limit is set to 4 MiB.
- [x] Discovery states `limits.maxJudgedPlaintextBytes`; `site/ref/limits.txt`, `ref/http-seller.txt`, `ref/checks.txt` and `docs/api.md` state it (not `ref/http.txt`: the plain-HTTP buyer's token budget, T-426, has no room, and a buyer reads it in `ref/limits.txt`); a test holds the docs and discovery to the constant and to the World's store cap.
- [x] `examples/check-terms.ts` warns when a `row_count_range` check's rows cannot or may not fit the limit.
- [x] 807's charged run, 818's depth cap and 821's long-string rule are unchanged.
- [x] D108 recorded, with the measurements and when to raise the limit.
- [x] Intake also refuses text longer than the limit in UTF-16 units once normalized, directly or with its `\u` escapes decoded (red team H1).
- [x] Normalization takes linear time on a run of variation selectors, with output identical to the old walk (red team H2).
- [x] One Opus red team; findings fixed or recorded.
- [x] The bundles rebuilt with `corepack pnpm build && node site/build.mjs`; `buy.mjs` and `try.mjs` unchanged; hashes listed.

## Decisions

- **A bound, not a rewrite (D108, the coordinator's option A).** The screen's memory comes from global regex replaces over the whole text in all three frozen screen versions, so a JSON-only bound would not do, and a byte-identical rewrite of three frozen versions is large and risky. A size limit before any check or screen reads the delivery keeps every kept version as it is.
- **1 MiB rather than the 2 MiB first proposed.** At 2 MiB the base64 shape failed at 112 MB of old space and passed at 128 MB. Node's `--max-old-space-size` counts only the old space, while a 128 MB isolate also holds young-generation and external memory and the World's own state. At 1 MiB every shape passes at 64 MB. The coordinator was told before the build.
- **The existing refusal.** `payload_too_large` was already a seller's fault (reject, no panel), and the seller's preflight already ran `refuseSize`, so the seller sees the same refusal before delivering.
- **Discovery's `limits`, not the adjudicator registration.** Discovery already publishes the store cap there, and an optional field in `spec/openapi/paths.json` needs no ADR or version bump (T-315's precedent). The registration lives in `spec/schemas/adjudicator.schema.json`, which would need both.
- **Row counts for check-terms.** Terms state no byte size. A row of K columns takes at least K bytes in any format, so `min x K` over the limit means no delivery can pass, and `max x K` over it means one near the maximum may be rejected.

## Evidence

Measured on 2026-11-25 on one Mac (Node 22.23.4), unless labelled. Probes in the gitignored `reports/scratch/heap-bound/` (`probe.mjs`, `run.mjs`, `ops.mjs`, `perval.mjs`; results in `baseline.txt`, `m1.txt`, `m2.txt`, `size2m-128.txt`, `size4m-128.txt`).

- **Before the change, 10 MiB** (stage 1 with five checks plus screen-2, 18 shapes): every shape failed at 128 MB; most failed at 256 MB and passed at 512 MB. The screen alone on 10 MiB of plain words failed at 256 MB and passed at 384 MB, in 16 s. One global regex replace with about 2,000,000 matches on 10 MiB of text failed at 128 MB by itself (`ops.mjs`).
- **By size, at 128 MB:** 1 MiB, every shape passed at 64 MB and failed at 32 MB. 2 MiB, every shape passed at 128 MB, and base64 failed at 112 MB. 4 MiB, 10 of 18 shapes failed.
- **Retained JSON.parse heap per value** (`perval.mjs`, 1,000,000 values): a small integer 10 bytes, a distinct short string 32, an empty array 43, an empty object 67, an object with a key of its own 184.
- **Test first:** `heap.test.ts` failed before the change (no limit exported). With the limit at 4 MiB it fails with `b64 at 4194304 bytes failed at 128 MB: FATAL ERROR: Reached heap limit`. At 1 MiB it passes in about 8 s.
- **Judgment package:** `corepack pnpm exec vitest run packages/judgment`, 31 files, 1,246 passed, 3 expected failures, 4 skipped. The tests that built deliveries over 1 MiB to exhaust the work budget now use 100 cells of 9,000 characters (900 kB) and still escalate.
- **Operator and World:** `apps/demo-cloud/src/world.test.ts` and `apps/operator/src/agent-ready.test.ts`, 73 passed; `examples/check-terms.test.ts`, 51 passed.

- **Bundles** (`corepack pnpm build && node site/build.mjs` after merging origin/main, SHA-256): `buy.mjs` `579788aa…`, `try.mjs` `71634a90…`, `take.mjs` `15cb5fd6…` and `preflight.mjs` `04469030…` are the same as main's. Three change, because they embed intake or normalization: `setup.mjs` `a8ed6855…` to `39a3c142…`, `serve.mjs` `37b7667c…` to `097356d7…`, and `seller-worker.mjs` `892c7fd8…` to `29f1b4f1…` (its pin in `examples/seller-worker-pin.ts` regenerated). `node site/check.mjs` passes.
- **After the red team's fixes:** `heap.test.ts` passes every case at 64, 128 and 512 MB, among them both NFKC shapes at exactly the limit and one unit over, and both variation-selector runs at 1 MiB. Before the memo, the plain run timed out at 60 s. `normalize.test.ts` holds the memo to the old walk over 5,000 random strings, and a wrong memo (always `a`) fails it.

- **Whole repository, after merging origin/main** (`bc9e9adb`): `corepack pnpm typecheck` and `corepack pnpm lint` clean; `pnpm validate:spec` passes with `spec/openapi.json` fresh; `pnpm snap` 73 of 73; `corepack pnpm test` 6,545 passed, 3 expected failures, 325 skipped, and 1 failed: `apps/own-seller/src/frozen.test.ts`. That test fails locally on any branch that changes `packages/`, and CI's shallow checkout skips it (only the gitleaks job fetches full history, `.github/workflows/ci.yml`).

**Red team** (one Opus pass, given CLAUDE.md, ADR-0001, ADR-0006, the operator threat model and the threat table, not this session's conclusions; probes in the gitignored `reports/scratch/redteam-t624/`). Result: ISSUES, two High.

| Finding | Severity | Status |
| --- | --- | --- |
| H1. NFKC expansion: 1 MiB of U+FDFA is 6,291,451 UTF-16 units once normalized; screen-1 ran out of memory at 256 MB, and at 1,048,548 bytes (Crow's store cap) it failed at 128 MB (measured) | High | Fixed: intake refuses normalized text over the limit, directly and with `\u` escapes decoded. `heap.test.ts` runs both at exactly the limit and one unit over |
| H2. `prevBase` walked back over every earlier variation selector: 1 MiB took 513 s in intake, and about 85 s in each screen through JSON escapes (measured) | High | Fixed: a memo, output identical (`normalize.test.ts`, 5,000 random strings against the old walk; a wrong memo fails it). `heap.test.ts` adds both runs and caps each case at 60 s |
| M1. The limit is the build's, not the signed policy's: builds can disagree on 1 to 10 MiB, and an upgrade changes in-flight deals with a third-party adjudicator that stores more (inferred) | Medium | Recorded in D108 as a residual; binding it needs the adjudicator schema (ADR) |
| L1. `ref/http-seller.txt` said "on any node"; the T17 row claimed a worker with a time limit | Low | Fixed: both say what holds |
| L2. check-terms read only `row_count_range` | Low | Fixed: a JSON Schema root's `minItems` (type array) or `minLength` (type string) that cannot fit warns too |
| L3. 1 MiB of empty lines builds a 1,200,315-character prompt for a 100,000-character data cap (datamark per line); the same on every host | Low | Not this change: for the triage note (`prompt.ts` is T-616's) |

What held (red team, measured): tag characters, 4-byte emoji, ZWJ runs, `uniqueItems`, `enum` and `pattern` JSON, the data kinds, twenty 1 MiB references at once, and the prompt with seeded sampling, all at 64 MB; every reader of a delivery passes the limit; `payload_too_large` rejects on the primary, the fallback and the appeal alike.

## Handoff

- **Done in the repository:** intake and the reference cap read at most 1 MiB, discovery and the docs state it, check-terms warns, and the heap test holds it at three heap sizes.
- **Not done:** a deploy of the operators and the site (Rafa's). Until then the live nodes publish no `maxJudgedPlaintextBytes`; their store already keeps no more than the limit.
- **Follow-ups for the coordinator:** M1 (bind the limit to the policy, an ADR) and L3 (the prompt's datamark overhead) for the triage note. `apps/own-seller/src/frozen.test.ts` (T-478) fails locally on every branch that changes `packages/`, since CI's shallow checkout skips it; it is not this task's file.
- **To raise the limit:** make the heavy screen passes lean with byte-identical output for every kept version, add a stage-1 JSON value bound, then raise the constant until `heap.test.ts` fails at 64 MB and keep the last size that passes.
