# T-444: Crow's product, the checked deal record

- **Lane:** demo (Crow's own agents, build row 6)
- **Phase:** 2
- **Depends on:** T-443 (the signer's selling half and the adapter's signer hook); `examples/deal-record.ts` (T-333)
- **Paths this task may touch:** `examples/record-seller.ts`, `examples/record-seller.test.ts`, `fixtures/terms/deal-record.yaml`, the `selling.products` of `examples/signer-rules.v1.json`, this file
- **Human gate:** no (nothing deployed; no real key)
- **Status:** review
- **Agent/session:** own-agents build session, on the coordinator's word of 2026-11-14
- **Roadmap row:** N131

## Intent

Crow's selling agent needs something of Crow's own to sell (Rafa's decision 3 of 2026-11-14: "a checked record of any public deal, at a fixed price"). A buyer names a public deal by its ID; Crow sells the record `examples/deal-record.ts` writes for it: the signed terms, each step, the delivery, the judgment and the settlement as every operator serves them, with how each was checked. The product must read only public routes, hold no key and no credential, and use the buyer's input as one deal ID and nothing else.

`examples/record-seller.ts` is the seller's API the adapter calls (quote, start, result). `fixtures/terms/deal-record.yaml` is the product's terms: the deliverable, the checks that bind the record to the deal the buyer named, the price (5.00 tUSDC, `constraints.md` S3) and the windows (S4). The same product goes into the signer's rules (`selling.products`), so Crow's signer signs an offer only when it equals it.

Non-goals: a page for the product on crow.direct (build row 9); a deal record of a private deal (it needs a read token); any change to `deal-record.ts` (it is inside the pinned `site/buy.mjs`).

## The constraints this build adds

| # | Constraint, version 1 value | Rung | What enforces it | The attack test that fails |
| --- | --- | --- | --- | --- |
| S7 | The buyer's input is one deal ID (0x and 64 lowercase hex characters) and nothing else | 3 at the offer; 4 at the quote | The signer's product template: `{{deal}}` is the only free part of the deliverable and the checks, and it must be one deal ID, the same everywhere (T-443, S4). The record seller's own quote check refuses any other field first | `record-seller.test.ts`: another field, another scope field, an option, an uppercase or malformed ID, a path in the ID; A12's product cases |
| S8 | The record delivered is the named deal's, with its terms checked against the ID | 3 | The adjudicator runs the deal's checks: `commitmentId` and `row.commitmentId` equal the named deal, and one check reads `{check: "commitment ID", ok: true}`. The signer runs the same checks before it signs the delivery (S6) | `record-seller.test.ts`: another deal's record, a record whose row names another deal, terms not checked, a commitment ID check missing or not passed, a section of the wrong type |
| S9 | The record seller reads public routes only, with no key, to the configured operators only | 4 | Its guard: GET only, the operators' origins only, no redirect followed, each answer at most 4 MiB. In its own process the guard replaces `fetch`, so `deal-record.ts`'s reads go through it too. It holds no key and reads no variable but `HOLDBACK_OPERATORS` | `record-seller.test.ts`: a POST, another origin, a redirect and a 2 KB answer above a 1 KB cap are refused; every request in the bought deal was a GET; the source names no variable but the operators' list |

## Still soft after this build

- **The guard is the record seller's own (rung 4).** A record seller that is taken over can read anything; it holds nothing to lose, and what it writes still has to pass S8 at the signer and at the adjudicator.
- **The record is Crow's word on what the operators served.** The checks bind the deal and say that the terms were checked; they cannot check the rest of the record against the operators. A buyer who wants that runs `deal-record.ts` itself.
- **The quote trusts the operators to say a deal is public.** One operator that says public, and none that says otherwise, is enough (an operator offline neither confirms nor denies). An operator that lies sells a record of a deal that is not public: the record then holds what the operators serve without a read token, which is not the deal's private content (inferred).
- **The record's public terms name the deal it is about.** Anyone who reads the record deal's terms learns which deal its buyer asked about. A buyer who minds should not buy it.

## Acceptance criteria

- [x] The quote takes exactly `{scope: {deal}}` with a lowercase commitment ID, and refuses anything else, naming it; a deal that is not public on the operators is refused.
- [x] The record seller sends GET requests only, to the operators it is given only, and reads no secret.
- [x] Through the adapter with Crow's signer, a buyer that is not Crow's buys the record of a public deal: the work is that deal's record and passes the deal's checks, the deal releases, and Crow's payout address is paid 5.00 tUSDC.
- [x] The record of another deal fails the checks; the signer's `selling.products` in the version 1 rules equals the terms file's product.
- [x] The SHA-256 of `site/buy.mjs` and `site/try.mjs` is unchanged, and so is the hosted bundle's for the kit's two seller folders.

## Evidence

All measured on 2026-11-14 in `.worktrees/holdback-T-444`, branch `t-444-record-seller` (T-443's branch merged in), unless labelled.

- `npx vitest run examples/record-seller.test.ts examples/signer-selling.test.ts examples/signer-selling-world.test.ts examples/signer.test.ts`: 4 files, 69 tests passed. `record-seller.test.ts` holds 12:
  - the quote's input, the one product definition (the adapter's template and the signer's version 1 product are the terms file's), and no secret;
  - against the demo world: a buyer that is not Crow's buys the record of another seller's public deal through the adapter, with Crow's signer holding the selling key; the work is that deal's record, its `commitment ID` check passed; the deal releases and Crow's payout address holds 5,000,000 base units (5.00 tUSD on SimChain; tUSDC on Sepolia); every request the record seller sent was a GET;
  - S8's cases, each beside a record that passes;
  - a record that quotes U+FE0F, U+200B and an accented letter passes once written as `\uXXXX`, and fails written raw;
  - a quote with anything but a deal ID makes no offer (the signer's count of offers is unchanged);
  - with stand-in operators: one offline and two saying public quotes; one saying private, judgment-level or unknown, or none answering, refuses; the same `Idempotency-Key` with another deal gets 409; a failed job, and one this process never held, runs again on the next poll;
  - the guard's refusals (S9).
- `pnpm typecheck`: 0 errors. `npx eslint examples/record-seller.ts examples/record-seller.test.ts`: 0 problems.
- The hosted bundle's SHA-256 for the kit's two seller folders, from copies of them (`reports/scratch/own-agents/bundle-hash.ts`), before (`main`) and after: pilot-scan-1 `301df04c27e6162b99c5170c47e8a4adf1b490dafad635a2e2f358bc39a59fd9`, pilot-scan-2 `ab20eea9a137faacd2c2a4fda51ee1d1dc66ddc4c4102f88907cadd001ba6c67`. Unchanged.
- `site/buy.mjs` `e74ff2230f0d4fd426525095731e42d50b65b55ab7792a43cab73c302b22eb88` and `site/try.mjs` `04ef4434fb4b5635bb3c49df69c7547f3200c6c41f903237ee37098be23f75c8`: the same as `origin/main`. `examples/deal-record.ts` is unchanged.

### Reviews

The `reviewer` agent and the `red-teamer` agent read `CLAUDE.md`, ADR-0038, `docs/neutrality.md`, the design and the diff at `4cf26bef`. Verdicts: ISSUES, no Critical or High finding. The red team's attack fixture is `reports/scratch/t-444-redteam/record-seller.attack.test.ts`. The fixes below are tested in `record-seller.test.ts`; they were not reviewed again.

| Finding | Severity | What changed |
| --- | --- | --- |
| Both: a deal whose text holds an emoji or a zero-width character got a record that failed its own hidden-character check, so it could never be delivered | Medium | The record's bytes write every character above 0x7E as `\uXXXX`: the same JSON value, no hidden character in the raw text |
| Red team: the checks passed a record whose terms were not the deal's, or that held no terms | Medium | S8: the checks require the deal's ID in `commitmentId` and `row.commitmentId`, a passed `commitment ID` check, and each section an object or null |
| Review: a failed job was never run again, so an outage of every operator cost the buyer the whole 3,600 s window | Medium | A poll of a failed job, or of a job this process never held, starts it again and answers 202. The job's ID names its deal |
| Red team: the same `Idempotency-Key` with another deal returned the first deal's job | Low | 409 |
| Red team: the first operator alone decided the quote; offline, it stopped every sale | Low | Every operator is asked; one public and none otherwise is enough |
| Red team: an operator could redirect the reads elsewhere, or answer without end | Low | S9's guard |
| Both: the deliverable said the record holds no work, but a panel's verdicts can quote it | Low | "no work but what the operators publish" |
| Review: the record said `party: buyer` though Crow reads as an outsider | Low | `party: seller` |
| Review: the task file's Evidence was empty | Medium (process) | Filled in |

## Decisions

- **Crow reads as an outsider.** The record seller writes the record with `party: seller` and no key: it is no party to the deal it records, and the record holds only what the operators publish.
- **The checks bind the deal and the terms check, not the whole record.** Binding every section would refuse an honest record when the operators disagree or one is degraded.
- **Jobs are stateless.** The job's ID names its deal, so after a restart a poll writes the record again; nothing is kept on disk.
- **The guard covers the whole process.** `deal-record.ts` is inside the pinned `site/buy.mjs`, so it cannot take a fetch of its own; the record seller's `serve` replaces the process's `fetch` with the guard instead.

## Handoff

Done: the product's terms, the record seller's API and its guard, the signer's version 1 product, and the tests. Nothing is deployed and no key exists.

Not done: running it against Sepolia with Crow's signer on its own machine (build row 7); a page for the product (build row 9).

**Owed before the proof run:** a review by a model of another family of the delivery path (design, "The build, in order"). It needs a key of Rafa's.
