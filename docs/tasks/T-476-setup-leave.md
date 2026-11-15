# T-476: Leaving is one command

- **Lane:** demo (agent access: the guides in `site/` and the reference tools in `examples/`)
- **Phase:** 2
- **Depends on:** T-472 (the seller's setup), T-475 (the buyer's).
- **Paths this task may touch:** `examples/setup-leave.ts` (new), `examples/setup-leave*.test.ts` (new), one entry in `examples/setup.ts`'s command table, the "Leave" section of `site/setup.txt`, `site/setup.mjs` (generated), this file. It imports `examples/deal-record.ts` and changes nothing it imports.
- **Human gate:** yes, for one step only: the site deploy that publishes the new bundle is Rafa's. The merge has no gate.
- **Status:** todo
- **Agent/session:** not started; starts after T-475 merges
- **Roadmap row:** N160
- **Change kind:** 4 with 1. Local checks: `pnpm exec vitest run examples/setup`, `node site/build.mjs && node site/check.mjs`.
- **Review:** one `red-teamer` pass (it deletes keys and stops a seller with deals open) and one `reviewer` pass.
- **Token budget:** 100,000 tokens, a target.

## Intent

Restate this in your own words before writing code.

A party that set Crow up can leave in one step: `node setup.mjs leave`. The command writes the party's own records as plain files, stops the service, removes what the setup made, and says plainly what stays behind. Nothing is removed at Crow, because nothing was registered there.

Leaving must never harm a counterparty or the party itself: a funded deal is finished or left to its deadline's refund, and a key is never deleted while it still matters.

Non-goals: removing a deal's public record (it cannot be removed); a signed revocation of a mandate (no operator route takes one yet, ADR-0038); restoring a setup from an export.

## Context

- The design: `docs/research/2026-11-15-setup-design.md`, "Leaving".
- The pattern and its gap: `docs/research/2026-11-15-blygger-study.md`, pattern 7. Blygger exports with one command but has no command that removes an installation.
- The deal record: `examples/deal-record.ts`. The adapter's journal and its behaviour on a stop: `examples/seller-adapter-service.md`, "Restarts".

## Acceptance criteria

- [ ] `node setup.mjs leave` writes `export/`: one deal record for each deal the folder knows, the configuration, the template, the card files and the journal. A test fails if any exported file holds a key or a secret's value.
- [ ] **Open deals first.** With a deal open, the command names each one with its state and deadline, and waits for it to end. `--now` leaves at once and prints, for each funded deal, that the buyer is refunded at its deadline. A seller's stop takes no new quote and finishes the step in progress.
- [ ] It removes what the setup made on this machine: the service files T-477 wrote, where it wrote them, and the card files. It prints the block the person must take off their own page, since it cannot edit their site.
- [ ] **Keys stay by default.** `--delete-keys` removes `keys/`; the command refuses it while a deal is open, while a key's address holds tokens, or before the export is complete, and names the reason.
- [ ] It prints what stays: the party's past deals on the operators and on Sepolia, public as before; the faucet's mandate, which runs out by itself within 30 days; nothing else at Crow.
- [ ] Run twice, the second run changes nothing and says so. Killed halfway, a rerun finishes.
- [ ] Its requests are reads of the party's own deals on the operators. A test records them and finds no write.
- [ ] The red-team pass tries to: delete a key with a deal open or tokens on its address; leave a funded deal with no message; put a secret into the export. Each fails, or the finding and its fix are in Evidence.

## Out of scope

- Removing a Worker on a party's Cloudflare account: T-478 adds that step to `leave` when it builds the deploy.

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:

## Decisions

Choices made inside this task.

## Handoff

Not started. Starts after T-475 merges, because both change the bundle `site/setup.mjs` and its pinned hash.
