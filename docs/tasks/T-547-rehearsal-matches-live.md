# T-547: The seller's rehearsal matches the live service

- **Lane:** demo (with one default in api: `apps/operator/src/sim-world.ts`)
- **Phase:** 2
- **Depends on:** T-546, the review of an outside evaluation
- **Paths this task may touch:** `apps/operator/src/sim-world.ts` and its test, `apps/operator/src/server.ts` (the ciphertext route's refusal), `apps/operator/src/agent-ready.test.ts`, `apps/demo-cloud/src/world.test.ts`, `examples/audit-deal.ts`, `site/sell.txt`, `site/llms.txt`, `site/ref/after-funding.txt`, `site/ref/checks.txt`, `site/ref/http-seller.txt`, `site/trust.mjs` and its built `trust.txt` and `trust.html`, `site/check.mjs`, this file
- **Human gate:** no for the merge. The site deploy that carries the doc changes is Rafa's.
- **Status:** review
- **Agent/session:** the T-547 session, started by the coordinator on 2026-11-18
- **Roadmap row:** N202

## What exists

The rehearsal (`pnpm audit-deal`) already runs the live operators' own world in process (`PublicWorld` from `apps/demo-cloud`), so most of its behaviour matches the test service by construction. `pnpm sim` (`apps/operator/src/sim-world.ts`) is a separate world, which `sell.txt` steps 3 to 7 use. The outside evaluation's review (private repository, `roadmap/triage/2026-11-18-second-outside-evaluation.md`, group (a)) lists eleven places where the rehearsal, the guides and the live service say different things. The task is still needed: each item below is checked against the code, and the ones that were true are fixed.

## Intent

A seller that passes the local rehearsal should pass on the test service, and the guides should say what both do. Each item is a default, a label, a sentence or a line: no new feature, route, message or concept. The pinned bundles the site serves (`try.mjs`, `buy.mjs`, `setup.mjs`, the goal commands and the preflight) must not change; an item that would move a pinned hash is left out and reported.

## Acceptance criteria

- [x] Each of the eleven items is done, already right, or left out with the reason (Evidence).
- [x] `pnpm sim`'s world stores at most 1 MiB per ciphertext by default, and a 2 MiB upload gets the live 413.
- [x] `node site/build.mjs && node site/check.mjs` passes; no pinned bundle's file changed.
- [x] `pnpm audit-deal --case all` ends 8 of 8 as expected.
- [x] The token budget is measured before and after.

## Evidence

All measured on 2026-11-18 in this worktree, at `origin/main` `21bb4e54` plus this branch, unless labelled otherwise. Outputs are in `reports/scratch/t547-*` on the maintainer's machine (not committed).

**The pinned bundles.** `setup.mjs` carries `examples/seller-adapter.ts`, `seller-adapter-core.ts`, `check-delivery.ts`, `deal-record.ts` and the built `packages/` (its banner lists them); `buy.mjs` carries `deal-record.ts` and `buyer-signer.ts`. `examples/audit-deal.ts`, `seller-adapter-stub.ts` and `apps/operator/` are in no bundle. After every change `git status` shows no `site/*.mjs` bundle changed: `site/check.mjs` and `site/trust.mjs` are sources, not bundles [measured].

**Token budget** (`node site/check.mjs`, estimate by bytes divided by four, no key set):

| Path | Before | After |
| --- | --- | --- |
| buyer: `llms.txt` + `buy.txt` | 19,420 bytes, 4,855 of 5,000 tokens | 19,458 bytes, 4,865 of 5,000 tokens |
| seller: `llms.txt` + `sell.txt` | 17,205 bytes, 4,302 of 5,000 tokens | 17,779 bytes, 4,445 of 5,000 tokens |
| plain-HTTP buyer: `llms.txt` + `ref/http.txt`, `signing.txt`, `http-buyer.txt` (`tests/site-guides.test.ts`) | 37,762 bytes, 9,441 of 9,450 tokens | 37,800 bytes, 9,450 of 9,450 tokens |

`llms.txt` grew from 5,135 to 5,173 bytes, about 10 tokens, under the review's 40 [measured]. The first wording of the status line put the plain-HTTP buyer's path at 9,458 tokens and failed its test; two words came out of `llms.txt` to pay for it: "Optional." before "The whole reference is one file", which "only when a role page cites" already says, and "own" in "in your own configuration" [measured]. That path now has no spare token: the next sentence added to any of its four files fails the test.

**The rehearsal.** `pnpm audit-deal --case all` before the change: `8 of 8 cases ended as expected.`, exit 0. After: the same, exit 0 [measured].

**The items:**

1. **Corepack fallback: done.** `sell.txt`'s first line says Node 25 and later ship without corepack, and step 1 adds: "If corepack is missing or fails, run `npm install -g pnpm@12.16.1` and the command without `corepack enable &&`." `site/check.mjs` now fails when the version there differs from `packageManager` in `package.json`: with `pnpm@12.16.0` written in, it printed `FAIL sell.txt names pnpm@12.16.0 for a Node without corepack, not pnpm@12.16.1, the packageManager in package.json` [measured]. That Node 25 ships without corepack is [inferred] from the Node project's decision to stop bundling it; not tried on a Node 25 here. `setup.txt` names no corepack, so it is unchanged [measured].
2. **1 MiB on the local chain: done for `pnpm sim`; the rehearsal was already right.**
   - The rehearsal's world is the live world's code, so it already refuses above 1,048,576 bytes. A 2,098,368-byte report through `pnpm audit-deal --case released --report <2 MiB file>` got, at each try, `POST /v1/ciphertext: payload_too_large: request bodies to /v1/ciphertext are limited to 1048576 bytes at this operator`, the live operators' own text; a 901,161-byte report ended `Released` [measured]. The review's reading that the rehearsal stores 10 MiB was wrong for the rehearsal and right for `pnpm sim`.
   - `pnpm sim`'s world now passes `maxCiphertextBytes` 1,048,576 (`SIM_MAX_CIPHERTEXT_BYTES`) to each operator, with a `maxCiphertextBytes` option for a test that needs another value. `apps/operator/src/sim-world.test.ts` ("stores at most the test service's 1 MiB") reads discovery's `limits.maxCiphertextBytes` 1048576, stores exactly 1 MiB, and gets 413 `payload_too_large` with `maxBytes` 1048576 for 2 MiB; `apps/demo-cloud/src/world.test.ts` (T-315's test) checks `SIM_MAX_CIPHERTEXT_BYTES` equals `DEMO_MAX_CIPHERTEXT_BYTES` [measured]. Status, type and `maxBytes` match the live answer; the `detail` text differs, since the live Worker refuses before the operator does [measured from the code].
   - **A reset after the 413, found and fixed.** The final test run failed `answers unknown prepare kinds and bad inputs with problems`, the test after the new one, with `fetch failed … read ECONNRESET`, 5 of 5 runs when the two ran together [measured]. The operator's upload loop left `for await` early on the first chunk past the limit, which destroys the request's socket, so the client's next request on it was reset. Closing the connection instead reset the upload itself (2 of 5 runs failed the new test with `fetch failed`); calling `resume()` before leaving the loop kept the reset (9 of 10 failed) [measured]. The fix in `apps/operator/src/server.ts`: past the limit the loop reads on, keeps nothing, and refuses at the end of the body. After it, the two tests passed 10 of 10 runs [measured]. Any seller whose delivery passes 1 MiB on `pnpm sim` met this, since the adapter retries at every poll.
   - `sell.txt` step 8 says the local chain, like the test service, stores at most `limits.maxCiphertextBytes`, 1 MiB, and that the adapter logs `payload_too_large` for a larger delivery.
3. **Stand-in judges in the rubric case: done.** The rubric case now prints `The judges: the local world's panel is a stand-in set to accept: no model runs, and each verdict reads "fake judge: pass", though the record names the policy's models.`; the refunded case's line gains the same last clause. On the local world, a deal record whose panel ran gets a top-level `note` second after `record`: "A local rehearsal: no model judged this deal. …". After the change, only the rubric and refunded records carry it [measured]. The note is written by `audit-deal.ts` only; `deal-record.ts`, which `buy.mjs` and `setup.mjs` carry, is unchanged. Live (`--live`) the rubric case runs real models, so neither the line nor the note appears.
4. **One delivery window: done, by saying why they differ.** `/defaults` publishes the template's 7 days (`seller-adapter-core.ts` `DEFAULTS.timing`); the stub quotes 1 day plus 1 day per 1,000 lines (`seller-adapter-stub.ts:113`), 4 days for the rehearsal's 3,000 lines, and a quote's window replaces the default (the adapter's own rule). The rehearsal already printed `Differences from the seller's defaults: deadlines.deliverWithinSec 604800 -> 345600.` [measured]. `sell.txt` step 4 now says so, and the header of `audit-deal.ts` too. No code changed: making the cases use 7 days would change the stub, which shows the per-quote window working.
5. **`--terms` names what it replaced, on every case: done.** The per-case path now prints the same sentence as the single-deal path. `pnpm audit-deal --case rubric --terms fixtures/terms/audit-report.yaml` printed `The club, the adjudicators and the adjudication fee come from discovery, not from the file's clubId data-services-v1 and policyId bench-a/p1.` and ended 1 of 1 as expected [measured].
6. **JSON and YAML terms: done.** `sell.txt` step 8: `check-delivery.ts` "takes the signed terms as JSON (`GET /v1/commitments/<id>/terms`), where `--terms` takes the template's shape." `--terms` reads YAML or JSON in the template's shape (`audit-deal.ts` header), so the line says "the template's shape", not YAML only.
7. **Local faucet label and the 404 lines: the 404s explained; the faucet label left out.**
   - The four `refused request … 404` lines are `GET /v1/commitments/<id>/judgment`, two operators each, for the missed-deadline and shown-mismatch deals, which no adjudicator decided [measured: their IDs are in those two cases' records]. The review's guess, the feedback route, was wrong: the rehearsal sends no report. Each such line now ends `answered 404 (no judgment: no adjudicator decided this deal)` [measured].
   - **Left out:** "the test service's faucet" is written by `examples/seller-adapter-core.ts:1296`, which `site/setup.mjs` carries, so any change there moves `setup.mjs`'s SHA-256. A re-pin is a separate decision.
8. **The default outcome, once: done.** `trust.txt` (from `site/trust.mjs`): "…which on the live service refunds the buyer the price and the adjudication fee. The seller's compensation from adjudicators' bonds in docs/architecture.md applies only to the full protocol on SimChain." `ref/after-funding.txt`, beside the default the operators send: the same second sentence. Both match `docs/architecture.md`'s ledger table (default outcome: `escrow:{id} → buyer` (price + fee); bonds on SimChain only) [read].
9. **`full_refund`: done.** `ref/http-seller.txt`, beside the term: "On a reject, `full_refund` returns the price to the buyer; the adjudication fee stays with the adjudicator, and an operator fee does not come back." This matches `buy.txt` step 8 and discovery's `fees.operator.refundable: false` [read]. `buy.txt` already said it, so the buyer's path is unchanged.
10. **The status file for agents: done.** `llms.txt`, "Configure": "The two operator nodes, one API (status: https://crow.direct/status/operators.json)." The site's Worker serves that path (`apps/site/status.js`, `STATUS_PATH`), so `site/check.mjs`'s link check now accepts it by that constant; before, it failed with `llms.txt links https://crow.direct/status/operators.json, which neither the publish build nor the test agents serve` [measured].
11. **Linked files: done.** `ref/checks.txt`, first section: "The checks and the judges read the delivered file only: a file it only links to is not fetched or checked, so put what you need in the delivery."

**Tests** (the kinds' local checks: site, and the operator and demo-cloud packages with the examples that use them). The first run over `apps/operator/src`, `apps/demo-cloud/src/world.test.ts`, `examples/audit-deal.test.ts`, `examples/seller-adapter.test.ts` and seven site and contract test files passed 543 of 545; both failures were this change's: `agent-ready.test.ts` expected the sim's old 10 MiB, and `tests/site-guides.test.ts` the plain-HTTP budget above. The second run found the reset in item 2. On the final tree [measured]:
- `pnpm exec vitest run apps/operator/src apps/demo-cloud/src examples/audit-deal.test.ts examples/seller-adapter.test.ts tests/site-guides.test.ts tests/site-status.test.ts tests/guide-budget.test.ts tests/card-schema.test.ts tests/audit-report-template.test.ts tests/contract/openapi.contract.test.ts tests/site-bundles.test.ts`: 48 files passed, 5 skipped; 654 tests passed, 13 skipped, 0 failed.
- `node site/build.mjs && node site/check.mjs`: `site check PASS`; `pnpm typecheck` exit 0; `pnpm exec eslint` on the changed sources exit 0.
- `pnpm audit-deal --case all`: `8 of 8 cases ended as expected.`, exit 0, with the four 404 lines labelled.
- No snapshot changed: `pnpm snap` was not run, since no fixture or `.expect.md` file is touched.

## Decisions

- **`pnpm sim`'s default follows the test service, and stays a parameter.** The protocol's ceiling stays 10 MiB (T-315); the local world takes the live node's value as its default so a rehearsal refuses what the live service refuses. `SimWorldOptions.maxCiphertextBytes` sets another value. No command-line flag was added: the task adds no feature.
- **An oversized upload is read to its end, not cut off.** The operator now reads the whole body of a refused upload and keeps none of it, so the client gets its 413 and its socket stays usable. The cost is the bandwidth of the refused body, which the client chose to send; memory stays bounded by the limit. On the test service the Worker refuses an upload above 1 MiB before the operator reads it (`apps/demo-cloud/src/world.ts`, `limited`), whenever the request carries an `Idempotency-Key`.
- **The record note is the rehearsal's, not the record's.** A field in `deal-record.ts` would move two pinned bundles; the note is added where `audit-deal.ts` writes the file, on the local world only, when the panel ran.
- **The pnpm version is checked, not filled.** `sell.txt` carries the version literally, as it does Node's; `site/check.mjs` compares it with `package.json` so it cannot drift silently.

## Handoff

**Done:** items 1 to 6 and 8 to 11, item 7's 404 lines, and the reset after a 413 that item 2's test found. CI and review on the pull request.

**Left out:**
- Item 7's faucet label ("the test service's faucet" on the local chain): `examples/seller-adapter-core.ts` is in `site/setup.mjs`, so the change moves a pinned hash. It belongs with the next deliberate re-pin of `setup.mjs`.

**Found, not fixed (for the triage file):**
- **The seller adapter retries a 413 forever.** With a 2 MiB delivery, the adapter logged `waits at delivering: POST /v1/ciphertext: payload_too_large … The adapter tries again at the next poll.` every poll for over 7 minutes, re-encrypting and re-uploading 2 MiB each time, and the rehearsal never ended; it also drew `rate_limited` answers from the operators [measured]. A refusal with `maxBytes` will never pass, so the adapter could treat it as a refusal of the delivery (alert, no retry) as it does a failed check. The code is `examples/seller-adapter-core.ts`, in `setup.mjs`: a re-pin decision, as above.
- **The plain-HTTP buyer's path has no spare token** (9,450 of 9,450). The next addition to `llms.txt`, `ref/http.txt`, `ref/signing.txt` or `ref/http-buyer.txt` needs a cut beside it or a decision on the ceiling.

**What a site deploy would carry:** `llms.txt` (the status line), `sell.txt` (items 1, 2, 4, 6), `ref/after-funding.txt` and `trust.txt`/`trust.html` (item 8), `ref/http-seller.txt` (item 9), `ref/checks.txt` (item 11). No bundle changes, so every pinned SHA-256 in `llms.txt` stays. The `pnpm sim` default and the rehearsal's output change with the repository on merge. `apps/operator/src/server.ts` is also in the operators' Worker: the next operator deploy carries the read-to-the-end refusal, which changes nothing a client sees but the socket staying usable. It needs no deploy of its own.
