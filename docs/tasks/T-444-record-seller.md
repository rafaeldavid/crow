# T-444: Crow's product, the checked deal record

- **Lane:** demo (Crow's own agents, build row 6)
- **Phase:** 2
- **Depends on:** T-443 (the signer's selling half and the adapter's signer hook); `examples/deal-record.ts` (T-333)
- **Paths this task may touch:** `examples/record-seller.ts`, `examples/record-seller.test.ts`, `fixtures/terms/deal-record.yaml`, the `selling.products` of `examples/signer-rules.v1.json`, this file
- **Human gate:** no (nothing deployed; no real key)
- **Status:** in progress
- **Agent/session:** own-agents build session, on the coordinator's word of 2026-11-14
- **Roadmap row:** N131

## Intent

Crow's selling agent needs something of Crow's own to sell (Rafa's decision 3 of 2026-11-14: "a checked record of any public deal, at a fixed price"). A buyer names a public deal by its ID; Crow sells the record `examples/deal-record.ts` writes for it: the signed terms, each step, the delivery, the judgment and the settlement as every operator serves them, with how each was checked. The product must read only public routes, hold no key and no credential, and use the buyer's input as one deal ID and nothing else.

`examples/record-seller.ts` is the seller's API the adapter calls (quote, start, result). `fixtures/terms/deal-record.yaml` is the product's terms: the deliverable, the checks that bind the record to the deal the buyer named, the price (5.00 tUSDC, `constraints.md` S3) and the windows (S4). The same product goes into the signer's rules (`selling.products`), so Crow's signer signs an offer only when it equals it.

Non-goals: a page for the product on crow.direct (build row 9); a deal record of a private deal (it needs a read token); any change to `deal-record.ts` (it is inside the pinned `site/buy.mjs`).

## Acceptance criteria

- [ ] The quote takes exactly `{scope: {deal}}` with a lowercase commitment ID, and refuses anything else, naming it; a deal that is not public on the operators is refused.
- [ ] The record seller sends GET requests only, to the operators it is given only, and reads no secret.
- [ ] Through the adapter with Crow's signer, a buyer that is not Crow's buys the record of a public deal: the work is that deal's record and passes the deal's checks, the deal releases, and Crow's payout address is paid 5.00 tUSDC.
- [ ] The record of another deal fails the checks; the signer's `selling.products` in the version 1 rules equals the terms file's product.
- [ ] The SHA-256 of `site/buy.mjs` and `site/try.mjs` is unchanged, and so is the hosted bundle's for the kit's two seller folders.

## Evidence

## Decisions

## Handoff

**Owed before the proof run:** a review by a model of another family of the delivery path (design, "The build, in order"). It needs a key of Rafa's.
