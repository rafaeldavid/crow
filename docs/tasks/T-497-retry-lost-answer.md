# T-497: the agents' HTTP client retries an answer lost on the network, with the same Idempotency-Key

- **Lane:** demo (the agents' client in `examples/`, and the published bundles that carry it)
- **Phase:** 2
- **Depends on:** T-496 (the try bundle and its live run)
- **Paths this task may touch:** `examples/agent.ts` (`Agent.call` only), `examples/agent-call.test.ts` (new), the rebuilt bundles `site/try.mjs`, `site/buy.mjs`, `site/setup.mjs`, `site/try-sell.mjs`, `site/try-judged.mjs`, `site/try-reclaim.mjs`, and `site/index.html`, this file.
- **Human gate:** the site deploy, Rafa's. Rafa accepted on 2026-11-17 that `buy.mjs`'s hash changes while the pilot's buyer depends on it ("Fix it now", through the session that started this one).
- **Status:** review
- **Agent/session:** the try-bundle session, 2026-11-17, branch `t-497-retry-lost-answer`.
- **Roadmap row:** N172
- **Change kind:** 1 (the published commands and their pages), with the examples' own tests for the code

## Intent

Restated in my own words.

On 2026-11-16 at about 22:32 UTC, one live run of the published try command printed "stopped at fund: fetch failed" and exited 1. Its deal still funded and released on both operators. The operator did the work, and its answer never reached the buyer. `Agent.call` sent each POST once with a fresh Idempotency-Key and threw away the error's cause.

The fix: when the answer is lost on the network, `Agent.call` sends the same request again, with the same Idempotency-Key and body. It tries 3 times in all, waiting 1 s, then 2 s. The operator replays the answer it stored, so nothing runs twice. A request that never reached the operator (a refused or timed-out connection, a host or network out of reach, a name that does not resolve, a TLS failure, a port fetch refuses) is not retried, nor is a headers timeout, where the operator held the request for minutes. Those are, so a caller fails over to the other operator at once. When the call gives up, it names the request, the host and the network error's cause. The error stays a `TypeError`, as fetch's own failure is, because callers fail over on that type.

Non-goals: retrying an answer that arrived, a refusal or a 5xx included; changing any caller.

## Acceptance criteria

- [x] A test fails without the fix: a server that drops the first connection after reading the request.
- [x] The retry sends the same Idempotency-Key and body; a GET is retried with no key.
- [x] The call gives up after 3 tries and names the cause; a refused connection gives up at once.
- [x] Every bundle that carries `agent.ts` is rebuilt, and every published hash is updated in this PR.

## Evidence

All measured on 2026-11-17, on branch `t-497-retry-lost-answer`.

- **The test before the fix:** `pnpm exec vitest run examples/agent-call.test.ts` failed 3 of 4 tests with "TypeError: fetch failed. Caused by: SocketError: other side closed", the error class of the live run. After the fix, 5 of 5 tests pass.
- **The suites:** `pnpm exec vitest run examples apps/test-agents apps/hosted-sellers tests/site-bundles.test.ts tests/site-guides.test.ts tests/guide-budget.test.ts tests/record-copies.test.ts tests/site-deploy.test.ts tests/site-headers.test.ts tests/metrics`: 82 files passed, 1,139 tests passed, 42 skipped (the network ones). `node site/check.mjs` passes, and `pnpm typecheck` passes.
- **One regression found and fixed on the way:** the test buyer (`apps/test-agents/src/buyer.ts`) fails over to the next operator on a `TypeError`. The first version threw a plain `Error`, and "still funds and settles when one operator is offline" failed with HTTP 503. The call now throws a `TypeError` with the original error as its cause, and the test passes.
- **The hashes**, SHA-256, `origin/main` at `9161d926` to this branch:

| File | Before | After |
|---|---|---|
| `try.mjs` | `ec018e6a9ffc005ca59898e12e8d137ab61779202efce0ee4d22639db519dead` | `fd7d9a4ad98d0cd16c0a392d47f97a18c4cb8d1762213e92a6d6e78790326af6` |
| `buy.mjs` | `a9a18edcb12693aec65e02d172fb920bdc3707b126ea370315e9d159f7974b9e` | `ce61062649214357f4c552445f3d25c756999279769a7d3d2c62f5f14ad1311d` |
| `setup.mjs` | `f3b405fb93ffa64b125ce1c4ed9921eff4a6b89f2ca97ffa422cf27360def768` | `260d1660a9e44fd7c1b4fc06432a7c7ccef2cc1dd7ea2e1154c7308997cc3fcd` |
| `try-sell.mjs` | `b4b3bdac8cc3f305ac2980d721a8e1041747066edfe237c5b4ac8f9cf622895b` | `6c3a609f5d33678350ecb8defeff93a74e58c07a671807b3855d2aaf27023bf8` |
| `try-judged.mjs` | `65f54147f1351610de1788ff3f19e91d434acf6b4d22db1ad50923d4178fb6e9` | `2b8945ad4b9dc30fbc857bcf09d039cc5a48ec30d5370f694e2cc74abd6e7525` |
| `try-reclaim.mjs` | `463909aeefcacc7f22f44f757b7acf80973cfb65605a1f0f604f21da09ddbf3a` | `d55ff65337a3858afa591ce7252f4dcabc41add782ad56683cb07d36f99faae0` |
| `preflight.mjs` | unchanged, `4ddd3da8…3faa` (it does not carry `agent.ts`) | |

- **The published copies:** the build fills every command's hash into `llms.txt`, `buy.txt` and `setup.txt` at publish, and into `site/index.html` now. `git grep` finds none of the old hashes in a standing file.

- **Review (reviewer agent, PASS, no blocking finding).** Fixed from its notes: no retry on a connect timeout, an unreachable host or network, a TLS failure or a headers timeout; the message says "1 try". Left: a body cut off while `res.json()` reads it is not retried (the live failure came before the headers).

## Decisions

- **Retry only an answer that may have been lost.** A refused connection, a name that does not resolve, and a port fetch refuses mean the request never left this machine, so there is nothing to replay. A retry there would only delay the caller's move to the other operator.
- **3 tries, 1 s then 2 s.** That is enough to ride out a dropped connection. It adds at most 3 s to a call that will fail anyway.
- **The operator side needs no change.** `IdempotencyStore` runs requests with the same key one after another and replays the stored answer. At the settlement layer, a funding repeated after it went through is replayed or refused.

## Handoff

- **The pilot's buyer:** `buy.mjs` changes from `a9a18edc…74b9e` to `ce610626…1311d`. After the deploy, the pilot buyer's install line in the live `buy.txt` carries the new hash, and an install line copied before the deploy fails its hash check, which is the safe way to fail. The pilot session updates any copy it handed out.
- **The hosted sellers** import `agent.ts` through `examples/seller-adapter-core.ts`. Their deployed Workers do not change until their next deploy; the frozen files are not edited here.
- **After the deploy:** the live checks and one live try run.
