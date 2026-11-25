# T-615: Judges read the verdict limits in words, and the record names each filter abstention's rule

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `packages/judgment/src/prompt.ts`, `packages/judgment/src/verdict.ts`, `packages/judgment/src/pipeline.ts`, `packages/judgment/src/kept.ts`, `packages/judgment/src/kept.test.ts`, `packages/judgment/src/template-limits.test.ts`, `packages/testkit/src/replay.ts`, `apps/adjudicator/src/kept-policies.json`, `fixtures/replay/kept-policies.json`, `fixtures/scenarios/attack.injection-filter-abstain-appeal-default.expect.md`, the rebuilt `site/setup.mjs` and `site/serve.mjs`, this file
- **Human gate:** no for this pull request; yes for the two deploys that carry pair 2 and then make it the default (Rafa's)
- **Status:** review
- **Agent/session:** judge-filter root cause, 2026-11-25; branch `judge-filter-claude`
- **Roadmap row:** none (incident fix, 2026-11-25)

## What exists

Read on 2026-11-25 at `origin/main` `e926f630`. The verdict filter (`packages/judgment/src/verdict.ts`) validates each judge's output against `spec/schemas/judge-verdict.schema.json`: each criterion's `evidence` and the `injectionEvidence` at most 300 characters, the `rationale` at most 600 (and at most the policy's `rationaleMaxChars`). Output over a cap abstains with reason `schema`, and the hard rule keeps it so. Template pair 1 (`0xabb5ec9b…` / `0xa0bb1a5d…`) states the caps only as `string<=300` and `string<=600` inside rule 5's type sketch. The pipeline escalates on any filter abstention; on the appeal after an escalation, agg-3 and agg-4 accept only a unanimous cross-family panel (D27a), so one lost seat refunds the buyer.

Partner C's deal on Sepolia (commitment `0x59f42180…`, 2026-11-25 15:10 UTC) refunded an honest delivery this way: every check passed, every judge that answered passed it, and 4 of 8 seats over the two panels abstained on the schema filter (measured from the two judgment records). Nothing in the repository tells a judge the limits in plain words.

## Intent

Judges keep their verdicts inside the schema's caps more often, without loosening the filter, and the next filter abstention can be measured.

1. A new template pair 2 replaces rule 5 only: it names each limit in words, asks for a target well under it (200 characters for each evidence; two thirds of the policy's rationale cap, at most 400, for the rationale), and says nothing of what happens to text over a limit, so the frozen text stays true under today's filter and under `agg-5`'s cut (D105). The rationale limit is filled from the policy's `rationaleMaxChars`. Pair 1 stays frozen for every deal that binds it (ADR-0036).
2. A schema abstention's detail names the rule it broke as metadata only: a field path built from the schema's names and array indices, the limit, and the length, count or JSON type, with numbers bucketed (`criteria[2].evidence: 312 > 300`). Never a value, key or text from the output.
3. The judgment record's aggregate reasons name each filter abstention's judge, filter and detail on every path; the appeal after an escalation listed only a count.

- **Inputs:** the bound policy's template hashes.
- **Outputs:** under pair 2, the same prompts with rule 5 in words.
- **Non-goals:** no change to the verdict schema, its caps, which outputs the filter admits, the aggregation rules, any decision or status, pair 1, or the default policy. Cutting overlong text instead of abstaining is D105 / ADR-0049's `agg-5`, a separate task after this one merges.

## Context

- `CLAUDE.md`, hard rules: judge output must match `judge-verdict.schema.json`, or the judge abstains.
- ADR-0036 (kept versions; a template change is a new pair, carried first and made the default in a second deploy).
- D27a (the appeal after an escalation), ADR-0043 (agg-4).

## Acceptance criteria

- [x] Pair 2's rule 5 names the 300-character evidence limit and the policy's rationale limit, the 200- and 400-character targets, and no consequence for text over a limit; every other line of pair 1 stays, first instance and appeal (`template-limits.test.ts`).
- [x] Pair 1 keeps its hashes; pair 2 has its own; this build keeps both (`template-limits.test.ts`, `kept.test.ts`, `kept-policies.json`).
- [x] The replay records pair 2 on every screen, aggregation and read path (`fixtures/replay/kept-policies.json`), and pair 1's records do not move.
- [x] A pipeline test replays the live appeal: agg-3 and agg-4 reject it with the live reasons; the same panel inside the caps accepts it.
- [x] A verdict whose evidence is 301 characters abstains with `criteria[2].evidence: 301 > 300`; one of 300 passes; each schema rule gives its own detail, and no detail carries output text (`template-limits.test.ts`).
- [x] The record names each filter abstention on the primary and the appeal paths; decisions, statuses and counts do not change; a new replay read path, `filtered`, pins the reasons for every kept combination.

## Out of scope

- Making pair 2 the default: a second deploy, after pair 2 is carried, changes `default` in `kept-policies.json` and the adjudicators' policy hash (Rafa's deploys).
- Measuring how often live judges overshoot under each pair: needs live judge calls with the adjudicators' keys.

## Evidence

- Measured: `verdict.ts`, `prompt.ts`, `pipeline.ts`, `aggregate.ts`, `kept.ts`, `apps/adjudicator/src/providers/live.ts` and `judge-verdict.schema.json` (apart from its `$id`) are the same at `1e96090` and `ae327a9`; the generated judge-verdict validator is the same code up to renamed identifiers. Today's deploy did not change the filter.
- Measured: in the appeal record the two DeepSeek verdicts' evidence runs 195 to 288 characters of the 300 allowed, and their rationales 393 and 399 of 600.
- Measured: `template-limits.test.ts` replays the appeal's shape (five seats, two families, three judges writing 340-character evidence): agg-3 and agg-4 reject with "3 judge outputs rejected by a filter"; the same panel at 288 characters accepts.
- Inferred: the Claude seats on the appeal and DeepSeek flash on the primary failed a length cap. The records keep only the reason `schema`, not the field; no raw output is kept.
- Guessed: stating the limits in words, with targets under them, cuts overshoots. Not measured until a live run under pair 2.
- Measured: the 42 replay records of pair 1 (3 screens, 2 aggregations, 7 read paths) did not move. 54 records are new keys: pair 2 on the eight paths (48) and the `filtered` path for pair 1 (6).
- Measured: `attack.injection-filter-abstain-appeal-default` changes only by the added reason `judge qwen-a output rejected by a filter (url)` and so its chain head; the decision stays reject.
- Measured: red team 1 (pair 2 alone) and red team 2 (pair 2, the detail, the record) found no High. Their Medium and Low findings are fixed: stale bundles rebuilt; the rationale limit filled from the policy; the snapshot reviewed and updated; a replay path for filter abstentions; the scope written here; numbers in the detail bucketed; tests that passed for the wrong reason rewritten.
- Commands run and results (measured, 2026-11-25, recipe 5):
  - `pnpm typecheck`: exit 0. `pnpm lint`: exit 0.
  - `pnpm exec vitest run packages/judgment packages/testkit apps/adjudicator/src`: 1580 passed, 12 skipped.
  - `pnpm test`: 6103 passed, 1 failed, 321 skipped. The failure, `apps/demo-cloud/src/limits.attack.test.ts`, touches no changed path; it is recorded as a separate defect.
  - `pnpm snap`: 63 passed. `pnpm validate:spec`: ok. `node site/build.mjs && node site/check.mjs`: PASS.
- Snapshot diffs: `attack.injection-filter-abstain-appeal-default`: the aggregate gains the reason `judge qwen-a output rejected by a filter (url)`, so the record hash and the chain head change; the decision stays reject.
- Measured, after rule 5 dropped its consequence clause: pair 2's hashes are `0x4d328a15…` / `0xfc6d93d5…`; its 48 replay records were recorded again, and pair 1's 48 did not move; the judgment, testkit and adjudicator suites pass 1580; `pnpm snap` 63 passed; the site check passes; typecheck and lint exit 0.
- Bundles: `site/setup.mjs` sha256 `b59bc721…` to `1cb79b43…`; `site/serve.mjs` sha256 `541ff38b…` to `e1f7a4a0…`.

## Decisions

- A new template pair, not a cutting filter: the hard rule forbids accepting output that fails the schema.
- `NEWEST_VERSIONS` stays on pair 1: every recording and snapshot was taken under it, and the default policy names it.
- The named filter reasons apply under every kept version. ADR-0036 freezes what a version flags or decides; the reasons are diagnostics in the record, and the decision, statuses, counts and signed outcome stay. Records with a filter abstention now hash differently, as the snapshot and the chain head show.
- The policy cap still counts UTF-16 units and the schema's caps code points (existing behaviour); the detail says which.
- A judge chooses the numbers in a detail, so they are bucketed (lengths over twice the cap, key counts over 9) to keep a covert channel to a few bits.

## Handoff

Done: pair 2 in code, kept, and recorded in the replay; the filter's detail in every record. Not done: the two deploys (carry, then default), a live rehearsal under pair 2, and `agg-5` (D105). Resume by deploying this build, then a change that moves `default` in `apps/adjudicator/src/kept-policies.json` to pair 2 with a fresh `policyParams` check. Open question for Rafa: whether a filter abstention on an escalated appeal should keep its D27a weight when the abstention is a length overrun on an otherwise valid verdict (a defense change, ADR-level).
