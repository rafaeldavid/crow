# T-502: the seller sees why a delivery would fail, before it submits

- **Lane:** demo (the seller adapter in `examples/`, which the hosted sellers bundle)
- **Phase:** 2
- **Depends on:** T-316 (the preflight), T-323 (the report mapping), T-329 (refused results), T-501 (the artifacts call)
- **Paths this task may touch:** `examples/seller-adapter-core.ts`, `examples/seller-adapter-api.ts`, `examples/report-converter.ts`, `examples/seller-refusal.ts` (new), `examples/seller-refusal.test.ts` (new), `examples/seller-adapter.ts` (the Node shell passes `refusals` on), `examples/seller-adapter-job-stub.ts` (a report per scope target), `examples/seller-adapter-keys.test.ts` (the per-deal gate), `apps/hosted-sellers/src/worker.ts`, `apps/hosted-sellers/src/check-report.ts` (new), `apps/hosted-sellers/src/refusal.test.ts` (new), `apps/hosted-sellers/scripts/check-report.ts` (new), `apps/hosted-sellers/package.json` (the script), `site/ref/seller-adapter.txt` (one paragraph), `site/setup.mjs` (rebuilt: it bundles the adapter core), this file.
- **Human gate:** yes for the deploy of `pilot-scan-2` only (Rafa's word, 2026-11-17: "Yes continue, help me push and get this working"). The code is confined to the repository.
- **Status:** review
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
- `checks` (stage `checks`): one entry per failing or open check: `checkId`, `required`, `outcome` (`fail` or `open`), `pointer` (a JSON pointer, when the check names one) and `message`;
- `field` and `message` (stage `not_converted`): the template field the mapping could not fill, and why;
- `code` (stage `intake`): the intake rule's code.

The entries are sorted by their own text, not by the commitment IDs the journal keys them by, and carry no time, so neither their order nor a time helps link a deal to this seller.

`GET <base>/deals/<commitmentId>` answers one deal's `commitmentId` and `stage`, and while it waits for a fixed report the same entry with `since`, when it was first refused by the seller's clock. With a standing key, anyone who knows the ID may ask: the card names the seller's address, so its deals are already linked to it on chain. With a key per deal, the route takes the ready credential and answers 404 without it, as for a deal it does not hold.

Why none of it leaks the report. Every value in an entry is built from the terms, the seller's own configuration or a count, never from the report:
- `checkId` and `required` come from the signed terms.
- A check's message is rebuilt by `examples/seller-refusal.ts`, not copied. The JSON-schema check's message is split into a pointer and a reason, read against the check's own schema. A segment stays only where the schema at that point declares it: a name under `properties`, or an index under an array schema's `items`. Anything else, such as a key the report added, becomes `*`, and the pointer stops there. The validator writes an added key unescaped, so a key can imitate segments; when a message holds an added property, no index is kept at all, and the reason is read from the message's end, which is always the validator's own. The reason stays only when it is one of the schema validator's fixed phrases (`anyOf not satisfied`, `expected string`, `missing <name the schema requires>`, `fewer than 3 items`, and the like); any other becomes `the value does not match the schema`. The other checks keep their numbers (`12 rows; expected 1 to 10`, `null 1/2 exceeds 100 bps`), and a message that names the report's own columns or values (`csv_columns_exact`) is replaced by a fixed sentence.
- A conversion message is the report mapping's own field and reason, written at each refusal in the converter without the report's values or keys, with no default: `findings[2].severity: issues[2].level is not one the mapping lists`, never the value it held.
- The workspace and scope stages say only that the job ran elsewhere or asked for another scope: the account ID and the scope values stay in the log.
- No report text, findings text, file name from the report, secret, key, account or name appears. A test runs reports full of marker strings through every stage and reads `/health` and the deal route for them.

## Acceptance criteria

- [x] Tests first: a refusal shows its stage, check and pointer on `/health` and on the deal route; nothing from the report body appears there.
- [x] The command and the live preflight give the same verdict on the same input: a table test across passing and failing synthetic reports, each run through the live adapter and through the command.
- [x] The adapter logs the reason again when it changes on a refetch.
- [x] The command runs on the real export against the three folders below; only the verdicts go in tracked files.
- [x] One paragraph in `site/ref/seller-adapter.txt` documents the command.

## Evidence

- **Test first** [measured]: `apps/hosted-sellers/src/refusal.test.ts` runs seven reports as live deals through a hosted seller on the in-process world and through `checkReport` with the same answer, once with the terms a quote would sign and once with the signed terms. With `refused` taken out of `/health`, it fails; with it, it passes. `examples/seller-refusal.test.ts`: 16 tests, among them 400 seeded random reports with a marker in keys and values through the adjudicator's own checks, and seven conversion refusals; no reason holds the marker.
- **The suites** [measured, 2026-11-17 18:28 UTC]: `vitest run examples/seller-adapter examples/report-converter examples/seller-refusal examples/check-delivery apps/hosted-sellers`: 13 files, 228 tests, pass. `pnpm typecheck` and ESLint on the changed files: clean. `node site/build.mjs && node site/check.mjs`: PASS; `site/setup.mjs` is rebuilt because it bundles the adapter core, and its published hash changes at the next site deploy, Rafa's.
- **The real export** [measured, 2026-11-17 18:20 UTC], kept in git-ignored scratch files; only the verdicts are here:
  - the second buyer's old folder: REFUSED at `checks`: `report` `/artifacts/9: anyOf not satisfied`, `scope` `/artifacts/0: anyOf not satisfied`; `proof`, `coverage` and `hidden` pass. The same with the folder's built terms.
  - the second buyer's corrected folder: PASS, all five checks, stage 1 `accept`.
  - Crow's corrected folder (`hosted-2`), the export moved to Crow's scope by the kit's `scope-export.mjs` with every finding kept: first REFUSED at `wrong_workspace`, rightly, since the export names the second buyer's workspace. With the job's `workspace_id` set to Crow's pinned workspace, as a job Crow's seller starts would name: PASS, all five checks, stage 1 `accept`. The same with the folder's built terms.

- **Review and red team** [measured]: one Opus review pass and one Opus red-team pass, each given CLAUDE.md, the task file and the code. Both found the same High: a report key made of digits under `additionalProperties` reached the public pointer (`/byId/411111111`), and a key holding `/<digits>: ` could put any digits there. Fixed by reading the pointer against the schema (above), with table cases and digit keys in the 400-report random test. Also fixed, each with a test: the converter's safe message had a default (now required at every throw); the command now refuses a result with further files and an artifacts file no call uses, reads an HTTP-status job, takes signed terms past a rule that now refuses, and takes `--salt` or `--no-salt`; table checks keep their real number formats; `/health` drops the time and the ID order; the deal route shows a refusal only while the deal waits; the per-deal gate has its test (`seller-adapter-keys.test.ts`); the command's exit codes and `--detail` have theirs; the parity test now covers the artifacts merge, the salt and a job from another workspace.
- **After the fixes** [measured, 2026-11-17 18:48 UTC]: `vitest run examples apps/hosted-sellers`: 59 files, 751 tests; 750 passed, and `setup-bundle.test.ts` failed once because `site/setup.mjs` was rebuilt only after the run; after `node site/build.mjs` it passes, 24 of 24. ESLint on the changed files: clean. `node site/check.mjs`: PASS. The three verdicts on the real export are unchanged.
- **`pnpm verify`** [measured, on the first commit, 2026-11-17 18:31 to 18:45 UTC]: typecheck, lint, `forge test` (505 tests), spec, snap (48 of 48), snap on the local chain (41 of 41, 7 excluded) and the demo pass. `forge build` failed while it fetched the contracts' nested submodules into this new worktree. `pnpm test` failed in `packages/settlement/evm` (`deploy-script.test.ts` and others, 28 failures), a package this change does not touch; see the Handoff.

## Decisions

- **No commitment ID on `/health`.** A per-deal key exists so a seller's deals cannot be linked to it; the public page lists the reasons without IDs, and the deal route answers by ID to those who know it.
- **Rebuild messages, never filter them.** A message is rebuilt from known parts (the schema's own names, the validator's fixed phrases, counts), so a new message shape falls back to a fixed sentence instead of leaking.
- **No verdict rather than a wrong one.** A seller whose result names further files gets an error from the command, not a verdict, since the command does not fetch those files.

## Handoff

- **Done:** the reason on `/health` and the deal route, the log on each change, the `check-report` command and its paragraph, the tests, both review passes and their fixes, and the verdicts on the real export.
- **Next:** merge, then deploy `pilot-scan-2` with Crow's corrected folder (Rafa's word, 2026-11-17), and record it in `docs/operations.md`.
- **Left open (Low):** the command does not fetch the further files a result names (`result.files`); it says so and gives no verdict. The salt is taken from `--salt`, `--no-salt` or today's configuration, not from the deal's journal.
