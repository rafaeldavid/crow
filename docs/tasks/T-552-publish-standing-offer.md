# T-552: the seller's step that publishes a standing offer

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-551, and T-543 (selling work from a template with the setup command), whose files this task builds on
- **Paths this task may touch:** the setup command's files once T-543 has merged (`examples/setup*.ts`, `site/setup.txt`, `site/sell.txt`), and their tests; this file.
- **Human gate:** no. The site deploy waits for Rafa.
- **Status:** todo
- **Agent/session:** none yet
- **Roadmap row:** N196
- **Change kind:** 4, then 1 for the guides.

## What exists

- The setup command makes a seller from a template of terms (T-543); it needs a program that signs each buyer's offer.
- After T-548 to T-551: the seller contract, the off-chain checks, the standing delivery and the buyer's command.

## Intent

Let a seller with no ETH publish a standing offer from the setup command, as ADR-0040 sections 4 and 5 describe: compute its contract's address, build the template, show one filled example, sign the template with its key, prepare a fixed file's standing delivery when there is one, and write the card entry. Crow deploys nothing at this step; the first take deploys the contract.

## Context

ADR-0040 sections 1 (many offers, one seller), 2 (a fixed file's delivery), 4 (deployment), 5 (the seller) and 7 (expiry, revocation, public deals only); D73 and D76 (what the setup sends).

## Acceptance criteria

- [ ] The step needs no ETH and sends nothing that names the seller to a Crow-run host, beyond what D73 and D76 already allow.
- [ ] The filled example it shows equals the contract's `termsOf` for the same fill, tested.
- [ ] For a fixed file, it uploads the ciphertext once and signs the standing delivery inside the template.
- [ ] `site/sell.txt` says a standing seller is one address across its takes, and how to revoke a template.

**Done when** from no ETH a seller publishes a template and a card entry, and a buyer's first take, through `site/take.mjs`, deploys the contract and settles on a local chain.

## Out of scope

- Work that depends on the buyer's input (ADR-0040 section 3): it keeps the per-buyer signer.

## Evidence

## Decisions

## Handoff
