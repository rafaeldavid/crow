# T-516: the refund test sends again on deal_busy, as a client does

- **Lane:** examples (a test only)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** a test change in `examples/` (tests follow the code); no review per the change recipes
- **Depends on:** T-503 (the seller's signed refund)
- **Paths this task may touch:** `examples/seller-adapter-refund.test.ts`, this file
- **Human gate:** no
- **Status:** done with the merge of this task's pull request
- **Agent/session:** the T-513 simplicity session, 2026-11-18, branch `t-516-refund-test-busy`
- **Roadmap row:** N173

## Intent

`examples/seller-adapter-refund.test.ts`, "answers two requests at once with one settlement", failed in CI on PR 636 (run 44276953066, shard 2 of 4), a docs-only change. Both refund requests got 409 where the test expects 200. The fix finds the cause, keeps the product unchanged, and never reruns the job to get past the failure.

## The cause [measured]

- Locally the file failed 1 run in 12 and 2 in 6 before the fix. The failing answer, printed in the assertion message, is twice `{"type":"deal_busy","detail":"the deal is being worked on now; send the request again in a few seconds"}`.
- The seller adapter answers `deal_busy` while its deal loop holds the deal (`examples/seller-adapter-core.ts`, the refund route). The test's helper `heldAndRefused` waits until the deal's stage reads `refused`, but the loop goes on working on the deal for a moment after it records the refusal.
- So a request sent at once can land inside that tick. The product's answer is right: busy, send again. The test sent once only.

## The fix

The test's `refund` helper does what a client does with `deal_busy`, as the answer's own detail says: it sends again every 100 ms, for up to 5 s. Every other answer, every other 409 included, comes back unchanged, so the cases that expect `not_held`, `delivered` or `cannot_sign` still see them.

## Evidence [measured]

- `pnpm exec vitest run examples/seller-adapter-refund.test.ts`, 25 runs in a row: 25 pass, 0 fail.
- `pnpm exec tsc -b examples` and `pnpm exec eslint examples/seller-adapter-refund.test.ts`: no output.

## Handoff

Nothing left. If `deal_busy` ever lasts past 5 s in a test, the loop's tick is slow; look there, not at the retry.
