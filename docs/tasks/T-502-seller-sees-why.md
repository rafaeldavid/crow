# T-502: the seller sees why a delivery would fail, before it submits

- **Lane:** demo (the seller adapter in `examples/`, which the hosted sellers bundle)
- **Phase:** 2
- **Depends on:** T-316 (the preflight), T-323 (the report mapping), T-329 (refused results), T-501 (the artifacts call)
- **Paths this task may touch:** `examples/seller-adapter-core.ts`, `examples/seller-adapter-api.ts`, `examples/report-converter.ts`, `examples/seller-refusal.ts` (new), `examples/seller-refusal.test.ts` (new), `apps/hosted-sellers/src/worker.ts`, `apps/hosted-sellers/src/worker.test.ts`, `apps/hosted-sellers/src/check-report.ts` (new), `apps/hosted-sellers/src/check-report.test.ts` (new), `apps/hosted-sellers/scripts/check-report.ts` (new), `apps/hosted-sellers/package.json` (the script), `site/ref/seller-adapter.txt` (one paragraph), `site/setup.mjs` (rebuilt: it bundles the adapter core), this file.
- **Human gate:** yes for the deploy of `pilot-scan-2` only (Rafa's word, 2026-11-17: "Yes continue, help me push and get this working"). The code is confined to the repository.
- **Status:** in progress
- **Agent/session:** the N179 build session, 2026-11-17, branch `t-502-refusal-reason`.
- **Roadmap row:** N179
- **Change kind:** 5 by risk (the seller's delivery path and a public page): the examples' and the hosted sellers' tests, one review pass and one red-team pass.

## Intent

Restated in my own words.

On 2026-11-17 a hosted seller refused to deliver a partner's report, which protected both parties, but it said why only once, in one log line. Its health page said `refused` and nothing else, so finding the cause took hours and a Cloudflare login. Later the report failed two signed checks that only an offline harness showed.

This task makes the reason visible where the seller and the buyer already look, and lets a seller run the same checks before anything is submitted:
1. **The reason on the seller's own surface.** For each refused deal, `/health` and a new `GET <base>/deals/<commitmentId>` say which stage refused it, which check failed, at which JSON pointer, and the check's own message, with no report content.
2. **The log on every change.** The adapter logs the reason each time it changes on a refetch, not only for the first refusal.
3. **One local command.** `pnpm -C apps/hosted-sellers check-report <seller folder> <job.json> [<artifacts.json>]` applies the folder's result mapping, artifacts merge, report mapping and every agreed check exactly as the live seller does, and prints pass or fail per check. It calls the same functions as the live preflight, so the two cannot disagree.

Non-goals: more delivery attempts (N179 part 2, the next contract version); any change to the signed terms, the contracts or the judgment package; a redeploy of `pilot-scan-1`.

## What `/health` and the deal route show, and why nothing leaks

`/health` is public: the buyer and anyone else read it. It gains one field, `refused`: a list with one entry per deal at stage `refused`, **without its commitment ID**. A seller with per-deal keys signs each deal with a fresh key so that its deals cannot be linked to it; listing commitment IDs on its public page would undo that. Each entry holds:

- `stage`: which step refused it, one of `wrong_workspace`, `wrong_scope`, `files_not_added`, `not_converted`, `not_salted`, `intake`, `checks`;
- `refusals`: how many distinct results were refused, a whole number;
- `since`: when the deal was first refused, by the seller's clock;
- `checks` (stage `checks`): one entry per failing or open check: `checkId`, `required`, `outcome` (`fail` or `open`), `pointer` (a JSON pointer, when the check names one) and `message`;
- `field` and `message` (stage `not_converted`): the template field the mapping could not fill, and why;
- `code` (stage `intake`): the intake rule's code.

`GET <base>/deals/<commitmentId>` answers the same entry for one deal, with its `commitmentId` and `stage`, to anyone who knows the ID: the buyer and the seller do, and the ID itself is already public on chain.

Why none of it leaks the report. Every value in an entry is built from the terms, the seller's own configuration or a count, never from the report:
- `checkId` and `required` come from the signed terms.
- A check's message is rebuilt by `examples/seller-refusal.ts`, not copied. The JSON-schema check's message is split into a pointer and a reason. A pointer segment stays only when it is an array index or a property name the check's own schema names; any other segment, such as a key the report added, becomes `*`. The reason stays only when it is one of the schema validator's fixed phrases (`anyOf not satisfied`, `expected string`, `missing <name the schema requires>`, `fewer than 3 items`, and the like); any other becomes `the value does not match the schema`. The other checks keep their numbers (`12 rows; expected 1 to 10`), and a message that names the report's own columns or values (`csv_columns_exact`) is replaced by a fixed sentence.
- A conversion message is the report mapping's own field and reason, rebuilt without the report's values: `findings[2].severity: issues[2].level is not one the mapping lists`, never the value it held.
- The workspace and scope stages say only that the job ran elsewhere or asked for another scope: the account ID and the scope values stay in the log.
- No report text, findings text, file name from the report, secret, key, account or name appears. A test runs reports full of marker strings through every stage and reads `/health` and the deal route for them.

## Acceptance criteria

- [ ] Tests first: a refusal shows its stage, check and pointer on `/health` and on the deal route; nothing from the report body appears there.
- [ ] The command and the live preflight give the same verdict on the same input: a table test across passing and failing synthetic reports, each run through the live adapter and through the command.
- [ ] The adapter logs the reason again when it changes on a refetch.
- [ ] The command runs on the real export against the three folders below; only the verdicts go in tracked files.
- [ ] One paragraph in `site/ref/seller-adapter.txt` documents the command.

## Evidence

- **Test first** [measured]: `apps/hosted-sellers/src/refusal.test.ts` runs seven reports as live deals through a hosted seller on the in-process world and through `checkReport` with the same answer, once with the terms a quote would sign and once with the signed terms. With `refused` taken out of `/health`, it fails; with it, it passes. `examples/seller-refusal.test.ts`: 16 tests, among them 400 seeded random reports with a marker in keys and values through the adjudicator's own checks, and seven conversion refusals; no reason holds the marker.
- **The suites** [measured, 2026-11-17 18:28 UTC]: `vitest run examples/seller-adapter examples/report-converter examples/seller-refusal examples/check-delivery apps/hosted-sellers`: 13 files, 228 tests, pass. `pnpm typecheck` and ESLint on the changed files: clean. `node site/build.mjs && node site/check.mjs`: PASS; `site/setup.mjs` is rebuilt because it bundles the adapter core, and its published hash changes at the next site deploy, Rafa's.
- **The real export** [measured, 2026-11-17 18:20 UTC], kept in git-ignored scratch files; only the verdicts are here:
  - the second buyer's old folder: REFUSED at `checks`: `report` `/artifacts/9: anyOf not satisfied`, `scope` `/artifacts/0: anyOf not satisfied`; `proof`, `coverage` and `hidden` pass. The same with the folder's built terms.
  - the second buyer's corrected folder: PASS, all five checks, stage 1 `accept`.
  - Crow's corrected folder (`hosted-2`), the export moved to Crow's scope by the kit's `scope-export.mjs` with every finding kept: first REFUSED at `wrong_workspace`, rightly, since the export names the second buyer's workspace. With the job's `workspace_id` set to Crow's pinned workspace, as a job Crow's seller starts would name: PASS, all five checks, stage 1 `accept`. The same with the folder's built terms.

## Decisions

- **No commitment ID on `/health`.** A per-deal key exists so a seller's deals cannot be linked to it; the public page lists the reasons without IDs, and the deal route answers by ID to those who know it.
- **Rebuild messages, never filter them.** A message is rebuilt from known parts (the schema's own names, the validator's fixed phrases, counts), so a new message shape falls back to a fixed sentence instead of leaking.

## Handoff

Not yet.
