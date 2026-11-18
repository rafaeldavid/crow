# T-530: the reference adjudicator keeps its judged result across a restart (A-4)

- **Lane:** judgment
- **Phase:** 2
- **Kind:** 5, settlement and judgment code (`docs/team.md`, Change recipes): the packages' tests and one review. `apps/adjudicator` is the judgment service, and `apps/demo-cloud` (kind 4) only wires its store
- **Depends on:** T-523 (the triage of an outside scan's findings, which lists A-4 among the off-chain items)
- **Paths this task may touch:** `apps/adjudicator/src/service.ts`, `apps/adjudicator/src/service.test.ts`, `apps/adjudicator/src/test-adjudicator.ts`, `apps/demo-cloud/src/world.ts`, `apps/demo-cloud/src/world.test.ts` (the list of storage prefixes the world may hold), this file
- **Human gate:** no for the change; a deploy of the operators is Rafa's
- **Status:** in review
- **Agent/session:** scan-fixes-main, started by the coordinator on 2026-11-18
- **Roadmap row:** N191

## Intent

Known issue A-4: the reference adjudicator kept its judged result in memory only. A restart between the panel's answer and the decision's landing ran the panel again for the same commitment, role and attempt, and could sign another verdict. The hard rule says a panel is never re-rolled.

The service now takes an optional store for judged results. It keeps the record and the outcome there before it publishes or signs anything, and a restarted service reads them back and signs the same decision without calling a judge. The content key is never stored: the service opens it again from its own envelope. The hosted world keeps the rows in its Durable Object's storage under `jd:`.

Non-goals: no change to what is judged or how; no change to the settlement layer; no change to the hosted sellers.

## Acceptance criteria

- [x] A restart after the panel returned signs the kept decision, names the kept record, and calls no judge.
- [x] A result the store cannot keep is neither published nor signed; the retry keeps it and calls no judge again.
- [x] A store that does not answer refuses the turn before any judge is called.
- [x] The kept row holds the record, the outcome and the published flag, and no key.
- [x] Each test fails before the change and passes after it.
- [x] One review has read the change, and its blocking finding is fixed.

## Evidence

Measured on 2026-11-18 in the worktree `t-530-judged-restart`, unless marked.

- **Before the change.** With `apps/adjudicator/src/service.ts` at `origin/main`, the 3 tests of `describe('a judged result survives a restart (A-4)')` in `apps/adjudicator/src/service.test.ts` failed:
  - "a restart after the panel returned signs the kept decision and never calls the judges again";
  - "a result that cannot be kept is neither published nor signed; the retry keeps it without judging again";
  - "a store that does not answer refuses before any judge is called".
- **The review's finding.** The first version kept the result only after the fallback read its bond cover again, so a cover failure followed by a restart ran the panel again. The result is now kept before that read. The fourth test, "a fallback whose bond is taken while the panel runs keeps its result: after a restart it calls no judge", failed on the first version and passes now.
- **After the change.** The 4 tests pass. `vitest run apps/adjudicator apps/demo-cloud`: 24 of 24 files that ran and 425 of 425 tests passed, 7 files and 17 tests skipped. The skipped files are the anvil suites; this worktree has no `forge build` output, and CI runs them.
- **The world's storage check.** `apps/demo-cloud/src/world.test.ts`, "never receives a body, a header value, an IP or an address", lists every storage prefix the world may hold. It failed on `jd` until the prefix was added; its canary check over every stored value still passes, so no request data reaches a `jd:` row.
- **Types and lint.** `pnpm typecheck` and `eslint` on the changed files exit 0.

## Handoff

**Done:** the store, its wiring in the hosted world, and four tests.

**A deploy of the operators would carry:** the hosted adjudicators write one `jd:` row per decided turn to the world's Durable Object storage, holding the published record and its outcome. Rows are not deleted; one deal adds at most one per role [inferred].

**Not changed, from the review:**
- After a restart, the fallback's first check reads its cached outcome from memory, so a kept escalation needs cover again at that check. A restart behaved the same before this change; phase-one deployments need no cover.
- `docs/audit/known-issues.md` still lists A-4 as open. The docs batch (row N192) marks it fixed with this task.
