# ADR-0049: Free text over its cap is cut and the verdict is kept

- **Status:** Accepted, 2026-11-25 (Rafa: "Yes, adopt it"), including the one sentence added to the hard rule (section 5). Not built yet: the build lands with that sentence in `CLAUDE.md` and `docs/team.md`, after a red team.
- **Date:** 2026-11-25
- **Raised by:** Rafa, 2026-11-25: "why is there a 300 character limit? Is there a protocol constraint there? That seems arbitrary and mostly will cause issues no?" A live deal that day was refunded although every deterministic check and every valid verdict passed the work.
- **Research:** a research note in the maintainers' private repository (`docs/private-materials.md`).
- **Builds on:** ADR-0001 (neutrality), ADR-0006 (defended judgment), ADR-0027 (judge text that quotes the work; Proposed), ADR-0036 (a deal is judged under the policy it bound), ADR-0043 (no one-family decision); D26, D27, D28, D32, D103.
- **Amends when accepted:** the hard rule "Judge output must match `spec/schemas/judge-verdict.schema.json`, or the judge abstains" in `CLAUDE.md` and `docs/team.md`, by one sentence (section 5).
- **Changes when built:** `packages/judgment` (the verdict filter, a frozen copy of today's filter, aggregation version `agg-5`), `apps/adjudicator` (the kept-policies file), `packages/testkit`, `fixtures/`, `docs/judgment-and-defenses.md`. No schema, signed type, contract or API route.

Labels: **measured** (read at `origin/main` `6adfc937`, or in the deal's records), **documented**, **inferred**, **guessed**.

## Summary

1. **A judge's free text over its length cap is cut to the cap.** The seat's scores, pass or fail and injection flag stay as the judge wrote them, and the verdict counts as valid.
2. **The caps do not move:** 300 code points of evidence per criterion, 300 of injection evidence, 600 of rationale, or the policy's lower rationale cap.
3. **The cut is recorded twice:** the kept text ends with `[cut]`, and the adjudicator adds one line per seat to the record's reasons.
4. **Every other fault in a judge's output is an abstention, as today.** The cut never touches a score, an id, a boolean or `overall`.
5. **No judge is called again.** The cut is a function of the one output.
6. **It is aggregation version `agg-5`.** Deals bound to `agg-3` or `agg-4` keep today's filter.
7. **No schema changes.**

## Context

- **Today one character over a cap discards the seat** [measured]. The schema caps `evidence` and `injectionEvidence` at 300 and `rationale` at 600 (`spec/schemas/judge-verdict.schema.json:37`, `:55`, `:60`). The filter turns any schema failure into an abstention (`packages/judgment/src/verdict.ts:135` to `:141`), and the pipeline drops the verdict (`packages/judgment/src/pipeline.ts:313` to `:314`). At first instance the case escalates. At the appeal after an escalation the case is rejected, because a flagged case is accepted only by a unanimous panel (`packages/judgment/src/aggregate.ts:169` to `:191`).
- **The case** [measured, the private deal record of 2026-11-25]. A seller delivered 19,953 bytes of JSON. All three deterministic checks passed. Four of eight seats over two rounds had their output rejected by the filter. Every valid verdict was a pass. The appeal rejected and the buyer was refunded. The longest valid evidence field ran to 288 of 300 characters.
- **The cause of the four rejections is inferred.** The record keeps the reason `schema` for one seat and no reason for three. A separate change records the failing field.
- **The number 300 is not a protocol constraint** [measured]. No contract, signed type or settlement step reads it. No ADR derives it.
- **A bound is a defense** [documented]. The free text can quote the work into a record that both parties read, and anyone reads on a public deal (ADR-0027, red-team finding F3). The bound also limits what a hijacked judge can write out (threat T15).
- **Aggregation reads no free text** [measured, `aggregate.ts`]. It reads the scores, `overall`, `injectionSuspected` and the family.
- **The filter already cuts in one place** [measured]. After it replaces a URL in evidence with `[link removed]`, it cuts the result at 300 with no mark (`verdict.ts:151` to `:156`).
- **A party can cause an overrun** [inferred]. The seller's delivery and the buyer's rubric criteria are both text the judges read. Today either can push a judge over a cap and send the case to escalation.

## Decision

### 1. The cut

**Recommendation: cut each overlong free-text field to its cap and keep the verdict.**

- **The fields:** `criteria[i].evidence`, `injectionEvidence` and `rationale`, and only where the value is a string.
- **The caps:** the schema's `maxLength`. For `rationale`, the lower of the schema's cap and the policy's `rationaleMaxChars`.
- **The unit is the Unicode code point,** as the schema counts. A cut never splits a surrogate pair. Today the code counts UTF-16 units in two places (`verdict.ts:141`, `:156`); `agg-5` counts code points in both.
- **The result:** the first `cap - 5` code points, then `[cut]`. A field at or under its cap is unchanged.
- **The text past the cut is discarded.** The record never holds it.

### 2. The order of the filter

1. Refuse output over 65,536 units, as today.
2. Parse the JSON, as today.
3. **Scan the raw output and the full, uncut free text for the canary, as today.** A canary past the cut still abstains.
4. Cut the three fields.
5. Check the result against the schema and the rubric's criterion ids, as today.
6. Run the URL step on the kept text: a URL in the rationale or injection evidence abstains; a URL in evidence is replaced.
7. Cut evidence again where a replacement lengthened it, with the same function.

- **The URL step reads only kept text.** The record still never holds a URL, and the URL patterns never run on a string longer than a cap.

### 3. What counts as a valid verdict

- **A cut verdict is valid.** It counts toward the valid verdicts, its family counts, and its pass or fail counts.
- **It is not a filter abstention and it does not flag the case.** A flag would escalate, and at the appeal reject, which is the outcome this record removes.
- **A judge that sets `overall` to `abstain` still abstains.**

### 4. The record

- **The adjudicator adds one reason per seat with a cut,** after the decision's own reasons: `judge <id> free text cut to its cap (rationale; evidence of <n> criteria)`. It carries an id and counts, no judge text.
- **The reason is not an escalation reason.** Aggregation treats escalation reasons beyond the filter abstentions as a sampled read (`aggregate.ts:163`).
- **A judge can write `[cut]` itself.** The reason line is the record of a cut; the mark in the text is for the reader of one field.
- **The schema is unchanged.** The cut text fits `judge-verdict.schema.json`, and `aggregate.reasons` exists. The record's hash covers both as before.

### 5. The hard rule

**Recommendation: add one sentence.** The rule reads:

> Judge output must match `spec/schemas/judge-verdict.schema.json`, or the judge abstains. One exception: free text over its length cap is cut to the cap and the cut is recorded. Nothing else is repaired.

- **"Never re-roll a panel because of its verdict" is untouched.** No judge is called again.
- **"Deliverables are untrusted" is untouched.** The judges' inputs, tools and prompt positions do not change.

### 6. Other faults

Each of these is an abstention, as today: output that is not one JSON value; a Markdown fence; an extra or missing key; a wrong type; a score that is not an integer from 0 to 4; a criterion id that is malformed, missing, repeated or outside the rubric; more than 12 criteria; an `overall` outside its three values; a canary echo; a URL in the kept rationale or injection evidence.

### 7. Versions

- **This is aggregation version `agg-5`** (ADR-0036: the aggregation version covers the verdict filter).
- **`agg-3` and `agg-4` get a frozen copy of today's filter.** Both use the live one today (`packages/judgment/src/kept.ts`).
- **`agg-5`'s decision rule is `agg-4`'s,** with the cut reasons appended.
- **Deals bind `agg-4` until the default moves in a second deploy.** A deal already signed is judged under the filter it bound.

## Options considered

| Option | Verdict | Reason |
| --- | --- | --- |
| **Cut to the cap, mark, keep the verdict** | **Chosen** | The record holds no more of the work than today; the result is the same on every adjudicator; no second call |
| Empty the overlong field and keep the verdict | Rejected | It discards the judge's first words, the part most useful as evidence (D26) |
| One format-repair retry with the validator's error | Rejected | A second sample can carry a different verdict. A delivery can ask a judge to overrun only when failing, so failing verdicts are drawn again: retry until pass (threat T6). It also needs a new template and a second input hash per seat |
| Raise the caps | Rejected | Any cap leaves a longer string (D103). More of the work reaches a refunded buyer (F3) |
| The prompt states target lengths, and nothing else | Adopted beside this record, not instead of it | It lowers the rate. An overrun that remains still costs the seat, and at the appeal the sale |
| A second limit above which the seat still abstains | Rejected | A new arbitrary number with the same failure. The whole output is already bounded |
| A typed `textCut` field on each seat | Deferred | It needs a version bump of every schema. Take it with ADR-0027's record split |
| Provider-side structured output | Deferred | Length limits differ by provider [guessed]; it ties the registry to provider features |

## Consequences

- **A seller no longer loses a sale to a judge's long sentence.**
- **Neither party can force an escalation through text length** [inferred]: not the seller through the delivery, and not the buyer through rubric criteria that ask for long quotes.
- **A reader can meet half a sentence.** The mark and the reason line say so. The scores and `overall` decide, and they are untouched.
- **A hijacked judge that rambles no longer abstains by accident.** Length was not the defense: such a judge can write short text today. The canary, the screen, the injection flag and the two-family rule stay.
- **One more kept version to carry:** a frozen filter file and `agg-5`.

## Litmus tests

- **Neutrality:** strengthened. One way for a party, or a model provider's verbosity, to stop a valid deal from settling on its terms is closed.
- **The hold:** unchanged.
- **Defended multi-model judgment:** unchanged in its defenses if the attack tests below hold. More seats return valid verdicts, so more decisions rest on two families.

## Verification when built

- **Unit and property tests:** each field at its cap, one over, and at 65,000 code points; an emoji across the cut; a policy cap below 600; for any output, the scores, ids, booleans and `overall` after the filter equal those before it.
- **Replay:** `agg-3` and `agg-4` give their recorded results.
- **Fixture:** an overlong evidence field on one seat; the pass counts and the deal settles.
- **Attack fixtures, each of which must fail to move the decision:**
  1. the canary only past the cut, plain and base64: the seat abstains;
  2. a URL only past the cut, and a URL across the cut: the record holds no working link;
  3. every recorded attack fixture under `agg-5`: none moves to accept;
  4. a delivery that tells the judge to write at length only when failing: the decision equals the short-text decision;
  5. rubric criteria that demand long quotes: the case is judged, not escalated;
  6. a judge that writes `[cut]` with no overrun: no reason line appears;
  7. 65,000 units in each field: the filter finishes within its time budget;
  8. a number, object or array at each of the three paths: the seat abstains;
  9. an unclosed bidirectional control before the cut: the record matches an uncut field holding the same control.

## Open questions

1. **Rafa approves the hard rule's added sentence,** or overrules it.
2. **Build order.** The recording of the failing field lands first. If the rejected seats failed on something other than length, this record still stands and its build drops in priority.
