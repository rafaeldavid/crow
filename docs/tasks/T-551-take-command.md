# T-551: the buyer's command that takes a standing offer

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-549, T-550
- **Paths this task may touch:** `examples/take.ts` and its test (new), `site/take-entry.mjs` and the built `site/take.mjs` (new), `site/build.mjs` and `site/check.mjs` (the new bundle and its pinned hash), `site/card.schema.json` (an optional `standing` entry), one guide under `site/ref/`, this file. Not `site/buy.mjs`, `site/try.mjs` or the `examples/` files they are built from.
- **Human gate:** no. The site deploy waits for Rafa.
- **Status:** todo
- **Agent/session:** none yet
- **Roadmap row:** N196
- **Change kind:** 4, then 1 for the guide.

## What exists

- `site/buy.mjs` is built from `examples/` and pinned by its SHA-256 (`site/build.mjs:180-211`, `site/check.mjs:394`, `:402`). It refuses a seller signature that does not recover (`examples/buyer-signer.ts:792-793`). The standing rule: buyer-side features go in a new `examples/` command (`docs/tasks/T-475-setup-buyer.md:25`).
- A card can list offers as unsigned data (`site/card.schema.json`, D74).

## Intent

Give a buyer one command that takes a standing offer, as ADR-0040 section 5 lists: read the card entry, check the template's signature and that the address follows from the key, fill, show the principal, post, wait for the acceptance, agree and fund, post a standing delivery, and open the file.

## Context

ADR-0040 sections 4 (the address proves the code), 5 (the buyer and the card) and 7 (public deals only); D74 (the card).

## Acceptance criteria

- [ ] `site/take.mjs` with its own pinned hash, checked by `site/check.mjs`.
- [ ] It refuses a template whose signature is not the key's, and an address that does not follow from the key and the salt.
- [ ] It shows the filled terms and stops for the principal's yes before it signs.
- [ ] The `standing` entry in `site/card.schema.json`, on an offer whose `id` equals the template's `offerId`, with an example.
- [ ] The hashes of `site/buy.mjs` and `site/try.mjs` are unchanged.

**Done when** `site/take.mjs` takes a template from a card on a local chain, funds it, and opens the file after the primary's accept.

## Out of scope

- The seller's side (T-552).

## Evidence

## Decisions

## Handoff
