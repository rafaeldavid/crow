# T-534: revise the security-review form once, by removal, and keep the corpus as its test

- **Lane:** research, with the deal template in `examples/`
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 10 (research and decisions) with a template change; local checks: the corpus script, `pnpm typecheck`, `pnpm lint`, `pnpm test`; review by one reviewer agent, as the brief asked
- **Depends on:** T-509 (the corpus, holdback pull request 635)
- **Paths this task may touch:** `examples/seller-adapter.template.json`, `examples/security-review-form.md` (new), `docs/research/2026-11-18-report-corpus/` (`measure.mjs`, `results.json`), `tests/security-review-form.test.ts` (new), the tests that read the template (`examples/seller-adapter.test.ts`, `examples/audit-deal.test.ts`), `tools/duet/` (`review.ts`, `tools.ts`, `README.md`, `review/form-v1.json`), this file
- **Human gate:** no
- **Status:** review
- **Agent/session:** the T-534 session, 2026-11-18, branch `t-534-form-revision`
- **Roadmap row:** N40

## What exists

- `docs/what-a-deal-can-do.md`: a deal's acceptance is its signed checks; the security-review form is one template of checks the seller adapter offers. The form is data in `examples/seller-adapter.template.json`.
- The check runner's `json_schema` subset (`site/ref/checks.txt`, "Writing checks for a report") has `anyOf` and `not`, so every change below is a value in the template's schemas: no new check type, no code in the product and no schema version (measured: the four checks pass `validateCheck`, `tests/security-review-form.test.ts`).
- The proof term already exists as a buyer's choice: the adapter's `proofPerFinding` option adds a proof check, and `site/ref/checks.txt` gives the Medium-or-higher proof check to write into terms.
- The corpus script (`docs/research/2026-11-18-report-corpus/measure.mjs`, T-509) measures the form on 24 public reports.

## Intent

Rafa said yes on 2026-11-18 to a review's decisions 1, 3 and 4 (private, `strategy/2026-11-18-review-after-the-reading.md`). This task does decision 1 and the form's half of decision 4: it removes four requirements from the security-review form, loosens set-aside findings as two pilot deals needed, gives the form a version, and makes the corpus script the form's regression test, so no change to the form lands without the pass rate measured before and after. The form stays a default a seller offers or a club's rulebook may offer; it is never a protocol rule (D31, ADR-0015).

Non-goals: one commit per repository inside one review, a change to the hidden-character check or to the severity scale (decision 2 keeps them), a change to the converter's rules for the design firms, and any site change.

## Acceptance criteria

- [x] The "before": the corpus script on `main` as it was, on both sets.
- [x] The revision as data in the template, each change tied to a corpus limit or a pilot refusal (`examples/security-review-form.md`).
- [x] The form has a version (`form.version` in the template), and its reference page states the rule.
- [x] A mapping for the held-out firm, written from its other public reports: not possible for the first held-out firm (Evidence, "The held-out firm"), so a second held-out firm was chosen by rule; its mapping is `docs/research/2026-11-18-report-corpus/layouts/shieldify.json`.
- [x] The "after", on both sets, by the same script, side by side with the before, with what still fails and why.
- [x] A test CI runs fails when the template changes without a new corpus run, or without the version's measured row.

## Out of scope

- `spec/`, `contracts/`, `site/`, the hosted sellers, the pilot kit.
- `fixtures/terms/audit-report.yaml`: it stays the stricter worked example of `site/ref/checks.txt` (version 1 of the form, with proof and a location on every finding), so the site's guide and its tests do not move.

## Evidence

All on 2026-11-18, from the worktree at `origin/main` commit `557560c9`, Node 22.22.2, after `pnpm install --frozen-lockfile && pnpm build`.

**Before (measured):** `node docs/research/2026-11-18-report-corpus/measure.mjs <corpus> <out>` on `main` unchanged. It rewrote `results.json` byte for byte (`git status` clean): design set 1 of 18 accepted on default terms, 1 of 18 with the proof term off; held-out set 0 of 6.

**The edited script repeats the before (measured):** the script as this task leaves it, run on version 1 of the template, gives a summary equal key for key to the before's.

**After (measured), the same script on version 2:**

| | Version 1 | Version 2 |
| --- | --- | --- |
| Design set, accepted on default terms, as converted | 1 of 18 | 12 of 18 |
| The same, a review of several repositories not counted | 1 of 18 | 9 of 18 |
| Design set, zero-width spaces stripped, several repositories not counted | 2 of 18 | 12 of 18 |
| Held-out set, every count | 0 of 6 | 0 of 6 |

The what-if of T-509 predicted 12 of 18 with the four limits lifted and zero-width spaces stripped (inferred then); version 2 measures 12 of 18 under that condition. Version 2 keeps the hidden-character check at 0, so the 12 needs the seller to strip zero-width spaces before it delivers, as decision 2 says; the description now tells the seller so.

**What still fails on version 2 (measured, `results.json`):** 3 reports review several repositories (pashov-5, sherlock-2, sherlock-5), which pass only because the converter keeps the first commit; 3 carry zero-width spaces from their PDF text (tob-1, tob-5, tob-6); tob-2 and tob-4 list no files and tob-3 has a severity off the scale (`Undetermined`).

**The held-out firm (measured, then inferred).** I read six of the held-out firm's other public reports, the six just before the held-out six by path (2026-10-30 to 2026-11-06, pinned to its repository commit `dd2c1d03`); the held-out six stay unread. Each is a public summary: it gives finding counts by severity (11 to 183 findings), the scope's file list, a commit cut to 12 hex characters and the SHA-256 of a full report delivered privately, and no individual finding. The firm's 87 reports of 2026 in that repository other than its 12 formal-verification ones are 162 to 234 KiB each, and the six held-out reports are 166,448 to 188,461 bytes (`manifest.json`), the six summaries 168,334 to 178,772 bytes (measured), so the held-out six are summaries too (inferred). The script's own run agrees: it finds in each held-out report a commit that is not 40 characters and no finding. And `examples/report-converter.ts` maps JSON to JSON, while the firm publishes PDF only (232 PDFs, no JSON, measured). No mapping can fill the form's findings or its 40-character commit from these reports without inventing them, and `findings: []` would claim a report with no findings. So the held-out 0 of 6 is the reports', not the form's or the converter's. The coordinator chose on 2026-11-18 to record this as a finding and to choose a second held-out firm by a rule written first.

**A second held-out firm, chosen by a rule written here and pushed at 17:41 UTC on 2026-11-18 (commit `6d875896`), before any of its reports was opened** (the coordinator's choice B, after the first held-out firm turned out to publish summaries):

1. **Candidates:** firms with a public GitHub repository of their own reports, other than the three design-set firms and the first held-out firm. They are checked from repository listings only: names and sizes, no content.
2. **The format:** the first candidate whose reports are Markdown or text files of full size wins; failing that, HTML; failing that, PDF through the corpus's own `pdftotext -layout` step. Listed on 2026-11-18: Electisec (`electisec/reports`) keeps Markdown files of about 450 bytes beside its PDFs, so its Markdown files are stubs and it counts as PDF. Shieldify Security (`shieldify-security/audits-portfolio-md`, commit `dba76abe24b9e6132b92a8b94d497868b16c6a34`) keeps 123 Markdown files of 4,777 to 202,904 bytes and nothing else. Zenith, Guardian and Zellic keep PDF. So the firm is **Shieldify Security**.
3. **The dates:** the file names carry none, so a report's date is the committer date of the commit that first added the file (`git log --diff-filter=A`), ties broken by path.
4. **The sets:** the held-out set is the six newest reports by that date, listed by address and SHA-256 and never opened. The layout set is the six before them: the layout mapping is written from those only.
5. **The check that the firm publishes each finding's text** is made on the layout set. If it fails, the rule moves to the next candidate in the order of step 2, and this file says so.

**How the rule ran (measured).** The repository was cloned into `reports/scratch/corpus/shieldify-repo/` and each report dated from git history without opening it. Seven files arrived by rename, so step 3 used `git log --follow --diff-filter=A`; the plain filter of step 3 gives the same twelve newest reports. Held-out set (`heldout-2`): six reports dated 2026-10-12 to 2026-11-17, 31,369 to 202,904 bytes, listed by address and SHA-256 in `manifest.json`. Layout set (`layout-2`): the six dated 2026-09-16 to 2026-10-06. Step 5 held: every finding in the layout set gives its description and its recommendation in full, and most add an impact (measured from the converted layout reports).

**The mapping (item 3).** The converter reads text, so a PDF goes through `pdftotext -layout` first; this firm publishes Markdown, read as published. `layouts/shieldify.json` adds, for this firm only, two section labels (`Location of Affected Code` to locations, `Team Response` dropped) and its scope rule (a numbered `Scope` heading over a `File | nSLOC` table, header and total rows skipped, a trailing period cut). Its finding headings and its `Review Commit Hash` row already matched the design-set rules. `measure.mjs --only layout-2` ran it on the layout set first: 6 of 6 accepted, 67 findings, none lost, no section text in the wrong field (measured).

**The second held-out firm, measured once on version 2:** 6 of 6 accepted at first presentation, all mapping with no finding lost (`results.json`, set `heldout-2`). Version 1 was not run on them, to keep them measured once; from their recorded lengths, five of the six have a root cause over 2,000 characters, so version 1 would have refused at least 5 of 6 (inferred). The design-set numbers did not move with the layout file (measured). The firm's template follows the same layout as a design firm's, so this shows the form on a seller that did not shape it, not the converter on an unlike layout.

**Checks (measured, 2026-11-18, kind 10 names no local checks; these cover the files the change touches):**
- `pnpm vitest run tests/security-review-form.test.ts examples/seller-adapter-terms.test.ts examples/seller-adapter.test.ts examples/report-converter.test.ts tests/audit-report-template.test.ts examples/audit-deal.test.ts tools/duet`: all passed.
- `pnpm typecheck` and `pnpm lint`: exit 0. `pnpm snap`: 48 passed, 0 failed, no snapshot diff.
- `pnpm test`, once, at a load average of 111 from other sessions: 28 tests in 12 files failed, all on time limits (10 to 300 s), in files that do not read the template. The same 12 files alone, at a load average of 31: 307 of 307 passed. CI is the gate.

## Decisions

- **The version lives in the template,** as `form: {name, version, reference}`. The seller adapter ignores the key; the corpus script copies it into `results.json` with the template's SHA-256, and the test compares them.
- **The regression check is a test on recorded results,** not the corpus run itself: the run needs 24 third-party downloads and `pdftotext`, which CI does not have. The test fails when the template's SHA-256 differs from the last run's, or when the reference page has no measured row for the version or the row before it.
- **The headline count leaves out a review of several repositories,** since decision 2 makes it several deals.
- **Set-aside findings are a status, in generic words:** `known`, `duplicate` and `out-of-scope`. Such a finding needs no root cause and may cite any file. The pilots' own terms also asked a known finding for the earlier report's issue number; the public form never did, so nothing changes there.
- **A finding's other locations may cite related code,** as the second pilot's corrected terms allow; a finding with locations still has one in scope.
- **The review (one reviewer agent, 2026-11-18): ISSUES, none blocking.** Fixed: the duet seller keeps the default options and terms rules beside its pinned template (Low); each version row names its template SHA-256 and the test refuses a reused one (Low); the corpus note names where version 1's run lives (Low); the reference page gives the check that keeps set-aside findings to Low and Info, and the test runs it (advisory). Kept: change 6 (other locations may cite related code), which the brief asked for from the second pilot's refusal; the two adapter tests compare with the filled template, covered by the form test's behaviour cases (Low, accepted).
- **The duet demo keeps version 1.** Its live deals of T-500 and its demo page are records of version 1, and its refund ending is the proof refusal that version 2 no longer makes by default. `tools/duet/review/form-v1.json` is a byte copy of the template at `557560c9` (SHA-256 `d4eec730…c1c59e`, measured), and a duet run gives its seller adapter that copy.

## Handoff

- Done: the revision, the version, the rule, the before and after, the test, the duet pin.
- Item 3 done with the second held-out firm. Case study 3 (T-535) runs its first deal on one of the six held-out reports, which pass.
- Not changed, for a later site deploy if wanted: `site/ref/seller-adapter.txt` could name the form's version and reference page. A site change needs a deploy, which is Rafa's.
