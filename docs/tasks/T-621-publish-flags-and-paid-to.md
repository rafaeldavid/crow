# T-621: publish names the flag that differs, and a chain's deal record names who was paid

- **Lane:** settlement (the chain adapter) and api (the seller's tool in `examples/`)
- **Phase:** 2
- **Depends on:** T-552 (`publish`), T-390 and T-411 (the deal record's payee)
- **Paths this task may touch:** `examples/setup-publish.ts` and its test, `examples/deal-record-chain.test.ts`, `packages/settlement/evm/evm-settlement.ts` and its tests, `site/setup.mjs`, `site/seller-worker.mjs` and `examples/seller-worker-pin.ts` (generated), `examples/setup.ts` (one comment), `.github/workflows/ci.yml` (one test file in the anvil job's list), `docs/api.md`, `docs/architecture.md`, this file
- **Human gate:** yes. The postings take effect only when both operators run this code, and the new message only when the site is deployed. Both deploys are Rafa's. A partner page pins `setup.mjs`; the coordinator rebuilds it after the site deploy.
- **Status:** review
- **Agent/session:** seller-tool-fixes, 2026-11-25
- **Roadmap row:** N196

## What exists

- `publish` prints an approve line with `--offer-id`, `--expires` and `--expect`, and signs only a template with that hash.
- The deal record (`examples/deal-record.ts`) fills `paidTo` and `refundedTo` from a settled event's `postings`, and runs two checks on them.
- SimChain writes `postings` on its settled events. The chain adapter wrote none, so on Sepolia both fields read `null` (T-399 Finding 6). T-411 did not fill them and named this change as its recommended route.

**Why the task is needed:** two stranger smoke tests on 2026-11-25 (private case studies) measured both defects. Each costs a stranger a step.

## Intent

1. An approve that differs from the one shown says which flag is missing or different, and prints the command to run.
2. On a chain, the deal record of a decided or reclaimed deal names who was paid.

**Non-goals:** any change to the deal record's code, to `buy.mjs` or `try.mjs`, to a schema or to a contract. `take.mjs approve` and `CROW_SELLER` (item 3 of the same triage note) are not in this task.

## Context

- ADR-0033: money goes to the seller's payout address and the buyer's payment address.
- ADR-0040 §4: `publish` and the template it signs.
- `spec/schemas/event.schema.json`: the payloads of `settlement.released`, `settlement.refunded` and `settlement.reclaimed` are open objects. `commitment.settled` takes `payouts` and `keyReleased` only.
- `docs/architecture.md`, Hold and settlement postings.

## Acceptance criteria

- [x] An approve without the printed `--expires`, without `--offer-id`, with another `--expires`, or without a printed `--replace` names that flag. It sends nothing.
- [x] The command in `run` is called one that signs only when the template it would build has the approved hash. Run through a shell as printed, it publishes.
- [x] The message blames the operators or the folder only when they changed.
- [x] On anvil, a Released deal's record names the payout address in `paidTo`; a Refunded one names the buyer's payment address in `refundedTo`. Both postings checks pass.
- [x] The postings equal the token balances, from a relayed transaction and from one the operator only read from the chain.
- [x] No schema change. `buy.mjs` and `try.mjs` keep their bytes.

## Out of scope

- `paidTo` after an early accept or a default outcome (Handoff).
- Deals that settled before the operators run this code: their events keep their hashes, and their records keep `null`.

## Evidence

Measured on this machine on 2026-11-25, Node 22.23.4, anvil and forge 1.0.0.

- **Tests failed first.** The old `setup.mjs` answered the approve without `--expires` with the smoke test's message ("the operators' answers or this folder changed since"). It accepts that approve when it runs in the same second as the preview, because the default expiry is rounded to the second; the test waits 1.1 s. The two adapter tests failed with no postings. The record test, run again with the postings switched off, failed with `paidTo: null` and `refundedTo: null`.
- **`packages/settlement/evm`, on anvil:** 25 files, 322 of 322 tests passed, before the review fixes.
- **`examples/` and `apps/demo-cloud`, on anvil:** 1,202 passed, 1 failed, 2 skipped, before the review fixes. The failure is `examples/take.test.ts`, "pins the creation code forge builds": the local build and the pinned code have the same length and differ only in the last 86 hex characters, the compiler's metadata hash (measured). This worktree checked the submodules out recursively; CI checks out six (inferred cause). This change touches neither `contracts/` nor the pinned code. CI is the check.
- **After the review fixes and the merge of `origin/main`:** 8 files (the adapter and sync tests, publish, the setup bundle, the record on SimChain and on anvil, the invoice, late work), 168 of 168 passed. `pnpm typecheck`, `pnpm lint` and `node site/check.mjs` passed; `pnpm validate:spec` passed before the merge. No file under `spec/` changed.
- **CI's first run on the pull request** (run 45709146788): `test (3/4)` failed, and `check` with it. Cause (measured from the log, and reproduced on this machine): `tests/ci-gated.test.ts`, "every gated test file is named in CI or exempt here with a reason", listed `examples/deal-record-chain.test.ts`. The new file skips without anvil and no CI job named it, so the shards would have skipped it unseen. The local runs before the push covered `examples/`, `apps/demo-cloud` and `packages/settlement/evm`, not `tests/`. Fixed by naming the file in the `world` leg of CI's anvil job, which fails on a skip. Both anvil legs passed in that run, `examples/take.test.ts`'s creation-code pin included, so its failure here is this worktree's.
- **After the second merge of `origin/main`** (at `f948f2fe`): `tests/` 1,435 passed, 2 skipped, 0 failed (55 files). CI's `world` list, with the new file: 77 passed, 1 failed (the creation-code pin above), none skipped. The adapter and sync tests, the setup bundle, the record on SimChain, the invoice and late work: 160 of 160. `pnpm typecheck`, `pnpm lint`, `pnpm validate:spec`, `pnpm snap` (73 of 73) and `node site/check.mjs` passed.
- **After the third merge of `origin/main`** (at `df65a931`, PR 837): `tests/` and the eight affected files, 63 files, 1,607 passed, 2 skipped, 0 failed. `pnpm typecheck`, `pnpm lint`, `pnpm validate:spec` and `node site/check.mjs` passed. The run before it on the pull request (head `4c298a72`) showed 19 checks passing, 1 skipped, 0 failing, as the app reported it.
- **Bundles, against `origin/main` at `df65a931`:**

| File | `origin/main` SHA-256 | This branch SHA-256 |
| --- | --- | --- |
| `site/setup.mjs` | `e87e061796fefeb1a6cd0a0ebecbb27429a48f391d846208fa1114e951e020a9` | `90119eed42a1a0110655ec872cd1fb39ab7be870df5d2da3a5895e762d1a145d` |
| `site/seller-worker.mjs` | `4a2b5493964f63aa0c8b761996508313511c7887f6187a2cdcef0df648b20a3b` | `90c753ec14558f8066de0cb2b0a0f317409db88bcc4646f07a98b7e3f299b9df` |

  Every other `site/*.mjs` bundle, `buy.mjs`, `try.mjs`, `take.mjs` and `serve.mjs` included, keeps `origin/main`'s bytes. `seller-worker.mjs` moves because it holds the chain adapter's module; its pin (`examples/seller-worker-pin.ts`), inside `setup.mjs`, moves with it.

- **Review** (kind 5, one red team, given the diff, the rules and the ADRs, not this file): no Critical or High finding; seven Low. It ran one script for the quoting and the kept-line filter, and no test. Fixed, test first where code changed:
  - findings 1 and 2: where the two money addresses are one, or the paid adjudicator is a party's address, the new postings could make a record check or the invoice fail where it said "not run". The adapter now lists no postings there;
  - finding 3: the message beside a command that signs now says to run it only on the person's yes;
  - finding 4, in part: an expired preview is named as expired;
  - finding 5: a kept line with no offer ID counts as no line;
  - finding 6: a word that holds `=` is now quoted, since zsh expands a leading `=`;
  - finding 7, in part: the comment in `examples/setup.ts`.
- **Not run:** nothing against Sepolia or the live operators. Full `pnpm verify` (it is for deploys).

## Decisions

- **The fix for `paidTo` is in the operators' adapter, not the record.** The cause is there, and `deal-record.ts` is part of `buy.mjs`, which stays pinned (D101). The record is unchanged.
- **Amounts come from the rules contract's logs; the two money addresses come from the terms.** `PaymentReleased` and `Refunded` name the signing addresses. The contract pays the terms' money addresses (ADR-0033), and the commitment ID fixes the terms.
- **No postings after an early accept or a default outcome.** The record's "postings follow the outcome" check (`examples/deal-record.ts`, the `settlement.released` and `settlement.refunded` branches) refuses their postings in SimChain's shape when the adjudication fee is above 0: an early accept returns the fee to the buyer, and the check allows only adjudicators beside the payee; a default returns price and fee in one posting, and the check wants a posting of exactly the price. Writing them would turn "not run" into "failed" in the pinned `buy.mjs`. The same holds for a decision on a price of 0.
- **`publish` keeps the approve lines it printed** in `publish-shown.json` in the seller's folder (20 at most; hashes and flags, no secret). The `--expect` hash alone cannot say which flag differs, and the default expiry counts from the second of the run.
- **With a live template, an approve that dropped a flag now stops.** Before, an approve of a `--replace` preview without `--replace` answered `"kept": true` and exit 0, with nothing replaced.

## Handoff

**Done:** both fixes, the review's fixes, and the pull request. The coordinator merges after CI.

**What each deploy turns on (Rafa's):**

- **Both operators** (they share one World, `apps/demo-cloud/wrangler.op2.jsonc`): postings on deals that settle afterwards. The records of today's smoke-test deals keep `paidTo: null`. The record needs no new client: the live `buy.mjs` and `setup.mjs` read the postings. Inferred from the unchanged record code and measured on anvil with the same code, not on Sepolia.
- **The site:** the new `setup.mjs` and `seller-worker.mjs`. The coordinator then rebuilds the partner page that pins `setup.mjs`.
- An approve line printed by the `setup.mjs` that is live today is not in `publish-shown.json`. With the new file, such an approve that differs says no preview in this folder printed it.

**Left open:**

- `paidTo` and `refundedTo` stay `null` after an early accept, a default outcome and a decision on a price of 0. The record's "postings follow the outcome" check needs a fix first: it fails SimChain's own early-accept and default postings when the fee is above 0 (inferred from the code, not run). The fix is in `examples/deal-record.ts`, so it moves `buy.mjs` and needs Rafa's yes (D101). After it, `outPostings` can list those two outcomes.
- Review findings left, all Low:
  - the invoice and the record still misread a SimChain deal whose addresses collide, as before this change;
  - finding 4's other case: after a later `--replace`, the message names "this folder";
  - finding 7: comments at `examples/deal-record.ts` (in `buy.mjs`) and `examples/seller-invoice.ts` still say a chain's events carry no postings, and `first-deal`'s note says "on this settlement layer".
- Not in this task: `take.mjs approve` does not check `CROW_SELLER` (item 3 of the same triage note).

**To resume:** `git switch t-621-publish-flags-paid-to`; the tests are named in Evidence. The anvil tests need `forge build` in `contracts/` and the submodules as `.github/workflows/ci.yml` checks them out.
