# T-629: The operators' deploy waits out a slow World handover

- **Lane:** infra
- **Phase:** 2
- **Depends on:** T-370, T-377
- **Paths this task may touch:** `scripts/deploy-lib.mjs`; `apps/demo-cloud/scripts/deploy.mjs`; `apps/demo-cloud/src/deploy-preflight.test.ts`; this file.
- **Human gate:** no. The change runs no deploy; the next deploy waits for Rafa.
- **Status:** review
- **Agent/session:** deploy-wait-session, 2026-11-26; branch `t-629-deploy-world-handover`
- **Roadmap row:** none
- **Change kind:** API and operator code (kind 4): the deploy tooling of `apps/demo-cloud`

## What exists

`pnpm demo-cloud:deploy` (`apps/demo-cloud/scripts/deploy.mjs`) uploads both operator Workers, then waits until both nodes' discovery names the deployed commit (`waitForCommit` in `scripts/deploy-lib.mjs`, T-370), then runs one smoke deal. A failed step rolls each changed Worker back (`rollback`), and the record line says "rolled back" once wrangler shows the old version at 100%. The deal guard (`dealGuard`, T-377) reads the commit discovery names before any upload.

The deploy at commit `9375c7d` on 2026-11-26 failed, measured:

- The World Durable Object took more than the 600 s budget (`COMMIT_TIMEOUT_MS`) to move to the new version. Past deploys measured 0 s, 255 to 286 s, and once 677 s on a passing deploy (`docs/operations.md`, the record line of 2026-11-25 06:35 UTC).
- The failure said "still names commit none". `waitForCommit` keeps only its last read, and the last read hung about 30 s during the handover. Earlier reads had named the old commit.
- After the rollback, the script reported "rolled back", but discovery named `9375c7d` for another 40 to 55 minutes, until between 08:28 and 08:40 UTC.

## Intent

Make the deploy tell a slow handover from a broken one, and report a rollback only once the World runs the old code again.

- The wait for the new commit keeps a tally of its reads: the commit each read named, the non-OK statuses, the reads that were not JSON or named no commit, the timeouts, and when each phase began and ended. A failure message says what the wait saw.
- A deploy whose only problem is that the old commit is still served keeps waiting, up to a ceiling of 1200 s.
- A run of failed reads fails fast in two cases: after the new commit first appeared (6 in a row), and when no read has named any commit yet (12 in a row).
- After a rollback, the deploy waits, with its own ceiling, until discovery names the commit that was live before the upload. Until then the record line says "front Workers rolled back; World still on `<new>` after N s".

Non-goals: the discovery `deployedAt` mismatch (it changes `spec/openapi/paths.json` and needs an ADR); any change to the other deploys (site, test seller, early access, hosted sellers), which share `rollback` and `recordLine` and keep their behaviour; running a deploy or a rollback.

## Acceptance criteria

- [x] A fake discovery that names the old commit and then hangs until the read is aborted fails with a message that names both: the old commit with its time span, and the timed-out read.
- [x] A fake discovery that names the old commit for 1000 s and then the new one passes within the 1200 s ceiling; `deploy.mjs` sets that ceiling.
- [x] After the new commit appears on one node, 6 failed reads in a row on a node fail the wait; 5 then the new commit pass.
- [x] 12 failed reads in a row with no commit ever named fail the wait; failed reads after the old commit was named do not.
- [x] After a rollback, a fake discovery that keeps naming the new commit gives a record line with "front Workers rolled back; World still on `<new>` after N s" and without ", rolled back".
- [x] A fake discovery that names the old commit again gives "rolled back" and the seconds it took.
- [x] The deal guard returns the live commit it read.
- [x] `pnpm typecheck`, `pnpm lint` and the tests of `apps/demo-cloud` pass.

## Out of scope

- The `deployedAt` field in discovery (follow-up, below).
- A change to how wrangler rolls back.

## Evidence

All on 2026-11-26, on branch `t-629-deploy-world-handover` at `b845c4ef`, in a fresh clone after `pnpm install --frozen-lockfile` and `pnpm build`.

- `pnpm typecheck` passes [measured].
- `pnpm lint` passes [measured].
- `pnpm exec vitest run apps/demo-cloud`: 18 files and 231 tests passed; 7 files and 21 tests skipped [measured]. The skipped files need anvil and `forge build` output in `contracts/out`, which this clone lacks; none of them imports the deploy script or `scripts/deploy-lib.mjs` [measured by their skip messages; that they are unaffected is inferred]. CI runs them.
- `apps/demo-cloud/src/deploy-preflight.test.ts`: 41 tests passed [measured]. On the old `scripts/deploy-lib.mjs` and `deploy.mjs` (commit `a557fc5d`, the tests alone), 12 of its 41 tests failed and 29 passed [measured].
- `apps/test-agents/src/deploy.test.ts`, which shares `scripts/deploy-lib.mjs`: 26 tests passed [measured]. `recordLine` without `world` writes the line it wrote before, so the site, test seller, early access and hosted sellers deploys are unchanged [inferred from the code; one test pins the operators' line without `world`].
- The glue in `deploy.mjs` (the wait after the rollback, the `world` passed to the record line) runs in no test: a test of it would need stand-ins for wrangler's deploy, status and rollback and a built `packages/core` [inferred: it calls only the tested functions]. No deploy ran.
- No snapshot changed; no schema, contract or defense changed [measured by `git diff --stat origin/main`].

## Decisions

- **Ceilings.** The forward wait has 1200 s while the old commit is served, about twice the longest handover on a passing deploy (677 s). The rollback wait has its own 1200 s. After the rollback of 2026-11-26 the World took 40 to 55 minutes, so this ceiling will often end with "World still on"; the script then exits and says so, rather than block an operator's terminal for an hour.
- **Fail-fast counts.** 6 failed reads in a row after the new commit appeared on any node: the World has moved, so a node that still cannot answer is broken. 12 in a row with no commit ever named: discovery is down, not handing over (12 reads at 5 s apart, each up to 30 s, is 1 to 7 minutes). Failed reads after the old commit was named, before the new one, are a handover and wait to the ceiling.
- **A missing commit field counts as a failed read**, with timeouts, non-OK statuses, non-JSON bodies and failed connections. The tally names it on its own ("named no commit").
- **The rollback waits only when every Worker that needed a rollback rolled back.** A failed rollback already reads ROLLBACK FAILED with the command to run.
- **New functions, not a changed `rollback`.** `rollback` and `recordLine` serve four other deploys; `waitForRollback` and `recordLine`'s optional `world` touch only the operators' deploy.
- **The tally keeps a long run short:** past 8 phases, the first phase, a count of the ones left out, and the last 6.

## Handoff

- **Done:** items 1 to 3 of the brief, with tests in `apps/demo-cloud/src/deploy-preflight.test.ts`. The PR is open; it is not merged, and no deploy ran.
- **Follow-up, not done (needs an ADR):** discovery's `deployedAt` does not match the version the World runs during a handover. A fix changes `spec/openapi/paths.json`, so it needs an ADR and a version bump.
- **Follow-up, not done:** a test of `deploy.mjs` end to end through a failed smoke deal and a rollback, with stand-ins for wrangler that answer `deployments status`, `deploy` and `rollback`.
- **The next deploy** waits for Rafa. Expect the wait for discovery to take up to 20 minutes before it fails on a slow handover alone, and up to 20 minutes more after a rollback.
- **To resume:** `pnpm install`, `pnpm build`, then `pnpm exec vitest run apps/demo-cloud/src/deploy-preflight.test.ts`.
