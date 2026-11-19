# T-559: Two refusals fail cleanly and say why

- **Lane:** api and settlement (`apps/operator`, `packages/settlement/evm`, one constant in `packages/core`)
- **Phase:** 2
- **Depends on:** T-547 (the ciphertext route's read-on refusal), T-540 (its finds 1 and 3)
- **Paths this task may touch:** `apps/operator/src/server.ts` (the JSON body reader) and a new test beside it, `packages/settlement/evm/evm-settlement.ts` (the `decide` case), `packages/settlement/evm/errors.ts` and its test, `packages/settlement/evm/testing.ts`, a new anvil test in `packages/settlement/evm/`, `packages/core/src/state.ts` (the reason as a named constant), this file
- **Human gate:** no for the merge. The operator deploy that carries the change is Rafa's.
- **Status:** in review (waits for the T-563 merge freeze)
- **Agent/session:** the T-559 session, started by the coordinator on 2026-11-19
- **Roadmap row:** N202

## What exists

T-547 fixed the reset for ciphertext uploads: past the node's limit the reader reads on to the protocol's 10 MiB ceiling, keeps nothing, and refuses at the end of the body. Its Handoff names the same reset on JSON bodies (`body()` in `apps/operator/src/server.ts`). T-540's finds (private repository, `roadmap/triage/2026-11-18-t-540-finds.md`, items 1 and 3) name the bare `contract revert InvalidMessage()` for a first decider's appeal ground, and the beacon errors' drift test that does not check the name map. No route, message, field or error code is needed: both refusals exist and keep their status and type.

## Intent

An outside agent that sends a wrong request gets a clear, stable refusal. A JSON body over a route's limit is refused with the same 413 and body as before, and the connection stays usable for the next request. A primary's or a fallback's decision that carries an appeal ground is refused with core's own reason instead of a bare contract error. A new beacon error cannot reach the relay without its problem type.

## Acceptance criteria

- [x] A test sends a JSON body over the limit and a second request on the same connection; it fails on `main` with the reset and passes after the fix, on every route that reads JSON.
- [x] The 413's status and body are unchanged; reading past the limit stops at a fixed ceiling and keeps nothing.
- [x] A test on anvil sends a primary's and a fallback's decision with an appeal ground; it fails on `main` with the bare contract error and passes after the fix with core's reason, and nothing is sent.
- [x] The early refusal turns away nothing the deployed contract accepts.
- [x] The beacon errors' drift test fails when a built error has no named entry.
- [x] The operator, core and EVM settlement tests pass, with anvil; one review and one red-team pass, every Medium or higher fixed with a test.

## Evidence

All measured on 2026-11-19 in this worktree, at `origin/main` `d9da8a00` plus this branch, unless labelled otherwise. Outputs are in `reports/scratch/t559-*` on the maintainer's machine (not committed).

**1. Oversized JSON bodies.** `apps/operator/src/body-limit.test.ts` sends a body 512 KiB over each route's limit on a keep-alive connection with one socket, then `GET /v1/status` on it.
- Before the fix: all four route tests failed with `read ECONNRESET` (a write, a prepare, an adjudicator registration, a feedback report).
- After: 6 of 6 pass. The 413 keeps its status, `type`, `maxBytes` and `detail` (`request bodies are limited to <limit> bytes here`), and the next request reuses the same socket and port.
- The fix (`body()` in `apps/operator/src/server.ts`): past the limit the loop reads on, keeps no chunk past the limit, and refuses at the end of the body. It reads on only to `MAX_CIPHERTEXT_BYTES` (10 MiB), the most the node reads for any request, as the ciphertext route does since T-547.
- The ceiling has its own test. A body 4 MiB past the ceiling, counted at the source through the Worker's fetch entry, must stop within two 64 KiB chunks of it, on `/v1/feedback` and `/v1/commitments`. With the ceiling line deleted, it read 14,680,064 bytes against a bound of 10,616,832 and failed in 12 ms.
- The reviewer ran the four route tests against `main`'s early-exit reader: all four failed.

**2. The reason for a refused decision.** `packages/settlement/evm/appeal-ground.test.ts`, on anvil:
- Before the fix: a primary's decision and a fallback's decision with an appeal ground got `contract revert InvalidMessage()`.
- After: both get `invalid_terms` with core's reason, `appealGround belongs to appeal decisions only`, and send no transaction. That covers a posted delivery, a carried delivery with accept, reject or escalate (the delivery stays unposted and the deal `Held`), and the fallback in `FallbackJudging`. The same decision without a ground then lands. The appeal adjudicator's decision with a ground still lands (`Released`).
- **Safe on `main`.** On `origin/main`, `HoldbackRules.decide` requires `m.role` to match the stage's role (`_turn`). A primary or fallback role reaches only `_firstInstance`, which reverts `InvalidMessage` unless `appealGroundHash == keccak256("")`. The schema allows only four non-empty grounds. The relay refuses only a non-empty ground on a non-appeal role, so it turns away nothing the deployed contract accepts. The reviewer and the red team each confirmed this from the code.
- The problem type is unchanged: `InvalidMessage` already mapped to `invalid_terms`. Core's reason is now the exported constant `APPEAL_GROUND_APPEAL_ONLY`, used by core and the relay.

**3. The beacon errors' drift test.** `errors.ts` exports `BY_NAME`. `errors.test.ts` now fails when an error in `BEACON_ERRORS` or in the built beacon's ABI has no entry. With `PairingGasBelowFloor` removed from `BY_NAME`, it failed with `expected [ 'PairingGasBelowFloor' ] to deeply equal []`.

**The recipe's checks** (kinds 4 and 5):
- `pnpm exec vitest run packages/settlement packages/core`, with anvil and `contracts/out` built: 45 of 45 files, 1,374 tests passed. `deploy-script.test.ts` passed too.
- `pnpm exec vitest run apps/operator apps/demo-cloud packages/core`: 1,495 passed, and 2 failed in `apps/demo-cloud/src/limits.attack.test.ts` (`t422-replay-cpu`, `t422-known-key-cpu`). Both time wall-clock work on bodies under 1 MiB, which never reach the changed code. They ran at a load average of 138 while many sessions compiled on this Mac: 1,834 ms per replay. Re-run at a load average of 13, they passed 12 of 12 at 76 ms per replay.
- `pnpm lint` and `tsc -b` passed.

**Review** (one reviewer, 2026-11-19): ISSUES. Both code changes are correct, with no Critical or High finding.
- Fixed: the Medium. No test held the 10 MiB ceiling, so a reader with none passed every test; the ceiling test above now fails it.
- Fixed: two Lows. The limit-plus-one test now says it is a boundary check (it also passed on `main`). The relay's comment now says a ground sent out of turn reads `invalid_terms` on EVM and `not_your_turn` on SimChain, and both send nothing.
- Fixed: the process Low (this file).
- Left as Low: the ceiling's cost (Handoff).

**Red team** (one red-teamer, 2026-11-19): no Critical, High or Medium. Rate-limit and idempotency counts match `main`'s (measured): three 413s then a 429 on unknown keys; two 413s then two 429s on a known key. No refusal stores an idempotency key. Its two Lows are in the Handoff.

## Handoff

**Done:** items 1 to 3. The pull request waits for the merge freeze of the fixed-contracts deploy (T-563). After the tag, bring `origin/main` into this branch, rerun the anvil suites against the new deployment record, and merge by hand once every check passes.

**What an operator deploy would carry:** `apps/operator/src/server.ts` and `packages/settlement/evm/evm-settlement.ts` are in the operators' Worker.
- A JSON body over a route's limit gets the same 413 at the end of the body.
- A first decider's appeal ground gets core's reason before any simulation.
- No route, field, status, problem type or judging-screen version changes; `packages/judgment` is untouched. It needs no deploy of its own.

**Found, not fixed (for the triage file):**
- **Every JSON refusal can read up to 10 MiB (Low; reviewer and red team).** That is up to 160 times the 16 KiB feedback limit (measured by the red team: 10,484,736 bytes read per refusal on the branch, 65,358 on `main`). The client sends every byte (1:1, no amplification), memory stays at about one route limit per connection, and the ciphertext route costs the same since T-547. On the Worker the read cost 4.5 to 6.1 ms of CPU per refusal against 0.6 ms on `main` (measured). Two aggravating factors:
  - The edge cap `bodyCapOf` (`apps/demo-cloud/src/limits.ts`) acts only on a declared Content-Length.
  - `/v1/prepare` is charged to the read budget.
  - A per-route ceiling such as `min(MAX_CIPHERTEXT_BYTES, limit + 1 MiB)` would bound it nearer the limit. Bodies past that cap would reset again.
- **A client that stops sending past the limit is held until Node's 300 s `requestTimeout` instead of answered at once (Low; red team).** `main` already holds one that stops just under the limit, so the bound per connection is unchanged.
- **A refusal sent before the body is read still resets an upload (Info).** For example, a 429 at entry gives EPIPE (measured). T-559 fixes only the 413 path.
- **Core refuses `appealGround: ""`, which the relay and the contract accept (Info, before this change).** The schema's enum stops it at the API. A direct `submit` that skips the schema would land on chain and then hit core's mirror as a divergence.
- **`limits.attack.test.ts`'s two timing tests fail under heavy load (Info).** They assert wall-clock thresholds, which a loaded Mac breaks (above). CI runs them on an unloaded runner.
