# ADR-0044: The screen's NFKC signal counts only characters that fold to a letter

- **Status:** Proposed, 2026-11-25. Adopted by the coordinator's session on Rafa's "Yes" of 2026-11-20 to "Should the screen stop flagging honest reports for their typography?", under the in-repository autonomy rule (D89). Rafa may overrule any line.
- **Raised by:** T-557 (`docs/research/2026-11-19-screen-flags-on-real-reports.md`), built by T-577 (`docs/tasks/T-577-screen-typography.md`). Roadmap row N40.
- **Builds on:** ADR-0006 (the defended panel, threats T1 and T2), ADR-0035 (screen-1), ADR-0036 (a deal is judged under the policy it bound), ADR-0043 (the same two-deploy pattern for `agg-4`); D32.
- **Changes:** `packages/judgment` (`normalize.ts` adds a count, `intake.ts` passes it, `screen.ts` becomes `screen-2`, `kept/screen-1.ts` is the frozen copy, `kept.ts`, tests), `packages/sdk/src/decrypt.ts` (passes the count), `apps/adjudicator/src/kept-policies.json` (`screen-2` kept, not the default), `fixtures/replay/kept-policies.json` (new records only), `packages/testkit/src/replay.ts` (a typography read path), `site/setup.mjs` (rebuilt). No contract, signed type, schema or API route changes.

Labels: **measured** (run on branch `t-577-screen-typography`, 2026-11-25), **inferred** (from reading the code), **guessed**.

## Summary

**Today the screen flags 8 of 24 genuine security reports delivered on the form, 7 of them for typography alone** [measured, T-557]: an ellipsis `…`, a superscript digit such as `¹⁸`, or a superscript minus. On a deal with a rubric, a flag sends the deal to the strict appeal path, where the seller is paid only on a unanimous, valid, cross-family pass.

**The decision:** from `screen-2`, the NFKC signal counts only the characters whose NFKC form holds a letter. Fullwidth, mathematical, enclosed and superscript letters and letter ligatures still flag. Ellipses, superscript, subscript, fullwidth and mathematical digits, and folded punctuation do not flag alone. Every other signal is unchanged.

**Result on the same reports, under product code:** 1 of 24 form deliveries flags under `screen-2`, against 8 of 24 under `screen-1` [measured, `count.mjs` over every kept screen; `results-screen-2.json` beside T-557's note]. The one left is the `override` phrase on a quoted line of code (`Effect.ignore`), a separate known limit T-557 named; this change leaves it.

## Why the narrower count loses little

- **The judges read the folded text** [inferred, from the code]. `decodePlaintext` applies NFKC (`packages/judgment/src/intake.ts:103-108`), and the prompt is built from that text (`packages/judgment/src/pipeline.ts`, `buildPrompt` with `input.intake.data`). The phrase patterns, the leetspeak and skeleton views and the decoders read the same folded text.
- **So a compatibility character cannot show the judges something the patterns do not see.** NFKC is idempotent: whatever an attacker writes in compatibility forms, the folded text could be delivered as it is, and the NFKC signal would not flag that text under either version [inferred].
- **What the signal still adds** is a catch on text written in compatibility letters that no phrase pattern matches, as an off-the-shelf "Unicode font" payload is. Letters keep that catch; digits and punctuation cannot spell a request alone.

## Measured on the attack corpus

`packages/judgment/src/screen.typography-t577.test.ts` runs 28 cases under `screen-1` (the frozen copy) and `screen-2`, and pins each result.

| Class | Cases | `screen-1` flags | `screen-2` flags |
| --- | --- | --- | --- |
| L: fullwidth, mathematical, circled, superscript and modifier letters | 6 | 6 | 6 |
| G: letter ligatures | 1 | 1 | 1 |
| D: folded digits as leetspeak inside a phrase | 3 | 3 | 3 |
| D: fullwidth digits in a request with no phrase | 1 | 1 | 0 |
| P: folded punctuation splitting a phrase | 2 | 2 | 0 |
| P: their plain-ASCII twins | 2 | 0 | 0 |
| P: fullwidth colon after an address to the judges | 1 | 1 | 1 |
| M: mixed scripts | 2 | 2 | 2 |
| C: Morse in ellipses, fullwidth hex and base64 | 3 | 3 | 3 |
| C: superscript digits as decimal character codes | 1 | 1 | 0 |
| C: its plain-ASCII twin | 1 | 0 | 0 |
| E: fullwidth letters behind JSON `\u` escapes | 1 | 1 | 1 |
| E: an ellipsis behind a JSON `\u` escape | 1 | 1 | 0 |
| H: honest typography from the reports | 3 | 3 | 0 |

Every existing screen test, the T-367 red team's cases and `redteam.test.ts` pass under `screen-2` [measured, `pnpm exec vitest run`, 5,427 tests passed]. One existing case changed by design: three fullwidth digits no longer flag (`screen.test.ts`, red-team round). The mutation sweep's three NFKC mutants for `screen-2` (`packages/judgment/scripts/mutants.mjs`) are all killed [measured].

Characters that fold to a letter and a symbol, such as `℃` (to `°C`) or `㎏` (to `kg`), still count. They are rare in reports, and counting them keeps the rule simple [inferred].

## What the change costs in catches, accepted

Four cases `screen-1` catches and `screen-2` does not, each because the only signal was the NFKC count:

1. **An ellipsis or a fullwidth full stop splitting the words of a phrase** ("ig…nore"). Its plain-ASCII twin ("ig...nore") passes `screen-1` too. A reader that rejoins words across punctuation is a phrase-pattern change, for both forms at once; it goes to triage.
2. **Superscript digits as decimal character codes.** The screen decodes no decimal codes, so the plain digits pass `screen-1` too.
3. **Fullwidth digits in a request with no phrase.** The request reads the same with ASCII digits, which pass both versions.

Accepted because each attack is open today in plain ASCII, so `screen-2` opens no text the judges could read that `screen-1` closes [inferred]. The panel remains the second line: judges read the data inside a marked section with injection-hardened templates, from two families.

## Alternatives

| Rule | Form deliveries flagged of 24 | Catches lost on the corpus | Note |
| --- | --- | --- | --- |
| A. Every NFKC change (`screen-1`) | 8 | 0 | One honest review in three escalates |
| **B. Letters only (`screen-2`)** | **1** [measured] | 4, each open in plain ASCII | Chosen |
| C. Letters and digits | 2 or more [inferred: the superscript `³` and `²` reports stay flagged] | 2 | Keeps flagging exponents, the commonest honest trigger after the ellipsis |
| D. Letters, and digits only inside a word | about 1 [guessed] | 3 | Needs context per character in `normalize.ts`; the inside-a-word digit cases already flag through the leetspeak view |
| E. A run-length or per-word ratio | not measured | depends on the threshold | A threshold tuned to 24 reports; more code for no catch B lacks |
| F. Form version 3 asks sellers to rewrite typography | 1, for sellers who follow it [inferred] | 0 | Protects only sellers who read the form; works today without a version (D32) |

A research pass on the most capable model was started on 2026-11-20 and stopped at Rafa's word to save tokens. This record rests on T-557's measurements, the code reading above and the measured corpus.

## Version and rollout

- `screen-1` is frozen as `packages/judgment/src/kept/screen-1.ts`; only its imports and header differ. Its pinned digest and its replay records do not change.
- `screen.ts` is `screen-2`. Without the letter count (a caller from before this change), it uses the broader count, so a missing field fails closed.
- `apps/adjudicator/src/kept-policies.json` lists `screen-2` as kept. The default stays `screen-1`, so no new deal binds `screen-2` yet. The file's own rule sets the order: a new default ships in two deploys, carried first and default second.
- **Two deploys, both the coordinator's, on Rafa's word:** first the build that carries `screen-2` beside `screen-1`, with the default unchanged; then the build whose default is `screen-2`.
- The buyer's SDK (`decryptDeliverable`) screens released work with the newest screen, now `screen-2`.

## Litmus tests

- **Neutrality:** unchanged. No party gains a way to move a hold outside the terms.
- **The hold:** unchanged.
- **Defended multi-model judgment:** the screen keeps every catch that changes what the judges read; it drops a flag that sent honest work to the strict appeal. Four catches with plain-ASCII twins are given up, as above.
