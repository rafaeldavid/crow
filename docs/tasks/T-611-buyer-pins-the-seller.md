# T-611: The buyer's tools check the seller against the address the buyer expects

- **Lane:** demo
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `examples/buyer-signer.ts`, `examples/buy-with-signer.ts`, `examples/own-buyer.ts`, `examples/take.ts`, their tests, `examples/help.ts`, `site/ref/http-buyer.txt`, `site/ref/buyer-signer.txt`, `site/ref/take.txt`, `site/buy.txt`, the rebuilt bundles `site/buy.mjs` and `site/take.mjs`, `site/build.mjs` (pinned hashes), `docs/decisions-today.md` (one D entry)
- **Human gate:** no (the site deploy that publishes the new bundles waits for Rafa)
- **Status:** review
- **Agent/session:** buyer-seller-pin (a session started from the coordinator, 2026-11-25)
- **Roadmap row:** none

## What exists

- Settlement binds a deal to the key that signed the terms, and accepts a delivery only from that key (`contracts/src/HoldbackRules.sol`, `_acceptDelivery`).
- `examples/buyer-signer.ts` `checkOffer` recovers the seller's signature and checks it equals `terms.seller`. It compares `seller` with the buyer's approval only when the approval names one.
- `quote` binds the key to the commitment ID the seller's own quote route answers, so a buyer that quotes cannot be moved to another offer by this key.
- `examples/buy-with-signer.ts` and `examples/own-buyer.ts` take `seller` as an optional field of `--expect-terms`.
- `examples/take.ts` rests the seller's identity on the card's origin.
- `site/ref/http-buyer.txt` tells a buyer who found an offer itself to read `seller` from the terms.

Nothing tells the buyer whether the key that signed is the company it means to buy from. Terms are public once offered, so anyone can copy an offer, sign the copy with their own key and name the same buyer.

## Intent

Make the buyer's tools refuse an offer whose `seller` differs from the address the buyer expects, naming the field. The address comes from the seller's own channel, never from the offer. Non-goals: no contract, operator or schema change; no settlement machinery (D32).

## Acceptance criteria

- [ ] The tools refuse an offer whose seller differs from the expected one, naming `seller`.
- [ ] A test where a copy signed by another key is refused, and the real offer still passes.
- [ ] The reference pages say where the address comes from.
- [ ] Kind 1 and the examples' tests pass; `node site/build.mjs && node site/check.mjs` passes; the PR lists the old and new SHA-256 of each pinned bundle that changes.
- [ ] One review.

## Out of scope

- Opening every delivery the buyer paid for (a separate proposed task that also edits `buyer-signer.ts` and `take.ts`).
- The site deploy.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

D101.

## Handoff
