# T-629: The operators' deploy waits out a slow World handover

- **Lane:** infra
- **Phase:** 2
- **Depends on:** T-370, T-377
- **Paths this task may touch:** `scripts/deploy-lib.mjs`; `apps/demo-cloud/scripts/deploy.mjs`; `apps/demo-cloud/src/deploy-preflight.test.ts`; this file.
- **Human gate:** no. The change runs no deploy; the next deploy waits for Rafa.
- **Status:** in progress
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

- [ ] A fake discovery that names the old commit and then hangs until the read is aborted fails with a message that names both: the old commit with its time span, and the timed-out read.
- [ ] A fake discovery that names the old commit for 1000 s and then the new one passes within the 1200 s ceiling; `deploy.mjs` sets that ceiling.
- [ ] After the new commit appears on one node, 6 failed reads in a row on a node fail the wait; 5 then the new commit pass.
- [ ] 12 failed reads in a row with no commit ever named fail the wait; failed reads after the old commit was named do not.
- [ ] After a rollback, a fake discovery that keeps naming the new commit gives a record line with "front Workers rolled back; World still on `<new>` after N s" and without ", rolled back".
- [ ] A fake discovery that names the old commit again gives "rolled back" and the seconds it took.
- [ ] The deal guard returns the live commit it read.
- [ ] `pnpm typecheck`, `pnpm lint` and the tests of `apps/demo-cloud` pass.

## Out of scope

- The `deployedAt` field in discovery (follow-up, below).
- A change to how wrangler rolls back.

## Evidence

To be filled before review.

## Decisions

To be filled.

## Handoff

To be filled.
