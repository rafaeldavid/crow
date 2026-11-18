# T-515: six lines in the buyer's guide from Crow's own purchase

- **Lane:** site (the agent guides)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 1 (copy): `node site/build.mjs && node site/check.mjs` and the guide tests; no red team, since no code changes
- **Depends on:** nothing
- **Paths this task may touch:** `site/buy.txt`, `site/ref/buyer-signer.txt`, this file. Never `buy.mjs`, `try.mjs`, `setup.mjs` or any other pinned bundle.
- **Human gate:** the site deploy is Rafa's.
- **Status:** done with the merge of this task's pull request
- **Agent/session:** the T-513 simplicity session, 2026-11-18, branch `t-515-buyer-guide-lines`

## Intent

On 2026-11-18 Crow bought a security review for itself through its own buyer agent, a fresh Claude Code agent on a machine of its own, following `buy.txt`. From the first command to the funded hold took 6 min 6 s: 22 commands, 0 failed, and 3 approvals by the principal against a target of 1. Seven of the 22 commands filled gaps in the guide [measured from the agent's transcript]. This task closes those gaps with a sentence each, and changes no code, schema, command or route.

## The six changes

1. **One approval, not three** (`buy.txt` step 1): the install asks for approval only when the principal has not already approved it. The yes that counts stays at the stop, after the agent has shown the offer.
2. **The faucet already funded the wallet** (`buy.txt` step 6): on a test network, the approve run has had the faucet send the total to the payment address. The agent had grepped `buy.mjs` to find this out.
3. **A wallet with no digest display is enough** (`ref/buyer-signer.txt`): `fund` recovers the signature over its own copy of the message and refuses a file changed after it was written, so a wallet that signs the checked file itself needs no digest display. The agent had written a `viem` script to compute the digest, the most code in its run.
4. **Three `cast` lines** (`ref/buyer-signer.txt`): `cast wallet new`, `cast wallet sign --data --from-file`, `cast wallet verify`, as the agent ran them; "any wallet" stays the rule.
5. **What `buy.mjs` sends where** (`buy.txt` step 1): the quote address gets the scope, the address, the public encryption key and any quote credential; the defaults address is read; everything else goes to the named operators; secret keys stay in the key store. "Read it before you run it" stays. The agent had read the file three times to learn this.
6. **Resume outlives the session** (`buy.txt` step 7): closing the agent's session stops `resume`, not the deal.

## Evidence

- **The claims, against the code [inferred from `examples/buyer-signer.ts` on `origin/main`]:**
  - The approve run's faucet call names the payment address and checks that it holds the total.
  - The quote credential is sent only as `Authorization: Bearer` to the quote URL.
  - `fund` recovers each signature over the signer's own message and refuses a file whose digest changed.
- **The `cast` lines [measured, the buyer agent's transcript, 2026-11-18]:** `cast wallet sign --data --from-file` and `cast wallet verify --address … --data --from-file …` ran on the funding file; the verify printed "Validation succeeded".
- **Token budget [measured, `node site/check.mjs`]:** the buyer's first-deal path (`llms.txt` + `buy.txt`) went from 4,612 to 4,769 of 5,000 tokens (bytes divided by four; no key set). The seller's path is unchanged at 4,302.
- **Checks [measured]:**
  - `node site/check.mjs`: PASS.
  - `pnpm exec vitest run tests/site-guides.test.ts tests/guide-budget.test.ts tests/site-bundles.test.ts tests/design-map.test.ts`: 65 of 65 pass.

## Handoff

- **Deploy:** the lines reach crow.direct only with a site deploy (`pnpm site:deploy` from a fresh detached checkout of `origin/main`, `docs/operations.md`), which is Rafa's.
- **Measure after:** the next buyer run, on the same path, counts its approvals and its commands. The target is 1 approval and no command spent reading `buy.mjs` for facts the guide states.
