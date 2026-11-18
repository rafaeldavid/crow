# T-501: a second pilot deal that delivers the finished scan

- **Lane:** demo (the seller adapter in `examples/`, which the hosted sellers bundle)
- **Phase:** 2
- **Depends on:** T-435 (the workspace guard), T-408 (naming a job), T-366 (the seller API mapping)
- **Paths this task may touch:** `examples/seller-adapter-api.ts`, `examples/seller-adapter-core.ts`, `examples/seller-adapter-job-stub.ts`, `examples/seller-adapter-existing-job.test.ts` (new), `site/ref/seller-adapter.txt` (the two fields and the route), `site/setup.mjs` (rebuilt: it bundles the adapter core), this file.
- **Human gate:** yes. Every live step waits for Rafa: the redeploy of `pilot-scan-1`, the new quote and funding on the buyer's machine, naming the job, and the record.
- **Status:** done
- **Agent/session:** the second-deal session, 2026-11-17, branch `t-501-second-deal`.
- **Roadmap row:** N88
- **Change kind:** 5 by risk (the seller's workspace guard and its start logic move money and spend the partner's credits): the examples' tests, one review pass and one red-team pass.

## Intent

Restated in my own words.

The second buyer's deal of 2026-11-17 cannot pass. Its seller read the partner's job answer, which holds no artifacts: the partner serves them from a second call. With the artifacts added, the report still fails two of the five signed checks. Rafa chose a second deal on the same contracts, with corrected terms, in which the seller delivers the job that already finished. No new scan runs and no credits are spent.

This task builds the two pieces of seller code that deal needs and proves them on this machine:
1. **The artifacts call.** A configured second call, made after the job is done, whose answer the adapter adds to the result before the checks run.
2. **An existing job for a new deal.** The seller's operator names a finished job for a deal before the adapter starts one. The adapter then sends no start, and delivers that job if it passes every guard below.

Non-goals: a new smart contract; any change to the signed terms of the open deal; Crow's own scan (`pilot-scan-2`); any deploy or live call.

## Design: an existing job for a new deal

**Who and when.** Only the holder of the ready credential (`redelivery.readyAuth`) can name a job, with `POST /deals/<id>/job` and the body `{"jobId": "<ID>", "existing": true}`. The deal must be `offered`: quoted, signed by the seller and not yet funded, so the adapter has sent no start. A funded deal is refused, because its start may already be on its way. The buyer funds after the job is named; the buyer's commands already stop for the owner's approval between the quote and the funding.

**What the adapter checks before it accepts the job.** It reads the job through the configured result call, at once:
- the job is done (a running or failed job is refused);
- the job ran in the pinned workspace (`sellerApi.workspace.resultPointer`, as for every result);
- the job's own request matches the deal's scope, field by field, at pointers the configuration names (`sellerApi.result.jobScope`, such as the target, the repository, the commit and the files). A list matches in any order.

A configuration that cannot run both checks, with no `jobScope` or a pinned workspace with no `resultPointer`, refuses every existing job. The same checks run again when the adapter fetches the result to deliver it, and `jobScope` then applies to every deal's job, a started one included.

**One job, one deal.** The journal records which deal holds each job. A job another deal holds is refused, unless the body names that deal as `"from": "<its commitment ID>"`. That deal must be `refused` or `closed`, never `delivering` or `delivered`. The adapter then closes it with a note naming the new deal (`jobMovedTo`), so it can never deliver the same job. The new deal records `existingJob` with the job and the deal it came from, and an event `job.attached`. The buyer of the old deal still reclaims its hold after its `deliverBy`, with no one acting.

**No race with the start.** While the adapter reads the job for the route, the deal cannot start a job: the start step waits for that check to end. Once funded, a deal with a named job goes straight to `started` with that job, and no start call is sent.

**The artifacts call** (`sellerApi.result.merge`: `{path, into}`). Its path takes only `{{jobId}}`, the job the start answered or the operator named: nothing from the job's answer steers it. It runs only after the job's workspace matched the pinned one; with a pinned workspace, a path that does not carry `{{workspace}}` needs `resultPointer`. It must answer 2xx with JSON. The answer goes in at `into`, which must be absent from the result. The size cap applies to the call and to the merged result. A failure holds the delivery, as a file that cannot be added does.

## Acceptance criteria

- [x] Tests fail without the change: the artifacts call, the existing job and every refusal below.
- [x] The artifacts call runs only after the workspace check, answers 2xx, and stays under the cap.
- [x] An existing job is delivered with no start call; one from another workspace or another scope, a running one, and one held by another deal are refused; the route needs the ready credential.
- [x] The local proof on the real export, kept out of every tracked file: the corrected folder releases the new deal with no start, and the old folder on the new code still refuses.

## Evidence

- **Test first** [measured]: `examples/seller-adapter-existing-job.test.ts` failed 14 of 14 on `origin/main` (`b7ff63f2`) with the stub change alone. After the review and the red team it holds 16 tests, which pass. `vitest run examples/seller-adapter apps/hosted-sellers`: 9 files, 162 tests, pass.
- **Review and red team** [measured]: one Opus review pass and one Opus red-team pass. Both found that a closed deal kept counting as a moved job's holder, so a stale `from` gave one job to two deals (High, reproduced by both). The red team also found that a refused deal part-way through a refetch could deliver after its job moved (High, reproduced). Both are fixed in `9881e4d1`, with a third-deal test. Also fixed: `jobScope` must cover every scope field the start sends, and the start may send no options (Medium); the two deals of a move change in one journal write (Low); a test for the size cap (Low). `pnpm typecheck` and ESLint on the changed files: clean.
- **The site** [measured]: `site/setup.mjs` bundles the adapter core, so `node site/build.mjs` rebuilt it; `node site/check.mjs` passes. Its published hash changes at the next site deploy, Rafa's.
- **The local proof with the partner's real export** [measured, 2026-11-17 15:18 to 15:22 UTC]: run from the private kit (`rehearsal/hosted-kit-run.ts`, Cloudflare's local runtime, SimChain, test tokens, the export kept in git-ignored scratch files). The corrected seller folder released a new deal with the finished job, 1 quote call and 0 start calls at the stand-in. Before funding, naming a job in another workspace answered 409 `wrong_workspace`, one of another commit 409 `wrong_scope`, and a caller with no credential 401. The current folder on this code refuses every existing job (`cannot_check`) and still refuses the report as live ("NOT CONVERTED"). The record is in the private kit's evidence file.

## Decisions

- **Only before funding.** An existing job is named only while the deal is `offered`. Naming it for a funded deal would race the start, which may already be sent. The buyer's commands stop for the owner between the quote and the funding, which leaves the time.
- **The scope match is the configuration's.** `jobScope` names pointers, not a rule the adapter infers from the start body. It applies to every result once set, so a job named for a `start-unknown` deal is checked too.
- **An artifacts failure after the checks does not refuse a named job.** The artifacts call runs only after the workspace, scope and status checks pass, so its failure at naming time holds the delivery later, as for a started job.
- **A moved job closes its old deal.** The adapter then never delivers one job into two deals. The old deal's buyer reclaims the hold after its `deliverBy`, as the contract allows with no one acting.

## Handoff

- **Done:** the code, its tests, the reference page and the rebuilt `site/setup.mjs`; the corrected terms and seller folder in the private kit; the local proof.
- **Live, 2026-11-17** [measured]: Rafa redeployed `pilot-scan-1` at 16:10 UTC (deploy record in `docs/operations.md`). He named the finished job for the new deal at 16:20 UTC, and the seller answered 202. The deal was funded at 16:22:00 and Released at 16:22:36 UTC, with no new start at the partner. The first deal is still Held, with nothing delivered, and refunds after its `deliverBy`. The transactions and the record are in the private kit's evidence file.
- **Left open (Low, red team):** the route answers `holder_busy` while the deal loop works on the holder; the caller sends the request again. The holder record is per journal: a job named in another adapter's journal is not seen. Crow's own seller (`pilot-scan-2`) can take the same two fields when its folder is next rebuilt.
