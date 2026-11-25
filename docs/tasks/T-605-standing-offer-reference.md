# T-605: the standing-offer reference for outside clients

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-551, T-552
- **Paths this task may touch:** `site/ref/standing.txt` (new), one line each in `site/llms.txt`, `site/sell.txt` and `site/ref/take.txt`, `site/build.mjs` and `site/check.mjs` (the creation code as its own published file), `examples/standing-reference.test.ts` (new), this file. Not the pinned bundles. In crow-private: `case-studies/test-crow-support/`.
- **Human gate:** no. The site deploy and the test.crow.support deploy wait for Rafa.
- **Status:** in progress
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

- [ ] `site/ref/standing.txt`, linked from `ref/take.txt` and `sell.txt`, covers what the brief lists.
- [ ] A test compares the page's types, structs, creation code hash and vectors with the code.
- [ ] test.crow.support, from the page and its own client, publishes one standing offer and takes one, live on Sepolia with test tokens.
- [ ] `node site/build.mjs && node site/check.mjs`, the site tests and lint pass; the pinned bundles are unchanged.

**Done when** the two live deals reach `Released` and every gap the outside client found is fixed in the page.

## Out of scope

- Any change to the protocol, the operators, the schemas or the pinned bundles.
- Deploying the site or test.crow.support.

## Evidence

## Handoff
