# T-443: Crow's signer, the selling half

- **Lane:** demo (Crow's own agents, build row 5)
- **Phase:** 2
- **Depends on:** T-439 (the signer's buying half), T-438 (the mandate tool); the seller adapter's split into a core and its shells (T-434 of the hosted-sellers lane, PRs 553, 556, 557)
- **Paths this task may touch:** `examples/signer.ts`, `examples/signer-rules.schema.json`, `examples/signer-rules.v1.json`, `examples/signer-test-kit.ts`, `examples/signer-selling*.test.ts`, `examples/seller-adapter-core.ts` (one optional hook), `examples/seller-adapter.ts` (the Node shell's `CROW_SIGNER_URL`), one paragraph in `site/ref/seller-adapter.txt`, this file
- **Human gate:** no (nothing deployed; no real key)
- **Status:** in progress
- **Agent/session:** own-agents build session, on the coordinator's word of 2026-11-14 (Rafa: "any other items we can kick off in parallel?")
- **Roadmap row:** N131

## Intent

Crow's selling agent must not be able to sell in Crow's name outside Crow's template, or deliver twice, whatever it does with its own process. So the selling key moves into the signer, beside the float. The signer signs an offer only when it equals Crow's template (the seller, the payout address, the price, the product and its checks, the reviewers and the fee, the club, the terms and the windows, the dates against its own clock), within its counts (offers an hour, open deals, deals a day), with a live mandate and no stop. It signs one delivery per funded deal, ever: only for a deal it offered, only when its own reads say the deal is funded, only for work that passes the deal's own checks, sealed to the deal's four recipients. The stop and the mandate apply at the offer, never at the delivery, so no stop can stall a buyer's funded deal (design, "Litmus tests", rule 2).

The seller adapter signs through the signer when its shell says so: the core takes an optional `signer` in its `AdapterIO`; the Node shell sets it when `CROW_SIGNER_URL` is set. Left out, as the hosted Worker and the pilot's adapter leave it, `HOLDBACK_KEY` signs exactly as before.

Non-goals: the product (T-444); the machines and their network rule (build row 7); a hosted Worker that uses the signer (the hook is there; no shell of the Worker sets it); any change to `apps/hosted-sellers/`, `agent.ts` or the buyer's pinned tools.

## Where the signer path lives, and why

The core (`seller-adapter-core.ts`) is the one file both shells run, so the hook is there: an optional `AdapterIO.signer`. With it the core builds the offer as `Agent.offerDirect` builds it and the delivery as `Agent.deliver` prepares it, and asks the signer for each signature; its own agent's account refuses to sign anything. `agent.ts` is inside the pinned `site/try.mjs` and `site/buy.mjs`, so the core does not change it. Only the Node shell sets the hook today: Crow's selling agent runs on the agents' machine (design, section 4), and the hosted Worker serves outside sellers. Without the hook the core runs the code it ran before.

## The constraints this build enforces

The attacker in every test is Crow's selling agent: it holds no key and has full control of its own process, so it can send the signer any request. The signer runs as its own process with the selling key in its own environment. Each attack has a control that is signed.

| # | Constraint, version 1 value | Rung | What enforces it | The attack test that fails |
| --- | --- | --- | --- | --- |
| S1 | The selling agent moves 0.00 tUSDC of Crow's money, and holds no key | 1, once the signer runs on its own machine (build row 7) | With `io.signer` the adapter refuses to start with `HOLDBACK_KEY` set; its agent's account refuses every signature; the selling key is in the signer's environment only | `signer-selling-world.test.ts`: the adapter runs with no key and every offer and delivery is the selling key's; the start is refused with `HOLDBACK_KEY` beside a signer |
| S2 | Where a sale pays: Crow's payout address | 3 at the offer, 2 after funding | The signer signs an offer only with `selling.payoutAddress`; the contract then pays only the signed payout address | A12 (`signer-selling.test.ts`); `signer-selling-world.test.ts`: a quote with another payout address makes no offer; the release pays Crow's payout address 5.00 tUSDC |
| S3 | The price: 5.00 tUSDC, fixed; at most the selling mandate's cap | 3 | The signer | A12: 4.999999 and 5.000001 refused |
| S4 | The seller, the product and its checks, the reviewers and the fee, the club and rulebook, the terms, each window exactly, the dates against the signer's clock | 3 | The signer: every field compared; the product as a template in which `{{deal}}` stands for one deal ID, the same everywhere | A12: another seller, each reviewer, the fee, another product text, a check removed, a rubric added, a window of 299 s and of 61 s, a date 120 s behind, another club, two deliveries |
| S5 | 20 offers an hour, 10 open sales, 20 offers a UTC day | 3 | The signer's ledger (`sales`), on its own disk before the signature leaves; an offer asked for again counts once | A12: the 21st offer in an hour, the 11th open sale |
| S6 | One delivery per funded deal, ever, and only work that passes; stopped or not | 3 | The signer: only a deal it offered; only when every read endpoint says Held; attempt 1; the bytes' hash; the agreed format; sealed to the three adjudicators and the buyer, in order; `submittedAt` its own now; the adjudicator's stage 1 (`preflightDelivery`) says accept; recorded before the signature leaves | A15: a second delivery, failing work, an unfunded deal, a read with no answer, a deal never offered, another recipient, a missing recipient, another hash, attempt 2, another format, an old `submittedAt` |
| X2 | No new offer after the stop; an offer signed before can fund for its window (300 s) | 3 | The stop flag, at the offer only | A12: after the stop; control: a funded deal's delivery is signed after the stop and with the selling mandate expired |
| Mandate | A live selling mandate from the pinned principal, seller role, the pinned club and token | 3 | The signer, at the offer only | A12: an expired selling mandate refuses an offer; the start refuses a selling mandate that does not hold |

## Still soft after this build

- **Rung 3 needs the signer's own machine** and the network rule (build row 7), as for the buying half: until then anyone who reaches the signer's port acts as the selling agent, and the tests run both on one machine.
- **The ciphertext is not checked against the plaintext.** The signer checks the plaintext against the deal's checks and its hash, and the delivery's four recipients, but not that the ciphertext holds those bytes or that each recipient's key opens it: it never sees the content key. An adapter that seals other bytes burns the deal's one attempt; the adjudicator then rejects and the buyer is refunded at most (inferred).
- **The funded read trusts the read endpoints** (Crow's two operators, one record on this service): an operator that wrongly says Held lets the signer sign a delivery for an unfunded deal, which no contract then takes (inferred).
- **The product template's one placeholder** binds the deal ID in the deliverable and the checks; whether a buyer named that deal is the buyer's own check.
- **S1's 1 base unit:** the faucet grants the selling key's address 1 base unit with each mandate on the test service. Nothing caps the selling address's balance; it pays nothing out, because the payout address is Crow's treasury.
- **The hosted Worker does not use the signer:** no shell of the Worker sets the hook. A hosted Crow seller would need that wiring and its own review.

## Acceptance criteria

- [ ] With `io.signer` set, the core holds no key (it refuses to start with `HOLDBACK_KEY` set, or with `signingKey: "per-deal"`), and every offer and delivery signature comes from the signer, checked against its selling address before it is sent.
- [ ] Without it, the adapter's existing tests and `apps/hosted-sellers`' tests pass unchanged, and the hosted bundle's SHA-256 for the kit's two seller folders is unchanged.
- [ ] The signer's selling half refuses each A12 attack and each A15 attack, naming the rule, each beside a control that is signed.
- [ ] The selling limits come from the rules file (`selling`, validated against the schema), with `constraints.md` version 1's values.
- [ ] The SHA-256 of `site/buy.mjs` and `site/try.mjs` is unchanged.

## Evidence

## Decisions

- **The hook is in the core, set by the Node shell only.** `agent.ts` is in the pinned buyer bundles, so the core builds the offer and the delivery itself in signer mode, through `Agent`'s public reads and `verify.ts`'s builders, and its agent gets an account that signs nothing.
- **The signer sees the whole terms and the plaintext,** not only typed data: it must compare the product's bodies with the template and run the deal's checks on the work.
- **The stop, the counts and the mandate act at the offer only.** A funded deal's delivery is signed whatever they say (design, rule 2); only a rules file changed on disk refuses it (X4), until a restart.
- **The selling windows are exact** (S4 "equals the template"); the buying windows are maxima (B8).

## Handoff

**Owed before the proof run:** a review by a model of another family of the delivery signature and the offer path (design, "The build, in order"). It needs a key of Rafa's.
