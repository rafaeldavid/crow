# T-609: operator writes survive a failed chain read, and `internal` logs its cause

- **Lane:** settlement
- **Phase:** 2
- **Depends on:** T-232 (pinned reads), T-549 (contract signers)
- **Paths this task may touch:** `packages/settlement/src/interface.ts`, `packages/settlement/evm/`, `apps/operator/src/`, `apps/demo-cloud/src/`, `docs/api.md`, `docs/operations.md`, this file
- **Human gate:** yes: merge and deploy wait for Rafa (the coordinator's brief, 2026-11-25)
- **Status:** review
- **Agent/session:** Claude Code side session, 2026-11-25
- **Roadmap row:** none

## What exists

- `LiveChain.pinned` (T-232) asks a read again within five receipt polls when a node lacks the block. Several write-path reads do not use it.
- `RelayRefused` and the `relay_refused` problem answer the cases where this node declines to relay. Nothing answers "this node failed before it sent anything".
- The route catch in `apps/operator/src/server.ts` answers `internal` and drops the exception.

## Intent

On 2026-11-25 outside clients got 500 `internal` on offers and funded agreements while `/v1/status` read healthy. Find why and fix it:

1. A write must not fail because one chain read met one bad RPC answer.
2. When a write fails before this node sends a transaction, the answer says so and says how to retry.
3. Every `internal` leaves its cause in the node's log, under the Request-Id, with no address, key or signed body.

Non-goals: a new problem type or schema change, and the adjudicator pass that waits behind transactions in flight (see Handoff).

## Acceptance criteria

- [x] A test on anvil reproduces 500 `internal` on an offer and on a funded agreement before the fix.
- [x] The same test passes after it.
- [x] An `internal` raised before any broadcast says nothing was sent, carries `retryAfterSec`, and the same Idempotency-Key succeeds later.
- [x] Each `internal` logs one line with the Request-Id, the route and the cause.
- [x] The packages' tests pass with anvil.
- [x] One review of the settlement change, blocking findings only (change recipe, kind 5).

## Evidence

Times are UTC on 2026-11-25. The live evidence is public: the operators' `GET /v1/events` and the relayer lanes' transactions on Sepolia. Nobody read the operators' logs: no Cloudflare token was set in the session.

### What the live data shows

- [measured] The `internal` catch dropped the exception, and the request log has no cause field. So no log holds the cause of any past `internal`.
- [measured] Around 10:03 to 10:06, when a plain offer answered `internal` twice, every relayer transaction belongs to a faucet grant or to a deal that succeeded. Each success's offer, acceptance and funding show in the public events.
- [measured] The morning's failed first take is on relayer lane 2, which mined nothing between before 08:20 and 08:35:12.
- [measured] Another deal, delivered at 08:28:24, was decided at 08:31:24 (180 s). Three offers made 08:29:28 to 08:30:26 were accepted together at 08:31:27. A deal delivered at 08:32:48 was decided at 08:34:24.
- [inferred] The 180 s answer is the relayer's receipt timeout: a transaction was broadcast and not mined. Why it was not mined is not known. That build predates N216's lane top-up before each send.
- [inferred] The fast failures (1 s, 7 s, and the plain offers) are one chain read failing on the write path. For a plain public offer by a key, the signature check was the only read there that could fail the request, and it had no retry. T-549 added it: `eth_getBlockNumber`, then `eth_getCode` at that block. Which read failed, and with what RPC answer, is not known.
- [measured] 200 reads of that shape on each of the two public RPCs, from the maintainer's Mac, failed 0 times. This says nothing about Cloudflare's network or a keyed RPC.

### The reproduction

`apps/demo-cloud/src/write-faults.anvil.test.ts` runs the demo world as two operators over anvil, with a JSON-RPC stand-in that answers chosen calls `header not found`.

- [measured] On `main`, five cases failed (the first version of the file): an offer and a funded agreement answered 500 `internal`, with the body the outside clients got, after one failed `eth_getCode`; a funded agreement answered 500 after five failed balance reads, and after one failed receipt poll.
- [measured] On this branch, every case in the file passes.
- The third case changed after the `main` run: the first version's five faults landed on the funding's own balance check, because the balance cache answered the earlier reads. It now waits out the cache and fails the two reads before the relay.

### Local checks

- [measured] On the branch with `main` merged (`7384d28a`): `pnpm typecheck`, `eslint .` and `pnpm validate:spec` pass.
- [measured] `vitest run packages/settlement apps/operator apps/demo-cloud apps/adjudicator`, with anvil: 1342 tests passed and 3 were skipped; 102 test files passed and 2 were skipped. No snapshot changed.
- [measured] Two earlier runs failed in `deploy-script.test.ts` only, for reasons outside the change. First, 27 cases: Finder wrote `.DS_Store` files into this checkout's submodules, and the script refuses uncommitted changes under `contracts/lib`. The passing runs told git to ignore `.DS_Store` through `GIT_CONFIG_*` variables, which changes no config. Second, 3 cases: the Mac slept from 12:17 to 12:48 local time during the run, and two of them timed out across it; the third's cause is inferred to be the same.

## Decisions

- **No new problem type.** The answer stays `internal` (500) and adds `retryAfterSec`, which the problem body and `Retry-After` already carry for `rate_limited`. No schema change.
- **The claim is per attempt.** `NothingSent` means this attempt called no broadcast, and no open lane row may be this commitment's. A row that was given up can still be mined, so the answer tells a caller whose earlier attempt lacked `retryAfterSec` to read the state first.
- **A live chain only.** The anvil scenario world does not call `onBroadcast`, so it never claims.
- **Advisory notices fail soft.** `bondNoticesFor` returns none rather than fail a write.
- **The receipt wait tolerates failed polls for five poll intervals** (10 s on Sepolia), the bound a pinned read already has. It never gives a transaction up while polls fail.

## Handoff

Done: the fix, its tests, one review (verdict ISSUES; both blocking findings fixed). Not done: merge and deploy, which wait for Rafa.

**After a deploy,** search holdback-op1's Workers Logs for `internal on`. Each line names the real cause. If the cause is a read on the write path that still has no retry, give it one.

Follow-ups, none fixed here:

1. **The adjudicator stall (a second defect).** `PublicWorld.work()` calls `recoverLanes()` before the adjudicators. `EvmSettlement.recover()` waits on every open row, live ones included, so every pass waits behind every transaction in flight, up to the 180 s receipt timeout [inferred from code; it matches the measured morning stall; no test yet]. `orphans()` alone is not enough: a mined row whose later reads failed is not among them.
2. **Reads on the write path with no retry** remain in the operator fee's recovery (`feePaidEarlier`) and in `expire_offer`'s block read. A failure there now answers that nothing was sent, and logs its cause.
3. **Log scrubbing limits** (review, not blocking): a URL path with no scheme, a short key in a subdomain, and short base64 runs that hold `/` pass through. `worker.ts` still cuts the configured RPC URLs.
4. `spec/openapi/paths.json` describes `retryAfterSec` for `rate_limited` only; it is outside this task's paths.
