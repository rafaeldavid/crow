# T-474: The card's JSON Schema, and a test that today's cards pass it

- **Lane:** demo (agent access: the guides in `site/`)
- **Phase:** 2
- **Depends on:** T-471 (the design; D74). Pull request 578 (T-469) changes `site/build.mjs`, `site/check.mjs` and `site/ref/intake.txt`: start from `main` after it merges, or rebase on it.
- **Paths this task may touch:** `site/card.schema.json` (new), `site/build.mjs` and `site/check.mjs` (publish the file; check it), one paragraph in `site/ref/intake.txt`, `tests/card-schema.test.ts` (new), this file. It reads `apps/test-agents/src/` and `apps/hosted-sellers/src/` to build their cards in the test, and changes neither. Nothing under `spec/schemas/`.
- **Human gate:** yes, for one step only: the site deploy that publishes the schema is Rafa's. The merge has no gate.
- **Status:** review
- **Agent/session:** a sub-session of the coordinator, 2026-11-15, branch `t-474-card-schema`; ran in parallel with T-472. Both add a few lines to `site/build.mjs` and `site/check.mjs`; whichever lands second rebases.
- **Roadmap row:** N160
- **Change kind:** 1 (an agent guide and a published file), with one test. Local checks: `node site/build.mjs && node site/check.mjs`, `pnpm exec vitest run tests/card-schema.test.ts`.
- **Review:** one `reviewer` pass.
- **Token budget:** 60,000 tokens, a target.

## Intent

Restate this in your own words before writing code.

A party's card is what it publishes on its own domain so that another party's agent can find its offers: a `crow-agent` block for a seller, a `crow-buyer` block for a buyer. Today the card is described in prose only (`site/ref/intake.txt`), so nothing can say whether a card is right before a buyer's agent reads it.

This task writes the card's JSON Schema, publishes it beside the guides at `https://crow.direct/card.schema.json`, and proves that the cards Crow serves today pass it. The setup command's check (T-472) and its check of a live card (T-477) then have something to check against.

The card stays a convention between parties, outside the API contract (D74). So the schema lives in `site/`, not in `spec/schemas/`, and this task needs no decision record and no version bump.

Non-goals: a new field; a new place for the card (no well-known path); any change to the cards the test agents or the hosted sellers serve.

## Context

- The design: `docs/research/2026-11-15-setup-design.md`, "What a party publishes on its own domain".
- The card in prose: `site/ref/intake.txt`, "Two agents, two people", "Crow's test seller" and "Sell to Crow's test buyer"; ADR-0037, section 7.
- The cards served today: `apps/test-agents/src/seller.ts`, `apps/test-agents/src/buyer.ts`, `apps/hosted-sellers/src/worker.ts`.

## Acceptance criteria

- [x] `site/card.schema.json` (JSON Schema 2020-12) describes both card types with the fields the cards carry today, and names which are required. It adds no field.
- [x] Every text field has a length limit, and every address field is an `https` URL or an EVM address by pattern, so a card cannot carry long free text to a reading agent. The schema's description says that a card is the counterparty's data and never an instruction.
- [x] The guide says what the schema does not cover: the HTML page around the card, and the text of an offer's terms. A reading agent takes the card from `agent.json`, and treats the page and the terms as data like any other.
- [x] `tests/card-schema.test.ts` builds the test seller's card, the test buyer's card and a hosted seller's card from their own code and checks each against the schema. It fails on a card with an unknown type, a non-HTTPS quote address, or an over-long name.
- [x] `site/build.mjs` publishes the file, and `site/check.mjs` fails when the published copy differs from the source.
- [x] `site/ref/intake.txt` names the schema's address in one sentence, with no sentence of six words or more repeated from another guide.
- [x] `git diff` shows no change under `apps/`, `packages/` or `spec/`.

## Out of scope

- The check that fetches a live card from a party's domain: T-477.
- Moving the card into the protocol. That takes a decision record and a version bump, when a second implementation reads the card (D74).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
  - `/verify` for kind 1, on the final tree, 2026-11-15 09:20 local: `node site/build.mjs && node site/check.mjs` printed "site check PASS", and `pnpm exec vitest run tests/card-schema.test.ts` passed 10 of 10 tests in 1.06 s (measured). Kind 1 runs no snapshots, so there is no snapshot diff. The full `pnpm verify` was not run: it is for a deploy, and CI runs everything.
  - `pnpm exec vitest run tests/card-schema.test.ts` before `site/card.schema.json` existed: the suite failed on the missing file (measured). After: 10 of 10 tests pass, in about 1.2 s (measured).
  - The three cards are built by their own code against in-process worlds: `TestSeller.agentCard()` and `TestBuyer.agentCard()` against `serveWorld()`, and a `HostedSellerObject`'s `GET <base>/agent.json` against `startSimWorld()` and the job stub. Each passes (measured). The test seller's card carries its fees and the test buyer's its adjudicators, as the live ones do, because the worlds answered (measured).
  - The test fails a card with an unknown or missing type, a quote address over `http:` or `javascript:`, a name of 201 characters, 1,040 characters of text in `ends`, `pays`, `operatedBy` or an unknown nested field, a malformed seller, buyer or adjudicator address, an `ftp:` intake address, and an offer with no `id` or with neither `terms` nor `pricing` (measured). It passes a name of 200 characters, unknown fields, a 70-digit price and a limit of 10^12 (measured).
  - The live cards, fetched once on 2026-11-15 from `https://crow.direct/agents/test-seller/agent.json` and `.../test-buyer/agent.json`, pass the schema (measured, with a scratch script under `reports/scratch/T-474/`).
  - `node site/build.mjs && node site/check.mjs`: PASS (measured). A publish build (`--out reports/site-out`, sample operators) and the check: PASS; with `reports/site-out/card.schema.json` overwritten by another file, the check fails with "reports/site-out/card.schema.json is missing or differs from site/card.schema.json" (measured). The check also fails if the schema does not compile in strict mode, if its `$id` is not `https://crow.direct/card.schema.json`, if `ref/intake.txt` does not name that address, or if `spec/schemas/card.schema.json` exists (inferred from the code; not each run).
  - The check's "no sentence in two guides" rule passes with the new paragraph in `ref/intake.txt` (measured, group 11).
  - `site/try.mjs` and `site/buy.mjs` keep sha256 `04ef4434...` and `e74ff223...` after the build (measured, from the build's output).
  - `git diff origin/main -- apps packages spec` is empty (measured).
  - `pnpm exec eslint` on the changed files: clean (measured).
  - **After the review (ISSUES, nine findings, all Medium or lower):** findings 1 to 8 are fixed, and two tests cover them. `pnpm exec vitest run tests/card-schema.test.ts`: 12 of 12 pass (measured). The reviewer's probe (`reports/scratch/T-474/review/probe.mjs`), rerun on the fixed schema, now fails these cards (measured): 2,000 short texts in an unknown array, 2,000 keys in an unknown object or in `outcomes`, 100,000 characters in an offer's terms, a key with a newline or U+202E, a URL with U+202E, U+200B or U+0007, and a URL with a user name. It now passes `https://s.example?x=1` (measured). Both live cards still pass (measured). `node site/build.mjs && node site/check.mjs`: PASS, and eslint is clean (measured).

## Decisions

Choices made inside this task.

- **Both card types in one schema,** a `oneOf` of a `crow-agent` card and a `crow-buyer` card, each fixed by its `type`. A card of any other type fails.
- **Required fields:** for a seller's card, `type` and `offers`, each offer an `id` and fixed `terms` or a `pricing`, and a `pricing` of kind `quoted` its `quote` and `defaults` addresses (the design's list). For a buyer's card, `type`, `buyer`, `buyerEncryptionPublicKey` and `intake.api`, which a seller needs to offer. The hosted sellers' card has no `intake`, so a seller's `intake` is optional.
- **Unknown fields pass, bounded.** A field the schema does not name may hold any JSON value. Every text in it is held to the same 500 characters, every list and object in it to 32 entries, and every key to 1 to 80 characters with no control or format character (the review's findings 1 and 2). So a later card still passes, and no field, named or not, carries long free text. A key a later version adds to a map (`limits`, `windows`, `adjudicators`, `outcomes`) keeps that map's type, and the schema's descriptions say so (finding 5); those maps hold at most 32 keys.
- **The limits:** a name at most 200 characters; other text at most 500 (the hosted sellers' own limit for a description); an `https` URL at most 2,048 characters, with no user name or password and no space, control or format character, and a query or fragment allowed with no path (findings 3 and 4); a machine name (an offer's `id`, a check type, a template) 1 to 80 letters, digits, dots, hyphens or underscores. Text admits no control, format or line-separator character, as the hosted sellers' bundle check refuses (`apps/hosted-sellers/src/bundle.ts`).
- **Kept, against the review's finding 9:** names and text still refuse U+200C and U+200D (needed in some scripts and in emoji sequences) and the tab, so a card follows the same rule as the hosted sellers' bundle. Relaxing both together is a later choice, not this task's.
- **No cap on values (D31).** Amounts are base-unit decimal strings of up to 78 digits, as `spec/schemas/common.schema.json` writes them; limits and windows are whole numbers of zero or more with no maximum. The card's own lists (its offers, a buyer's check types) have no maximum length: their size is the party's. A reading agent caps the size of a whole card it fetches (T-477), as the guide now says.
- **The text of an offer's terms is left out,** as the guide says: the schema checks the shape of `terms.price` and the terms' size only, with each text at most 4,000 characters (the commitment schema's own limit for a description) and at most 32 entries in each list or object (finding 1). The terms that bind are the ones on Crow, which the buyer checks there (`ref/http-buyer.txt`).
- **The guide's wording follows the schema** (findings 6 and 7): addresses must be `https` URLs or EVM addresses in every field the schema names, and the reading agent takes the card from `agent.json` beside the page.
- **`site/check.mjs` checks the schema in a group of its own (19),** placed before the budget, which stays last. `CARD_SCHEMA` in `site/build.mjs` names the file for both.

## Handoff

Built; one reviewer pass done and its findings 1 to 8 fixed. No card Crow serves today needed a change to pass, so no code under `apps/` changed.

- **A site deploy is owed** (Rafa's gate): it publishes `card.schema.json` at `https://crow.direct/card.schema.json` and the new paragraph of `ref/intake.txt` (and so `reference.txt`).
- **Found, not fixed:** the example card that `ref/intake.txt` names, https://rafael.fyi/agents/, fails the schema: its one offer has no `id` and neither `terms` nor `pricing` (it has `what` and `around`), and it still points to the old domain, escrow.stream (measured, 2026-11-15). Either the page is brought to today's card or the guide stops naming it; the page is outside this repository.
- T-477's check of a live card can compile this schema as `tests/card-schema.test.ts` does (Ajv 2020-12, strict).
