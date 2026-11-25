# T-551: the buyer's command that takes a standing offer

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-549, T-550
- **Paths this task may touch:** `examples/take.ts` and its test (new), `site/take-entry.mjs` and the built `site/take.mjs` (new), `site/build.mjs` and `site/check.mjs` (the new bundle and its pinned hash), `site/card.schema.json` (an optional `standing` entry), one guide under `site/ref/`, this file. Not `site/buy.mjs`, `site/try.mjs` or the `examples/` files they are built from.
- **Human gate:** no. The site deploy waits for Rafa.
- **Status:** done
- **Agent/session:** the T-551 side session of the journeys session (T-532), 2026-11-24 to 2026-11-25
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

- [x] `site/take.mjs` with its own pinned hash, checked by `site/check.mjs`.
- [x] It refuses a template whose signature is not the key's, and an address that does not follow from the key and the salt.
- [x] It shows the filled terms and stops for the principal's yes before it signs.
- [x] The `standing` entry in `site/card.schema.json`, on an offer whose `id` equals the template's `offerId`, with an example.
- [x] The hashes of `site/buy.mjs` and `site/try.mjs` are unchanged.

**Done when** `site/take.mjs` takes a template from a card on a local chain, funds it, and opens the file after the primary's accept.

## Out of scope

- The seller's side (T-552).

## Evidence

All measured on 2026-11-25 on branch `t-551-take-command`, rebased on `origin/main` at `4825e88b`, unless a line says otherwise.

- **The done-when run** [measured, `examples/take.test.ts`, the anvil case]: the phase-one contracts and test USDC on anvil, the demo world on two origins, and a `HoldbackStandingSeller` deployed through the deterministic deployer at salt 0. The seller's page on 127.0.0.1 carries the card; from then on the seller signs nothing.
  - `node site/take.mjs <card> customers-2 <store> 100000000` exits 3 with the filled terms (public, the price, the standing delivery's hash), and no operator holds the commitment (404).
  - The approve line exits 0: the take is posted, accepted, funded and delivered. The primary accepts, both operators read `Released`, and `<store>/<id>.work` holds the seller's CSV byte for byte.
  - `--stop-after-funding` leaves the take `Held` with no delivery; `resume` then posts the standing delivery, and the take ends `Released` with the file.
  - `attack.standing-ciphertext-missing`: a signed template whose file the store never held is refused before anything is shown.
- **The refusals, offline** [measured, the same file, 9 cases]: a signature by another key, or the key's signature over another template; a salt or an address the key and the salt do not give, a contract elsewhere that signs for its own address included; another chain, rules deployment or token; a field a template does not hold (`disclosure`, a timing field, a buyer field); another offer's `offerId`; a chain other than Sepolia or 31337; a standing file that is not text; two `crow-agent` blocks in a page, or a `data-id`. The pinned creation code equals `contracts/out`. The schema's own example passes the schema, `entryOf` and `checkEntry`.
- **The suite:** 79 of 79 in the affected files after the rebase [measured]. The full suite after the rebase passed 5,750 tests and failed 1 [measured]: `apps/demo-cloud/src/registration.anvil.test.ts`, "the rules redeployment moved", which passes alone and beside `examples/take.test.ts` (13 of 13). Its cause is under Handoff. The full suite before the review fixes passed 5,664 tests and failed 4 [measured]: three registries the new files had to join (CI's gated list, the cut-feature list, the bundle list), now fixed; and `apps/demo-cloud/src/limits.attack.test.ts`, a timing assertion that failed under the suite's load and passes 12 of 12 alone (Handoff). `node site/check.mjs` passes, and lint and typecheck pass on the changed files [measured].
- **The kind's local checks on the final commit** [measured, `/verify`]: `pnpm exec vitest run` on the command's test and the six registry and guide tests passed 79 of 79 in 7 files; `node site/build.mjs && node site/check.mjs` passed, and the build left the tree unchanged. The one snapshot diff: `tests/cut-feature-alignment.known.json` lists `site/take.mjs`, which bundles the core code the list already names for `buy.mjs` and `setup.mjs`.
- **The pinned hashes** [measured, `shasum -a 256` before any change and after `node site/build.mjs` on the rebased branch]:
  - `site/buy.mjs`: `b87e478b1aa9846b67bc5273cb7a26405c90943fdee0d36a7dc1d1a2b38102ee` before and after;
  - `site/try.mjs`: `71634a9021fff0e31bc88b338d942c3e95a46fe698e223b68ba73a09c4fbdfa3` before and after;
  - `site/take.mjs`, new: `01a171a2166c63378b15c0df220607bd380a24ea7ba8ca3e64fbafb497d25984`, 1.9 MB with its packages inside (`setup.mjs` is 2.4 MB).
- **The plain-HTTP buyer's path** [measured, `measureHttpBuyer`]: 9,442 of 9,450 tokens, with `signing.txt`'s signature line fixed ("a key's is 65 bytes") and `take` added to the front door's list of reference parts.
- **Approvals** [inferred from the design, under crow-private `case-studies/approvals-2026-11-19/definition.md`; no live run]: a cold agent with a shell needs 4: the seller's page, `ref/take.txt` (or `reference.txt`), the install-and-show line, and the approve line. The principal's yes is one more, a policy approval counted apart, as the buyer's stop is there. `buy.mjs` needs 6 for a perfect script [measured there, 2026-11-19].
- **Reviews:** one review and one red team, each given `CLAUDE.md`, ADR-0040, the threat model and the related ADRs, not the session's view. Each finding and its fix is under Decisions.

## Decisions

- **One self-contained bundle** with its packages inside, as `setup.mjs` is, so a cold agent installs and shows in one command with no `npm install`.
- **The funded take goes to the pinned buyer signer, unchanged.** `take.ts` writes the checked terms into the key file that `examples/buyer-signer.ts` reads, then calls its `agreeAndFund`, `openDelivery` (watch, reclaim past `deliverBy`, open) and `openDeals`. No file bundled in `buy.mjs` or `try.mjs` changes.
- **Dated 24 s back** (`BLOCK_BACK_SEC`, two 12-second Sepolia slots): live operators report the wall clock, the seller contract refuses a take dated after the newest block, and the newest block lags by up to a slot plus propagation. `site/check.mjs` ties the guide's number to the constant.
- **The card schema's example uses placeholder addresses** for the rules deployment (`0x…aa`) and the token (`0x…bb`), on chain 31337, signed by anvil's public second key. The first version carried a real Sepolia token address that is not Crow's test token (the coordinator's measurement). gitleaks flagged that address twice in commit `3ecc4d03`, as `generic-api-key`. The new form scans clean [measured, `gitleaks dir`]. The two old hits stay in the pull request's range: `3ecc4d03c4438d30e58610a71f3f64c2e6c2ab2e:site/card.schema.json:generic-api-key:155` and `:162` [measured, `gitleaks git` over `origin/main..HEAD`]. They are for Rafa to let through in `.gitleaksignore`; the history is not rewritten.
- **The pinned creation code** lives in `examples/standing-seller-code.ts`, copied from `contracts/out`, with a test that the two are equal.
- **Review and red-team findings, and their fixes:**
  - **High (red team 1):** after funding, the command read one operator's state once and skipped the delivery on a lie, so one operator could turn every standing take into a refund. **Fixed:** the delivery goes to each operator in turn until every operator's events record it. It is recorded as delivered only then. An approve run after funding, or `resume`, posts it again (also review Medium 1, the crash between funding and delivery, and review Low 3).
  - **Medium (red team 3):** a template whose file the store never held passed every check, and the buyer funded a take that could not be delivered. **Fixed:** before showing anything, the command fetches the file from the operator and checks its size and sha256. Tested on anvil.
  - **Medium (red team 2):** the seller's key can deliver another file before the standing one; the checks decide the release (D28). **Reported, not prevented:** the result carries `otherFile: true` and a warning. Delivering in the funding transaction (ADR-0040 §2, Multicall3) would close it (Handoff).
  - **Medium (red team 4):** a seller can name an adjudicator it registered itself. **Advice (D31):** the stop's `notices` names each adjudicator the operators' discovery does not list.
  - **Low:**
    - The card's size cap now stops the read (red team 5, review 8).
    - A page must hold exactly one `id="crow-agent"` block (red team 6).
    - Only Sepolia or a local chain (red team 7: `verify.ts` pins whatever `HOLDBACK_DEPLOYMENT` names; `buy.mjs` keeps that, Handoff).
    - A standing file that is not text is refused before funding (red team 8).
    - The faucet's 429 no longer stops a key that already holds the total (review 4).
    - Unknown fields on the card's entry are left unread, as the schema allows; inside the signed template they are still refused (review 5).
    - The creation-code test skips by name (review 6).
    - The guide's two lines are fixed (review 7).
  - **Review Medium 2:** this Evidence and Handoff.

## Handoff

- **The site deploy is Rafa's.** It publishes `site/take.mjs` (sha256 `01a171a2…5984`) with `ref/take.txt`, the card schema's `standing` entry and the two guide edits. Until then the guide's install line names a file the site does not serve.
- **The first take that deploys the seller contract waits for N216** (T-549's pull request 4), which had no pull request when this task finished. Today the operators refuse a take of a seller contract with no code, and the guide says to deploy it first. When N216 merges, `take.mjs` needs nothing for an operator that deploys before funding. Re-run the anvil case with an undeployed seller then.
- **T-552 can start:** the card's `standing` entry, its example, and the command that takes it are in place. Its publish step should write the entry `entryOf` reads; the schema's example is one, signed by anvil's public second key.
- **Paths beyond the task's list:**
  - `examples/standing-seller-code.ts` (the pinned code);
  - `examples/package.json` and `pnpm-lock.yaml` (`@holdback/core` for examples);
  - `eslint.config.js` (ignores the built bundle, as for the others);
  - `.github/workflows/ci.yml` (one test path in the anvil world's list, so the end-to-end case runs in CI);
  - `tests/site-bundles.test.ts` and `tests/cut-feature-alignment.known.json` (the registries);
  - `site/llms.txt`, `site/ref/signing.txt` and `site/ref/intake.txt` (one word, one clause, one sentence).
- **For triage:**
  - **The front-run file (red team 2):** a later version could deliver in the funding transaction, so the standing file is the deal's.
  - **`buy.mjs` and `verify.ts` pin any `HOLDBACK_DEPLOYMENT`,** mainnet included (red team 7). `take.mjs` refuses it; the pinned files cannot change here.
  - **`limits.attack.test.ts`** ("a known key with another body") failed once under the full suite's load: 10.99 ms against a bound of 9.95 ms. It passes alone. A timing bound that load breaks is a defect to fix in `apps/demo-cloud`.
  - **Two anvil worlds can share one anvil** [inferred, not reproduced]: `freePort` in `packages/settlement/evm/world.ts` closes its probe before anvil binds, so two tests that start together can get one port. The second anvil then fails to bind, and its world uses the first one's chain. A deployment from the shared deployer account then moves the other world's rules address, the error `registration.anvil.test.ts` showed once in the full suite. `examples/take.test.ts` now pays its seller contract's deployment from anvil's sixth dev account, so it leaves the world's deployer and relayer nonces alone.
  - **A live measurement of the approvals,** with the runner of T-584 once it is merged, would replace the inferred 4.
