# T-552: the seller's step that publishes a standing offer

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-551, and T-543 (selling work from a template with the setup command), whose files this task builds on
- **Paths this task may touch:** the setup command's files once T-543 has merged (`examples/setup*.ts`, `site/setup.txt`, `site/sell.txt`), and their tests; this file.
- **Human gate:** no. The site deploy waits for Rafa.
- **Status:** in review
- **Agent/session:** a session started by the journeys session, 2026-11-25; branch `t-552-publish-standing-offer`
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

Built on `origin/main` `4f8aacf8`, which holds N216 (PR 783, the first take deploys the seller contract), so the done-when ran against an undeployed contract, not a deployed stand-in.

- **The done-when** [measured, `examples/setup-publish.test.ts`, anvil, through the committed `site/setup.mjs` and `site/take.mjs`]: a seller folder made with `seller --template --file` publishes a template and a card entry; the seller's key and its contract address hold 0 wei before and after; the contract has no code after `publish`; a buyer's `take.mjs` reads the card from a page on this machine, stops for the yes (exit 3), and its approve line ends `Released` with the CSV; the contract has code after that first take.
- **Criterion 1, no ETH and nothing extra sent** [measured]: `publish` without `--expect` and `--preview` send no POST; `publish --expect` sends `POST /v1/ciphertext` and `POST /v1/faucet` only, after it writes `first-deal.started`. The faucet request names the contract's address and the folder's holding address.
- **Criterion 2, the example equals `termsOf`** [measured]: the deployed contract's `commitmentId(termsOf(template, fill))` equals the `exampleId` publish printed, for the same placeholder fill; seller, buyer and payout fields compared too. The example signed equals the example shown, but for its dates and nonce.
- **Criterion 3, a fixed file** [measured]: the ciphertext is stored once on operator 1, read back by its hash, and the standing delivery is in the signed template; the buyer posts it and opens the file.
- **Criterion 4, the guide** [measured, `site/check.mjs` PASS]: `site/sell.txt` "Standing offers" says a standing seller is one address across its takes and how to revoke. `site/setup.txt` publishes at 9,996 of 10,000 bytes; the seller's first-deal path is 4,920 of 5,000 tokens (bytes divided by four).
- **Work after funding** [measured]: a folder without `--file` publishes; a take funded with `--stop-after-funding` is listed by `deliver` under the contract (exit 4, the work's path), delivered once the work is there (exit 0), not delivered twice, and `take.mjs resume` ends `Released` with the file.
- **Revocation** [measured]: `--revoke` prints the signed `revoke`, which an unrelated anvil account sends; `revoked(templateHash)` is then true. Before any take it prints the deployment first; deployment then revocation end the template. `--replace` leaves one card entry, which `take.mjs` takes.
- **Pinned files** [measured, `shasum -a 256`]: `site/take.mjs` `01a171a2…5984`, `site/buy.mjs` `b87e478b…02ee`, `site/try.mjs` `71634a90…dfa3`, the same before and after. `site/setup.mjs` moved from `e422f778…c09d630` to `b38dbf9d…3ed3e98` and grew from 2,437,507 to about 2,546,000 bytes.
- **Local checks for kinds 4 and 1** [measured]: `vitest run` on the setup files, `examples/take.test.ts` and `apps/test-agents/src/setup*.test.ts`: every file passed; `tsc -p examples` and `eslint` on the changed files clean; `node site/build.mjs && node site/check.mjs` PASS. No snapshot ran, so none changed.
- **Not run:** Sepolia. The publish step needs no ETH there, and the first take's deployment gas was measured by N216 (18,295,444 gas by `cast estimate` against Sepolia's own RPC).

## Decisions

- **`publish` writes the first-deal marker before it sends.** D73's rule is that nothing names the party to a Crow-run host before the marker. A standing offer is the folder's first offer, and the contract needs a mandate before any take, so `publish` writes `first-deal.started`, then asks the faucet as each per-deal key's quote does. The request names the contract and the holding address every per-deal grant already names. `setup.txt`'s sentence on what comes before the marker stays true.
- **The folder's signing key is the standing key, at salt 0.** In per-deal mode it signs no deal, so the contract's key path approves only what this step and `deliver` sign.
- **`publish` signs only the template it showed.** Without `--expect` it prints the example and the hash of the template, and exits 3; with that hash it rebuilds and signs only an equal one. The red team showed the operators could change the adjudicators between a preview and a publish.
- **Templates are live by this machine's clock,** which must agree with the operators' within 10 minutes before a signature (red team M2).
- **The default expiry is 30 days, the faucet mandate's length.** `--expires` takes any later time (D31); the command then says the mandate must be renewed, which `publish` run again does.
- **`deliver` signs a take's delivery itself,** with `verifyPrepared` and the key, as the first-take test does: the adapter signs only for the key's own address and its deal keys, and it stays unchanged. A take joins only when its seller signature is exactly a take of the folder's own template and its ID is that template's filled terms.
- **`--deployment <file>`** pins a local chain's deployment, on `--test-world` and chain 31337 only, since the command reads no `HOLDBACK_DEPLOYMENT`.

## Handoff

**Done:** the code, the tests and the two guides, on branch `t-552-publish-standing-offer`.

**For Rafa: the site deploy.** It publishes `site/setup.mjs` (sha256 `b38dbf9d6fb3f3fab7de088fe74a37ac0c5b9dc667343ecaeef78af365ed3e98` at the last build here; the merge's build is the one to read) with `setup.txt` and `sell.txt`. Until then crow.direct serves the earlier setup, which has no `publish`.

**Paths beyond the task's list:** `.github/workflows/ci.yml` (one test path in the anvil world's list, so the done-when runs in CI) and the built `site/setup.mjs`.

**Approvals a seller needs for this step** (crow-private `case-studies/approvals-2026-11-19/definition.md`) [inferred, not measured]: from a finished template folder, 3: the `publish` command, the principal's yes to the example, and `publish --expect`. One more web read when the assistant fetches `sell.txt`. Putting the card on the seller's own site is outside the count.

**For triage, none started:**
- One operator that fails a read stops every take's delivery in that pass, as for any funded deal found by listing; the buyer's refund at `deliverBy` is the bound (review item 7).
- The faucet mandate lasts 30 days, so a fixed-file seller with nothing running must run `publish` again within that time, or takes are refused after it.
- Deleting the folder deletes the key: its templates stay takeable until they expire, and per-take work goes undelivered and refunded. `setup.txt`'s "To stop" line does not say so yet.
- The red team's attack tests are throwaway vitest cases in `reports/scratch/t552-redteam/`; the proposed fixture names are in the PR.

**How to resume:** `pnpm build`, then `node site/build.mjs`; the tests are `examples/setup-publish.test.ts` (anvil) and `examples/setup-deliver.test.ts`.
