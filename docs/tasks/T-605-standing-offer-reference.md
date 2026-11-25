# T-605: the standing-offer reference for outside clients

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-551, T-552
- **Paths this task may touch:** `site/ref/standing.txt` (new), one line each in `site/llms.txt`, `site/sell.txt` and `site/ref/take.txt`, `site/build.mjs` and `site/check.mjs` (the creation code as its own published file), `examples/standing-reference.test.ts` (new), this file. Not the pinned bundles. In the private repository: `case-studies/test-crow-support/`.
- **Human gate:** no. The site deploy and the test.crow.support deploy wait for Rafa.
- **Status:** review
- **Agent/session:** ref-standing, a side session of 2026-11-25
- **Roadmap row:** N216
- **Change kind:** 1, with one review as the brief asks.

## What exists

- Standing offers work through Crow's own bundles (`site/setup.mjs publish`, `site/take.mjs`).
- The `StandingOffer` type, the template hash rule, the seller contract's domain, its creation code and the standing-delivery shape are only in the code. A stranger smoke test on 2026-11-25 (item 8) found that an outside client could neither publish nor take a standing offer from the public reference.

## Intent

An agent that integrates over HTTP and the agent pages alone can publish a standing offer and take one. One reference page holds every type, encoding, step and error it needs, and the creation code is a file it can fetch. test.crow.support, which uses none of Crow's code, proves it.

## Context

ADR-0040. `examples/take.ts`, `examples/setup-publish.ts`, `packages/core/src/standing.ts`, `contracts/src/IHoldbackStandingSeller.sol`.

## Acceptance criteria

- [x] `site/ref/standing.txt`, linked from `ref/take.txt` and `sell.txt`, covers what the brief lists.
- [x] A test compares the page's types, structs, creation code hash and vectors with the code.
- [x] test.crow.support, from the page and its own client, publishes one standing offer and takes one, live on Sepolia with test tokens.
- [x] `node site/build.mjs && node site/check.mjs`, the site tests and lint pass; the pinned bundles are unchanged.

**Done when** the two live deals reach `Released` and every gap the outside client found is fixed in the page.

## Out of scope

- Any change to the protocol, the operators, the schemas or the pinned bundles.
- Deploying the site or test.crow.support.

## Evidence

All measured on 2026-11-25 unless a line says otherwise.

- **Local checks** [measured, on this branch rebased on `origin/main` at `91430b55`]: `node site/build.mjs && node site/check.mjs` passes; `vitest run tests/ examples/standing-reference.test.ts examples/setup-bundle.test.ts examples/take.test.ts` passes 1,383 of 1,406 tests, 23 skipped; lint on the changed files and `pnpm typecheck` pass. No snapshot changed.
- **Pinned bundles** [measured]: the branch changes no `site/*.mjs` bundle (`git diff origin/main...HEAD`). `buy.mjs`, `try.mjs` and `take.mjs` keep their hashes; `setup.mjs`'s moved on `main`.
- **The outside client.** A fresh agent built test.crow.support's publisher and taker from a copy of the published pages (the draft page), with no access to Crow's code. Its offline test matched every vector on the first run, after one inference about the `sha256:` prefix [measured by that agent].
- **Live, Sepolia, test tokens, the client's Worker run locally** [measured; `Released` on both operators]:
  - the client takes `sites-2`, which Crow's `setup.mjs` published: `0x6a58fd457e9f6684e2fd52e01f9d52d571d60c2beac4c229d7e4df191ea14b9b`, 82 s;
  - Crow's pinned `take.mjs` takes the client's offer: `0x79cee4c0cc291e9328f56ca9bfd2152a7dfbf288bbc4f7e948e46b3bfd758e00`, 65 s, no error and no notice;
  - the client takes its own offer three times (`0x8fc03fd9…4de4`, `0x8634fa86…3e8a`, `0xbf754f0d…10d1`).
- **What the page had wrong or lacked,** each now fixed. The client reported 13 points; the main ones:
  - the card's top-level `seller` when a seller also has an intake: `take.mjs` refused the client's first card [measured], so the client serves its standing offer on a card of its own;
  - the JSON field types, the `fee.min` object and the mandate list's shape;
  - signature recovery, which a take's blob cannot pass; when `internal` needs a resend; when a new take is safe;
  - the vector's `sha256:` prefix.
- **One review** [the `reviewer` agent, on the first draft]: ISSUES, 8 blocking. It rebuilt the encoder from the pages alone and matched every vector. Fixed: the page told a seller to sign a digest an operator chose; no rule to use the key for nothing else; `Retire` missing; the delivery checks before paying; delivery retries; the funded test (`hold.funded`); the approval list; the faucet call that mints into the seller contract. Its other points are fixed too. No second review ran after the fixes.
- **Size** [measured, the published build]: the page is 21,210 bytes, about 5,300 tokens at 4 bytes each [inferred]; `reference.txt` is 175,690 bytes. The first-deal paths are 4,907 (buyer) and 4,991 (seller) of 5,000 tokens, and the plain-HTTP buyer's path 9,442 of 9,450 [measured, bytes divided by four].
- **Not exercised live:** `relay_refused`, `deadline_passed`, a reclaim, a template without a `delivery`, `Revoke` and `Retire`, deploying by hand. The text on these comes from the code and the review.

## Decisions

- **The creation code is its own published file,** `standing-seller.hex`, written by the publish build from `examples/standing-seller-code.ts`. The page pins its keccak256. A client then needs no bundle to get the bytes.
- **The page's numbers are pinned by a test,** `examples/standing-reference.test.ts`: types, ABI structs, the code's hash and every vector.

## Handoff

- **The site deploy is Rafa's.** Until it runs, `ref/standing.txt` and `standing-seller.hex` are not served.
- **The test.crow.support deploy is Rafa's.** Its code and result note are on the private repository's `main` (`c78c21a`, `case-studies/test-crow-support/2026-11-25-standing-offer-result.md`), which lists what to know first: a deploy publishes the standing offer by itself.
- **For follow-up: the operators answer 500 `internal` on writes** [measured; cause not known]. Two of the client's first takes got it on the funding call, and the same body then funded. The client's intake test, which this change does not touch, then failed twice on it around 10:03 to 10:06 UTC (one request: `urn:holdback:request:c2c7664a-999b-49bc-9af9-92630238e763`) and passed on its third run. The operators' logs were not read.
- **For triage:** `site/card.schema.json` says of the card's `seller` "check terms.seller against it", and does not say that a card with a standing offer from another address must leave it out.
