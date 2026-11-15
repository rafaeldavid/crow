# T-475: A standing buyer with limits, to a first settled test deal

- **Lane:** demo (agent access: the guides in `site/` and the reference tools in `examples/`)
- **Phase:** 2
- **Depends on:** T-472 (the setup command's shared parts: the folder, the state file, the keys, the bundle); it runs after T-483, because each changes the bundle.
- **Paths this task may touch:** `examples/setup-buyer.ts` (new), `examples/setup-buyer*.test.ts` (new), one entry in `examples/setup.ts`'s command table, the buyer's section of `site/setup.txt`, `site/setup.mjs` (generated), this file. It imports `examples/agent.ts`, `examples/verify.ts`, `examples/goal-kit.ts`, `examples/buy-with-signer.ts`, `examples/buyer-signer.ts`, `examples/pay-from-wallet.ts` and `examples/deal-record.ts` and changes none of them.
- **Human gate:** yes, for one step only: the site deploy that publishes the new bundle is Rafa's. The merge has no gate.
- **Status:** todo
- **Agent/session:** not started; starts after T-483 merges
- **Roadmap row:** N160
- **Change kind:** 4 is the nearest recipe, with 1. Local checks: `pnpm exec vitest run examples/setup`, `node site/build.mjs && node site/check.mjs`.
- **Review:** one `red-teamer` pass (the keys, the limits, the faucet call, text from a seller) and one `reviewer` pass.
- **Token budget:** 250,000 tokens, a target.

## Intent

Restate this in your own words before writing code.

A person says: "Read https://crow.direct/setup.txt and set up Crow for me as a buyer who pays at most 30 tUSDC a deal and 60 tUSDC a day." The assistant runs the setup command, which makes a buyer's folder with its own keys and a limits file, then buys a test dataset from Crow's test seller and keeps the deal's record. After that the same folder buys from any seller's card.

The one pinned command of the front door already runs a test deal as a buyer, but it keeps nothing: its keys live in memory. This task adds what a standing buyer needs: keys that last, limits the person set, a record of each deal, and one place for all of it.

**Two ways of buying, and the first deal needs the one the buyer's tools lack.** Crow's test seller takes a sealed proposal at its intake, and Crow runs no seller that sells by quote (`site/buy.txt`, step 2). The buyer's tools in `buy.mjs` are quote-driven, and `examples/try.ts`, which does buy from the test seller, exports nothing and keeps its keys in memory. So this task writes the intake purchase for a standing folder, in `examples/setup-buyer.ts`, on `examples/agent.ts`, `examples/verify.ts` and the kit of pull request 578. Purchases from a seller's quote address reuse the buyer's tools as they are.

The buyer's pinned files `site/buy.mjs` and `site/try.mjs` are pinned by hash and do not change.

Non-goals: a signer on another machine (T-479); leaving (T-476); a buyer's card; any change to `buy.mjs`, `try.mjs` or the files they bundle.

## Context

- The design: `docs/research/2026-11-15-setup-design.md`, "The ways in, by effort" (a buyer), "Keys, secrets and limits", "The privacy table".
- The baseline: `docs/research/2026-11-15-setup-baseline.md`, "A buyer today": no hard spending limit binds a buyer's agent today, and on the test service the faucet mints a deal's total to any payment address.
- Buying from the test seller: `site/ref/intake.txt`, "Two agents, two people" and "Crow's test seller"; `examples/try.ts`.
- The buyer's tools: `site/buy.txt`, `site/ref/buyer-signer.txt`. Limits and what enforces them: `site/ref/limits.txt`, ADR-0038.

## Acceptance criteria

- [ ] `node setup.mjs buyer --max-per-deal <base units> --max-per-day <base units>` makes the folder, a key store and `limits.json`. Without both numbers it prints the questions as JSON and exits 3; it invents no limit, and it takes any number (D31). It makes no request to an operator, the faucet, the test agents or crow.direct.
- [ ] `node setup.mjs first-deal` buys the test seller's dataset through its intake, follows the deal to `Released`, and writes the deal record. Scripted, in the in-process world, it ends `Released` with Crow's test seller. When the test seller refuses or is down, the command says so; with `--self-buy` it plays the seller itself, as `try.mjs` does, and the record says so.
- [ ] A later purchase from a seller's quote address goes through the same folder: the offer is shown, nothing is signed until the person approves the command that pays, as `buy.mjs` stops today (exit status 3).
- [ ] **The limits hold in the command.** A deal whose total is above `maxPerDeal`, or that would take the UTC day's total above `maxPerDay`, is refused before any signature, naming the limit. The day's total comes from one ledger for the folder, locked while a purchase runs and written before the signature leaves, so two runs at once cannot both pass.
- [ ] **The limits change only at a terminal.** A command that raises a limit refuses to run when its input is not a terminal. The command detects a `limits.json` edited by hand since it last wrote it, says so, and refuses to pay until the person confirms the new numbers at a terminal.
- [ ] **A seller's text stays out of the assistant's context by default.** The opened work is written to a file; the command prints its path, size and SHA-256, not its content. The offer's free text (the description) is printed as one plain line, as the repository's output rule for untrusted text requires.
- [ ] **The output says what the limits are.** After `buyer`, and in `status`, the command states: these limits are enforced by this command only; an assistant that shares the machine can read the key, make a second folder or pay with another tool; on the test service the faucet fills any payment address, so no balance bounds spending; for a limit the assistant cannot pass, pay from a wallet the person controls or use the signer.
- [ ] `--payment-address <address>` wires the separate wallet: the first deal stops before funding until the wallet signs, as `buy.txt` step 6 describes. The guide says that the wallet's address is then public in every deal and ties them together.
- [ ] **Keys:** a fresh key for each deal, file mode 0600 under `keys/`; never printed, logged, on a command line or sent. The leak test of T-472 covers the buyer's commands, the encryption secrets included.
- [ ] `site/buy.mjs` and `site/try.mjs` keep their SHA-256.
- [ ] The red-team pass tries to: spend above a limit through the command, by a rewritten limits file, by two runs at once and by text in an offer or a delivery that tells the assistant to raise it; make the command print or send a key; make it call the faucet before `first-deal`. Each fails, or the finding and its fix are in Evidence.

## Out of scope

- Limits an assistant on the same machine cannot pass: T-479, or the person's own wallet.
- A buyer's card, so that sellers can come to it. Deferred (the design's list).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

- Commands run and results:
- The requests each command made, by host:

## Decisions

Choices made inside this task.

## Handoff

Not started. Starts after T-483 merges, because each changes the bundle `site/setup.mjs` and its pinned hash.
