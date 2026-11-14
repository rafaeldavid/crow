# T-443: Crow's signer, the selling half

- **Lane:** demo (Crow's own agents, build row 5)
- **Phase:** 2
- **Depends on:** T-439 (the signer's buying half), T-438 (the mandate tool); the seller adapter's split into a core and its shells (T-434 of the hosted-sellers lane, PRs 553, 556, 557)
- **Paths this task may touch:** `examples/signer.ts`, `examples/signer-rules.schema.json`, `examples/signer-rules.v1.json`, `examples/signer-test-kit.ts`, `examples/signer-world-kit.ts` (one line: buying rules leave the selling half out), `examples/signer.test.ts` (the environment test names the selling key), `examples/signer-selling*.test.ts`, `examples/seller-adapter-core.ts` (one optional hook), `examples/seller-adapter.ts` (the Node shell's `CROW_SIGNER_URL`), one paragraph in `site/ref/seller-adapter.txt`, this file
- **Human gate:** no (nothing deployed; no real key)
- **Status:** review
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
| S6 | One delivery per funded deal, ever, and only work that passes; stopped or not | 3 | The signer: only a deal it offered; only when one read endpoint says Held and none says another state; exactly the Delivery its fields give under the pinned types, each key sealed now with no unlock; attempt 1; the bytes' hash; the agreed format; sealed to the three adjudicators and the buyer, in order; `submittedAt` its own now; the adjudicator's stage 1 (`preflightDelivery`) says accept; recorded before the signature leaves | A15: a second, different delivery (the same one again gets the same signature), failing work, the caller's own types, an unlock, another scheme, an unfunded deal, a read with no answer, a deal never offered, another recipient, a missing recipient, another hash, attempt 2, another format, an old `submittedAt` |
| X2 | No new offer after the stop; an offer signed before can fund for its window (300 s) | 3 | The stop flag, at the offer only | A12: after the stop; control: a funded deal's delivery is signed after the stop and with the selling mandate expired |
| Mandate | A live selling mandate from the pinned principal, seller role, the pinned club and token | 3 | The signer, at the offer only | A12: an expired selling mandate refuses an offer; the start refuses a selling mandate that does not hold |

## Still soft after this build

- **Rung 3 needs the signer's own machine** and the network rule (build row 7), as for the buying half: until then anyone who reaches the signer's port acts as the selling agent, and the tests run both on one machine.
- **The ciphertext is not checked against the plaintext.** The signer checks the plaintext against the deal's checks and its hash, and the delivery's four recipients, but not that the ciphertext holds those bytes or that each recipient's key opens it: it never sees the content key. An adapter that seals other bytes burns the deal's one attempt; the adjudicator then rejects and the buyer is refunded at most (inferred).
- **The funded read trusts the read endpoints** (Crow's two operators, one record on this service). One read that says Held, with none saying another state, is enough, so an operator offline does not stall a funded deal's delivery. The other side: one operator that wrongly says Held, while the others do not answer, gets a delivery signed for an unfunded deal. No contract takes that delivery, and the adapter keeps it and sends it again when the deal is funded, as long as its `submittedAt` is still accepted then (inferred).
- **One request waits for the one before it.** The signer decides one request at a time. Its reads of open deals now run all at once, so one request takes at most about one read timeout, 5 s (inferred), well inside the adapter's 60 s.
- **The product template's one placeholder** binds the deal ID in the deliverable and the checks; whether a buyer named that deal is the buyer's own check.
- **S1's 1 base unit:** the faucet grants the selling key's address 1 base unit with each mandate on the test service. Nothing caps the selling address's balance; it pays nothing out, because the payout address is Crow's treasury.
- **The hosted Worker does not use the signer:** no shell of the Worker sets the hook. A hosted Crow seller would need that wiring and its own review.

## Acceptance criteria

- [x] With `io.signer` set, the core holds no key (it refuses to start with `HOLDBACK_KEY` set, or with `signingKey: "per-deal"`), and every offer and delivery signature comes from the signer, checked against its selling address before it is sent.
- [x] Without it, the adapter's existing tests and `apps/hosted-sellers`' tests pass unchanged, and the hosted bundle's SHA-256 for the kit's two seller folders is unchanged.
- [x] The signer's selling half refuses each A12 attack and each A15 attack, naming the rule, each beside a control that is signed.
- [x] The selling limits come from the rules file (`selling`, validated against the schema), with `constraints.md` version 1's values.
- [x] The SHA-256 of `site/buy.mjs` and `site/try.mjs` is unchanged.

## Evidence

All measured on 2026-11-14 in `.worktrees/holdback-T-443`, branch `t-443-signer-selling`, unless labelled.

- `npx vitest run examples/seller-adapter apps/hosted-sellers examples/signer examples/own-buyer examples/mandate.test.ts tests/site-guides.test.ts tests/ci-gated.test.ts`: 19 files, 266 tests passed. They include:
  - `signer-selling.test.ts`: 13, the A12 and A15 attacks and the review's findings, each with a control;
  - `signer-selling-world.test.ts`: 5, against the demo world:
    - the adapter holds no key and sells to a buyer that is not Crow's; the release pays Crow's payout address 5.00 tUSDC;
    - a refused quote makes no offer;
    - a signer that lies with another key's signature gets nothing sent;
    - a delivery whose send fails is sent again, the same body, and the deal releases;
    - the start is refused beside `HOLDBACK_KEY` or with per-deal keys;
  - the seller adapter's own tests and `apps/hosted-sellers`' 31, unchanged.
- **Each attack test fails without its constraint.** `reports/scratch/own-agents/mutate-selling.sh` disabled 24 checks of the selling half one at a time. Each made at least one of `signer-selling.test.ts`'s tests fail; with none disabled, 7 of 7 passed. That sweep ran before the review's fixes. After them, the resend fix was taken out once: its world test failed, and with it back the test passes.
- `pnpm typecheck`: 0 errors. `npx eslint examples/ apps/hosted-sellers`: 0 problems. `node site/build.mjs && node site/check.mjs`: PASS.
- The hosted bundle's SHA-256 for the kit's two seller folders, from copies of them (`reports/scratch/own-agents/bundle-hash.ts`), before (`main` at `a1a4fa67`) and after: pilot-scan-1 `301df04c27e6162b99c5170c47e8a4adf1b490dafad635a2e2f358bc39a59fd9`, pilot-scan-2 `ab20eea9a137faacd2c2a4fda51ee1d1dc66ddc4c4102f88907cadd001ba6c67`. Unchanged. The Worker's own script changes, since it bundles the core; its behaviour does not (no shell of it sets the hook).
- `site/buy.mjs` `e74ff2230f0d4fd426525095731e42d50b65b55ab7792a43cab73c302b22eb88` and `site/try.mjs` `04ef4434fb4b5635bb3c49df69c7547f3200c6c41f903237ee37098be23f75c8`: unchanged.

### Reviews (PR 575)

The `reviewer` agent and the `red-teamer` agent read `CLAUDE.md`, ADR-0038, `docs/neutrality.md`, the design and the diff. The red team got no offer signed outside Crow's template, no second or failing delivery, and no other message signed. Its one goal that broke was stalling a funded deal. Verdicts: ISSUES, no Critical or High finding.

| Finding | Severity | What changed |
| --- | --- | --- |
| Both: a delivery could not be asked for twice, so one lost answer or failed send ended a funded deal | Medium | The signer answers the same delivery with the same signature; the adapter keeps the signed body and sends it again (tested with a failed send) |
| Red team: any one read endpoint offline stopped every delivery | Medium | One read saying Held and none saying another state is enough |
| Red team: a slow read endpoint held up every request behind it | Medium | The reads of open deals run all at once; the adapter waits up to 60 s |
| Review: a product with a rubric could be sold but never delivered | Medium | The start and `check-rules` refuse such a product |
| Both: a report above about 190 KB could not pass through the signer | Medium | The body cap is 2 MiB; a 600 KB report passes (tested) |
| Both: the selling key signed a digest of the caller's own types; an `unlock` or another scheme was signed | Low | The signer rebuilds the Delivery under the pinned types and signs only that digest; keys must be sealed now |
| Red team: memory and disk could disagree after a failed ledger write | Low | The ledger goes to disk first, then into memory, in both halves |
| Red team: the status hid an expired selling mandate | Info | `selling.state` |
| Review: claims with no attack test (the adapter's signature check, the start refusals, the selling mandate's role) | Low | Tested |
| Review: S4 refusals without a reason, an order-dependent world test | Low | Reasons asserted; the world test counts before and after |
| Review: S5 counts offers; the sales' clock skew was the buying side's | Low | Stated under Decisions; the selling side's skew is used |
| Review: an open deal another key offered would hang after a switch to the signer | Low | The adapter refuses to start in signer mode with such a deal open |
| Review: the reference line and a comment said more than holds today | Low | Reworded: the signer is meant to run on its own machine; its stop refuses offers only |

## Decisions

- **The hook is in the core, set by the Node shell only.** `agent.ts` is in the pinned buyer bundles, so the core builds the offer and the delivery itself in signer mode, through `Agent`'s public reads and `verify.ts`'s builders, and its agent gets an account that signs nothing.
- **The signer sees the whole terms and the plaintext,** not only typed data: it must compare the product's bodies with the template and run the deal's checks on the work.
- **The stop, the counts and the mandate act at the offer only.** A funded deal's delivery is signed whatever they say (design, rule 2); only a rules file changed on disk refuses it (X4), until a restart.
- **The selling windows are exact** (S4 "equals the template"); the buying windows are maxima (B8).
- **S5 counts offers signed, not deals funded:** the stricter reading of "20 deals a UTC day". Quotes alone can use up the day, the hour and the open sales, for about `fundBy` plus `reads.lagSec` plus `clockSkewSec` after the last one (about 16 min at version 1's values).
- **A delivery is idempotent at the signer and at the adapter:** the signer returns the same signature for the same delivery, and the adapter keeps the signed body in its journal (`signedDelivery`) and sends it again after a failed send.

## Handoff

Done: the selling half, the adapter's hook and the Node shell's `CROW_SIGNER_URL`, the attack tests and the reference line. The site needs a deploy for the line in `site/ref/seller-adapter.txt`.

Not done: a hosted Worker that uses the signer (the hook is there; the Worker's shell does not set it); the machines (build row 7).

**Owed before the proof run:** a review by a model of another family of the delivery signature and the offer path (design, "The build, in order"). It needs a key of Rafa's.
