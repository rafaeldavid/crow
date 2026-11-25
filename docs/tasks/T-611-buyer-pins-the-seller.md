# T-611: The buyer's tools check the seller against the address the buyer expects

- **Lane:** demo
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `examples/buyer-signer.ts`, `examples/buy-with-signer.ts`, `examples/own-buyer.ts`, `examples/take.ts`, their tests, `examples/help.ts`, `site/ref/http-buyer.txt`, `site/ref/buyer-signer.txt`, `site/ref/take.txt`, `site/buy.txt`, the rebuilt bundles `site/buy.mjs` and `site/take.mjs`, `site/build.mjs` (pinned hashes), `docs/decisions-today.md` (one D entry)
- **Human gate:** no (the site deploy that publishes the new bundles waits for Rafa)
- **Status:** review
- **Agent/session:** buyer-seller-pin (a session started from the coordinator, 2026-11-25)
- **Roadmap row:** none (the long-term binding is N228, held until after the case studies)

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

- Measured: `pnpm exec vitest run examples/buyer-signer-addresses.test.ts`: 19 of 19 passed. A copy of the deal signed by another key, at its own payout address, is refused by `readOffer`, naming `seller`; the real quoted offer passes `checkOffer`. An offer the key did not ask for is refused without a named seller and passes with its signer named.
- Measured: `examples/buy-with-signer.test.ts` (D101 test): `CROW_SELLER` naming another address refuses the offer (exit 1, `refusing to sign: seller is …`), the right address stops for approval (exit 3), and a terms file seller that differs from `CROW_SELLER` is refused.
- Measured: `examples/take.test.ts` on anvil (D101 test): `CROW_SELLER` naming another address refuses the standing offer before it shows anything (exit 1); the named seller contract shows it (exit 3). The bytecode pin test in the same file failed locally against this machine's `forge build`, whose nested submodule `contracts/lib/commerce-payments` is dirty; this branch changes no contract or bytecode.
- Measured: after the review, `buyer-signer-outcome.test.ts` and `serve.test.ts`, which read offers their key never quoted, name the seller; with them, 49 of 49 tests in the four affected files passed.
- Measured: `node site/build.mjs && node site/check.mjs`: PASS. The buyer's first-deal path is 4,958 of 5,000 tokens; the plain-HTTP buyer's path is within its 9,450-token ceiling after tightening two sentences of `ref/http-buyer.txt`.
- Measured: `pnpm typecheck` and ESLint on the changed files: clean. `examples/buy-with-signer.ts` stays at 50 lines.
- Bundles: the PR lists the old and new SHA-256 of `site/buy.mjs` and `site/take.mjs`. The deploy that publishes them waits for Rafa.

## Decisions

D101.

## Handoff

- **Review** (one, Opus): ISSUES, one blocking finding, fixed: two existing test files called `checkOffer` on offers their key never quoted. Also fixed: `take.ts` checks `CROW_SELLER` is an address; one test title. Left as is: `ref/http-buyer.txt`'s approve line no longer lists the fields (the bullets above it do; the page is at its token ceiling).
- **Coordination:** the proposed task "Buyer tool opens every delivery it paid for" also edits `examples/buyer-signer.ts` and `examples/take.ts`. This change adds a key option, one getter, two refusals in `readOffer`/`checkOffer` and `sellerOf` to `buyer-signer.ts`, and three lines to `take.ts`'s `show`.
- **N228 (held):** the research findings on binding a seller's key to its published identity are below, for when the case studies are done. Build nothing for them before then.
