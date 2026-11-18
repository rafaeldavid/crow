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

- [ ] A restart after the panel returned signs the kept decision, names the kept record, and calls no judge.
- [ ] A result the store cannot keep is neither published nor signed; the retry keeps it and calls no judge again.
- [ ] A store that does not answer refuses the turn before any judge is called.
- [ ] The kept row holds the record, the outcome and the published flag, and no key.
- [ ] Each test fails before the change and passes after it.
- [ ] One review has read the change, and its blocking findings are fixed.

## Evidence

To be filled in.

## Handoff

To be filled in.
