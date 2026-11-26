# T-626: Operator limits upkeep

- **Lane:** api
- **Phase:** 2
- **Depends on:** T-422
- **Paths this task may touch:** `apps/demo-cloud/`; `apps/operator/src/` (the write path); `docs/operator-threat-model.md`; this file.
- **Human gate:** yes. A deploy of the operators waits for Rafa.
- **Status:** review
- **Agent/session:** operator-limits, 2026-11-26; branch `t-626-operator-limits`
- **Roadmap row:** none
- **Change kind:** API and operator code (kind 4), with one red-team pass

## What exists

T-422 added the daily caps (`DailyCaps` in `apps/demo-cloud/src/limits.ts`) and the operator's read, write and replay budgets (`apps/operator/src/server.ts`). The World object applied the caps in a wrapper around each operator. This task changes where the caps run. It adds no limit and changes no limit's value.

## Intent

Make each operator ask the daily caps itself, as a quota, after its throttle and its own checks and just before it relays or stores. The caps then take the operation as the operator parsed it. Keep T-422's replay rule: no daily cap and no write budget refuses a replay of an accepted request. Non-goals: new limits, new values, a schema or contract change, a deploy.

## Change

- `apps/operator/src/server.ts`: a new option, `quota`, with the types `QuotaSubject` and `QuotaTake`. The operator asks it inside the idempotency handler, around the relay of a write and around the store of a ciphertext. The quota gets a frozen copy of its subject, so it cannot change what the operator relays. Without the option, a node behaves as before.
- `apps/demo-cloud/src/limits.ts`: `dailyCapQuota` holds the caps' rules and refusal texts, moved from `world.ts`. `capOf` and `routedUrl` are gone, because the operator's parsed operation replaces them.
- `apps/demo-cloud/src/world.ts`: the wrapper is gone. `fetch` passes each request to the operator.
- `docs/operator-threat-model.md`: says when the operator asks the caps.

What a caller can see:

- A daily-cap refusal now counts as a write against the client's write budget, because the throttle counts every write at entry. At the defaults, 120 refusals in 60 s also stop that client's other writes at that operator until the window ends. The other operator counts separately.
- A client whose write or replay budget is spent gets the throttle's 429 in place of a cap's. It has the throttle's text, and its `retryAfterSec` runs to the end of the window, not to 00:00 UTC.
- A request that the operator refuses for another reason (shape, policy, signer budget, fee) gets that refusal, even when a cap is also spent.
- A body over the limit on a route that a cap counts is a write like any other: it counts against the budget, and past the budget it gets the 429 in place of the 413. The 413 has the operator's own text. Its type and `maxBytes` are the same.
- A cap refusal now carries the operator's `Request-Id` and schema-version headers, and its `instance` names that Request-Id. The request log records it, so the hourly and daily summaries count it under `throttled.write`.
- When the caps' storage fails before a relay or an upload, the answer is a 500 `internal` problem. For a relay it says that nothing was sent.

The stored cap rows and the fingerprints in them keep their format, so a day's counts hold across a deploy.

## Acceptance criteria

- [x] Tests in `apps/demo-cloud/src/limits.test.ts` show that the operator's budgets answer before the daily caps on the four capped routes.
- [x] A replay of an accepted funding and of an accepted upload is answered once the write budget and both daily caps are spent.
- [x] `neutrality.operator-daily-cap` passes.
- [ ] One red-team pass, with its blocking findings fixed.
- [x] The tests of `apps/demo-cloud` and `apps/operator` pass.

## Evidence

All measured on 2026-11-26.

On the code after the review's fixes, with `origin/main` at `1a2440e3` merged in:

- `pnpm build`, `pnpm typecheck` and `pnpm lint` pass.
- `pnpm exec vitest run apps/demo-cloud apps/operator tests/design-map.test.ts`, with anvil and built contracts: 57 files and 631 tests passed; 1 file and 2 tests skipped.
- `node site/build.mjs && node site/check.mjs` passes and changes no file.
- No snapshot changed.
- The test of replays after a reopen fails with 429 when `dailyCapQuota` skips its check of the deal's state, and when it skips its check of the stored bytes. Both lines were restored.
- The frozen-copy test in `apps/operator/src/quota.test.ts` failed with a 500 before the quota got a frozen copy.

## Decisions

- The quota is an operator option, not a second check in front of the operator. One throttle then covers each request, and there is no second reading of its path or body to keep in step.

## Handoff

- **Not done: the red-team pass.** The red-team agent's session ended before it reported findings. At the coordinator's request, a reviewer pass ran on the local branch. It is a code review and does not count as the red-team pass.
- **Review, 2026-11-26, at `d9b08468`: ISSUES, nothing blocking.** Fixed after it: a test for replays after a reopen; the frozen copy for the quota; operator tests for the `quota` option; one test title that claimed more than its test; the list of what a caller can see; the option's comment; and in the threat model, how a cap refusal counts and how far the operator reads an oversized body. No second review ran on these fixes.
- This session does not push: auto mode refused its push, and Rafa pushes the branch. The coordinator merges after CI passes. This session does not merge.
- No deploy. A deploy waits for Rafa.
- To resume: run the tests above, after `pnpm build` and `forge build --root contracts`.
