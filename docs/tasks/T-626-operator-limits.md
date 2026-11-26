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

- `apps/operator/src/server.ts`: a new option, `quota`, with the types `QuotaSubject` and `QuotaTake`. The operator asks it inside the idempotency handler, around the relay of a write and around the store of a ciphertext. Without the option, a node behaves as before.
- `apps/demo-cloud/src/limits.ts`: `dailyCapQuota` holds the caps' rules and refusal texts, moved from `world.ts`. `capOf` and `routedUrl` are gone, because the operator's parsed operation replaces them.
- `apps/demo-cloud/src/world.ts`: the wrapper is gone. `fetch` passes each request to the operator.
- `docs/operator-threat-model.md`: says when the operator asks the caps.

What a caller can see:

- A cap refusal now carries the operator's `Request-Id` and schema-version headers, its `instance` names that Request-Id, and the request log records its problem type.
- A request that the operator refuses for another reason (shape, policy, signer budget, fee) gets that refusal, even when a cap is also spent.
- The 413 of a body over the limit has the operator's own text. Its type and `maxBytes` are the same.

The stored cap rows and the fingerprints in them keep their format, so a day's counts hold across a deploy.

## Acceptance criteria

- [x] Tests in `apps/demo-cloud/src/limits.test.ts` show that the operator's budgets answer before the daily caps on the four capped routes.
- [x] A replay of an accepted funding and of an accepted upload is answered once the write budget and both daily caps are spent.
- [x] `neutrality.operator-daily-cap` passes.
- [ ] One red-team pass, with its blocking findings fixed.
- [x] The tests of `apps/demo-cloud` and `apps/operator` pass.

## Evidence

All measured on 2026-11-26.

- `pnpm build`, `pnpm typecheck` and `pnpm lint` pass.
- `pnpm exec vitest run apps/demo-cloud apps/operator`, with anvil and built contracts: 55 files and 586 tests passed; 1 file and 2 tests skipped. The result is the same after the merge of `origin/main` at `1a2440e3`.
- After that merge, `node site/build.mjs && node site/check.mjs` passes and changes no file.
- No snapshot changed.

## Decisions

- The quota is an operator option, not a second check in front of the operator. One throttle then covers each request, and there is no second reading of its path or body to keep in step.

## Handoff

- **Not done: the red-team pass.** The red-team agent's session ended before it reported findings. At the coordinator's request, a reviewer pass runs on the pull request. It is a code review and does not count as the red-team pass.
- The coordinator merges after CI passes and the review is clean. This session does not merge.
- No deploy. A deploy waits for Rafa.
- To resume: run the tests above, after `pnpm build` and `forge build --root contracts`.
