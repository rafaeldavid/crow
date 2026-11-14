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

## Acceptance criteria

- [ ] With `io.signer` set, the core holds no key (it refuses to start with `HOLDBACK_KEY` set, or with `signingKey: "per-deal"`), and every offer and delivery signature comes from the signer, checked against its selling address before it is sent.
- [ ] Without it, the adapter's existing tests and `apps/hosted-sellers`' tests pass unchanged, and the hosted bundle's SHA-256 for the kit's two seller folders is unchanged.
- [ ] The signer's selling half refuses each A12 attack and each A15 attack, naming the rule, each beside a control that is signed.
- [ ] The selling limits come from the rules file (`selling`, validated against the schema), with `constraints.md` version 1's values.
- [ ] The SHA-256 of `site/buy.mjs` and `site/try.mjs` is unchanged.

## Evidence

## Decisions

## Handoff

**Owed before the proof run:** a review by a model of another family of the delivery signature and the offer path (design, "The build, in order"). It needs a key of Rafa's.
