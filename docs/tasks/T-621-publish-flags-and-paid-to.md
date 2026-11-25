# T-621: publish names the flag that differs, and a chain's deal record names who was paid

- **Lane:** settlement (the chain adapter) and api (the seller's tool in `examples/`)
- **Phase:** 2
- **Depends on:** T-552 (`publish`), T-390 and T-411 (the deal record's payee)
- **Paths this task may touch:** `examples/setup-publish.ts` and its test, `examples/deal-record-chain.test.ts`, `packages/settlement/evm/evm-settlement.ts` and its tests, `site/setup.mjs` (generated), `docs/api.md`, `docs/architecture.md`, this file
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

(Filled before review.)

## Decisions

- **The fix for `paidTo` is in the operators' adapter, not the record.** The cause is there, and `deal-record.ts` is part of `buy.mjs`, which stays pinned (D101). The record is unchanged.
- **Amounts come from the rules contract's logs; the two money addresses come from the terms.** `PaymentReleased` and `Refunded` name the signing addresses. The contract pays the terms' money addresses (ADR-0033), and the commitment ID fixes the terms.
- **No postings after an early accept or a default outcome.** The record's "postings follow the outcome" check (`examples/deal-record.ts`, the `settlement.released` and `settlement.refunded` branches) refuses their postings in SimChain's shape when the adjudication fee is above 0: an early accept returns the fee to the buyer, and the check allows only adjudicators beside the payee; a default returns price and fee in one posting, and the check wants a posting of exactly the price. Writing them would turn "not run" into "failed" in the pinned `buy.mjs`. The same holds for a decision on a price of 0.
- **`publish` keeps the approve lines it printed** in `publish-shown.json` in the seller's folder (20 at most; hashes and flags, no secret). The `--expect` hash alone cannot say which flag differs, and the default expiry counts from the second of the run.
- **With a live template, an approve that dropped a flag now stops.** Before, an approve of a `--replace` preview without `--replace` answered `"kept": true` and exit 0, with nothing replaced.

## Handoff

(Filled before review.)
