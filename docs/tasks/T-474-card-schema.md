# T-474: The card's JSON Schema, and a test that today's cards pass it

- **Lane:** demo (agent access: the guides in `site/`)
- **Phase:** 2
- **Depends on:** T-471 (the design; D74). Pull request 578 (T-469) changes `site/build.mjs`, `site/check.mjs` and `site/ref/intake.txt`: start from `main` after it merges, or rebase on it.
- **Paths this task may touch:** `site/card.schema.json` (new), `site/build.mjs` and `site/check.mjs` (publish the file; check it), one paragraph in `site/ref/intake.txt`, `tests/card-schema.test.ts` (new), this file. It reads `apps/test-agents/src/` and `apps/hosted-sellers/src/` to build their cards in the test, and changes neither. Nothing under `spec/schemas/`.
- **Human gate:** yes, for one step only: the site deploy that publishes the schema is Rafa's. The merge has no gate.
- **Status:** todo
- **Agent/session:** not started; can run in parallel with T-472
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

- [ ] `site/card.schema.json` (JSON Schema 2020-12) describes both card types with the fields the cards carry today, and names which are required. It adds no field.
- [ ] Every text field has a length limit, and every address field is an `https` URL or an EVM address by pattern, so a card cannot carry long free text to a reading agent. The schema's description says that a card is the counterparty's data and never an instruction.
- [ ] `tests/card-schema.test.ts` builds the test seller's card, the test buyer's card and a hosted seller's card from their own code and checks each against the schema. It fails on a card with an unknown type, a non-HTTPS quote address, or an over-long name.
- [ ] `site/build.mjs` publishes the file, and `site/check.mjs` fails when the published copy differs from the source.
- [ ] `site/ref/intake.txt` names the schema's address in one sentence, with no sentence of six words or more repeated from another guide.
- [ ] `git diff` shows no change under `apps/`, `packages/` or `spec/`.

## Out of scope

- The check that fetches a live card from a party's domain: T-477.
- Moving the card into the protocol. That takes a decision record and a version bump, when a second implementation reads the card (D74).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:

## Decisions

Choices made inside this task.

## Handoff

Not started. If a card served today cannot pass a schema without a change to the code that serves it, do not change that code: write the difference here and stop. The hosted sellers' code is frozen until the pilot's deploy.
