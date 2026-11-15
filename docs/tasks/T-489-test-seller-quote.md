# T-489: Crow's test seller answers a quote

- **Lane:** demo (Crow's test agents in `apps/test-agents/`, the buyer's guide in `site/`, the benchmark in `tools/one-click/`)
- **Phase:** 2
- **Depends on:** T-222 (the test seller), T-472 (the sample product, `examples/setup-sample-api.ts`)
- **Paths this task may touch:**
  - The seller: `apps/test-agents/src/seller.ts`, `apps/test-agents/src/catalog.ts`, `apps/test-agents/src/quote.ts` (new), `apps/test-agents/src/quote.test.ts` (new), `apps/test-agents/src/seller.test.ts` (one expectation at most).
  - The guides: `site/buy.txt`, `site/check.mjs` and `tests/site-guides.test.ts` only where a budget or an expectation names the changed step.
  - The benchmark: `tools/one-click/scenarios.mjs`, `tools/one-click/scripted/buy-by-quote.ts` (new), `tools/one-click/README.md`, `scripts/metrics/schemas/one-click.schema.json` (the scenario ID patterns), `scripts/metrics/one-click-summary.mjs` (the deal scenarios' list), `tests/metrics/one-click-bench.test.ts`.
  - The records: the test seller's line in `docs/operations.md`, this file.
  - It changes nothing under `apps/hosted-sellers/`, `packages/`, `contracts/src/` or `spec/schemas/`, neither `examples/seller-adapter-core.ts` nor `examples/seller-adapter-api.ts`, and no pinned bundle (`site/buy.mjs`, `site/try.mjs`, `site/setup.mjs`).
- **Human gate:** yes, for the two deploys, both Rafa's: the Worker `crow-test-agents` first, then the site. The site deploy that publishes the new `buy.txt` waits until the pilot's second buyer has funded its deal. The merge has no gate.
- **Status:** in progress
- **Agent/session:** a build session started by the coordinator, 2026-11-15, branch `t-489-test-seller-quote`.
- **Roadmap row:** N163
- **Change kind:** 4 is the nearest recipe (a live test service's code), with 1 (an agent guide in `site/`). The brief adds one `reviewer` pass and one `red-teamer` pass on the quote address and its limits, since it touches funds and limits.

## Intent

Restated in my own words.

A buyer's agent that reads only `buy.txt` today finds no one to buy from: the guide expects a seller with a quote address, and the only seller Crow runs for strangers takes sealed proposals. In the benchmark of 2026-11-14 every buyer agent left the guide. This task gives Crow's test seller a quote address of the shape the guide expects, beside its proposal intake. An agent that follows `buy.txt` step by step, with the pinned `buy.mjs` and no credential, then gets a quote, funds it, receives the work and sees the deal Released. The guide's step 2 says where to find that seller.

Non-goals: a seller of the party's own (setup's work), any change to the hosted sellers or the adapter's core, sealed terms, a judged product.

## Design

**Choice: a quote route inside Crow's test seller (`POST <base>/quote`, `GET <base>/defaults`), selling the setup's sample product from the seller's one standing address.** Why, in five lines:

1. The test seller already holds what the route needs: a standing key with one mandate, caps on open deals and on offers per hour, per day and per client, delivery within seconds, and its storage and alarm. The route adds a way in, not a second seller.
2. A standing key needs no faucet grant per quote: the seller's mandate comes from the faucet once a month (`ensureMandate`). So open quoting spends none of the day's 600 mints, and the faucet's 503 path (friction item 3) does not arise.
3. Candidate (a), the adapter's core in the test seller's object, needs a job API it can reach over HTTP and a second key and journal beside the seller's; candidate (b), one more hosted seller, needs a new Worker, a secret only Rafa can set, and a public sample API. Both are larger and deploy more.
4. The sample product (`examples/setup-sample-api.ts`, imported unchanged) is small, fixed and decided by three deterministic checks: no judge call. Its scope, `{"rows": <3 to 50>}`, makes the guide's "scope as JSON" step real, and its price is 1 tUSDC.
5. Nothing frozen changes: the hosted sellers, the adapter's core and API, `packages/`, the contracts, the schemas and every pinned bundle stay as they are.

**The route.** `POST <base>/quote` takes the body `buy.mjs` sends, `{buyer, buyerEncryptionPublicKey, buyerPaymentAddress?, scope}`, with an `Idempotency-Key`. It checks the body, then the caps, then makes the offer on Crow in the same request, as the seller's alarm makes an intake offer, and answers `{commitmentId, price, fees, expiresAt}`. The same key with the same body replays the answer; with another body it answers 409. `GET <base>/defaults` serves the sample's template with its placeholders, its windows and its scope rule, in the adapter's `/defaults` shape, so `buy.mjs` names every way an offer differs. Every refusal is `{type, detail}`, and the detail names the next step. The deal then runs through the seller's existing steps: delivery once every operator shows Held, then the outcome.

**The card.** The seller's card keeps its four named offers first (`try.mjs` reads `offers[0]`) and lists a fifth, `squares`, with `"pricing": {"kind": "quoted", "quote": ..., "defaults": ...}`, which `card.schema.json` takes.

**Limits** (named values in `catalog.ts`; each refusal is 429 with `Retry-After` and the seconds in its detail):

| Name | Value | Why |
| --- | --- | --- |
| `LIMITS.open` (existing) | 10 deals in progress at once, intake and quotes together | bounds the work and the relayer's gas in flight |
| `LIMITS.perHour`, `LIMITS.perDay` (existing) | 20 offers an hour, 100 a UTC day, intake and quotes together | the seller's existing budget; a quote is one offer |
| `LIMITS.perClientPerHour`, `perClientPerDay` (existing) | 3 requests an hour, 10 a UTC day per IP address (an IPv6 /64), intake and quotes together | one stranger cannot take the shared caps; a body the route refuses with 400 counts nothing |
| `QUOTE_LIMITS.waiting` (new) | 5 offers by quote unfunded at once | an unfunded quote holds an open slot until its funding window closes; quotes can never take more than half the open slots, so the intake and the front door's "Try it" keep working |
| `QUOTE_TIMING` (new) | 600 s to agree, 900 s to fund, 3,600 s to deliver | the setup's windows, which Crow's test buyer also takes; an unfunded quote frees its slot within 15 minutes |
| `QUOTE_LIMITS.bodyBytes` (new) | 4,096 bytes | a quote body is about 300 bytes; the route reads no more |

**The faucet.** A quote costs no faucet grant. The buyer's approve run takes its own grant (its tokens and its mandate) under the faucet's own limits for that buyer's address and client, as every buyer of `buy.txt` does now.

## Acceptance criteria

- [ ] A buyer that runs the pinned `site/buy.mjs` unchanged, with no credential, completes quote, approval stop, approve and funding, delivery, Released against the test seller's quote route in the in-process world (a test in CI).
- [ ] The same path, once, on Sepolia against a test seller run on this machine, if that needs no deploy; otherwise the report says what only the deployed Worker proves.
- [ ] Every refusal answers `{type, detail}` with the next step; caps answer 429 with `Retry-After`; a repeated key replays, another body gets 409 (tests).
- [ ] The card passes `site/card.schema.json` (test).
- [ ] `buy.txt` step 2 names the seller; `node site/build.mjs && node site/check.mjs` passes with the buyer's path inside its budget.
- [ ] A benchmark scenario plays this path in CI without the network; the live command is in the handoff.
- [ ] The pinned bundles keep their hashes; no frozen path changes.

## Out of scope

- A refund or silent ending by quote: the intake's named offers cover those endings.
- Raising the faucet's daily mints (friction item 3), the test buyer's limits (item 4).

## Evidence

Fill this in before review. Label each item measured, inferred or guessed.

## Decisions

- No D number: the route adds a way in to a test service and uses the quote and defaults shapes `buy.mjs` already reads. It changes no interface of the API, no schema and no defense.

## Handoff

Not yet.
