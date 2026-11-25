# ADR-0050: Judges return coded verdicts, and the public record keeps no judge text

- **Status:** Accepted in direction, 2026-11-25 (Rafa: "ok fix it", on judges answering in a structured format with a fixed size and privacy control). Order (Rafa: "Cut rule, then T-616"): ADR-0049's `agg-5` is built first; this ADR is built after it merges, as aggregation version `agg-6` and template pair 3. The default moves to `agg-6` only after the live calibration in section 7, through Rafa's deploys.
- **Built:** T-616, 2026-11-25, on branch `t-616-coded-verdicts`: schema v0.15, template pair 3 and `agg-6`, carried beside the prose versions; the default is unchanged. The build notes at the end record where the build settles a detail this ADR left open.
- **Date:** 2026-11-25
- **Raised by:** Rafa, 2026-11-25: judges should "submit code as judgement, not raw text, so the code (like JSON or YAML format) has a fixed character count (e.g. 1000) and privacy controlled". The same day a live deal was refunded although every check and every valid verdict passed the work, and its public judgment record retold the refunded work's design.
- **Research:** a research pass on 2026-11-25 (T-616 task file, Context), with file and line references.
- **Builds on:** ADR-0001 (neutrality), ADR-0006 (defended judgment), ADR-0027 (judge text that quotes the work; Proposed), ADR-0036 (a deal is judged under the policy it bound), ADR-0043 (no one-family decision), ADR-0049 (overlong free text is cut); D26, D35, D105.
- **Supersedes:** ADR-0049's free-text rule for new policies that bind `agg-6`. `agg-5` stays kept, and every deal that bound it is judged by it unchanged.
- **Amends when built:** the hard rule on judge output in `CLAUDE.md` and `docs/team.md` (section 5).
- **Changes when built:** `spec/schemas/judge-verdict.schema.json` and `spec/schemas/judgment.schema.json` (v0.15, additive), `spec/openapi.json`, `spec/examples/`, `packages/core` (types and validators), `packages/judgment` (a coded filter, references, template pair 3, `agg-6`, a frozen copy of the prose filter), `apps/adjudicator` (kept policies), `packages/testkit`, `fixtures/`, `docs/judgment-and-defenses.md`, `site/llms.txt` and `site/ref/limits.txt`. No signed type, EIP-712 domain, contract or API route.

Labels: **measured** (read on 2026-11-25 at `origin/main` `6f123c73`, or in the deal's records), **documented**, **inferred**, **guessed**.

## Summary

1. **A judge answers in codes.** Per criterion: a score, one to three reason codes from a closed list of 16, and up to three references into the work. Then `overall`, the injection flag, up to three injection kinds from a closed list of 6, and up to three injection references. No rationale and no evidence prose.
2. **Decision fields stay strict; evidence fields never cost a seat.** A bad score, id, `overall` or flag abstains, as today. An unknown code, an extra item, a reference that does not resolve, or an unknown key is dropped and counted.
3. **The public record keeps no judge-written text and no path into the work.** A resolved reference is kept as an opaque 16-hex anchor that only a holder of the work can match.
4. **A recorded verdict is bounded by construction:** at most about 2,550 characters of rubric ids, list words, hex and digits [measured, counted for a 12-criterion rubric].
5. **Old deals are untouched.** Template pairs 1 and 2 and `agg-3`, `agg-4` and `agg-5` stay kept and judge every deal that bound them. Old verdicts keep parsing.
6. **The default moves only after a live calibration** that judges the same deliveries under the prose policy and the coded one and reports how far the scores agree.

## Context

- **A length cap on prose cost a seller a sale** [measured]. On 2026-11-25 a 19,953-byte JSON delivery passed all three checks. Four of eight seats over two panels were rejected by the filter for schema faults; every valid verdict passed the work. The appeal required a unanimous cross-family panel and rejected, and the buyer was refunded.
- **ADR-0049 fixes the penalty, not the prose** [documented]. It cuts overlong text and keeps the verdict. The text that remains is still the judges' own words about the work.
- **The public record retells the work** [measured]. `GET /v1/commitments/<id>/judgment` serves every seat's evidence and rationale on a public deal. The refunded deal's record describes its mark and its rejected routes, though the buyer never received the work and the seller keeps it. That breaks D35's default of minimal disclosure.
- **Free text is also the exfiltration channel** [documented]. Threat T15 is a hijacked judge writing a URL or the work into the record; the filter's URL and canary rules exist because of the prose. A seat carries up to 4,500 free characters today (12 × 300 + 300 + 600).
- **Aggregation reads no free text** [measured, `packages/judgment/src/aggregate.ts`]. It reads scores, `overall`, `injectionSuspected` and each judge's family.
- **The filter already prefers to keep a seat** [measured]. It replaces a URL in evidence instead of abstaining, so a seller cannot remove a failing seat by planting a URL (`packages/judgment/src/verdict.ts`, `redteam.test.ts`).

## Decision

### 1. The coded verdict

The judge writes one JSON object, references and reasons before the score:

```json
{
  "criteria": [{"id": "fit", "refs": ["/logo/variants/2"], "reasons": ["meets_terms", "consistent"], "score": 4}],
  "overall": "pass",
  "injectionSuspected": false,
  "injectionKinds": [],
  "injectionRefs": []
}
```

- **Reason codes, closed list of 16.** Positive: `meets_terms`, `complete`, `accurate`, `consistent`, `well_formed`. Negative: `missing_element`, `incomplete`, `inaccurate`, `inconsistent`, `malformed`, `off_spec`, `weak_execution`, `filler_content`, `unsupported_claim`. Neutral: `not_assessable`, `other`.
- **Injection kinds, closed list of 6,** the screen's classes (`docs/judgment-and-defenses.md`): `instruction_override`, `addressed_to_judge`, `verdict_steer`, `prompt_probe`, `hidden_text`, `other`. The boolean alone flags a case; kinds without it are dropped.
- **References the judge writes.** For a JSON delivery, an RFC 6901 pointer of at most 512 code points, resolved with the grammar and resolver the `signature_valid` check already uses (`packages/judgment/src/checks/signature-valid.ts`). For CSV, plain text and Markdown, `L<n>`: the line number that template pair 3 prints beside each line of the work. A sampled read carries no references.
- **The template says it in words:** the closed lists, at most three of each, no other keys, no prose.

### 2. What abstains and what is dropped

| Abstains, as today | Dropped and counted on the seat |
| --- | --- |
| Output over 65,536 characters; not one JSON value (a code fence too) | An unknown reason code or injection kind |
| The canary anywhere in the raw output, scanned first, including in a key, code or reference that would be dropped | More than 3 items in a list; duplicates |
| `criteria`, a `score`, `overall` or `injectionSuspected` missing or of the wrong type | A reference of the wrong type, over 512 code points, or that does not resolve in the work |
| Criterion ids not exactly the rubric's, each once | An unknown key, such as a habitual `rationale` |

- **Why dropping is safe** [inferred]. A filter abstention escalates the case because a party could otherwise make only failing seats abstain. A dropped evidence field keeps the seat and its score whatever a party induces, and aggregation reads no evidence field.
- **The counts go on the seat** (`dropped: {reasons, refs, keys}`, each capped at 9), never into the aggregate's escalation reasons, which read an extra reason as a sampled read [measured, `aggregate.ts`].
- **No judge is called again,** as in ADR-0049.

### 3. The public record

- **It carries, per seat:** the format (`coded-1`), each criterion's score, reason codes and anchors, `overall`, the injection flag and kinds and anchors, and the dropped counts. No judge-written string.
- **A reference is kept as an anchor,** never verbatim: the first 8 bytes of HMAC-SHA-256 over the locator, keyed by SHA-256 of a domain tag and the work's plaintext, as 16 hex characters.
- **Why not the pointer itself** [inferred]. A pointer is built from the seller's own key names, which can hold content, a URL or an instruction to a reader's agent, and it shows the document's structure. An anchor shows only how many references a seat made and which ones match.
- **Who can resolve an anchor:** whoever holds the plaintext, by computing the anchor of each node or line. The seller always; the buyer after an accept; a court through whichever party produces the work, checked against the signed delivery's hash. An anchor adds no test of a guess beyond the public `plaintextSha256` [inferred]. A refunded buyer gets scores and codes only.
- **The appeal adjudicator needs no anchors:** its judges read the work afresh and are not told the first decision [measured, `packages/judgment/src/prompt.ts`].
- **Nothing is sealed instead.** Phase one refuses a private judgment record [measured, `packages/core/src/parse.ts`]. Sealed judge prose for the parties is ADR-0027's later step.
- **Records already published keep their prose:** `recordHash` binds it. Withdrawing a published record's prose would need a projection on the operator's read route; that is Rafa's call, not part of this ADR.

### 4. Compatibility (ADR-0036)

- **Kept, unchanged:** template pairs 1 and 2; `agg-3`, `agg-4` and `agg-5`. Today's prose filter is frozen as its own module before any change, so the replay records do not move.
- **Old outputs keep parsing,** for open prose deals and the recorded judge outputs in `fixtures/`, all bound to pair 1 [measured].
- **New kept values:** template pair 3 (the next free number in `apps/adjudicator/src/kept-policies.json`) and `agg-6`. A policy that pairs a template and an aggregation of different formats is refused before any judge is called.
- **Schema v0.15 is additive.** `judge-verdict.schema.json` accepts a coded or a prose verdict; `judgment.schema.json` gains the seat's `format`, anchors and `dropped`. Every v0.14 record still validates. The bump moves every schema `$id`, `spec/openapi.json`, `packages/core/src/types.ts` and the generated validators, and adds coded examples.
- **Policy discovery gains no field.** The template hashes and `aggregationVersion` name the format. `rationaleMaxChars` stays required and is unused under `agg-6`.
- **The scripted judges' mark** moves out of the rationale to the `placeholder-` model prefix, which its readers then check.

### 5. The hard rule

Today: "Judge output must match `spec/schemas/judge-verdict.schema.json`, or the judge abstains." ADR-0049 adds a sentence for `agg-5`. Under this ADR the rule reads:

> Judge output must match the output schema its bound policy names, or the judge abstains. Two exceptions: free text over its length cap is cut to the cap and the cut is recorded (ADR-0049), and in a coded verdict, evidence the pipeline cannot use (a reason code, a reference, an unknown key) is dropped and counted (ADR-0050). Nothing else is repaired.

The sentence folds into the rule ADR-0049 put in `CLAUDE.md` and `docs/team.md` rather than replacing it, so both exceptions stand in one place (coordinator and Rafa, 2026-11-25).

### 6. ADR-0049

- **ADR-0049 stays accepted and is built as `agg-5`.** Its filter order, its no-second-call rule, its frozen filter and its attack list carry over to `agg-6`.
- **Under `agg-6` there is no free text to cut,** so its cut rule has nothing to act on. ADR-0049's status gains one line when this ADR is built: "Superseded for new policies that bind `agg-6` by ADR-0050; `agg-5` stays kept."

### 7. The default moves after a live calibration

- **The calibration:** on Sepolia, the same deliveries judged under the prose policy (pair 1 or 2 with `agg-5`) and the coded one (pair 3 with `agg-6`), with the same pinned judges. The deliveries: partner C's brand kit (with the seller's consent, from the seller), the test seller's sample reports, and the recorded attack deliveries.
- **Reported:** per criterion, the share of seats whose score is equal and within one point; per delivery, the decision under each policy; filter abstentions and dropped counts under each; output size.
- **The bar** [guessed, to confirm with Rafa]: equal decisions on every honest delivery; no attack moves to accept; scores within one point on at least 90% of seat-criteria. A miss keeps the default and reopens the template.
- **The deploys are Rafa's:** carry pair 3 and `agg-6` beside the default, run the calibration, then move the default.

## Consequences

- **The length-cap fault cannot recur** under `agg-6`: no field has a length a judge can overrun.
- **The public record stops retelling the work,** and a hijacked judge's channel shrinks from 4,500 free characters a seat to choices from closed lists.
- **The strongest cost: judges lose their visible reasoning** [inferred]. The DeepSeek seats run without thinking and the Claude seats at low effort (`apps/adjudicator/src/providers/live.ts`), so the evidence prose is much of what they reason with before scoring. How far scores shift is unknown [guessed]; no calibration set exists. Section 7 measures it before any default moves. If scores drift, template pair 3 can allow a scratch field that the filter drops, with no schema change.
- **Codes are blunter than prose** for criteria like "distinct". A buyer who wants a judge's reasons in words has none on the public record until ADR-0027's sealed prose.
- **The red team** attacks: covert bits in the choice of codes, references and dropped counts; anchor guessing on small or guessable work; `__proto__`, duplicate keys, deep nesting and 65,536 characters of references; parser differences between the judge's view and the resolver's; forged line-number prefixes and U+2028 line breaks; steering that leaves no reasoning to read; rubric text that induces the injection flag; and that kept prompts and filters stay byte-identical.

## Alternatives

- **ADR-0049's cut alone.** Fixes the measured fault in one file. Keeps the prose in the public record and the 4,500-character channel. Built first, as `agg-5`.
- **Prose kept but sealed to the parties.** Needs private records, which phase one refuses (ADR-0027, later).
- **Verbatim pointers in the record.** Readable for anyone, but carries the seller's key names and text into a public record.
- **Codes with no references.** Simpler, but a party or a court could not tell what a score points at.

## Build notes (T-616)

The build settles these details [documented, T-616 task file, Decisions]:

- **A coded `reasons` list may be empty** after the filter. The template asks for one to three; when the filter drops every code a judge wrote, the seat keeps its score with no code. The task's schema draft said `minItems: 1`; with it, dropping the last code would have to abstain the seat, which section 2 rules out.
- **A prose seat carries no `format` key** in the record. Its absence means `prose-1`, so every v0.14 record and every replay record of `agg-3` to `agg-5` stays byte-identical. A coded seat carries `format: "coded-1"`.
- **The anchor key** is SHA-256 of the tag `holdback/judgment/anchor/v1` and the plaintext bytes as delivered, a leading byte-order mark included (`packages/judgment/src/refs.ts`).
- **References resolve against** the delivered JSON (a pointer) or the lines the judges read (a line number), as the prompt splits them under every Unicode line break. Injection references without the flag are dropped, like the kinds.
- **A prose-shaped answer under pair 3 still counts**: its `evidence` and `rationale` are unknown keys, dropped and counted, and its scores stand.
- **`agg-6` is `agg-5`'s rule** read through a coded seat's ids, scores, `overall` and flag; its decision digests equal `agg-5`'s (`aggregate.test.ts`).

