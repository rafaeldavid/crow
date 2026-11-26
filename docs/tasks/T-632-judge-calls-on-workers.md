# T-632: Live judge calls work on the Workers runtime, and a failed call names its cause

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** T-631 (PRs 848, 849, 850)
- **Paths this task may touch:** `apps/adjudicator/src/providers/`, `apps/demo-cloud/src/judges.ts`, `apps/demo-cloud/src/judges.test.ts`, this file
- **Human gate:** no for this pull request; yes for the redeploy, which is Rafa's
- **Status:** in review
- **Agent/session:** opus-swap, 2026-11-26; branch `t-632-judge-calls-on-workers`
- **Roadmap row:** none (the stable milestone of 2026-11-26, step 4: the regression pass)

## What exists

Read on 2026-11-26 at `origin/main` `00b30525`, which is live since the flip deploy (operators at 18:42 UTC).
- **The failure:** after the flip, every live judge seat errored (crow-ops-private `case-studies/2026-11-26-regression-pass/README.md`, rerun section, commit `ffeda19`). On deal `0xd865116c…93a6`, all three primary seats and all five appeal seats are `status: "error"`.
- **What the records show:** the seat records carry no detail. `liveCallsToday` rose from 30 to 46, and `tokensToday.byModel` gained no new model.

## Intent

Live judge calls succeed on the operators, and a failed call leaves a cause someone can read.

1. **The cause [measured]:** T-631 fixed red team L3 by sending `fetch` with `redirect: 'error'`. The Workers runtime refuses that value: `TypeError: Invalid redirect value, must be one of "follow" or "manual"` (wrangler 4.151.3 dev, compatibility date 2025-09-15, `nodejs_compat`, on 2026-11-26). Node accepts it, so every test passed.
2. **The failure chain:** the adapter turned the throw into a transport error ("network error"). The pipeline retried once, and the seat ended in error with no tokens. That happened for every provider, so every seat failed. The code shipped with the carry deploy, so judged deals under the old registry failed the same way from deploy 1 on [inferred].
3. **The fix:** `redirect: 'manual'`. A 3xx comes back as the response, and the adapter refuses it as a non-transport error, without following it or resending the key, so L3 stays closed.
4. **Observability:** each failed call reports a code from a closed list (`network`, `redirect`, `http_<status>`, `blocked`, `stopped`, `no_text`). The world counts it per model in `demo.judges.tokensToday.byModel.<model>.errors` and logs one line: `judge call failed: <provider> <model> <code>`. The codes carry no provider text, prompt or key.
   - **Not in the judgment record:** a code on the record would change every kept aggregation's output, so it would need new aggregation versions (ADR-0036).

- **Non-goals:** no change to the registry, the policy, the judgment record or the schema.

## Acceptance criteria

- [x] Every seat of `config/judges-live-2.yaml` and of `config/judges-live.yaml` answers, its repeat seat included, against a fetch that refuses what workerd refuses. The test goes through `liveJudges` with the providers the registry seats (`workers-fetch.test.ts`), and through the Worker's own `panelConfig` (`judges.test.ts`). Without the fix, the 4 new adapter tests fail [measured].
- [x] A 3xx is refused, unfollowed, as a non-transport error, and the request carries `redirect: 'manual'` (`workers-fetch.test.ts`, `attack.gemini.test.ts`).
- [x] Each failure reports its code, never provider text or a key (`workers-fetch.test.ts`). The world counts it by model and code and logs one line (`judges.test.ts`).

## Evidence

- **The cause [measured]:** a probe Worker ran under `npx -y wrangler@4.151.3 dev --local` with the operators' compatibility date and flags. It sent `fetch` with each `redirect` value: `error` threw the TypeError above, while `manual` and `follow` answered. It made no model call.
- **Node's manual mode [measured]:** Node's `fetch` with `redirect: 'manual'` returns a 3xx as the response (301 from `http://github.com/`), which the adapter refuses.
- **Checks [measured]:**
  - `pnpm exec tsc -b` passes, and `pnpm lint` exits 0.
  - `pnpm exec vitest run packages/judgment apps/adjudicator apps/demo-cloud packages/testkit`: 2,409 passed, 5 expected failures, 37 skipped.

## Handoff

- **Redeploy:** Rafa's call. Deploy this PR's merge commit to the operators the usual way (`pnpm demo-cloud:deploy`); no secret or registry change.
- **After it:** run one judged deal. `demo.judges.tokensToday.byModel` should list `gemini-4-neon@2026-11-26` with calls and no errors.
- **Then:** rerun regression items 5 and 6.
- **Follow-up:** a CI check that runs the live provider code in workerd itself, so a runtime difference like this one fails before a deploy. Not done here.
