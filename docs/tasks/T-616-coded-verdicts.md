# T-616: Judges return coded verdicts, and the public record keeps no judge text

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** ADR-0049's `agg-5` build (session agg5-cut-rule) merged first; this task edits the same files (`packages/judgment/src/verdict.ts`, `pipeline.ts`, `kept.ts`)
- **Paths this task may touch:** `spec/schemas/judge-verdict.schema.json`, `spec/schemas/judgment.schema.json`, every other `spec/schemas/*.json` for the `$id` bump, `spec/openapi.json`, `spec/examples/`, `spec/README.md`, `packages/core/src/{types,parse,validators.generated}.ts`, `packages/judgment/src/` (a coded filter, `refs.ts`, template pair 3 in `prompt.ts`, `kept.ts`, `pipeline.ts`, a frozen copy of the prose filter, tests), `apps/adjudicator/src/kept-policies.json`, `apps/adjudicator/src/test-adjudicator.ts`, the scripted-judge readers (`apps/test-agents/src/seller.ts`, `examples/demo-sepolia.ts`), `packages/testkit/src/`, `fixtures/replay/`, new `fixtures/scenarios/attack.*` files, `docs/judgment-and-defenses.md`, `CLAUDE.md` and `docs/team.md` (the hard rule's wording only), `site/llms.txt`, `site/ref/limits.txt`, the rebuilt `site/*.mjs` bundles, ADR-0049's status line, this file, ADR-0050, D106
- **Human gate:** no for the pull request; yes for the deploys (carry pair 3 and `agg-6`, the calibration on Sepolia, then the default), which are Rafa's
- **Status:** review
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

- [x] Schema v0.15 as drafted (two deviations, Decisions); every v0.14 example and record validates; coded examples added; `pnpm validate:spec` passes.
- [x] Today's prose filter frozen as its own module; `agg-3`, `agg-4`, `agg-5` and pairs 1 and 2 byte-identical; the replay records do not move (144 at `origin/main` `49e7da1f`, after `agg-5`; the task's 96 predates it).
- [x] The coded filter: decision fields strict, evidence dropped and counted, canary scanned on the raw output first; references resolved against the work (RFC 6901 for JSON, `L<n>` for text) and kept as anchors.
- [x] Template pair 3 states the closed lists and the reference format in words and prints line numbers for text deliveries.
- [x] A policy pairing a template and an aggregation of different formats is refused before any judge is called.
- [x] The judgment record under `agg-6` holds only rubric ids, list words, hex and digits (a property test).
- [x] Partner C's appeal replayed under pair 3 / `agg-6` with three seats adding a habitual `rationale` accepts.
- [x] Attack fixtures: a canary as a property name never reaches the record and abstains; keys holding a URL or an instruction never reach the record; a delivery that asks for junk only when failing does not move the decision; no recorded attack moves to accept under pair 3.
- [x] The scripted judges' mark moves to the `placeholder-` model prefix and its readers check it.
- [x] The hard rule's wording updated in `CLAUDE.md` and `docs/team.md` (ADR-0050 section 5); ADR-0049's status gains its one line.
- [x] A red team over the attack list in ADR-0050, Consequences; findings fixed or filed (Evidence, Red team).
- [ ] `pnpm verify` passes: every judgment, spec, snap and demo step passes; `forge build` and the contracts-built tests fail in this worktree only (see Evidence).

## Out of scope

- Moving the default (the calibration, Rafa's deploys).
- Sealed prose for the parties (ADR-0027).
- Withdrawing prose from records already published.
- The CSV header that a check's detail prints into the record (`packages/judgment/src/checks/index.ts`), a separate triage item.

## Evidence

Measured on 2026-11-25 on `t-616-coded-verdicts`, unless labelled otherwise.

- **Schema v0.15** [measured]: `pnpm validate:spec` passes, 40 of 40 examples (the two coded ones new) and `spec/openapi.json` fresh. `tests/spec.test.ts` holds v0.15's taken and refused cases under both Ajv and the compiled validators: 41 cases, including the prose parser refusing a coded verdict and a coded seat refusing a locator where an anchor goes.
- **Kept versions unchanged** [measured]: `verdict.ts`, `aggregate.ts`, `kept/*.ts` and pairs 1 and 2 are byte-identical to `49e7da1f` (`git diff` is empty for them). All 144 replay records of pairs 1 and 2 under `agg-3`, `agg-4` and `agg-5` are unchanged; 24 records added for pair 3 with `agg-6` (`fixtures/replay/kept-policies.json`, 168 records). `agg-6`'s two decision digests equal `agg-5`'s (`aggregate.test.ts`).
- **The coded filter** [measured]: `coded.test.ts`, 54 tests: 17 decision faults abstain with metadata-only detail; 18 evidence faults are dropped and counted with scores unchanged; 9 canary placements abstain (a property name, a criterion key, a dropped code, a dropped reference, base64 in a key, `\u` escapes in a key, split across two keys, prose output); `__proto__`, `constructor` and nesting 5,000 deep are dropped; 120 references of 500 characters are dropped in under 500 ms. `refs.test.ts`: pointers, lines and anchors as ADR-0050 section 3 defines them, and a holder resolves every anchor.
- **Template pair 3** [measured]: replaces rules 3 and 5 of pair 1 and adds rules 9 to 11; states the 16 codes, the 6 kinds and both reference forms in words; numbers each line of a whole text, CSV or Markdown delivery; numbers no JSON delivery and no sample. Pair 1's and pair 2's prompts are unchanged with or without a MIME type. Hashes: first `0xf65c7859…d11f`, appeal `0x6839cb0c…93cc`.
- **Mixed formats refused** [measured]: pair 3 with `agg-3` or `agg-5`, and pairs 1 and 2 with `agg-6`, return `policy_mismatch` with no judge call (`coded.pipeline.test.ts`); `checkPolicyBinding` declines them too (`bound-policy.test.ts`).
- **The record holds only rubric ids, list words, hex and digits** [measured]: two property tests, 400 runs on the filter and 60 on the pipeline; a mark planted in any key, code or reference never appears in the serialized draft. A coded seat is at most 2,591 characters for a 12-criterion rubric (measured with the longest ids, codes and kinds).
- **Partner C's appeal under pair 3 and `agg-6`** [measured]: the private record (`partner-c-record.test.ts`, run with `CROW_PARTNER_C_DEAL`) accepts, 5 passes from two families, each Claude seat's habitual rationale dropped (`keys: 1`), no filter abstention. `agg-4` and `agg-5` give their earlier results. The public model in `coded.pipeline.test.ts` accepts with each Claude seat's five unknown keys dropped. The Claude seats' coded outputs are rebuilt from the DeepSeek flash verdict [inferred: no live coded output exists yet].
- **Attack fixtures** [measured, `coded.pipeline.test.ts`]: a canary as a property name abstains, flags the screen and never reaches the record; keys holding a URL or an instruction are dropped (3 and 4 counted) and never reach the record; a delivery that asks for junk only when failing leaves the aggregate equal to the clean run (escalate when the screen sees the note, reject when it does not).
- **No recorded attack moves to accept under pair 3** [measured, `packages/testkit/src/coded-attacks.test.ts`]: the five attack fixtures with recorded judges end escalate then reject, Refunded, under prose and under pair 3 with `agg-6`. The coded answers are built from the recordings [inferred model: each judge keeps its recorded scores, overall and flag, and a judge with no recording in a role answers as in its other role].
- **The scripted mark** [measured]: `markedFake` passes a coded verdict unchanged; the Sepolia demo's `panelKind`, the test seller and the offer player check the `placeholder-` prefix first (`test-adjudicator.test.ts`, `demo-sepolia.test.ts`).
- **Bundles** [measured, sha256]: `setup.mjs` `6275515f…` to `dbcc8990…`; `serve.mjs` `85c014da…` to `00b0b2fd…`; `take.mjs` `15cb5fd6…` to `da23f1e7…`; `seller-worker.mjs` `1b163543…` to `8b5da668…`, with its pin. `buy.mjs` `b5992bfd…` and `try.mjs` `71634a90…` unchanged. Validators grew from 1,038,668 to 1,121,023 bytes; each bundle from 115 KB to 157 KB larger. `node site/build.mjs && node site/check.mjs`: PASS.
- **Red team** [measured, 2026-11-25, `packages/judgment/src/coded.redteam.test.ts`, 39 tests, now all passing; 11 were findings]:
  - M1 (medium), a canary split across two dropped fields escaped the scan. Fixed: the scan also joins the values alone without the schema's words, and the keys alone without its key names. Tests: "a canary split across …" (4 cases).
  - M2 (medium), reason-code order carried about 142 bits a 12-criterion seat (a 128-bit canary decoded from the record). Fixed: codes and kinds in closed-list order. Tests: "the reason codes of a 12-criterion seat cannot carry the judge's 128-bit canary to the public record"; `coded.test.ts` "keeps reason codes and injection kinds in closed-list order …".
  - M3 (medium), the holder numbered raw lines while judges read normalized lines. Fixed: `judgedText` for both. Test: "a hidden character between CR and LF does not shift the holder's line under the judge's".
  - L1 (low), the record kept the judge's criteria order (28.8 bits). Fixed: rubric order. Tests: "the record keeps the rubric's criteria order, not the judge's …"; `coded.test.ts` "… records the criteria in rubric order …".
  - L2 (low), lone surrogates made two locators share an anchor. Fixed: such a locator is dropped and counted, and `anchorIndex` lists none. Test: "a locator holding a lone surrogate is dropped and counted …".
  - L3 (low), a pointer resolved in the raw JSON, not the JSON the judges read. Fixed: resolved in the judged JSON; a repeated key there keeps no pointer. Tests: "a pointer the judge wrote from the normalized JSON resolves to the node the judge read …", "a JSON delivery whose judged text repeats a key keeps no pointer".
  - Parity: a fullwidth canary, and a decision key written twice (read as its last value), were missed by both filters. Fixed in the coded filter only (NFKC fold, `json-keys.ts`); the frozen prose filter keeps both, held by the red team's control test. Tests: "the canary in fullwidth characters in a dropped key abstains", "a repeated decision key abstains rather than reading the last one".
  - LIMITs the design accepts: the canary as bytes in numbers or reversed; the dropped counts (about 10 bits); the choice of codes (about 9.4 bits a criterion).
  - The 24 `agg-6` replay records were re-recorded (codes now in list order); `agg-6` was never released. The 144 prose records are unchanged.
- **Commands** [measured]:
  - `pnpm typecheck`, `pnpm lint`: exit 0. `pnpm validate:spec`: ok. `pnpm snap`: 63 passed, no snapshot changed. `pnpm snap --settlement=local`: pass. `pnpm demo`: pass. `forge test`: 592 passed.
  - `pnpm test`, first full run (before `forge build` ran in this worktree): 6,633 passed, 2 failed, 3 expected fail, 326 skipped. One failure (`tests/cut-feature-alignment.test.ts`, the new tests named `appealHash`) is fixed. The other is `apps/own-seller/src/frozen.test.ts`, which fails on any branch that changes `packages/`; CI's shallow checkout skips it [inferred from `.github/workflows/ci.yml`].
  - `pnpm verify`: FAIL on `forge build` and `test`. `forge build` cloned the contracts' nested submodules in this worktree (`contracts/lib/commerce-payments` now shows modified) and wrote a `contracts/out` whose creation code differs from the pinned one. With it, 28 more tests fail: 27 in `packages/settlement/evm/deploy-script.test.ts` and `examples/take.test.ts`'s creation-code pin. This branch changes no file under `contracts/`, `packages/settlement` or `examples/take.ts` [measured with `git diff`], so the failures belong to this worktree's contracts build [inferred]. Second full run: 6,922 passed, 29 failed (those 28 and the frozen-path test), 3 expected fail, 10 skipped.

## Decisions

- Aggregation label `agg-6` and template pair 3, after `agg-5` (coordinator, relaying Rafa, 2026-11-25).
- References kept as anchors, not verbatim (ADR-0050 section 3).
- The default stays screen-1, pair 2 and `agg-5`; `NEWEST_VERSIONS` stays pair 1 with `agg-5` (coordinator and Rafa, 2026-11-25).
- One format per policy, checked in `implementationsFor`, so the pipeline and `checkPolicyBinding` both refuse a mix before any judge is called.
- Deviation from the schema draft: a coded `reasons` list may be empty. With `minItems: 1`, dropping a judge's last unknown code would abstain the seat, which ADR-0050 section 2 rules out.
- Deviation from the schema draft: a prose seat carries no `format` key; its absence means `prose-1`. Writing `prose-1` would move every `agg-3` to `agg-5` record. A coded seat requires `format: "coded-1"`, and in the record `injectionKinds`, `injectionRefs` and each criterion's `refs` are always present.
- Core's `parseJudgeVerdict` now validates the prose branch only (`judge-verdict#prose`), so `verdict.ts` and `kept/verdict-0.ts` stay byte-identical and never accept a coded verdict. `parseAnyJudgeVerdict` reads the whole file and backs `parsers['judge-verdict']`.
- `agg-6` reuses `aggregate.ts`'s rule through `scoredView` (ids, scores, `overall`, flag; empty free text), so `aggregate.ts` is unchanged. A later change to `aggregate.ts` has to freeze it for both `agg-5` and `agg-6`.
- The canary scan reads keys too (`allText`), and copies `agg-5`'s base64 decoder rather than exporting it from `verdict.ts`.
- The anchor key is SHA-256 of `holdback/judgment/anchor/v1` and the plaintext bytes as delivered; intake drops a leading byte-order mark, and `plaintextBytes` restores it from the record's byte count.
- References resolve against the text the judges read, for the filter and the holder: the normalized JSON parsed (a repeated key there keeps no pointer), or its lines (red team M3, L3; this replaced resolving pointers against the raw JSON). A locator with a lone surrogate is dropped (L2). Criteria are recorded in rubric order and codes and kinds in closed-list order (L1, M2). Injection references without the flag are dropped, like the kinds.
- A prose-shaped answer under pair 3 counts: `evidence` and `rationale` are unknown keys, dropped and counted.
- The scripted mark: `markedFake` still marks a prose verdict (the demo-cloud tests read that mark), and passes a coded verdict unchanged; the readers check the `placeholder-` prefix first and the rationale mark for older prose records.
- `site/llms.txt` is unchanged: Crow's adjudicators accept new deals under the prose default only, so its line stays true. `site/ref/limits.txt` now says it per policy.
- The task's "no recorded attack moves to accept" runs as a what-if over the five attack fixtures with recorded judges (`coded-attacks.test.ts`): each judge keeps its recorded scores, overall and flag, and a judge drawn into a panel it has no recording for answers as it did in its other role.

## Handoff

Done on `t-616-coded-verdicts`: schema v0.15; the coded filter, references and anchors; template pair 3 and `agg-6`, carried beside the prose default; the one-format refusal; the replay records for pair 3 with `agg-6`; the attack fixtures; partner C's replay; the scripted mark; the hard rule, ADR-0049's status line, ADR-0050 section 5 and build notes, D106, the defenses doc, `site/ref/limits.txt` and the rebuilt bundles. No pull request opened (the coordinator opens it).

Paths touched beyond the task's list, all mechanical:
- The schema-version bump: `apps/operator/src/server.ts` (`SCHEMA_VERSION` 0.15) and its two tests, `examples/mandate.test.ts`, `docs/api.md`, `site/ref/http.txt`, `site/ref/signing.txt`, `spec/openapi/paths.json`, `tests/spec.test.ts`, as T-610's v0.14 bump did.
- `packages/core/src/parse.ts`, `validators-codegen.ts` and `validators.test.ts` (the per-format validators).
- The verdict union's prose readers: `apps/demo/src/source/simchain.ts` and `apps/demo/agents/agents.test.ts` (a narrowing each).
- `apps/adjudicator/src/bound-policy.test.ts` (pair 3 carried, the mix declined) and `apps/test-agents/scripts/play-offers.ts` (the mark reader).
- Nothing under `apps/demo-cloud` or the adjudicator's decide path.

Follow-up for both filters (not done): the prose filters of `agg-3` to `agg-5` are frozen, so they keep the fullwidth-canary gap and read a repeated decision key as its last value; a later prose aggregation version could adopt the coded filter's NFKC fold and `json-keys.ts`.

Not done:
- The red team over ADR-0050's attack list (the parent session runs it). Start with `coded.ts` (duplicate keys and `__proto__`, deep nesting, covert bits in codes and counts), `refs.ts` (anchor guessing on small work, U+2028 and forged `L<n>` prefixes) and `prompt.ts` (pair 3's numbering).
- The deploys and the calibration, which are Rafa's: carry pair 3 and `agg-6`, run the calibration on Sepolia, then move the default (Calibration plan).
- `docs/api.md` line 401 and the operator's discovery text still describe the fake-judge mark as the rationale prefix as well as the model prefix; true for prose records, and left for the deploy that moves the default.
