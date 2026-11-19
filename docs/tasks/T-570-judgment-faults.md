# T-570: Prove that no judge fault re-rolls a panel or yields a one-family decision

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `packages/judgment/src/*.test.ts`, `apps/adjudicator/src/*.test.ts` (new files only), `fixtures/scenarios/`, `docs/tasks/T-570-judgment-faults.md`. Source in `packages/judgment` and `apps/adjudicator` only with the coordinator's word (T-549 edits `apps/adjudicator` and `packages/settlement`).
- **Human gate:** no
- **Status:** in progress
- **Agent/session:** T-570 session, 2026-11-19
- **Roadmap row:** N209

## Intent

The roadmap's demo stage (stage 2) sets this bar for judgment: "No judge fault re-rolls a panel or yields a one-family decision; on SimChain, a test refuses the bond drain." This task proves each clause with a test or fixture that runs in CI, or finds where the code falls short.

In my words: when a judge times out, errors, returns output the verdict schema refuses, refuses, answers late, or a whole model family goes down or abstains, three things must hold.

1. The panel the seed chose stays the panel. No fault and no verdict seats another judge or draws another panel.
2. A faulty seat is an abstention, never a vote, and no decision rests on verdicts from one family. Such a case escalates, and the default rules (D27) take it from there.
3. On SimChain, where an escalation reserves the appeal adjudicator's bond, judge faults at the appeal never let the default outcome pay a seller from that bond when the delivery was flagged.

Non-goals: live model calls (scripted judges only), changes to the aggregation rule without the coordinator's word, and the phase-one contracts (they hold no bond).

## Acceptance criteria

- [ ] A table maps each clause of the bar and each fault class to the test or fixture that proves it, with "pass" as measured by the suite.
- [ ] Every gap has a new test, written before any fix.
- [ ] A failing proof is reported to the coordinator with the failing test and the smallest fix as a proposal, red-teamed, before any shared source changes.
- [ ] The new tests are merged.
- [ ] The Handoff lists any fault class the tests could not reach, and why.

## Evidence

### The bar, clause by clause

Status words: **pass** (the suite shows it passing), **defect** (the suite records the defect as today's behaviour, and the fix that changes it is named), **known gap** (a backlog row covers it; the test records today's behaviour). `packages/judgment/src/faults.test.ts` and `apps/adjudicator/src/judge-faults.test.ts` land in PR 719.

| Clause | What must hold | Test or fixture | Status |
| --- | --- | --- | --- |
| No re-roll by a verdict | Panel selection takes no verdict; anyone recomputes the panel from the seed | `packages/judgment/src/panel.test.ts` ("anyone can recompute the panel", "the seed decides"); `panel.ts` takes no verdict | pass |
| No re-roll by a fault | A fault seats no other judge; a retry repeats the same request; a second pass calls no judge | `apps/adjudicator/src/judge-faults.test.ts` ("a judge fault never re-rolls the commit-reveal panel", one case per fault class); `packages/judgment/src/faults.test.ts` ("only the seated judges are called") | pass |
| No re-roll after a later failure | A failed submission, publication or restart signs the kept result without calling the judges | `apps/adjudicator/src/service.test.ts` ("never re-rolls: a failed submission", "never re-roll after a post-panel failure", "a restart after the panel returned") | pass |
| No one-family accept | An accept needs passes from two families | `packages/judgment/src/aggregate.test.ts` ("unanimous pass, one family", "3 pass but only one pass family"); `faults.test.ts` (the other family passing) | pass |
| No one-family reject | A reject needs valid verdicts from two families when a fault removes one | `faults.test.ts` (the other family failing; `ONE_FAMILY_REJECT_AT_AGG3`) | **defect** at `agg-3`: 6 cases sign the reject; aggregation `agg-4` (T-570's second PR) escalates them |
| No re-roll on a malformed answer | No provider output aborts the panel: a malformed answer is an error for its seat, and the panel decides once | `faults.test.ts` ("no seat's output aborts the panel", 8 cases); `judge-faults.test.ts` ("a malformed answer never re-runs the panel", 5 cases) | pass, after the fix in `packages/judgment/src/pipeline.ts` (red team H1) |
| No one-family decision on the live demo | A retry is answered by the same kind of judge as the first call | none in this PR: `apps/demo-cloud/src/judges.ts` is outside T-570's paths | **defect** (red team H2, testnet only): a live judge's retry past the daily live budget is answered by the scripted judge; proposed as its own task |
| A faulty seat is no vote | `passCount`, `failCount` and `validCount` leave faulty seats out | `faults.test.ts` (every case); `judge-faults.test.ts` (the late answer) | pass |
| SimChain refuses the bond drain (flagged) | A flagged appeal whose judges fault signs reject; the default is refused; the appeal bond pays nothing | `judge-faults.test.ts` ("a judge fault at the appeal does not drain the appeal bond", 16 cases, and a control that shows the drain path pays when the appeal signs nothing); fixtures `attack.injection-splits-appeal-to-default`, `attack.injection-steers-appeal-supermajority`, `attack.injection-steers-appeal-two-families`, `attack.injection-filter-abstain-appeal-default`, `attack.forced-stride-appeal-default` | pass |
| SimChain bond drain (unflagged) | An unflagged appeal that cannot decide signs nothing, and the default pays the seller compensation from the appeal bond | `judge-faults.test.ts` ("known gap (D27g)", 6 cases; and 2 cases where a filter abstention closes the path); fixture `neutrality.appeal-adjudicator-offline-after-escalation` | known gap: backlog row D27g in `docs/decisions-today.md` |

### Fault classes

Each class was applied to every seat of one family.

| Fault class | How the provider reports it | What happens to the seat | Tests | Status |
| --- | --- | --- | --- | --- |
| Times out | `providers/timeout.ts` resolves `{ kind: 'timeout' }` | `timeout`, not retried, no vote | `pipeline.test.ts` ("records a timeout"), `apps/adjudicator/src/providers/providers.test.ts` ("abstains as a timeout"), `faults.test.ts`, `judge-faults.test.ts` | pass; the reject case is the `agg-3` defect |
| HTTP 429 or 5xx | `live.ts`: transport error | retried once with the same request, then `error`, no vote | `pipeline.test.ts` ("retries once on a transport error"), `faults.test.ts`, `judge-faults.test.ts` | pass; the reject case is the `agg-3` defect |
| HTTP 4xx, network error, no text | `live.ts`: error; a throw counts as transport | `error`, no vote | `pipeline.test.ts` ("does not retry a non-transport error", "a provider that throws"), `faults.test.ts`, `judge-faults.test.ts` ("throws (network error)") | pass; the reject case is the `agg-3` defect |
| Output that fails `judge-verdict.schema.json` | `verdict.ts` filter abstention | `abstain`; any filter abstention escalates | `pipeline.test.ts` ("schema-invalid output abstains"), `verdict.test.ts`, `faults.test.ts`, `judge-faults.test.ts` | pass |
| Refuses | a refusal in prose is not JSON; an empty answer is "no text" | filter abstention, or `error` | `faults.test.ts`, `judge-faults.test.ts` | pass |
| Answers after the panel closed | `withTimeout` has resolved; the late answer is dropped | stays `timeout` in the signed record | `judge-faults.test.ts` ("a judge that answers after the timeout is no vote") | pass |
| A whole family down | every seat of one family faults | as its class | `faults.test.ts`, `judge-faults.test.ts`; `service.test.ts` scripts (two families down) | pass; the reject case is the `agg-3` defect |
| Every judge of one family abstains | schema-valid `"overall": "abstain"` | `abstain`, no vote, not a filter abstention | `aggregate.test.ts` ("one valid of three"), `faults.test.ts`, `judge-faults.test.ts` | pass; the reject case is the `agg-3` defect |
| Answer text that is not a string, or no response | an ok answer with `null`, an array, a number or an object; no response object; an unknown kind; a verdict filter that throws | `error`, no vote | `faults.test.ts`, `judge-faults.test.ts` | pass, after the H1 fix |

### Runs

- `npx vitest run apps/adjudicator/src/judge-faults.test.ts`: 34 passed [measured, 2026-11-19].
- `npx vitest run packages/judgment/src/faults.test.ts`: 57 passed, with the 6 one-family rejects and the 3 throws recorded as today's behaviour [measured, 2026-11-19]. Written first with escalation expected: 6 failed, 48 passed at `agg-3` [measured].
- The existing tests the table cites: `pipeline`, `aggregate`, `panel`, `verdict` and both `providers` tests, `service.test.ts` and `simchain-adapter.test.ts`: 8 files, 353 passed [measured].
- `pnpm snap` on the five `attack.*` fixtures above, `neutrality.appeal-adjudicator-offline-after-escalation`, `panel-disagreement-escalates` and `honest-seller-survives-judge-noise-on-appeal`: 8 passed, 0 failed [measured].

## Handoff

In progress. PR 719 lands the proofs. What remains, in order:

1. **The second PR, aggregation `agg-4`:** an ADR and a `docs/decisions-today.md` entry, on the coordinator's decision of 2026-11-19 (Rafa may overrule); `agg-3` frozen in `packages/judgment/src/kept/agg-3.ts`; the two-family rule for every decision; the `agg-4` entry in `apps/adjudicator/src/kept-policies.json` (T-549's lane, agreed with the coordinator); `site/setup.mjs` rebuilt, since it bundles the judgment package. It turns `ONE_FAMILY_REJECT_AT_AGG3` into escalations. A draft is on branch `t-570-agg-4`.
2. **Decided by the coordinator on 2026-11-19:** the H1 fix lands in its own PR ahead of `agg-4` (done on branch `t-570-seat-errors`); `agg-4` also counts a reject's fails against every seated seat (red team M1); D27g stays open for Rafa in the `agg-4` ADR, which stays Proposed, and no default moves (red team M2).
3. **Elsewhere:** H2 (the live demo answers a retry past the live budget with the scripted judge, `apps/demo-cloud/src/judges.ts`) went to the small-fixes session, T-574, through the coordinator. **For triage:** the Panel policy table in `docs/judgment-and-defenses.md` gives the appeal a 90 s timeout and 4/5 supermajorities, while the code uses 60 s and 2/3 at every role (red team I3); `withTimeout` does not abort a late request, so its tokens are still spent.
4. **Deploys:** none from T-570. The two deploys for `agg-4` are the coordinator's, on Rafa's word.

Fault classes the tests could not reach: none of the listed classes. The tests use scripted judges only, so each class is the shape `live.ts` and `timeout.ts` give the pipeline, not a real provider's answer.
