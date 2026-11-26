# T-630: the intermittent 500 on a first funding call: its cause, and a test on the standing take's path

- **Lane:** operator
- **Phase:** 2
- **Depends on:** T-609 (a write survives a failed chain read), T-549 (first takes of a standing seller)
- **Paths this task may touch:** `apps/demo-cloud/src/write-faults.anvil.test.ts`, this file
- **Human gate:** no for the merge (change recipe kind 4); there is nothing to deploy
- **Status:** review (pull request open, 2026-11-26)
- **Agent/session:** Claude Code side session, 2026-11-26
- **Roadmap row:** N232

## Intent

On the morning of 2026-11-25 the live operators sometimes answered 500 `internal` on a deal's first funding call, and the same body with the same `Idempotency-Key` then passed. This is step 3 of the stable milestone (row N231). Find the cause and prove it is gone:

1. Match the recorded 500s to a cause, by time and route.
2. Measure the live build: 20 first funding calls in a row, each on a fresh deal.
3. Fix what is left, test first. When T-609 already fixed it, add the test T-609 left out.

Non-goals: a new problem type, or a change to how an `internal` answers (see Handoff).

## Acceptance criteria

- [x] Each recorded 500 is placed in time against T-609's deploy (2026-11-25 12:47 UTC).
- [x] A test fails without the fix and passes with it, on the route the recorded 500s took.
- [x] 20 first funding calls in a row on the live build answer without a 500.
- [x] The package's tests pass with anvil.

## Root cause

**The 500s came from one failed chain read on a standing take's funding path, before T-609.** [inferred from the times, the routes and the anvil reproduction below; no log holds the live cause.] Before T-609 the funding of a standing offer's first take read the chain three times with no retry: the seller contract's code (`codeNow`), its runtime from the creation code (`runtimeOf`), and the deployment's gas estimate (`sendDeployment`). One bad answer from one RPC node failed the request with 500 `internal`, and a retry a few seconds later met a healthy node and passed. T-609 put all three behind the pinned read (`LiveChain.pinned`: asked again for up to five receipt polls, 10 s on Sepolia). Its tests covered the plain deal's reads only.

Cases in the record that are not this cause:

- The smoke test's two `internal` answers at 08:28 and 08:31 UTC came after 180 s and 97 s. T-609 traced them to a relayer lane that mined nothing (the receipt timeout), not to a read. T-609's Handoff item 1 (the adjudicator pass waits behind transactions in flight) is still open.

## Evidence

Times are UTC.

### The recorded 500s fall before T-609's fix

- [measured] The record of the standing-offer run (crow-ops-private `case-studies/test-crow-support/2026-11-25-standing-offer-result.md`) was committed at 2026-11-25 10:07 UTC (`c78c21a`). So every 500 it names came before 10:07 UTC, 2 h 40 min before T-609 went live at 12:47 UTC.
- [measured] The five deals in that record funded between 09:41:12 and 10:01:24 UTC on 2026-11-25 (`hold.funded` in each deal's public events, `GET /v1/commitments/{id}/events`). The two funding 500s answered after 1 s and 7 s, the shape of one failed read, not of the 180 s receipt timeout.
- [measured] The intake test's 500s at about 10:03 to 10:06 UTC were on `POST /v1/commitments`, the offer. T-609 reproduced that route's 500 after one failed `eth_getCode` and fixed it.
- [measured] The record names one Request-Id (`c2c7664a…`). No log holds its cause: before T-609 the `internal` catch dropped the exception (T-609, Evidence). Workers Logs could not be read anyway: no Cloudflare token was set in this session, and `docs/operations.md` names no read-only command for past logs (`wrangler tail` shows live requests only).
- [measured] Since 12:47 UTC on 2026-11-25, no record shows a 500: the three stranger smoke tests after 12:50, 18:06 and 22:15 UTC (crow-ops-private `case-studies/`), and test.crow.support's live takes on 2026-11-26 (its README, `d4c27f5`).

### The reproduction on anvil

A new case in `apps/demo-cloud/src/write-faults.anvil.test.ts` takes a standing offer whose seller contract has no code, through T-609's JSON-RPC stand-in. The stand-in answers `header not found` the first time each of the three reads is made.

- [measured] On this branch, the case passes: the funding answers 200 `Held`, each of the three reads failed once (3 faults in all), and the seller contract has code after.
- [measured] With T-609's three retries on that path reverted locally, the case fails: the take's funding answers 500 `internal` ("this attempt failed before the operator sent any transaction…", `retryAfterSec` 5). With the creation read's retry kept and the other two reverted, the funding call itself answers 500. Nothing reverted was committed.
- [measured] The file's other seven cases pass, unchanged.

### 20 first funding calls on the live build

`examples/try.ts --seller https://crow.direct/agents/test-seller`, run 20 times in a row from the maintainer's Mac on 2026-11-26, 13:59 to 14:15 UTC. Each run is a fresh buyer key, a faucet grant and a fresh deal with Crow's test seller. Odd runs relayed through api.crow.direct, even runs through api2.crow.direct. A preload logged each POST's status and Request-Id, with no body or key. Deployed build: `e9b3bd1`.

- [measured] 20 of 20 funding calls (`POST /v1/commitments/{id}/agree`) answered 200, in 4.9 s to 11.0 s. No call of any route answered 5xx. Every deal reached `Released`, in 45 s to 59 s.
- Not covered live: a standing offer's first take. Each would deploy a seller contract at Crow's gas, within the operator's daily deployment budget. The anvil case covers that path.

| Run | Relayed by | Funding status | Funding ms | Commitment | Final | Deal s |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | api.crow.direct | 200 | 10972 | `0xe0f6f2ea9e3b7c95c1d9510758d2ade44f872fe157154ef1343e5c504b028a7d` | Released | 45 |
| 2 | api2.crow.direct | 200 | 6895 | `0xeb72f5b578c2d1701cab7a05a40cc12a28ea0a3946b8004e55df2d7e975c1eef` | Released | 48 |
| 3 | api.crow.direct | 200 | 10761 | `0x474f6d8352bf17005412aadb73de45f82bc6d05b47993ecba40d6d9014b2e035` | Released | 48 |
| 4 | api2.crow.direct | 200 | 8584 | `0xafebae39e9dde8966cc85994b3353c1c639a779826f9877d8ef3eb211d228169` | Released | 48 |
| 5 | api.crow.direct | 200 | 10595 | `0x98d6ed723f30ac8221cc654a06068678022f922c97319cca8585901e6d2c4563` | Released | 47 |
| 6 | api2.crow.direct | 200 | 8512 | `0x274e67ff51eff22827a0dacd3cdf657a2d472a96d4ca09b05a0d9629660dafdc` | Released | 59 |
| 7 | api.crow.direct | 200 | 8607 | `0x725d854814c810ef0085a6f2894e9e08b4df54ce6a2be2a3da17a216b7b45f9d` | Released | 50 |
| 8 | api2.crow.direct | 200 | 6501 | `0xc30950e0d87cb6418a37dd71885a6b0387753c9290f5e2dd2f9c946c53c84d8a` | Released | 45 |
| 9 | api.crow.direct | 200 | 9314 | `0xae09404c5168ae6301e9653a1496bbeee7723dd5848f46392dc53debe42fad59` | Released | 50 |
| 10 | api2.crow.direct | 200 | 8517 | `0x60a13fbfe0d12f984d386384d222c1e63d9ebaedef97dafc5731221815d1c102` | Released | 47 |
| 11 | api.crow.direct | 200 | 8492 | `0xc7d88b4a1ef1cec56613efc69b20aae7fa566acba438987316d56dc08283df24` | Released | 49 |
| 12 | api2.crow.direct | 200 | 8587 | `0x4722b21c94ebb4fa2f461b04d6644d718b09aad8a14d45875f9fd4ab10f6b4ae` | Released | 47 |
| 13 | api.crow.direct | 200 | 8532 | `0xf48b3427b55c10d32a84dfef18d6da36de5e55cba3464b7bf843e097bd3b1030` | Released | 49 |
| 14 | api2.crow.direct | 200 | 6501 | `0x4d81f0267ac0f7621d343ef861ada56f5f8f1557b2ac4d38ca6917727c5eca31` | Released | 58 |
| 15 | api.crow.direct | 200 | 4865 | `0x336f70b90277f20d4d1c071e5b5ffe8fc6b424ef00e0553482af829b8eb07423` | Released | 49 |
| 16 | api2.crow.direct | 200 | 8556 | `0xf0990e849a057040ffc47c16a34232a47f3466add9b07238cdc85876ccb7c6c2` | Released | 45 |
| 17 | api.crow.direct | 200 | 8506 | `0x8805a66b30d40a2a8b58c83c191e3d2e201cdb46236a988b3daffcc27094b6f5` | Released | 47 |
| 18 | api2.crow.direct | 200 | 8490 | `0x19a502af948ce35ed484f9f30eb3c8d5cfaf4c047b96e4ce9da722bc8f1289d3` | Released | 57 |
| 19 | api.crow.direct | 200 | 8550 | `0x6101bc08589626d51b3cbfdad057b1569ea6f99eb29b292b82e9ef9129ce9b3f` | Released | 52 |
| 20 | api2.crow.direct | 200 | 6934 | `0x5f3b9537c8e2c299d1b8f44f60cbc713a6e86ade47bb7eb49c422d2c3c643d81` | Released | 48 |

### Local checks (change recipe kind 4)

- [measured] `pnpm exec vitest run apps/demo-cloud`, with anvil: 258 tests passed and 2 were skipped; 24 test files passed and 1 was skipped. No snapshot changed.
- [measured] `pnpm typecheck` and `eslint` on the changed test pass. `scripts/id-check.mjs` passes for this branch: it names T-630, and the task file names row N232.

## Decisions

- **No source change.** T-609 already fixed the cause; this task adds the test it lacked.
- **The answer to a read that keeps failing stays 500 `internal`, with `retryAfterSec`.** T-609 chose this, and changing it needs a new problem type, an ADR and a schema bump (see Handoff).

## Handoff

Done: the cause, the test, the live measurement. Not done: merge (the coordinator's).

Follow-ups, none fixed here:

1. **A typed answer for a chain the node cannot read.** When reads keep failing past the 10 s retry, the funding still answers 500 `internal`, now with `retryAfterSec` and "nothing was sent". A client that counts 5xx counts it as a fault. A 503 problem type (for example `chain_unavailable`) would need an ADR and a schema version bump.
2. **The adjudicator pass waits behind transactions in flight** (T-609, Handoff item 1): still open in `apps/demo-cloud/src/world.ts` (`recoverLanes` before the adjudicators). It explains the morning's 97 s and 180 s answers, not the fast 500s.
3. **Reads on the write path with no retry** (T-609, Handoff item 2): `feePaidEarlier` and `expire_offer`'s block read. Neither is reached on a funding while the operator fee is 0.
