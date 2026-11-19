# The screen flags 8 of 24 genuine security reports delivered on the form, 7 of them for typography (T-557)

Research pass for T-557, roadmap row N40, run on 2026-11-19. Every number below comes from `count.mjs` in `docs/research/2026-11-19-screen-flags-on-real-reports/`, which wrote `results.json` beside it, unless the line says otherwise. The task changes no screen rule, check, form, schema or policy.

## Summary

**State: as a form delivery, the adjudicator's screen flags 8 of 24 genuine published security reports, and a person reading each trigger would call all 8 honest.** Measured counts; the honesty judgment is inferred from reading each trigger's line. A form delivery is the converted report with zero-width characters stripped, as form version 2 asks the seller (`examples/security-review-form.md`).

- **7 of the 8 flag for one signal alone:** characters that Unicode NFKC normalisation changes. The triggers are the ellipsis character `…`, superscript digits such as `²` and `¹`, and a superscript minus. These come from ordinary typing and from exponents in formulas (measured).
- **The eighth flags for one phrase:** an `override` match on `Effect.ignore, unlike the fresh-orphan path directly above`. That is a line of code and its comment, quoted in a finding (measured).

**What a flag means for a deal with a rubric:** the deal escalates. The appeal adjudicator then accepts the work only on a unanimous, valid, cross-family panel; anything less refunds the buyer. A rubric is the form's optional term (`examples/seller-adapter.template.json`, `optionalRubric`). So today, about one honest review in three would put the seller's pay on a unanimous panel (inferred from the 8 of 24).

**Recommendation: a decision for Rafa on one signal, the NFKC count.** Count only the characters whose NFKC form holds a letter: fullwidth letters, mathematical letters and letter ligatures. Ellipses, superscript digits and signs would stop flagging. On the same 24 form deliveries, the flag rate goes from 8 of 24 (33 %) to 1 of 24 (4 %), measured on a what-if in `count.mjs`, not on product code. Leave every other signal as it is.

**The genuine fix review of Crow's contracts reproduces the triage's 3 signals exactly (measured).** Its NFKC count is 6 characters: 5 ellipses and 1 superscript `³`. Its `verdict-claim` match is the phrase "verdict that is not an accept", where the review describes Crow's own contract. The words "Fixed" and "open" did not match. Under the proposed rule this review still flags, on `verdict-claim`. A review of an adjudication system names verdicts and accepts as its subject (inferred); this note records that as a known limit and proposes no change for it.

## Where the screen sits and what a flag does

- **Intake normalises the delivery.** `decodePlaintext` (`packages/judgment/src/intake.ts:103-108`) runs `normalizeText`. That function strips hidden characters and applies NFKC, counting each non-ASCII character NFKC changes except space variants (`packages/judgment/src/normalize.ts:91-95`).
- **The pipeline runs the screen the bound policy names.** `runPipeline` (`packages/judgment/src/pipeline.ts:211`) calls the screen. It also screens the party-written terms (`:212-213`). The default policy names `screen-1` (`apps/adjudicator/src/kept-policies.json`), and the build still carries `screen-0` for older deals (`packages/judgment/src/kept.ts`, `KEPT`).
- **The screen's entry point and its signals** are in `packages/judgment/src/screen.ts`. `screen()` starts at `:402`. It adds a `unicode_tags`, `zero_width` or NFKC `encoded_run` signal from the intake counts (`:408-410`). It then reads the text (`:413`) and, for a JSON delivery, the parsed string values (`:418-425`), each through `scanView` (`:315-357`). That scan finds:
  - the phrase patterns, `instruction_phrase` (`PHRASES`, `:44-64`; weak patterns flag only near a judging word, `TARGET`, `:69-71`);
  - mixed-script words, `encoded_run` (`:292-299`);
  - decodable base64, hex, percent-encoded and Morse runs, `encoded_run` (`:255-261`).

  Any signal makes `flagged` true (`:427`).
- **Without a rubric,** the panel does not run. The checks decide (`packages/judgment/src/aggregate.ts:107`). A flag only adds the reason "screen flagged; see screen.signals" to an accept (`:129-132`). The fix-review deal took this path.
- **With a rubric:**
  - The panel runs for the record, and the primary's decision can only be `escalate` (`aggregate.ts:186`).
  - The appeal adjudicator then decides under the flagged-appeal rule (`:162-183`). It accepts only if every seat returns a valid pass on the whole file, the passes span the family minimum, no judge suspects injection and the score is met. Otherwise it rejects, which refunds the buyer.
  - A silent appeal adjudicator leaves the default outcome, a refund on a chain (`docs/judgment-and-defenses.md`, decision table). The case also waits up to the deal's `appealDecideSec` (ADR-0031).

## Method

- **Reports:** the T-509 and T-534 corpus (`docs/research/2026-11-18-report-corpus.md`), with sources pinned in `sources.json` beside that note.
  - The 24 that convert to the form: the design set of 18 (Pashov Audit Group, Trail of Bits, Sherlock) and the second held-out firm's 6 (Shieldify).
  - Also screened and reported apart: the first held-out firm's 6 summaries (Cyfrin). They convert to a form with no findings, so they are screened as published only.
  - Also apart: Shieldify's 6 older layout reports, and the redacted first scan and fix review of Crow's contracts (`docs/audit/outside-scan/`).
- **Three shapes per report:**
  - *Published:* the Markdown as fetched, or the PDF's `pdftotext -layout` text, as `text/markdown` or `text/plain`.
  - *Converted:* the form's JSON from the corpus converter, run by `count.mjs` as `measure.mjs --only <set>`, as `application/json`.
  - *Form delivery:* the converted JSON with hidden characters stripped.
- **The screen as the adjudicator runs it:** `decodePlaintext`, then each kept screen through `KEPT.screens`, with the same inputs `runPipeline` passes. No model call is made: the screen is deterministic, and the panel is out of scope.
- **Attribution:** `count.mjs` copies screen-1's phrase patterns to name the words that matched. It checks the copy against the screen's own report on every report. Measured: 0 differences.
- **Reports are untrusted data.** The script reads their bytes and runs nothing from them. The committed files hold counts, code points and the short matched phrases. Copies stay under `reports/scratch/` (git-ignored).

To repeat:

```bash
node docs/research/2026-11-18-report-corpus/fetch.mjs reports/scratch/corpus/security
```

```bash
node docs/research/2026-11-19-screen-flags-on-real-reports/count.mjs reports/scratch/corpus/security reports/scratch/t-557-out
```

## Results

All counts measured with screen-1, the default. Screen-0 gives the same counts on the 24 in all three shapes. A report counts once per signal however many signals of that kind it raised.

| | Published | Converted | Form delivery |
| --- | --- | --- | --- |
| Reports screened | 24 | 24 | 24 |
| Reports with at least one signal | 16 | 12 | 8 |
| `encoded_run`, NFKC | 8 | 7 | 7 |
| `zero_width` | 6 | 4 | 0 |
| `encoded_run`, mixed script | 1 | 0 | 0 |
| `instruction_phrase` | 1 | 1 | 1 |
| `unicode_tags`, decodable runs | 0 | 0 | 0 |
| Flagged reports a person would call honest (inferred) | 16 of 16 | 12 of 12 | 8 of 8 |
| What-if: NFKC counts only characters that fold to a letter | 8 | 5 | 1 |

The most common triggers for each signal, on the 24 as published (measured; counts are characters or matches across all reports):

| Signal | Top triggers |
| --- | --- |
| `encoded_run`, NFKC | U+2026 `…` to `...`: 10 characters. U+00B2 `²` to `2`: 2. U+00B9 `¹` to `1`: 2. A fourth, U+207B superscript minus: 1. |
| `zero_width` | U+200B zero-width space: 1,424 characters, all in Trail of Bits PDF text layers. U+00AD soft hyphen: 4. No third trigger. |
| `encoded_run`, mixed script | Greek `Δ` joined to Latin identifiers in a formula (`ΔfeeReceiver`): 2 words, 1 report. No second trigger. |
| `instruction_phrase` | `override`: "Effect.ignore, unlike the fresh-orphan path directly above", in code and in its comment: 1 report. No second trigger. |

Outside the 24 (measured):

- **Cyfrin summaries, published:** screen-1 flags 2 of 6, both on decodable Morse. The runs are the dot leaders of a table of contents (`Overview . . . . .`), which decode as rows of the letter e. Screen-0 flags 3 of 6.
- **Shieldify layout reports:** screen-1 flags 2 of 6 as published, 1 of 6 converted and 1 as a form delivery, all on NFKC (ellipses, and the `ﬀ` ligature). Under the what-if, 0 of 6 form deliveries flag.
- **Crow's first scan and fix review:** screen-1 flags 2 of 2. Each has 6 NFKC characters (5 `…`, 1 `³`) and the `verdict-claim` phrase "verdict that is not an accept", in the text and in the JSON string values. Screen-0 flags both on NFKC only. Under the what-if, both still flag, on `verdict-claim`.

## What the numbers mean for a deal with a rubric

A buyer who adds the form's optional rubric to a security review turns every flag into an escalation. Measured: 8 of 24 genuine reports delivered as the form would flag. The appeal adjudicator would then pay the seller only if every judge, across families, returns a valid pass on the whole file; one abstention, one fail or one judge suspecting injection refunds the buyer. The flags in this corpus come from an ellipsis, an exponent and a quoted line of code, which a seller cannot reasonably foresee. The seller's protection is to read the screen before delivering, and its only fix would be to rewrite the report's typography. Folding NFKC before delivery would change meaning: `10¹⁸` becomes `1018` (inferred). The zero-width signal is already handled: form version 2 tells the seller to strip zero-width spaces, and the form's `hidden` check rejects them before the screen matters. So the NFKC count is the one signal that makes honest work escalate often, at a rate a rubric deal should not carry.

## Recommendation

**Propose a change to one signal, as a decision for Rafa: the NFKC signal counts only characters whose NFKC form holds a letter.**

- **Before:** 8 of 24 form deliveries flagged, 33 % (measured).
- **Expected after:** 1 of 24, 4 % (measured on the what-if in `count.mjs`, not on product code). The one left is the `override` phrase on a quoted line of code.
- **What the defense keeps (inferred):**
  - The phrase patterns already read the NFKC-normalised text, so a phrase written in fullwidth or mathematical letters still flags as a phrase.
  - Fullwidth and mathematical letters and letter ligatures still flag as NFKC changes.
  - What stops flagging is punctuation, superscript and subscript digits and signs, and fullwidth digits; none of these can spell an instruction alone.
- **What changes:**
  - The test `packages/judgment/src/screen.test.ts:143` flags three fullwidth digits; under the rule it would not.
  - The change is a new screen version, `screen-2`, carried beside `screen-1` for the open deals bound to it, with the default switched in a second deploy (ADR-0036).
  - It needs a red-team pass: the screen is a judgment defense.
- **Leave the rest as it is, as known limits:**
  - `verdict-claim` on reviews of an adjudication system: 0 of 24 in the corpus; the 2 outside-scan reviews of Crow's own contracts.
  - `override` on quoted code: 1 of 24.
  - Mixed script on `Δ` in a formula: 1 of 24 as published, 0 as a form delivery.
  - Morse on dot leaders: Cyfrin's summaries, which are not form deliveries.

  Each is one report or a report that is not a form delivery. Changing a signal for one report would tune the screen to this corpus.

The corpus is 24 reports from 4 firms, so the rate has a wide margin. Read 8 of 24 as "about a third", not as 33.3 % (inferred).
