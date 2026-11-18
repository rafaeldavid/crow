# Published security reviews against today's form: 1 of 18 passes as published (T-509)

Research pass for T-509, roadmap row N180, run on 2026-11-18. Every number below comes from `docs/research/2026-11-18-report-corpus/measure.mjs` on the reports listed in `manifest.json` beside it, unless the line says otherwise.

## Summary

**State: today's security-review form accepts 1 of 18 published reports at first presentation (measured).** Only 5 of the 18 map to the form with no finding lost, and the check runner accepts 1 of those 5. The proof term changes nothing: with the proof check left out, the count stays 1 of 18.

**The form, more than the reports, sets that number (measured).** When the what-if run lifts four check-level limits together, the same check runner accepts 12 of the 18 reports. Those limits are the 2,000-character text caps, the required location, the required separate recommendation and the proof check, plus removing zero-width spaces. No single limit lifted alone raises the count above 2 of 18 (inferred from each report's measured list of blockers), because 15 of the 18 reports meet two or more blockers.

**The held-out firm's 6 reports give 0 of 6, and that number says nothing about the reports (measured).** The converter's rules, written from the three design firms, find no finding header and no 40-character commit in any of them. The held-out set measures the converter's reach: rules learned from three firms' layouts did not reach a fourth.

What matters most:

1. **High · Text caps.** 55 of 182 design-set findings have a root cause over 2,000 characters (median about 1,520 characters, longest 6,775). 11 of 18 reports carry at least one.
2. **High · No file at a finding.** 28 findings in 9 reports name functions or contracts in prose and no file in scope, so the required location cannot be filled without someone who knows the code.
3. **High · Proof.** 0 of the 50 Medium-or-higher findings carry a proof of concept, as a file or as a section. 8 of 18 reports have Medium-or-higher findings without proof; a ninth fails the proof check on a finding with no severity.
4. **Medium · One commit.** 4 of 18 reports review two to seven repositories, each at its own commit. The form holds one.

## Scope

- **The corpus:** 24 public reports from 4 firms, 6 per firm, chosen by a rule fixed before any report was read. The rule takes the six newest reports in each firm's own public GitHub repository, by the date in the file name (`sources.json`, key `rule`). Every source is pinned to the repository commit read on 2026-11-18.
- **The sets:** design set: Pashov Audit Group, Trail of Bits and Sherlock (18 reports, 182 findings). Held-out set: every report of Cyfrin (6 reports), listed in `heldout.json`. `fetch.mjs` fetched and hashed the held-out reports and `measure.mjs` ran on them; no person or model read them.
- **The form under test:** `examples/seller-adapter.template.json` at `origin/main` commit `4d7aacb5`, its five checks unchanged: `report`, `proof`, `scope`, `coverage` and `hidden`.
- **The check runner:** `examples/check-delivery.ts`, unchanged, on Node 22.22.2. It runs the adjudicator's intake rules and deterministic checks (stage 1).
- **Left out:** the screen, the judges, any rubric, and live deals. The design partner's own reports are left out of this public note.
- **Reports are untrusted data.** Copies stay under `reports/scratch/corpus/` (git-ignored). The scripts read their text and run nothing from them. This note and the committed files hold no report text: addresses, hashes and counts only.

## Manifest

The address of each file is its GitHub blob at the pinned commit; `manifest.json` holds it, the licence and the SHA-256. Reuse terms: Trail of Bits publishes under CC-BY-SA-4.0. Pashov Audit Group, Sherlock and Cyfrin publish with no licence file, for public reading. This task stores no copy in the repository and reuses links, hashes and counts only.

| ID | Firm | Date | Set | Format | Bytes | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| pashov-1 | Pashov Audit Group | 2026-03-26 | design | Markdown | 35,947 | `94cca6af0e8e5c2e47fceefa1d3953f3dbf21ff610264035f526a83d990caf86` |
| pashov-2 | Pashov Audit Group | 2026-04-06 | design | Markdown | 48,727 | `a0cb5b77f2394899c0594c25acc2d1824b5ac75273989f33af947e54b724ec2a` |
| pashov-3 | Pashov Audit Group | 2026-04-16 | design | Markdown | 124,654 | `f1f88e9953145285fc049df5423ac05cd157f3b91d08e9d1462ccaf771588ac0` |
| pashov-4 | Pashov Audit Group | 2026-04-30 | design | Markdown | 12,488 | `6e1abab0801c89342cb213d8d3e31c4fa433d37553455b6cabe649cb6c8d8aaa` |
| pashov-5 | Pashov Audit Group | 2026-05-14 | design | Markdown | 20,024 | `1833476e90bdf33e5980a291495e0395a5f1fd354a470b20c74b6b5f557e1cd4` |
| pashov-6 | Pashov Audit Group | 2026-05-23 | design | Markdown | 6,102 | `6ecc8c724b2722ccdf6510e49e2bc935c6209cd4e3a2e72b5a6d55c1b21849db` |
| tob-1 | Trail of Bits | 2026-09 | design | PDF | 854,417 | `2198f6f9afe2ad4b4c31004792908e5ff3d42063220a43060c2d7305ef33109b` |
| tob-2 | Trail of Bits | 2026-09 | design | PDF | 762,607 | `f0f68aed44d8744d9c63c97fac1393a403fea5439f4e2545138e401851ce00e2` |
| tob-3 | Trail of Bits | 2026-10 | design | PDF | 1,289,185 | `a5347923f5133b3f10ccc4b967901818efeb6eb3a63a578d60701c3ecd318de7` |
| tob-4 | Trail of Bits | 2026-10 | design | PDF | 509,783 | `0a98d003d5f9daabf82cb4fc3e1d3f155f21e93193c33ef56041fdaee3b64d01` |
| tob-5 | Trail of Bits | 2026-10 | design | PDF | 1,046,256 | `db7300bd494d709e9b2f8368747cc52719d2cc7603ab5680a2e305e037addf6e` |
| tob-6 | Trail of Bits | 2026-11 | design | PDF | 598,910 | `74ceaa3e478f245930dbed1be6bb949c8c47adcd7fa8e92120e52188c8940c9e` |
| sherlock-1 | Sherlock | 2026-07-01 | design | PDF | 1,306,072 | `af1bfb3e7afc2d902aae104c693f08c58aba3f1d2aa1df99ad42cabdca9be7bf` |
| sherlock-2 | Sherlock | 2026-07-21 | design | PDF | 927,313 | `b294267aa1f9b56f60e7a4110813319d8991b5a1af02462f75df4d0b68b75139` |
| sherlock-3 | Sherlock | 2026-09-08 | design | PDF | 891,916 | `dbea71b52715d10ebaea0ea3ddf6fee91f66bbc4aecd69f7de21dc156acf9a68` |
| sherlock-4 | Sherlock | 2026-09-08 | design | PDF | 806,559 | `f458eb9bd19a64e5bd6a64f2dc13c8ad328817d25225fdbbb129542f4cb07b44` |
| sherlock-5 | Sherlock | 2026-09-21 | design | PDF | 883,868 | `2c4daae255382e9767eb8776576ae76b789b07c5c74c271a1ee414ba138672db` |
| sherlock-6 | Sherlock | 2026-09-29 | design | PDF | 1,037,699 | `0dc16d8f3150ab9108a0a52c2a1eb185a26954051b0c8bebbcb6c2126b22f4c9` |
| cyfrin-1 | Cyfrin | 2026-11-12 | held-out | PDF | 166,448 | `8159366f93d83138c9c8e68d5c9e46cb4fe50356465a9ef558b05e9b004c1887` |
| cyfrin-2 | Cyfrin | 2026-11-12 | held-out | PDF | 188,461 | `bd519db092150d45f1f675f5067ae03dbf49227a22bbbc2511b3355ba5e37be6` |
| cyfrin-3 | Cyfrin | 2026-11-12 | held-out | PDF | 171,823 | `b13a2bdd395453b9cfea0921fb99eb35e91cbf521a48e0108f0338083c713a83` |
| cyfrin-4 | Cyfrin | 2026-11-12 | held-out | PDF | 175,153 | `68b50004d52c5ba333b92afab54e47c70139f2cc7bcfebf1b65ce13b37ac31b0` |
| cyfrin-5 | Cyfrin | 2026-11-13 | held-out | PDF | 171,215 | `7516762d5e85e2063222b7cc2129ba9730f1209cc1641982d461cf40f7fcfec8` |
| cyfrin-6 | Cyfrin | 2026-11-17 | held-out | PDF | 168,994 | `789960f09e94e49ff6cbd155964aba23f6e8aae181963aeab6ff138337546e4d` |

## How each report becomes the form's JSON

One converter in `measure.mjs` turns every report into the form's shape by fixed rules. It copies text and changes no word; it only cuts the text into sections and puts each section in a field. No model read any report for the measured column.

1. **Text.** Markdown is read as it stands. A PDF goes through `pdftotext -layout`. The script then drops page headers and footers (a line among the first or last three of a page that repeats on half the pages or more) and lone page numbers, and joins URLs that the PDF broke at the line width.
2. **Findings.** A finding starts at one of three header layouts seen in the design set: a Markdown heading `[X-NN] title`, a line `Issue X-N: title`, or a numbered heading with a `Severity:` label within the next 8 lines. Findings end at the next header, an appendix or disclaimer heading or, in Markdown, the next top-level heading. A looser count of finding identifiers anywhere in the text, summary tables included, checks that no finding was missed: it found none missed in the 18 design reports (measured).
3. **Identifier and title.** The form's id pattern is `F-` and digits, so the converter renumbers `F-01`, `F-02` and so on, and keeps the report's own id at the start of the title.
4. **Severity.** From a `Severity:` label, or else from the id's letter: C, H, M, L give Critical, High, Medium, Low; I, G (gas), N and Q give Info. `Informational` becomes Info. Sherlock's L stands for its "Low/Info" class and becomes Low. A word outside the scale, such as `Undetermined`, maps to nothing.
5. **Sections.** A line that is a known label starts a section. Description, Summary, Vulnerability Detail and Root Cause go to `rootCause`, joined in report order. Impact, Exploit Scenario, Attack Path and similar go to `impact`. Recommendation(s) and Mitigation go to `recommendedFix`. Text before the first label goes to the start of `rootCause`. Discussion, Client Commentary, Fix Implemented, Tool Used and the severity rating sections have no field; the converter drops them and counts their characters.
6. **Status.** `_Resolved_` or `[RESOLVED]` becomes `fixed`; `Acknowledged` becomes `acknowledged`.
7. **Locations.** In order: the header's `Target:`; every file path in the finding's text, with a line range from `#L12-L34` or `:12-34`; and a contract name that equals the name of exactly one scope file without its extension. A path counts only when it matches a stated scope file at a `/` boundary. Excerpts are left out; the code stays in the root cause text, where the report put it.
8. **Commit.** The report's "Review commit hash", "Audited Commit" or "Version" line, before the findings. The form takes one 40-character hex commit.
9. **Files reviewed.** The report's stated file list (a Markdown Scope list or a PDF `Files:` list, one per repository). When the report states none, the files its findings name stand in. That happened for all 6 Trail of Bits reports; two of them have no findings, so no files stand in.
10. **Terms.** The template filled with the report's own commit and files, by the same placeholder rule the seller adapter's `fill()` uses. So `scope` and `coverage` test each report against the scope it claims, and `coverage` passes by construction wherever a file list exists. Where the report gives no 40-character commit or no file list, the script fills 40 zeros or `(none)` so the checks can run; the seller adapter would refuse those terms. The script runs the check runner twice: with the default terms, and with the proof check left out, which the template names as a per-deal term.

**A report maps with no finding lost** when the rules find every finding the text identifies, the report states one 40-character commit and some file list, and every finding gets a severity on the scale, a location in scope, a root cause and a separate recommended fix.

## Results

All rows measured. "Accept" is the check runner's result on the converted report. "What-if" is the runner's result with the four check-level limits lifted (section "One change at a time").

| ID | Findings | Maps | Default terms | No proof term | What-if | Blockers |
| --- | --- | --- | --- | --- | --- | --- |
| pashov-1 | 9 | no | reject | reject | accept | location, proof, recommendation, text over a limit |
| pashov-2 | 15 | no | reject | reject | accept | location, proof, recommendation, text over a limit |
| pashov-3 | 31 | no | reject | reject | accept | location, proof, recommendation, text over a limit |
| pashov-4 | 5 | no | reject | reject | accept | location, recommendation |
| pashov-5 | 7 | no | reject | reject | accept | several commits, location, recommendation, text over a limit |
| pashov-6 | 3 | no | reject | reject | accept | location, recommendation |
| tob-1 | 2 | yes | reject | reject | accept | hidden characters |
| tob-2 | 0 | no | reject | reject | reject | several commits (a version tag), findings listed elsewhere, no file list |
| tob-3 | 9 | no | reject | reject | reject | hidden characters, severity, text over a limit |
| tob-4 | 0 | no | reject | reject | reject | no file list |
| tob-5 | 14 | yes | reject | reject | accept | hidden characters, proof, text over a limit |
| tob-6 | 1 | yes | reject | reject | accept | hidden characters, text over a limit |
| sherlock-1 | 44 | no | reject | reject | accept | location, proof, recommendation, text over a limit |
| sherlock-2 | 14 | no | reject | reject | accept | several commits, location, proof |
| sherlock-3 | 10 | yes | reject | reject | accept | proof, text over a limit |
| sherlock-4 | 2 | yes | accept | accept | accept | none |
| sherlock-5 | 4 | no | reject | reject | accept | several commits, text over a limit |
| sherlock-6 | 12 | no | reject | reject | accept | location, proof, text over a limit |
| cyfrin-1 to cyfrin-6 | 0 found | no | reject | reject | reject | no finding, commit or file list recognised |

Design set, measured: 5 of 18 reports map with no finding lost; 1 of those 5 passes today's checks with the default terms, and 1 with the proof term set to none. Held-out set, measured: 0 of 6 map; 0 of 6 pass.

## Why reports fail, one line per cause

Counts are design-set reports, with findings in brackets where the cause is per finding. All measured.

- **Text over a field limit: 11 of 18 reports (55 findings).** 55 root causes and 1 recommendation exceed 2,000 characters; one finding has both. Joining a finding's Summary and Detail sections, which the converter does to lose nothing, adds to the length.
- **No location in scope: 9 of 18 (28 findings).** The finding names functions, variables or a contract by a name no scope file has. Filling the location needs the code or a model's reading.
- **Proof files: 8 of 18 (50 findings rated Medium or higher).** No design-set finding carries a proof of concept as a file or a section.
- **No separate recommendation: 7 of 18 (20 findings).** The recommendation is a sentence inside the description. Cutting it out needs a model's reading; the script does not, so these stay unmapped.
- **Several commits: 4 of 18.** The review covers two to seven repositories, or names a version tag beside a commit.
- **Hidden characters: 4 of 18, all Trail of Bits.** The PDFs' text layer carries zero-width spaces (U+200B): 2 to 216 per report. The `hidden` check allows 0. The converter keeps them, as it keeps every character of the text it carries.
- **No file list: 2 of 18.** A summary report with no findings names a repository and no files; another lists its findings as advisories published elsewhere.
- **Severity off the scale: 1 of 18 (2 findings).** `Undetermined`.
- **Findings not in the report: 1 of 18.** The report summarises findings published as separate advisories.

Among the 5 reports that map, the runner fails: `hidden` in 3, `report` (text over a limit) in 3, `proof` in 2.

## What the conversion itself lost

Measured on the design set, in characters of the text the converter read (717,660 in all):

- **Carried into the form's fields:** 471,677 characters (65.7%).
- **Outside the findings:** 153,139 characters (21.3%): title pages, summaries, scope prose, methodology, disclaimers and appendices. The form has an optional `summary` field of 5,000 characters; the converter leaves it out because no rule picks a summary.
- **Finding sections with no field:** 71,137 characters (9.9%): discussion threads between auditor and client 28,295, code snippet links 22,055, source links 7,815, affected-file lists 6,217 (their paths became locations), fix notes 3,805, and the rest 2,950.
- **Paths not in scope:** 70 file paths named in findings matched no stated scope file and were not kept. Most are tests, libraries or files of another repository (inferred from their names).
- **Converter errors found and fixed on the design set:** four, all before the numbers above: Markdown labels cut short, a header rule that deleted repeated URL lines, URLs broken across lines, and a disclaimer heading (`Disclaimers`) that the end rule missed, which put legal text into the last finding of four reports. The review found the fourth; no result changed. The held-out set was not used to find them.

The conversion loses no finding it recognises and changes no word. It drops status words outside its two-word list: 0 in this corpus.

## One change at a time

Measured: the runner's result on each design report with four limits lifted together (no proof check, no text caps, an empty location list allowed, the recommendation optional) and zero-width spaces removed. 15 of 18 accept. 3 of those 15 pass only because the run keeps the first commit of a several-repository review and drops the others, so the fair count is **12 of 18**.

Computed from each report's list of blockers, removing one kind at a time (inferred from the measured lists, not rerun): the best single removals, hidden characters or the missing file list, each raise the count from 1 to 2. In the best order, the count runs 1, 2 (hidden characters), 3 (text caps), 5 (proof), 6 (location), 12 (recommendation), 15 (several commits), 16 (file list), 17 (findings elsewhere), 18 (severity).

## Held-out set

Measured: the rules found 0 finding headers, 0 file lists and no 40-character commit in the 6 held-out reports. Their text extracted: `measure.mjs` read 7,947 to 25,550 characters from each, and `pdfinfo`, which reads the PDF's metadata and no text, gives 5 to 13 pages each. The rules do recognise something in the commit position that is not a 40-character hex commit. Whether these reports have findings, and of what shape, is not known from this run: the held-out rule forbids reading them.

So the held-out number measures the converter, not the reports or the form: rules learned from three firms' layouts reach no fourth (measured). A seller writes a converter for its own layout once; a buyer cannot assume one converter fits every firm (inferred).

A later task that changes the form or the converter reruns `measure.mjs` and reports the held-out numbers as they come. It must not read the held-out reports or tune a rule on their result.

## What earlier work already answered

An earlier private pass on 2026-11-11 measured eight public reports from two firms against the form as it was then. This pass builds on it.

- **Already answered then, and confirmed here:** no published report carries proof files; reports carry content outside the findings that the form has no place for; identifiers and severity words differ by firm; a 2,000-character cap is too small for some findings; the delivery size limit is never close. That pass's first recommendation, a list of locations per finding with optional lines and excerpt, is in today's form. The proof term and optional impact are in it too.
- **New here:** the first-presentation rate on a larger corpus chosen by a fixed rule (1 of 18); the share of findings that name no file (28 of 182); reports on several repositories (4 of 18); zero-width spaces in PDF text (4 of 18); recommendations inside the description (20 of 182); and the converter's reach across firms (0 of 6 held out).
- **Still open from then:** a real proof-of-concept size. No public report in either pass has one.

## Scouting sets for other kinds of work

Desk research on 2026-11-18, read from public pages and dataset cards; nothing large downloaded. The full set, with an address, the reuse terms and a measured, inferred or guessed label on every entry, is `docs/research/2026-11-18-report-corpus/scouting.md`. This section says only what a delivery looks like and what a check could test. It writes no form, as the task asked.

| Kind | Examples | What a delivery looks like | What a deterministic check could test | What needs a model or more |
| --- | --- | --- | --- | --- |
| Robot training data | 5: two LeRobot v3 datasets, DROID, Open X-Embodiment, BridgeData V2 | A small JSON manifest (LeRobot's `meta/info.json`: features, dtypes, shapes, fps, episode count) beside Parquet, MP4 or TFRecord payloads of megabytes to terabytes (measured) | The manifest against a schema; counts, vector widths, frames per episode; a hash of each payload (inferred) | Whether the demonstrations are competent and match the instruction: video or a person (inferred) |
| Robot task execution | 5: a LeRobot `eval_info.json`, BEHAVIOR 2025 episode results, RoboArena, SimplerEnv, NIST ARIAC | Small JSON per run: per-episode success, reward and seed, plus aggregates; 75.8 kB for 500 episodes (measured) | Counts, ranges, unique seeds, and aggregates that equal their rows; fits Crow as published (inferred) | That the robot really ran: a re-run, video or a trusted evaluator. Free-text preferences need a model (inferred) |
| Non-official legal review | 5: CUAD, ContractNLI, MAUD, LegalBench, ToS;DR | Span labels on contract text, or fixed questions with fixed answer sets, as JSON or CSV (measured) | Enums, a full set of answers per document, span offsets that land in the text, cited documents that exist (inferred) | Whether each answer is right. No public issues list from a contract-review tool turned up (measured) |
| Product review (a tester's report on a product, assumed) | 5: NHTSA safety ratings, ENERGY STAR TV data, Euro NCAP, a laptop review site, a TV test site | Government tests: JSON or CSV rows of measured values beside certification limits. Editorial labs: copyrighted HTML or PDF tied to a named test version (measured) | Measured value within its limit; the report names its protocol version and gives a unit with each value (inferred) | Whether the verdict prose follows from the numbers; PDF extraction first (inferred) |

One source each for the target list's other kinds (all addresses in `scouting.md`): a QA test run (Playwright JSON report), an AI code review (GitHub's pull-request review object), web data extraction (Web Data Commons), document parsing (Docling's document JSON), business verification (a GLEIF LEI record), financial data extraction (SEC XBRL facts), a cited research report (DeepResearch Bench), human labelling (a Label Studio export), a protein assay (ProteinGym), a satellite imagery order (a STAC Item) and a compute job (Slurm `sacct`). 9 of these 11 already have an open, documented JSON or CSV format (inferred from the pages). The strongest check across kinds is a match against a public authority by key or hash, such as an SEC accession number, an LEI or an asset checksum (inferred).

## What the numbers say

**The form's problem is mostly the form.** The four check-level limits and the hidden-character rule block 15 of the 18 design reports, and lifting them moves the runner from 1 to 12 accepts with no change to any report (measured). The reports cause the rest: findings that name no file (28 of 182), reviews of several repositories (4 of 18), and no file list (2 of 18). The converter matters at the edges. A converter fix for zero-width spaces gains one report, and a converter built on three firms reached none of a fourth firm's reports (measured).

**The single change that raises the rate most is one revision of the finding object, made as one change (inferred from the what-if).** It lifts or raises the text caps (8,000 characters covers every design finding; the longest is 6,775), lets a finding carry no location and no separate recommendation, and makes proof a per-deal term that is off unless the buyer asks. No one field alone gains more than one report, because most reports meet two to four limits at once. The second-best lever, after that revision, is one commit per repository in place of one commit per review (3 more reports).

**The second form should go to robot training data (inferred).** Its deliveries already come in a published, documented layout (LeRobot v3's `meta/info.json`), so most checks test the file as the field publishes it, with no converter to write; `examples/robot-episode.ts` already packs one episode into one JSON file. Its limit is size: a real dataset is far over 1 MiB, so the delivery is the manifest plus payload hashes. Robot task execution is the close second: its result files fit as published, but no check can show that the robot ran. Legal review comes after: its answers are checkable in shape, and their correctness needs a model.

**The data does not show a need for a delivery with named defects (inferred).** What blocks these reports is systematic by firm: one firm never states files, another reviews several repositories, none gives proof. A buyer sees each of these in a sample report before signing and can set the terms to match (D32: the parties carry the burden). After the form revision, the 6 reports still refused fail on shape a pre-signing check finds: several repositories (3), no file list (2) and a severity off the scale (1). None fails on a defect only the delivery reveals.

## Rerun

From a checkout at this task's merge commit, after `pnpm install --frozen-lockfile && pnpm build`:

```
node docs/research/2026-11-18-report-corpus/fetch.mjs /Users/rafa/Documents/escrow/reports/scratch/corpus/security
node docs/research/2026-11-18-report-corpus/measure.mjs /Users/rafa/Documents/escrow/reports/scratch/corpus/security /Users/rafa/Documents/escrow/reports/scratch/corpus/converted
```

`fetch.mjs` downloads the 24 files at their pinned commits and rewrites `manifest.json`. `measure.mjs` rewrites `results.json` and prints one line per report and the summary. A different SHA-256 in `manifest.json` means a firm changed a file at the same path, which a pinned commit rules out (inferred). The second command needs `pdftotext` (Poppler).

## Open questions

1. **Rafa decides whether to revise the finding object as one change,** as above, and whether the revision keeps any cap. The owner of the revision is a later task; this one changes no product file.
2. **A proof of concept's real size is still unknown.** No public report has one. Owner: the design partner thread, through Rafa.
3. **The held-out firm's layout.** A later converter task can add rules for a fourth layout only from that firm's other public reports, never from these six.
