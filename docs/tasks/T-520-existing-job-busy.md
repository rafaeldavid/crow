# T-520: the existing-job test waits out a busy holder, as a client does

- **Lane:** examples (a test only)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** a test change in `examples/` (tests follow the code), with one row of a process doc; no review per the change recipes
- **Depends on:** T-501 (an existing job for a new deal)
- **Paths this task may touch:** `examples/seller-adapter-existing-job.test.ts`; `examples/buyer-signer.test.ts` and `examples/signer-world-kit.ts` only if they fail for the same cause; one row of `docs/team.md` (Rules and checks, `tests/ci-gated.test.ts`); this file. No seller code: Crow's own scan is open on `pilot-scan-2`.
- **Human gate:** no
- **Status:** done with the merge of this task's pull request
- **Agent/session:** the CI review session (T-504), on the coordinator's triage of 2026-11-18
- **Roadmap row:** N173

## Intent

`examples/seller-adapter-existing-job.test.ts`, "moves a job from a refused deal only when the request names that deal, and closes it", failed in CI on PR 625. That was run 44280972130, shard 1 of 4, on a change to `ci.yml` alone. This task finds the cause, keeps the product unchanged, and never reruns the job to get past the failure. If the cause is a real race in the adapter, it writes the evidence here and stops.

## The cause [measured from the log; inferred from the code]

- The failing answer, printed in the assertion message: 409 `{"type":"holder_busy","detail":"deal 0xff5a… is being worked on now; send the request again in a few seconds"}`, where the test expects 202.
- The seller adapter answers `holder_busy` while its deal loop is part-way through the holding deal's pass (`examples/seller-adapter-core.ts`, `existingJobNamed`, the `advancing.has(holder.id)` check). T-501's review added that answer on purpose, so a job is never moved while the loop fetches or delivers it.
- The test waits until the first deal's stage reads `refused`, then asks at once to move its job. The loop goes on working on the deal for a moment after it records the refusal, so the request can land inside that pass.
- The product's answer is right: busy, send again. The test sent once only. It is the same shape as T-516's refund test (`deal_busy`).

## The fix

The test's `name` helper does what a client does with `holder_busy`, as the answer's own detail says: it sends again every 100 ms, for up to 5 s. Every other answer, every other 409 included, comes back unchanged, so the cases that expect `job_taken`, `not_waiting`, `already_named` or `cannot_check` still see them.

`examples/buyer-signer.test.ts` and `examples/signer-world-kit.ts` are left alone. Their open item (T-508's follow-up) is a seller watch that never ends on an unfunded deal, a different cause, and neither has failed in CI.

`docs/team.md`: the Rules and checks row for `tests/ci-gated.test.ts` counted the exempt files and the anvil halves. T-504 removed one exemption, so the count was wrong. The row now points to the list in the test, since a standing doc carries no counts (`docs/writing.md`).

## Evidence

- `pnpm build`, then `pnpm exec vitest run examples/seller-adapter-existing-job.test.ts`: 16 of 16 passed (measured, local, under a load average near 78). The machine's load makes local timing an unfair test, so the gate is CI: this pull request's shards, then PR 625's rerun on its new commit.
- `tests/design-map.test.ts` passes with the edited row (measured, local).

## Handoff

Nothing left. If `holder_busy` ever lasts past 5 s in a test, the loop's pass is slow; look there, not at the retry.
