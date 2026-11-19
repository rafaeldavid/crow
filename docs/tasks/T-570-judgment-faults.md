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
| No one-family reject | After a fault, no reject rests on one family: valid verdicts from two families (rule 1), and fails from two families (rule 2) | `faults.test.ts` (the other family failing, under `agg-4`; "a deal bound to agg-3 keeps the rule it bound"); `aggregate.test.ts` (the `agg-4` rows and the pinned digests); `judge-faults.test.ts` ("through the adjudicator, agg-4 signs no one-family reject") | pass under `agg-4` (ADR-0043); `agg-3` keeps the one-family reject for the deals bound to it until they settle |
| No re-roll on a malformed answer | No provider output and no delivered text aborts the panel or the record: a malformed answer is an error for its seat; a lone UTF-16 surrogate anywhere in the draft becomes U+FFFD, so the record always hashes | `faults.test.ts` ("no seat's output aborts the panel", 13 cases); `judge-faults.test.ts` ("a malformed answer never re-runs the panel", 8 cases) | pass, after the fix in `packages/judgment/src/pipeline.ts` (red team H1; the lone-surrogate paths from the review and red team of PR 722) |
| No judge call before a refusal | Every seat's prompt is built before any judge is called | `faults.test.ts` ("a seat whose criteria order is refused stops the turn before any judge is called") | pass, after the same fix |
| No one-family decision on the live demo | A retry is answered by the same kind of judge as the first call | none in this PR: `apps/demo-cloud/src/judges.ts` is outside T-570's paths | **defect** (red team H2, testnet only): a live judge's retry past the daily live budget is answered by the scripted judge; proposed as its own task |
| A faulty seat is no vote | `passCount`, `failCount` and `validCount` leave faulty seats out | `faults.test.ts` (every case); `judge-faults.test.ts` (the late answer) | pass |
| SimChain refuses the bond drain (flagged) | A flagged appeal whose judges fault signs reject; the default is refused; the appeal bond pays nothing | `judge-faults.test.ts` ("a judge fault at the appeal does not drain the appeal bond", 16 cases, and a control that shows the drain path pays when the appeal signs nothing); fixtures `attack.injection-splits-appeal-to-default`, `attack.injection-steers-appeal-supermajority`, `attack.injection-steers-appeal-two-families`, `attack.injection-filter-abstain-appeal-default`, `attack.forced-stride-appeal-default` | pass |
| SimChain bond drain (unflagged) | An unflagged appeal that cannot decide signs nothing, and the default pays the seller compensation from the appeal bond | `judge-faults.test.ts` ("known gap (D27g)", 6 cases; and 2 cases where a filter abstention closes the path); fixture `neutrality.appeal-adjudicator-offline-after-escalation` | known gap: backlog row D27g in `docs/decisions-today.md` |

### Fault classes

Each class was applied to every seat of one family.

| Fault class | How the provider reports it | What happens to the seat | Tests | Status |
| --- | --- | --- | --- | --- |
| Times out | `providers/timeout.ts` resolves `{ kind: 'timeout' }` | `timeout`, not retried, no vote | `pipeline.test.ts` ("records a timeout"), `apps/adjudicator/src/providers/providers.test.ts` ("abstains as a timeout"), `faults.test.ts`, `judge-faults.test.ts` | pass; under `agg-4` the reject case escalates |
| HTTP 429 or 5xx | `live.ts`: transport error | retried once with the same request, then `error`, no vote | `pipeline.test.ts` ("retries once on a transport error"), `faults.test.ts`, `judge-faults.test.ts` | pass; under `agg-4` the reject case escalates |
| HTTP 4xx, network error, no text | `live.ts`: error; a throw counts as transport | `error`, no vote | `pipeline.test.ts` ("does not retry a non-transport error", "a provider that throws"), `faults.test.ts`, `judge-faults.test.ts` ("throws (network error)") | pass; under `agg-4` the reject case escalates |
| Output that fails `judge-verdict.schema.json` | `verdict.ts` filter abstention | `abstain`; any filter abstention escalates | `pipeline.test.ts` ("schema-invalid output abstains"), `verdict.test.ts`, `faults.test.ts`, `judge-faults.test.ts` | pass |
| Refuses | a refusal in prose is not JSON; an empty answer is "no text" | filter abstention, or `error` | `faults.test.ts`, `judge-faults.test.ts` | pass |
| Answers after the panel closed | `withTimeout` has resolved; the late answer is dropped | stays `timeout` in the signed record | `judge-faults.test.ts` ("a judge that answers after the timeout is no vote") | pass |
| A whole family down | every seat of one family faults | as its class | `faults.test.ts`, `judge-faults.test.ts`; `service.test.ts` scripts (two families down) | pass; under `agg-4` the reject case escalates |
| Every judge of one family abstains | schema-valid `"overall": "abstain"` | `abstain`, no vote, not a filter abstention | `aggregate.test.ts` ("one valid of three"), `faults.test.ts`, `judge-faults.test.ts` | pass; under `agg-4` the reject case escalates |
| Answer text that is not a string, or no response | an ok answer with `null`, an array, a number or an object; no response object; an unknown kind; a verdict filter that throws | `error`, no vote | `faults.test.ts`, `judge-faults.test.ts` | pass, after the H1 fix |
| A lone surrogate in a verdict or in a check detail | from a judge's escape, from redacted evidence cut at 300 units, from a delivered CSV header or JSON key a check copies | the check's cut stops before a split pair; any lone surrogate left becomes U+FFFD; a verdict stays a vote; a failing required check rejects on the first pass | `faults.test.ts` (named cases, and a property test over arbitrary CSV and JSON text, fixed seed); `judge-faults.test.ts` | pass, after the fix |

### Runs

- `npx vitest run apps/adjudicator/src/judge-faults.test.ts packages/judgment/src/faults.test.ts`: 112 passed with the PR 722 fix [measured, 2026-11-19]. With `origin/main`'s `pipeline.ts`, 18 of the named cases fail, and the property test finds a counterexample for CSV and for JSON at seed 5702 [measured].
- `faults.test.ts` was written first with escalation expected: 6 failed, 48 passed at `agg-3` [measured]. PR 719 recorded those 6 as today's behaviour; the `agg-4` PR turns them into escalations.
- The existing tests the table cites: `pipeline`, `aggregate`, `panel`, `verdict` and both `providers` tests, `service.test.ts` and `simchain-adapter.test.ts`: 8 files, 353 passed [measured].
- `pnpm snap` on the five `attack.*` fixtures above, `neutrality.appeal-adjudicator-offline-after-escalation`, `panel-disagreement-escalates` and `honest-seller-survives-judge-noise-on-appeal`: 8 passed, 0 failed [measured].

## Handoff

In progress. Merged: PR 719 (the proofs). Open in order: PR 722 (no seat's output aborts the panel), the service PR that keeps the panel's result before the record is built (branch `t-570-keep-draft`), and the `agg-4` PR (branch `t-570-agg-4`, ADR-0043, D87).

### The two deploys for `agg-4`, the coordinator's, each on Rafa's word

1. **Deploy 1, after the `agg-4` PR merges:** the operators' build carries `agg-4` beside `agg-3`; the default in `apps/adjudicator/src/kept-policies.json` stays `agg-3`. Expected from the deal guard (`scripts/deploy-lib.mjs`, `docs/operations.md`, The deal guard): no refusal, because the new build keeps every version the live build carries; it prints the count of open deals checked and no orphan [inferred from the guard's documented rules]. The same deploy carries PR 722 and the service PR.
2. **Deploy 2, after deploy 1 is live:** a one-line PR moves `default.aggregationVersion` to `agg-4` in `kept-policies.json`. The deal guard refuses this if the live build does not carry `agg-4`, so deploy 1 must be live first [documented]. New deals then bind `agg-4`; open deals keep `agg-3` until they settle. That PR also re-pins every snapshot (`pnpm snap --update`), because the policy hash binds the version and feeds every fixture's commitment ID.

### Does SimChain's demo default move with deploy 2?

There is one default per build, so by default it moves. Measured on 2026-11-19 by running `pnpm demo` with the default at `agg-3` and then at `agg-4`: every beat's outcomes are the same, and only the decision hashes differ (the policy hash binds the version). The demo's appeal beats are unaffected:
- **Beat 6** (a flagged appeal after an escalation) runs D27a's rule, which `agg-4` does not touch.
- **Beat 8** (a party appeal over a wrongful reject, paid by the bond) has no judge fault in its script.

**Recommendation: let it move.** Keeping SimChain on `agg-3` means a second default (a per-world policy in `apps/demo/agents/bench.ts`), and it keeps the one-family reject there. The bonded-phase question (ADR-0043 section 5) matters for SimChain only when a family is silent at the appeal, which no scripted beat does.

### Open for others

- **Rafa, when bonds return:** ADR-0043 section 5, what an unflagged appeal that cannot decide does (backlog row D27g); recommended a signed no-decision that refunds without paying from the bond. Also its M2 question, `null` content as an error or a filter abstention (recommended: an error).
- **T-574, through the coordinator:** red team H2, the live demo answers a retry past the live budget with the scripted judge (`apps/demo-cloud/src/judges.ts`).
- **For triage:**
  - Two existing tests fail only under load. `packages/judgment/src/preflight.test.ts` ("escalates ... when a check runs out of its work budget") timed out after 47 s during a full run and passes alone. `apps/demo-cloud/src/limits.attack.test.ts` ("attack.t422-replay-cpu") measured a CPU ratio of 0.65 against 0.5 under load and passes alone.
  - `docs/judgment-and-defenses.md`'s Panel policy table gives the appeal a 90 s timeout and 4/5 supermajorities, while the code uses 60 s and 2/3 at every role. The same doc says a party appeal that cannot decide returns the appellant's bond, while the fixture `honest-seller-survives-judge-noise-on-appeal` forfeits it.
  - `withTimeout` does not abort a late request, so its tokens are still spent.
  - The verdict filter cuts redacted evidence, and the screen cuts signal details, by UTF-16 units. The well-forming pass covers both; a code-point cut there would need a new version of each (ADR-0036).
  - Fail verdicts from two families with no fault (alternative 2 in ADR-0043) is a design question for the calibration work.

Fault classes the tests could not reach: none of the listed classes. The tests use scripted judges only, so each class is the shape `live.ts` and `timeout.ts` give the pipeline, not a real provider's answer.
