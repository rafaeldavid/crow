# T-616: Judges return coded verdicts, and the public record keeps no judge text

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** ADR-0049's `agg-5` build (session agg5-cut-rule) merged first; this task edits the same files (`packages/judgment/src/verdict.ts`, `pipeline.ts`, `kept.ts`)
- **Paths this task may touch:** `spec/schemas/judge-verdict.schema.json`, `spec/schemas/judgment.schema.json`, every other `spec/schemas/*.json` for the `$id` bump, `spec/openapi.json`, `spec/examples/`, `spec/README.md`, `packages/core/src/{types,parse,validators.generated}.ts`, `packages/judgment/src/` (a coded filter, `refs.ts`, template pair 3 in `prompt.ts`, `kept.ts`, `pipeline.ts`, a frozen copy of the prose filter, tests), `apps/adjudicator/src/kept-policies.json`, `apps/adjudicator/src/test-adjudicator.ts`, the scripted-judge readers (`apps/test-agents/src/seller.ts`, `examples/demo-sepolia.ts`), `packages/testkit/src/`, `fixtures/replay/`, new `fixtures/scenarios/attack.*` files, `docs/judgment-and-defenses.md`, `CLAUDE.md` and `docs/team.md` (the hard rule's wording only), `site/llms.txt`, `site/ref/limits.txt`, the rebuilt `site/*.mjs` bundles, ADR-0049's status line, this file, ADR-0050, D106
- **Human gate:** no for the pull request; yes for the deploys (carry pair 3 and `agg-6`, the calibration on Sepolia, then the default), which are Rafa's
- **Status:** todo (design written; build held until `agg-5` merges)
- **Agent/session:** partner-c-design-pack, 2026-11-25; branch `t-616-coded-verdicts`
- **Roadmap row:** none (incident follow-up, 2026-11-25)

## What exists

Read on 2026-11-25 at `origin/main` `6f123c73`.

- **The verdict format** (`spec/schemas/judge-verdict.schema.json`, v0.14): per criterion an id, a score of 0 to 4 and `evidence` of at most 300 code points; `overall`; `injectionSuspected`; `injectionEvidence` (300) and `rationale` (600). The filter (`packages/judgment/src/verdict.ts`) abstains on any schema fault, with PR 824's metadata-only fault detail; the pipeline escalates on any filter abstention.
- **ADR-0049 / D105, `agg-5`:** cuts overlong free text and keeps the verdict. Being built by another session; this task follows it.
- **The public record:** `GET /v1/commitments/<id>/judgment` serves each seat's evidence and rationale on a public deal.
- **Kept policies** (`apps/adjudicator/src/kept-policies.json`): template pairs 1 and 2, `agg-3` and `agg-4` (and `agg-5` after its build); default pair 1 with `agg-3`.
- **Nothing gives judges a closed vocabulary or references into the work,** and nothing keeps judge text out of the public record. The task is still needed.

## Intent

Judges answer in a fixed-size, closed format that cannot overrun a cap and carries no prose, and the public record stops retelling the work, for new policies only. Old deals keep the policy they bound.

- **Inputs:** a delivery and the bound policy, as today.
- **Outputs:** under template pair 3 and `agg-6`, coded verdicts and a judgment record with scores, codes, anchors and dropped counts.
- **Non-goals:** no change to aggregation rules beyond reading the coded format; no change to pairs 1 and 2 or `agg-3` to `agg-5`; no sealed prose (ADR-0027); no withdrawal of already-published records; no default move in this pull request.

## Context

- ADR-0050 (this design), ADR-0049, ADR-0036, ADR-0027, ADR-0006; D105, D106.
- Partner C's deal, 2026-11-25 (the maintainers' private deal record): 4 of 8 seats rejected by the filter; every valid verdict passed; refunded; the public record retells the refunded work.
- The research pass (2026-11-25), with file and line references, summarized in ADR-0050. Its counts: 96 replay records in `fixtures/replay/` must not move; 101 recorded judge outputs, all bound to pair 1, must keep parsing.

## Schema v0.15 draft (lands in the build, not before)

`judge-verdict.schema.json` becomes `oneOf` the v0.14 prose verdict (unchanged) and the coded verdict:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["criteria", "overall", "injectionSuspected"],
  "properties": {
    "criteria": {"type": "array", "maxItems": 12, "items": {
      "type": "object", "additionalProperties": false, "required": ["id", "reasons", "score"],
      "properties": {
        "id": {"type": "string", "pattern": "^[a-z0-9_-]{1,40}$"},
        "refs": {"type": "array", "maxItems": 3, "items": {"type": "string", "maxLength": 512}},
        "reasons": {"type": "array", "minItems": 1, "maxItems": 3, "uniqueItems": true, "items": {"enum": [
          "meets_terms", "complete", "accurate", "consistent", "well_formed",
          "missing_element", "incomplete", "inaccurate", "inconsistent", "malformed", "off_spec",
          "weak_execution", "filler_content", "unsupported_claim", "not_assessable", "other"]}},
        "score": {"type": "integer", "minimum": 0, "maximum": 4}}}},
    "overall": {"enum": ["pass", "fail", "abstain"]},
    "injectionSuspected": {"type": "boolean"},
    "injectionKinds": {"type": "array", "maxItems": 3, "uniqueItems": true, "items": {"enum": [
      "instruction_override", "addressed_to_judge", "verdict_steer", "prompt_probe", "hidden_text", "other"]}},
    "injectionRefs": {"type": "array", "maxItems": 3, "items": {"type": "string", "maxLength": 512}}
  }
}
```

This is the shape after the filter's normalization (ADR-0050 section 2); the judge's raw output is checked strictly only on the decision fields. In `judgment.schema.json` a seat's verdict gains `format` (`prose-1` or `coded-1`); under `coded-1`, `refs` and `injectionRefs` hold anchors (`^[0-9a-f]{16}$`) instead of locators, and the seat gains `dropped: {reasons, refs, keys}`, integers 0 to 9. Every v0.14 record still validates.

## Calibration plan (Rafa's deploys gate it)

1. **Carry:** a deploy that registers pair 3 and `agg-6` beside the default, which stays prose.
2. **Deliveries:** partner C's brand kit (asked from the seller, used only for this), the test seller's sample reports, two of the scenario fixtures' honest deliveries, and every recorded attack delivery.
3. **Run:** for each delivery, one deal under the prose policy (pair 2 with `agg-5`) and one under the coded policy (pair 3 with `agg-6`), with the same pinned judges and rubric, on Sepolia, through Crow's own buyer and test seller.
4. **Report** (a dated file in the maintainers' private repository and a summary in Evidence): per criterion, the share of seat-criteria with equal scores and within one point; per delivery, both decisions; filter abstentions and dropped counts under each; recorded verdict sizes; judge latency.
5. **Bar** [guessed, Rafa confirms]: equal decisions on every honest delivery; no attack moves to accept; scores within one point on at least 90% of seat-criteria.
6. **Then:** on a pass, Rafa's deploy moves the default to pair 3 with `agg-6`; on a miss, the default stays and the template is reopened (a scratch field the filter drops is the first lever).

## Acceptance criteria

- [ ] Schema v0.15 as drafted; every v0.14 example and record validates; coded examples added; `pnpm validate:spec` passes.
- [ ] Today's prose filter frozen as its own module; `agg-3`, `agg-4`, `agg-5` and pairs 1 and 2 byte-identical; the 96 replay records do not move.
- [ ] The coded filter: decision fields strict, evidence dropped and counted, canary scanned on the raw output first; references resolved against the work (RFC 6901 for JSON, `L<n>` for text) and kept as anchors.
- [ ] Template pair 3 states the closed lists and the reference format in words and prints line numbers for text deliveries.
- [ ] A policy pairing a template and an aggregation of different formats is refused before any judge is called.
- [ ] The judgment record under `agg-6` holds only rubric ids, list words, hex and digits (a property test).
- [ ] Partner C's appeal replayed under pair 3 / `agg-6` with three seats adding a habitual `rationale` accepts.
- [ ] Attack fixtures: a canary as a property name never reaches the record and abstains; keys holding a URL or an instruction never reach the record; a delivery that asks for junk only when failing does not move the decision; no recorded attack moves to accept under pair 3.
- [ ] The scripted judges' mark moves to the `placeholder-` model prefix and its readers check it.
- [ ] The hard rule's wording updated in `CLAUDE.md` and `docs/team.md` (ADR-0050 section 5); ADR-0049's status gains its one line.
- [ ] A red team over the attack list in ADR-0050, Consequences; findings fixed or filed.
- [ ] `pnpm verify` passes.

## Out of scope

- Moving the default (the calibration, Rafa's deploys).
- Sealed prose for the parties (ADR-0027).
- Withdrawing prose from records already published.
- The CSV header that a check's detail prints into the record (`packages/judgment/src/checks/index.ts`), a separate triage item.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

- Aggregation label `agg-6` and template pair 3, after `agg-5` (coordinator, relaying Rafa, 2026-11-25).
- References kept as anchors, not verbatim (ADR-0050 section 3).

## Handoff

Design written (ADR-0050, D106, this file). Build held until the `agg-5` pull request merges, to avoid two writers on `verdict.ts` and `pipeline.ts`. Then: merge `origin/main` into `t-616-coded-verdicts` (no rewrite), build in the order of the acceptance criteria, red team, open the pull request. The coordinator wants a report before building.
