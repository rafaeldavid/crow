# T-494: Crow Control is current and says how old its data is

- **Lane:** company operations (Crow Control; the deploy scripts in holdback, the page in crow-private)
- **Phase:** 2
- **Depends on:** T-404 (the rebuilt page), T-454 (the build's skip rule)
- **Paths this task may touch:** in holdback, `scripts/deploy-lib.mjs`, the five deploy entries (`site/deploy.mjs`, `apps/demo-cloud/scripts/deploy.mjs`, `apps/early-access/deploy.mjs`, `apps/test-agents/scripts/deploy.mjs`, `apps/hosted-sellers/scripts/deploy.ts`), `tests/deploy-refresh.test.ts` (new), the `gh` stand-ins in `apps/demo-cloud/src/deploy-preflight.test.ts` and `tests/site-deploy.test.ts`, one paragraph of `docs/operations.md`, this file. In crow-private, `control/console.html` and `control/test/fresh.test.mjs` (new), in its own pull request.
- **Human gate:** the Crow Control Worker deploy that ships the page, Rafa's, given 2026-11-16 ("Yes, go ahead" to the plan).
- **Status:** review
- **Agent/session:** the expo/exact review session, 2026-11-16, branch `n166-deploy-refresh`.
- **Roadmap row:** N166
- **Change kind:** 4 is the nearest (deploy scripts); 3 for the page.

## Intent

Restated in my own words.

On 2026-11-16, 40 minutes after both operators were deployed, Crow Control still showed them behind. Rafa: the dashboard "is just not presenting information that's either accurate or understandable." Two causes. The page builds automatically at most once every two hours, and a deploy changes nothing that would start a build. And the page did not say clearly how old its data was, so old data passed for current. This task fixes both. Every deploy script ends by starting a Crow Control build, which a manual run always does. Every tab shows the data's read time and age, in amber past 2 hours, with the private part's own push time.

The row descriptions in the Work tab are the same row's second part, in later pull requests.

## Acceptance criteria

1. A deploy that may have changed what runs (exit 0 or 1, not a dry run or check-only) starts `control-hourly.yml` in crow-private and prints one line; without `gh` it says so and names the command; the exit code never changes; a refusal before upload (exit 2) starts nothing.
2. No test reaches GitHub: the tests that run a real deploy entry put a stand-in `gh` first on the PATH.
3. Every tab shows "Data read at HH:MM UTC, N min ago", says plainly when the data is older than 2 hours, shows the private part's push time, and reads missing when the build has no time.

## Evidence

All measured on 2026-11-16.

- holdback: `vitest run tests/deploy-refresh.test.ts apps/demo-cloud/src/deploy-preflight.test.ts tests/site-deploy.test.ts tests/early-access-deploy.test.ts apps/test-agents/src/deploy.test.ts apps/hosted-sellers`: 7 files, 106 tests passed. The operator deploy's entry, run to its end in a temporary repository, prints "Crow Control: no build started (gh exit 1); …" with the stand-in `gh`, and keeps exit 1. eslint and `tsc -p apps/hosted-sellers` report no findings.
- crow-private: `node --test control/test/fresh.test.mjs` passes 4 of 4; `control/test/page.test.mjs` passes 14 of 14.

## Handoff

- The page change reaches control.crow.direct only after the Crow Control Worker deploy: `npx wrangler@4.151.3 deploy --config reports/crow-private/control/wrangler.access.jsonc` (crow-private `control/README.md`).
- Next on row N166: a plain "what it is" and "done when" for each open roadmap row, in the rows' `public.intent` and `public.doneWhen`, shown in the Work tab; and clearer labels where one does not stand alone.
