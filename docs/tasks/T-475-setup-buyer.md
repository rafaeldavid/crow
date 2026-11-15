# T-475: A standing buyer with limits, to a first settled test deal

- **Lane:** demo (agent access: the guides in `site/` and the reference tools in `examples/`)
- **Phase:** 2
- **Depends on:** T-472 (the setup command's shared parts: the folder, the state file, the keys, the bundle).
- **Paths this task may touch:** `examples/setup-buyer.ts` (new), `examples/setup-buyer*.test.ts` (new), one entry in `examples/setup.ts`'s command table, the buyer's section of `site/setup.txt`, `site/setup.mjs` (generated), this file. It imports `examples/buy-with-signer.ts`, `examples/buyer-signer.ts`, `examples/pay-from-wallet.ts` and `examples/deal-record.ts` and changes none of them.
- **Human gate:** yes, for one step only: the site deploy that publishes the new bundle is Rafa's. The merge has no gate.
- **Status:** todo
- **Agent/session:** not started; starts after T-472 merges
- **Roadmap row:** N160
- **Change kind:** 4 with 1. Local checks: `pnpm exec vitest run examples/setup`, `node site/build.mjs && node site/check.mjs`.
- **Review:** one `red-teamer` pass (the keys, the limits, the faucet call) and one `reviewer` pass.
- **Token budget:** 200,000 tokens, a target.

## Intent

Restate this in your own words before writing code.

A person says: "Read https://crow.direct/setup.txt and set up Crow for me as a buyer who pays at most 30 tUSDC a deal and 60 tUSDC a day." The assistant runs the setup command, which makes a buyer's folder with its own keys and a limits file, then buys a test dataset from Crow's test seller and keeps the deal's record. After that the same folder buys from any seller's card.

The one pinned command of the front door already runs a test deal as a buyer, but it keeps nothing: its keys live in memory. This task adds what a standing buyer needs: keys that last, limits the person set, a record of each deal, and one place for all of it.

The buyer's pinned files `site/buy.mjs` and `site/try.mjs` are pinned by hash and do not change. The buying logic is imported from their sources into the setup command's own bundle.

Non-goals: a signer on another machine (T-479); leaving (T-476); a buyer's card; any change to `buy.mjs`, `try.mjs` or the files they bundle.

## Context

- The design: `docs/research/2026-11-15-setup-design.md`, "The ways in, by effort" (a buyer), "Keys, secrets and limits", "The privacy table".
- The baseline: `docs/research/2026-11-15-setup-baseline.md`, "A buyer today": no hard spending limit binds a buyer's agent today, and on the test service the faucet mints a deal's total to any payment address.
- The buyer's tools: `site/buy.txt`, `site/ref/buyer-signer.txt`. Limits and what enforces them: `site/ref/limits.txt`, ADR-0038.

## Acceptance criteria

- [ ] `node setup.mjs buyer --max-per-deal <base units> --max-per-day <base units>` makes the folder, a key store and `limits.json`. Without both numbers it prints the questions as JSON and exits 3; it invents no limit. It makes no request to an operator, the faucet, the test agents or crow.direct.
- [ ] `node setup.mjs first-deal` buys the test seller's dataset, follows the deal to `Released`, opens the work and writes the deal record. Scripted, in the in-process world, it ends `Released` with Crow's test seller.
- [ ] A later purchase from a seller's quote address goes through the same folder: the offer is shown, nothing is signed until the person approves, as `buy.mjs` stops today (exit status 3).
- [ ] **The limits hold in the command.** A deal whose total is above `maxPerDeal`, or that would take the UTC day's total above `maxPerDay`, is refused before any signature, naming the limit. The day's total comes from the folder's own ledger, written before the signature leaves.
- [ ] **The output says what the limits are.** After `buyer`, and in `status`, the command states: these limits are enforced by this command only; an assistant that shares the machine can read the key; on the test service the faucet fills any payment address, so no balance bounds spending; for a limit the assistant cannot pass, pay from a wallet the person controls or use the signer.
- [ ] `--payment-address <address>` wires the separate wallet: the first deal stops before funding until the wallet signs, as `buy.txt` step 6 describes.
- [ ] **Keys:** a fresh key for each deal, file mode 0600 under `keys/`; never printed, logged, on a command line or sent. The test of T-472 that reads every printed line and every file outside `keys/` covers the buyer's commands too.
- [ ] `site/buy.mjs` and `site/try.mjs` keep their SHA-256.
- [ ] The red-team pass tries to: spend above a limit through the command; make the command print or send a key; make it call the faucet before `first-deal`. Each fails, or the finding and its fix are in Evidence.

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

Not started. Starts after T-472 merges, because both change the bundle `site/setup.mjs` and its pinned hash.
