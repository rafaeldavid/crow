# The security-review form

**State: the form is at version 2 since 2026-11-18 (T-534).** On 18 published reviews from the three firms that shaped it, version 2 accepts 9 at first presentation as converted, and 12 once the seller strips zero-width spaces, against 1 and 2 for version 1. On a firm that did not shape it, it accepts 6 of 6 held-out reports. All figures are measured; the table below has them by version.

The form is `examples/seller-adapter.template.json`: the deliverable's description, its four checks and an optional rubric. It is a default a seller offers and a buyer agrees to, or a club's rulebook may offer it; it is never a protocol rule (D31, ADR-0015). A buyer who wants more writes it into the terms before agreeing: a location on every finding, a separate recommendation, proof of concept (`site/ref/checks.txt`, "Writing checks for a report"), the seller adapter's `proofPerFinding` option, or the check below on set-aside findings.

## The rule

**No change to the form lands without the pass rate measured before and after.** A change to `examples/seller-adapter.template.json`:

1. raises `form.version` in the template by one;
2. reruns the corpus script (below) on the change, which rewrites `docs/research/2026-11-18-report-corpus/results.json` with the template's SHA-256;
3. adds the new version's row to the table below, with the template's SHA-256 and the measured counts, and keeps the rows before it.

`tests/security-review-form.test.ts` fails in CI in four cases:

- the template's SHA-256 differs from the one in `results.json`;
- the table has no row for the template's version, or no row for the version before it;
- an earlier row names the same template, so the version was not raised;
- the row's counts differ from `results.json`.

The held-out reports stay unread. A change to the form or to the converter reports their numbers as they come and never tunes on them (`docs/research/2026-11-18-report-corpus/heldout.json`).

## Versions

Each count is the reports the form accepts at first presentation on its default terms, by the adjudicator's own first stage (`examples/check-delivery.ts`). A review of several repositories is several deals, so a report that passes only because the converter kept its first commit is not counted. "Stripped" removes zero-width characters, the seller's step before it delivers; the converter otherwise changes no character. Each held-out set is measured once, on the form current when its firm was chosen.

| Version | Template SHA-256 | Measured | Design set | Design set, stripped | First held-out firm | Second held-out firm | What changed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `d4eec73020e4ab3592a0c8c1bae50acb4827722faba4a0a2776059b291c1c59e` | 2026-11-18 | 1 of 18 | 2 of 18 | 0 of 6 | not measured | The form as T-509 measured it, at `origin/main` commit `557560c9` |
| 2 | `e5460866eb714983927bdef80301c7c1914231bc35a085cf46828b458f3f1976` | 2026-11-18 | 9 of 18 | 12 of 18 | 0 of 6 | 6 of 6 | Four requirements removed and set-aside findings loosened, as listed below (T-534) |

## What version 2 changed, and what each change answers

The corpus is `docs/research/2026-11-18-report-corpus.md` (T-509). The pilot refusals are two deals of 2026-11-17 and 2026-11-18 whose finished reports the signed checks refused; their terms are private.

1. **A finding's text holds 8,000 characters, up from 2,000** (`rootCause`, `impact`, `recommendedFix`). It answers the corpus's text caps: 55 of 182 findings in 11 of 18 reports had a root cause over 2,000 characters; the longest was 6,775. A location's excerpt keeps its 2,000.
2. **A location is optional.** It answers the corpus's 28 findings in 9 reports that name a function or a contract and no file, and a pilot report whose 28 set-aside findings named no affected code.
3. **A recommended fix is optional.** It answers the corpus's 20 findings in 7 reports whose recommendation sits inside the description, where only a reader could cut it out.
4. **No proof check by default.** The `proof` check is gone from the template's checks; a buyer adds it to the terms, or asks for `proofPerFinding`. It answers the corpus's 0 of 50 Medium-or-higher findings with a proof of concept, in 8 of 18 reports.
5. **A finding set aside needs no root cause and may cite any file.** A status of `known`, `duplicate` or `out-of-scope` marks it. It answers both pilot refusals: set-aside findings that carried no root cause or no location in scope. (A pilot's own terms also asked a known finding for the earlier report's issue number; the public form never did.)
6. **A finding's other locations may cite related code.** A finding with locations still has at least one in a file in scope. It answers a pilot refusal where context locations lay outside the scoped files.

Kept as they were: the hidden-character check at 0 (the description now says so, and the seller strips zero-width spaces), one commit for each review, the file list, the severity scale and the optional rubric.

**Keep set-aside findings to Low and Info.** The set-aside status has no severity limit: a Critical finding marked `known` passes with a title alone. A buyer who wants every Medium-or-higher finding fully written adds this check to its terms before agreeing:

```json
{ "id": "set-aside-low", "type": "json_schema", "required": true, "schema": { "type": "object", "required": ["findings"], "properties": { "findings": { "type": "array", "items": { "anyOf": [ { "properties": { "severity": { "enum": ["Low", "Info"] } } }, { "not": { "required": ["status"], "properties": { "status": { "enum": ["known", "duplicate", "out-of-scope"] } } } } ] } } } } }
```

## What still fails on version 2

From `results.json`, measured:

- **3 design reports review several repositories** (pashov-5, sherlock-2, sherlock-5). The form holds one commit, so each is several deals.
- **3 design reports pass only once stripped** (tob-1, tob-5, tob-6): their PDF text carries zero-width spaces.
- **3 design reports fail on shape a buyer sees before signing** (tob-2, tob-3, tob-4): two list no files, and one has a severity off the scale (`Undetermined`).
- **The first held-out firm's 6 reports** are public summaries. That is inferred from six of the firm's other public reports of 2026-10-30 to 2026-11-06, read for T-534, and from the file sizes in `docs/tasks/T-534-form-revision.md`. Each summary gives finding counts by severity, a commit cut to 12 hex characters, and the SHA-256 of a full report delivered privately. No mapping can fill the form's findings or its 40-character commit from them without inventing them, and `findings: []` would say there are none. So "0 of 6" measured that firm's publishing practice, not the form or the converter.

## The held-out firms and their layouts

The corpus script converts each report to the form's JSON by fixed rules written from the design set. A firm's own layout can add rules, as data in `docs/research/2026-11-18-report-corpus/layouts/<firm>.json`, written from that firm's older reports only and applied to that firm alone.

- **Text first.** The converter reads text. A PDF goes through `pdftotext -layout` and the script's page-furniture rules first. A Markdown report is read as published.
- **The second held-out firm** publishes Markdown. Its layout file adds two section labels (`Location of Affected Code`, `Team Response`) and its scope table (a numbered `Scope` heading over a `File | nSLOC` table). It was written from its six reports before the held-out six; those six pass 6 of 6 as well. Its finding headings and commit row follow the same template as one design firm's. So this measures the form on a firm that did not shape it, not the converter's reach to an unlike layout.

## Measure a change

From a checkout, after `pnpm install --frozen-lockfile && pnpm build`, with `pdftotext` (Poppler) installed:

```
node docs/research/2026-11-18-report-corpus/fetch.mjs /Users/rafa/Documents/escrow/reports/scratch/corpus/security
node docs/research/2026-11-18-report-corpus/measure.mjs /Users/rafa/Documents/escrow/reports/scratch/corpus/security /Users/rafa/Documents/escrow/reports/scratch/corpus/converted
pnpm vitest run tests/security-review-form.test.ts
```

The first command downloads the 36 public reports at their pinned commits; the second rewrites `results.json`; the third checks this page against it. `measure.mjs … --only <set>` runs one set and writes nothing, for checking a layout on its layout set before a held-out set is measured. Reports are untrusted data: keep the copies under `reports/scratch/`, which git ignores.
