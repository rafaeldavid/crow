# ADR-0043: No decision rests on one model family after a judge fault

- **Status:** Proposed, 2026-11-19. Rules 1 and 2 are adopted by the coordinator's decision of 2026-11-19 under the in-repository autonomy rule (D87). Rafa may overrule any line. Section 5, what an appeal that cannot decide does once bonds return, is Rafa's to decide then; it does not hold this rule.
- **Raised by:** T-570 (`docs/tasks/T-570-judgment-faults.md`), the proofs for the roadmap's stage-2 judgment bar: "No judge fault re-rolls a panel or yields a one-family decision; on SimChain, a test refuses the bond drain." PR 719 recorded the defect as today's behaviour.
- **Builds on:** ADR-0006 (the defended panel, threat T8), the ADR-0021 amendment and D27 (the default clause set for appeals), ADR-0031 (phase one), ADR-0036 (a deal is judged under the policy it bound); D26, D28, D32, D81.
- **Changes:** `packages/judgment` (`aggregate.ts`; `kept/agg-3.ts`, the frozen copy; `kept.ts`; tests), `apps/adjudicator/src/kept-policies.json` (`agg-4` kept, not the default), `fixtures/replay/kept-policies.json`, the snap runner's test, `docs/judgment-and-defenses.md`, and `site/setup.mjs`, which bundles the judgment package. No contract, signed type, schema or API route changes.

Labels: **measured** (run on branch `t-570-agg-4`, or in the scratch tests of the red team and the research pass, 2026-11-19), **documented**, **inferred** (from reading), **guessed**.

## Summary

**Today a judge fault can sign a reject on one family's verdicts** [measured]. Take a panel of three seats from two families: two claude seats and one gpt seat. The gpt seat times out, answers an HTTP error, returns no text, or abstains with a schema-valid verdict. Both claude seats fail the work. Aggregation `agg-3` then signs a reject on two verdicts from one family. An accept cannot happen this way, because it needs passes from two families. A reject has no such rule.

**The decision:**

1. **No one-family decision.** When the valid verdicts come from fewer than two families, the case escalates. This holds at every role.
2. **After a fault, a reject needs fails from two families,** as an accept always needs passes from two. A seat faulted when it returned no valid verdict.
3. **Neither rule changes a decision where every seat returned a valid verdict,** on any panel of two or more families, the only panels the schemas allow. Two fails from one family still outvote one pass from another family. That asymmetry is the existing design, and `agg-4` does not change it.
4. **A new version.** The rules ship as `agg-4`. `agg-3` stays frozen for the deals bound to it (ADR-0036). `agg-4` merges as a kept version, bound to no new deal; the default moves in a second deploy, on Rafa's word.

## Context

### The finding

Each row was measured with scripted judges, at the pipeline (`packages/judgment/src/faults.test.ts`) and through the adjudicator on the real SimChain (`apps/adjudicator/src/judge-faults.test.ts`).

| Fault on the one gpt seat (claude-a and claude-b fail) | `agg-3` | `agg-4` |
| --- | --- | --- |
| Times out | reject, from claude only | escalate |
| HTTP 503 twice (retried once) | reject, from claude only | escalate |
| HTTP 400, a throw, no text | reject, from claude only | escalate |
| Schema-valid `"overall": "abstain"` | reject, from claude only | escalate |
| Output failing the verdict schema, a refusal in prose | escalate (filter abstention) | escalate |

When the faulty family holds two of the three seats, one valid verdict remains, and the minimum of valid verdicts escalates. The defect needs the faulty family to hold a minority of the seats. On the live registry (three claude judges and two deepseek judges), every first-instance panel has that shape: 6,965 of 10,000 seeds seat two claude judges and one deepseek judge, and 3,035 seat the reverse [measured, research pass].

### What the red team added

The red team's reports are scratch files, `reports/scratch/t570-redteam-proposal.md`, not committed. The task's Evidence summarises them.

- **A fault can leave one family's fails carrying a reject (M1)** [measured]. Five seats at 2/3: three claude seats fail, one deepseek seat passes, one deepseek seat times out. Three of four valid verdicts fail, so `agg-3` rejects. The valid verdicts span two families, so rule 1 alone lets this stand. Rule 2 escalates it.
- **A seller may cause the fault on purpose (M3)** [measured, SimChain]. A delivery carried a marker that made one family's judges time out, with no screen flag. The primary escalated. At the appeal, two of five seats again gave no valid verdict, and the policy needs four. The appeal signed nothing, so the default applied. It refunded the buyer its price and fee, and paid the seller compensation from the appeal bond. Whether a real seller can silence one family on purpose is uncertain (guessed): a long answer times out only from a model slower than about 137 tokens a second, and a faster one hits its output cap. The adjudicator's live providers record two measured cases where a reasoning model spent its whole output cap and returned no text (`apps/adjudicator/src/providers/live.ts`).

## Decision

### 1. No decision rests on one family

After the minimum-valid check, `aggregate` escalates when the valid verdicts come from fewer than `MIN_DECISION_FAMILIES` (2) families. The reason reads: "2 valid verdicts from 1 model family; a decision needs verdicts from 2".

The rule fixes the constant, as it fixes `MIN_PASS_FAMILIES`; it is not the policy's `minFamilies`. The policy's minimum governs who is seated. A policy may seat three families; the rule asks for two families' verdicts before any decision.

### 2. After a fault, a reject needs fails from two families

When any seat returned no valid verdict (a timeout, an error, a filter abstention or a schema-valid abstain), a reject also needs its fail verdicts to come from at least two families. An accept already needs passes from two families, so it needs no twin. With every seat answering, the reject rule is `agg-3`'s.

### 3. What the two rules change

Over every pattern of five outcomes per seat (pass, fail, schema-valid abstain, timeout, filter abstention), comparing `agg-4` with `agg-3` [measured]:

| Panel | Patterns | Decisions that change |
| --- | --- | --- |
| Primary, 3 seats (claude, claude, gpt), minimum 2 valid | 125 | 2 rejects become escalations: the gpt seat times out or abstains |
| Primary, 3 seats from 3 families | 125 | none |
| Appeal, 5 seats from 3 families (2, 2, 1), minimum 4 valid, at 2/3 | 3,125 | none |
| Appeal, 5 seats from 2 families (3, 2), minimum 4 valid, at 2/3 | 3,125 | 4 rejects become escalations |

No decision changes where every seat returned a valid verdict on a panel of two or more families, and no flagged case changes [measured]. On such panels rule 1 changes no decision that rule 2 does not also change; it adds its own reason text, and it states the principle for every role. Rule 1 alone changes a decision only on a one-family panel, which `terms.ts` accepts with `minFamilies` 1 but the schemas refuse: there an all-answered reject becomes an escalation (2 of 3,000 corpus samples, review of PR 730) [measured]. `aggregate.test.ts` pins these counts ("ADR-0043 section 3"). `aggregate.test.ts` pins each kept version to two digests: one on the existing corpus, and one on a corpus of unflagged panels with faults, where the two versions differ. Removing rule 2 changes the second digest, so the pin covers it [measured].

### 4. Where the rules do not reach

- **The flagged appeal after an escalation (D27a, D27b)** returns before these lines. It accepts only on a unanimous valid panel from the appeal's family minimum, and otherwise rejects. A timeout there rejects passing work. That is D27a's rule, by decision, and the bar's reading names it as the exception.
- **A party appeal (D27c, SimChain only):** an undecided appeal panel leaves the first decision standing, as for any escalation there.
- **A silent seat can still turn an escalation into an accept,** when the passes that remain meet the share and come from two families: for example, two passes and one fail of five seats at 2/3 become three passes of four. Two families still pass, so this is not a one-family decision. `minValid` sets how many silent seats a policy tolerates (research pass, F4).

### 5. Open point for Rafa, when bonds return: an appeal that cannot decide (D27g)

**What is live is not affected.** Phase one's contracts hold no bond, and every default refunds the buyer. Nothing here needs deciding for Sepolia.

**The question for the bonded phase.** After an escalation, the appeal panel sometimes cannot decide without a flag: too few seats return a valid verdict, or the valid verdicts come from one family. Today the appeal then signs nothing. On SimChain under the full protocol, the default then also pays the seller compensation, up to the price, from the appeal adjudicator's bond.

**How `agg-4` widens the way in** [measured]. On a registry of three claude and two deepseek judges, with one family silent at every turn and work the other family fails, the seller was paid from the appeal bond in 20 of 20 deals under `agg-4`. Under `agg-3` it was paid in 4 of 20 when the two-judge family was silent, and in 16 of 20 when the three-judge family was (research pass; red team of PR 730). In the red team's run with a seller-made fault, failing work reached the default in 30% of deals under `agg-4` and 8% under `agg-3`, over 40 deals a row. Passing work reached it in 30% and 23%. `agg-4` does not change what the appeal itself signs under the default policy (section 3).

| Option | What an unflagged appeal that cannot decide does | The seller above | An honest seller during an outage |
| --- | --- | --- | --- |
| G1. Reject when the valid verdicts come from fewer than two families, as D27a does | signs a reject | paid nothing on a two-family registry; still paid where three valid verdicts from two families stay undecided | gets a final reject for work every answering judge passed (116 of 1,024 unflagged patterns on the live panel), and no compensation |
| G2. Leave it as it is | signs nothing; the default applies | paid from the appeal bond | paid from the appeal bond |
| G3. A signed no-decision: the appeal adjudicator signs that its panel ran and could not decide; settlement refunds at once and pays no fee and nothing from the bond | signs the no-decision | paid nothing | unpaid; keeps the work; no reject on its record |
| G4. Any silent seat takes D27a's reject branch | rejects | paid nothing | rejected on one timeout: 210 of 1,024 unflagged patterns reject work every answering judge passed |

**Recommendation: G2 now, and G3 with the bonds.** The coordinator decided G2 for now on 2026-11-19.
- **G3 closes every undecided case at once:** too few valid verdicts, one family, and a genuine split. It removes the reason a seller would prefer an undecided appeal, and it keeps compensation for an absent adjudicator apart from a panel that ran and could not decide, which D27g asks for. It needs a signed outcome at the appeal role, so its own ADR.
- **G1 is ruled out.** One aggregation rule binds every deployment, so G1 would also govern Sepolia, where no bond exists to protect. It would sign a final reject because a provider was silent. Rafa ruled out the same thing for an envelope that does not open: a reject is final, and the failure can be the adjudicator's own (D81). G1 also closes only the two-family case.

**A related question for the same ADR (red team M2).** A host that answers `content: null` is a seat error, while the same refusal written in prose is a filter abstention. At an unflagged appeal after an escalation, the two differ: a filter abstention takes D27a's reject, while errors can leave the appeal undecided, so the default applies. **Recommendation: keep `null` content an error.** At the primary an error only shrinks the valid count, so a provider's glitch does not count against the seller, and D81's reasoning applies. G3 closes the bonded-phase gap for both shapes at once.

### 6. What a seller-made re-run cost, and what bounds it now

Before T-570's fixes, a delivery could make the adjudicator run its panel on every pass. With a check that is not required, the red team's run made 15 judge calls and kept no record [measured]. That spends an adjudicator's model budget. Two fixes bound it:
- `runPipeline` returns a draft whose record always hashes, whatever the delivery or the judges send (PR 722, with a property test over arbitrary delivered text).
- The adjudicator keeps the panel's result before it builds the record, so a record that fails to build is retried without calling a judge (T-570's PR after 722).

Each adjudicator now runs its panel at most once per attempt [measured, `judge-faults.test.ts`]. A deal's judge calls are bounded by its seats: three at the primary, three at the fallback when the primary is silent, and five at the appeal after an escalation. Each seat makes at most one retry, on a transport error. The terms' `maxSubmissions` bounds the attempts.

### 7. Version and rollout

- `agg-3` is frozen as `packages/judgment/src/kept/agg-3.ts`. Its pinned digests and its replay records do not change.
- `apps/adjudicator/src/kept-policies.json` lists `agg-4` as kept. The default stays `agg-3`, so no new deal binds `agg-4` yet.
- **Two deploys, both the coordinator's, on Rafa's word:** first the build that carries `agg-4` beside `agg-3`, with the default unchanged; then the build whose default is `agg-4`. The order, the deal guard's expected output, and what the second deploy does to SimChain's demo are in T-570's Handoff.

### 8. Can the Sepolia operators take `agg-4` without changing SimChain?

**Yes** [measured, inferred]. Under the default policy, `agg-4` changes none of the appeal's own decisions (section 3). It changes only how many deals reach the appeal, which matters only where a bond stands behind the appeal. The default is one value per build, in `kept-policies.json`. It feeds both the Sepolia adjudicators and the SimChain fixture worlds. A SimChain world could keep `agg-3` by passing its own policy to `defaultPolicy` (`apps/adjudicator/src/policy.ts`), since the build carries both versions. That is a second default to maintain, and the research pass judged it not worth it. The Handoff states the choice.

## What the fix changes in money

For a deal with price P and adjudication fee F:

- **On the phase-one contracts.** When the valid verdicts at the primary or the fallback come from one family, the adjudicator signs an escalation, and no money moves. On the phase-one contracts an escalation goes to the appeal adjudicator, which then has `appealDecideSec`.
  - If it accepts, on passes from two families, the seller receives P, the appeal adjudicator F, and the buyer the key.
  - If it rejects, the buyer receives P, the appeal adjudicator F, and the seller keeps the work.
  - If it signs nothing, anyone triggers the default after the deadline. The buyer receives P and F, no adjudicator is paid, and the seller keeps the work.
  - Under `agg-3` the same deal ended at the first decision: P back to the buyer and F to the first decider. So the buyer never pays unless two families accept. The first decider gives up F. The cost is time: at most `appealDecideSec` after the escalation, never later than `fallbackBy` plus `appealDecideSec`.
- **On SimChain's full protocol, which no chain runs.** The same, except that the default after an undecided escalation also pays the seller the rulebook's `sellerCompensationRateBps` of P from the appeal adjudicator's reserved bond. That is section 5.
- **Liveness.** Anyone who can silence one model family forces escalations: a provider, the adjudicator's own configuration, a network attacker, or perhaps a seller through the delivery. The deal's windows bound the delay, as above. With failing work and one family silent, the buyer's refund waits up to `appealDecideSec` in every such deal under `agg-4`, against about 70% of them under `agg-3`, and the primary loses its fee (red team of PR 730) [measured].
- **A seller's new incentive (rule 2).** Two claude seats fail and one gpt seat would pass: under `agg-3` the deal is rejected whether the gpt seat answers or not. Under `agg-4` it escalates when the gpt seat is silent. So a seller with failing work gains by silencing the family that would vote for it. On a chain that buys only delay: the buyer is refunded either way. On SimChain's full protocol it is another way into section 5's default [measured, red team of PR 730].

## Alternatives considered

1. **Count every seated seat in both supermajorities** (the coordinator's first decision on M1, 2026-11-19, dropped the same day after the research pass). It turns 40 rejects and 36 accepts of 3,125 patterns at the shipped appeal into no decision, and 36 of those 40 rejects had fails from two families. Each feeds the SimChain bond default. `minValid` already sets how many silent seats a policy tolerates. Rule 2 closes exactly the case the red team raised and moves 4 of 3,125 patterns [measured].
2. **Require the fail verdicts to come from two families always,** symmetric with accept. It changes "two claude seats fail, one gpt seat passes", a reject with no fault that the rule pins today. With an appeal minimum of three, it moves 1,012 escalated-appeal rejects to the default, where rule 1 alone moves 640 (red team). It also lets a seller block a reject by steering one family to pass. Left for the calibration work, as a design question of its own.
3. **Count timeouts and errors as filter abstentions.** It leaves the schema-valid abstain reject open: 130 patterns per role. It also turns 11,426 unflagged escalated-appeal timeouts into rejects of passing work (red team). Rejected.
4. **Treat a one-family panel as inconclusive and go straight to the default.** It skips the appeal adjudicator, which may have a healthy second family. Rejected.
5. **Require two families only for reject, and only at the primary.** It leaves the fallback able to sign a one-family reject: 48 of the 54 fault cases pass under it (research pass). Rejected.
6. **Record the defect and change nothing.** The bar's clause "no judge fault yields a one-family decision" would stay false for reject. Rejected by the coordinator on 2026-11-19.

## Consequences

- No decision is signed on one family's verdicts after a fault.
- More cases escalate while one family is down. On phase one that delays a deal by at most `appealDecideSec` after the escalation, then refunds the buyer if nobody decides.
- On SimChain, more escalated deals reach the appeal. Section 5 records what an appeal that cannot decide should do once bonds return.
- Deals bound to `agg-3` keep their rule until they settle. The build carries both versions.
- `site/setup.mjs` changes bytes because it bundles the judgment package. Its published hash changes with the next site deploy, which is Rafa's.

## Litmus tests

- **Neutrality:** holds. No party gains a way to move a hold outside the terms. An escalation never accepts, and on a chain every default refunds the buyer. On SimChain the appeal bond's exposure is section 5's open point; it exists under `agg-3` too.
- **The hold:** unchanged. No contract, settlement path or hold rule changes.
- **Defended multi-model judgment:** strengthened. After a fault, both decisions need votes from two families. This closes the correlated-error path (threat T8) that a fault opened for reject.

## Research pass

A research pass on the most capable model at maximum effort attacked the fix and its alternatives (`reports/scratch/t570-decision-research.md`, scratch, not committed; 33 tests, 33 passed). Its recommendation, adopted except where the coordinator decided otherwise:
- Ship rule 1 at every role. It fixes all 54 fault cases, changes 0 of 496 all-answered cases and no flagged case, and changes 0 of 3,125 patterns at the shipped appeal.
- Keep the seat count out. The coordinator then chose rule 2, which the pass named as the narrow way to meet the stronger reading of the bar.
- Leave D27g open now, and adopt a signed no-decision when bonds return.
- It corrected an earlier note: on the phase-one contracts an escalation goes to the appeal adjudicator, not the fallback (`packages/core/src/state.ts`, the Escalated transitions; `HoldbackRules.sol`).
