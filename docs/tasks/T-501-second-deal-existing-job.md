# T-501: a second pilot deal that delivers the finished scan

- **Lane:** demo (the seller adapter in `examples/`, which the hosted sellers bundle)
- **Phase:** 2
- **Depends on:** T-435 (the workspace guard), T-408 (naming a job), T-366 (the seller API mapping)
- **Paths this task may touch:** `examples/seller-adapter-api.ts`, `examples/seller-adapter-core.ts`, `examples/seller-adapter-job-stub.ts`, `examples/seller-adapter-existing-job.test.ts` (new), `site/ref/seller-adapter.txt` (the two fields and the route), `site/setup.mjs` (rebuilt: it bundles the adapter core), this file.
- **Human gate:** yes. Every live step waits for Rafa: the redeploy of `pilot-scan-1`, the new quote and funding on the buyer's machine, naming the job, and the record.
- **Status:** in progress
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

- [ ] Tests fail without the change: the artifacts call, the existing job and every refusal below.
- [ ] The artifacts call runs only after the workspace check, answers 2xx, and stays under the cap.
- [ ] An existing job is delivered with no start call; one from another workspace or another scope, a running one, and one held by another deal are refused; the route needs the ready credential.
- [ ] The local proof on the real export, kept out of every tracked file: the corrected folder releases the new deal with no start, and the old folder on the new code still refuses.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

## Handoff
