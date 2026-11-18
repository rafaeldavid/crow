# T-489: Crow's test seller answers a quote

- **Lane:** demo (Crow's test agents in `apps/test-agents/`, the buyer's guide in `site/`, the benchmark in `tools/one-click/`)
- **Phase:** 2
- **Depends on:** T-222 (the test seller), T-472 (the sample product, `examples/setup-sample-api.ts`)
- **Paths this task may touch:**
  - The seller: `apps/test-agents/src/seller.ts`, `apps/test-agents/src/catalog.ts`, `apps/test-agents/src/quote.ts` (new), `apps/test-agents/src/quote.test.ts` (new), `apps/test-agents/src/seller.test.ts` (one expectation at most).
  - The guides: `site/buy.txt`, `site/check.mjs` and `tests/site-guides.test.ts` only where a budget or an expectation names the changed step.
  - The benchmark: `tools/one-click/scenarios.mjs`, `tools/one-click/scripted/buy-by-quote.ts` (new), `tools/one-click/README.md`, `scripts/metrics/schemas/one-click.schema.json` (the scenario ID patterns), `scripts/metrics/one-click-summary.mjs` (the deal scenarios' list), `tests/metrics/one-click-bench.test.ts`.
  - The records: the test seller's line in `docs/operations.md`, this file.
  - Two more, which s9 needs once it is a deal scenario (named here, as the reviewer asked): `scripts/metrics/schemas/one-click-summary.schema.json` (an optional `byScenario.s9`) and `tests/metrics/one-click-setup.test.ts` (the deal scenarios' list).
  - It changes nothing under `apps/hosted-sellers/`, `packages/`, `contracts/src/` or `spec/schemas/`, neither `examples/seller-adapter-core.ts` nor `examples/seller-adapter-api.ts`, and no pinned bundle (`site/buy.mjs`, `site/try.mjs`, `site/setup.mjs`).
- **Human gate:** yes, for the two deploys, both Rafa's: the Worker `crow-test-agents` first, then the site. The site deploy that publishes the new `buy.txt` waits until the pilot's second buyer has funded its deal. The merge has no gate.
- **Status:** done (PR 591; deployed 2026-11-16, and a `buy.txt` run against the deployed seller Released on 2026-11-17, in Evidence)
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
| `QUOTE_LIMITS.waiting` (new) | 5 offers by quote waiting to be funded or delivered at once | an unfunded quote holds an open slot until it expires; quotes can never take more than half the open slots |
| `QUOTE_LIMITS.perHour`, `perDay` (new, after the red team) | 10 offers by quote an hour, 50 a UTC day | quotes' own share of the shared 20 and 100, so quotes alone never use up the offers the intake and the front door's "Try it" need |
| `QUOTE_LIMITS.inLine` (new, after the review) | 4 quotes in line at once, at most 1 per client; a client at its own cap is refused before it joins | quotes are answered one at a time; a few seconds each keeps the line inside `buy.mjs`'s 120 s wait |
| `QUOTE_LIMITS.offerWithinSec` (new, after the red team) | 30 s for one quote's reads of the operators | one hung call cannot hold the line; nothing is signed or sent before the reads end |
| `QUOTE_TIMING` (new) | 600 s to agree, 900 s to fund, 3,600 s to deliver | the setup's windows, which Crow's test buyer also takes; an unfunded quote frees its slot about 11 minutes after the offer |
| `QUOTE_LIMITS.bodyBytes` (new) | 4,096 bytes | a quote body is about 300 bytes; the route reads no more |

**The faucet.** A quote costs no faucet grant. The buyer's approve run takes its own grant (its tokens and its mandate) under the faucet's own limits for that buyer's address and client, as every buyer of `buy.txt` does now.

## Acceptance criteria

- [x] A buyer that runs the pinned `site/buy.mjs` unchanged, with no credential, completes quote, approval stop, approve and funding, delivery, Released against the test seller's quote route in the in-process world (a test in CI).
- [x] The same path, once, on Sepolia against a test seller run on this machine (Evidence), and what only the deployed Worker proves.
- [x] Every refusal answers `{type, detail}` with the next step; caps answer 429 with `Retry-After`; a repeated key replays, another body gets 409 (tests).
- [x] The card passes `site/card.schema.json` (`tests/card-schema.test.ts`).
- [x] `buy.txt` step 2 names the seller; `node site/build.mjs && node site/check.mjs` passes with the buyer's path inside its budget.
- [x] A benchmark scenario, s9, plays this path in CI without the network; the live command is in the Handoff.
- [x] The pinned bundles keep their hashes; no frozen path changes.

## Out of scope

- A refund or silent ending by quote: the intake's named offers cover those endings.
- Raising the faucet's daily mints (friction item 3), the test buyer's limits (item 4).

## Evidence

Labels: **[measured]** run here; **[inferred]** read in the code; **[guessed]**.

- **The pinned `buy.mjs`, in the in-process world** [measured]: `apps/test-agents/src/quote.test.ts`, "a buyer that follows buy.txt". It copies `site/buy.mjs` into a folder with only its two packages, runs step 3 (exit 3, `"approval": "needed"`, no term differs from the defaults), then the approve command the stop printed, unchanged (exit 0, `outcome: Released`, the work is the 5-row `squares.csv`). The operator reports Released. No credential is set.
- **One live deal on Sepolia, before any deploy** [measured], 2026-11-15, 14:41 UTC: this branch's test seller ran on this machine at `http://127.0.0.1:<port>/agents/test-seller` against the live operators (`api.crow.direct`, `api2.crow.direct`), with a fresh seed made in memory, so a new standing address `0xea867ea6fa363fdd4b3c6f006ad81e351d2c8386` that took one mandate from the live faucet. The benchmark's s9 script then ran the pinned `buy.mjs` against it. Commitment `0x21cf627e906d3c86ce75c45154387dfae08888d3b7de59a3acf32e76ef2304c4`: quoted at 2,000,000 base units in all (1 tUSDC price, 1 tUSDC adjudication fee, 0 operator fee), no difference from the defaults, funded, delivered, Released; the buyer's run took 75 s. Transactions: funded `0xb43ba0ab51c3715df3a92b0642b5f5ebf3f7bea70a87d6310f8b1e496180d563`, delivered `0x84bffb4669f934cf2b551ee6dbece6259fefdc24735a1d59f75a37d875e25b89`, decided `0x67cb49832867c6706c5212e2902cdecc6beacefcfcb7366cabe741c05b29f0fe`. The runner is `reports/scratch/t-489-live/serve-and-buy.ts`, outside the repository.
- **What only the deployed Worker proves** [inferred]: the route on `crow.direct/agents/test-seller*` reaching the quote path, the Durable Object's storage and alarm, the client IP the Worker sets, the bundle loading `examples/setup-sample-api.ts` (it imports `node:http` and `node:net`; Cloudflare documents both as available with `nodejs_compat` from the Worker's compatibility date 2025-09-15, and the quote path never calls them), and the card at the published `https://` addresses.
- **The benchmark** [measured]: `node tools/one-click/bench.mjs --scenario s9` wrote a valid record, Released, 63 API calls, 1.2 s. `tests/metrics` passes with s9 among the runnable scenarios.
- **The guides** [measured]: `node site/build.mjs && node site/check.mjs` PASS; the buyer's first-deal path is 4,609 of 5,000 tokens. The build leaves `site/buy.mjs`, `site/try.mjs` and `site/setup.mjs` unchanged (`git status` clean for them).
- **Tests** [measured]: `pnpm exec vitest run apps/test-agents tests/card-schema.test.ts tests/metrics tests/site-guides.test.ts` passes; `pnpm typecheck` and `eslint` on the changed files pass.
- **The offer equals the published defaults for every scope** [measured by the reviewer]: `quoteTerms({rows})` against the adapter core's `fill` of the defaults for rows 3 to 50: 0 mismatches.
- **No faucet grant per quote** [measured]: four quotes in a row made at most one faucet call (the standing address's first mandate). The red team counted 1 faucet request across about 55 quotes.

- **`/verify` at `a0071113`** [measured], the kind's local checks: `pnpm exec vitest run apps/test-agents tests/card-schema.test.ts tests/metrics tests/site-guides.test.ts`: 24 files passed, 2 skipped; 424 tests passed, 17 skipped. `node site/build.mjs && node site/check.mjs`: PASS, buyer's path 4,609 of 5,000 tokens, no generated file changed. `pnpm typecheck` and `eslint` on the changed sources: clean. No snapshot step in this kind, so no snapshot diff. The full `pnpm verify` was not run (it is for before a deploy); CI is the gate.

### Reviews

One `reviewer` pass and one `red-teamer` pass, both on commit `50f20b18`, given CLAUDE.md, this file and the code. Neither found a Critical or High issue. Each fix below has a test in `quote.test.ts`; the fixes were not reviewed again (one round, `docs/team.md`).

| Finding | Severity | What changed |
| --- | --- | --- |
| Reviewer 1: Evidence and Handoff empty; two paths outside the list | Medium | filled; the two paths are named above |
| Reviewer 2: a 503's detail did not name its seconds | Medium | every 429 and 503 detail says "Wait N s" |
| Reviewer 3, red team L2: an offer could stand on Crow unrecorded if a read after the submit failed | Medium | every read of the operators happens before the signature; after the submit only storage writes; a lost answer is retried with the same key and then checked on Crow |
| Red team M1: ten addresses could take the day's 100 offers and close the intake until midnight | Medium | quotes have their own share, 10 an hour and 50 a day |
| Red team M2: a client at its cap could fill the line with refusals that counted nothing | Medium | a client at its cap is refused before the line; one place in line per client |
| Reviewer 4, red team L3: one hung operator call held every quote | Low | a line of 4, and a 30 s limit on a quote's reads |
| Reviewer 5, red team L1: intake and quotes together could pass the open cap by one | Low | the intake counts the slot a quote holds while its offer is made |
| Reviewer 6: `waiting` counts funded deals not yet delivered | Low | the detail says "waiting to be funded or delivered" |
| Red team L4: refusals sent buyers to a new directory, and the waiting cap's wait was 900 s for a slot that frees at about 660 s | Low | 429 and 503 say "run buy.mjs again", as `buy.txt` does; the wait counts from `offerExpiresAt` plus 90 s |
| Red team L5: offers to the seller itself or to the zero address | Low | refused with 400 |
| Reviewer 7: idempotency hashes the normalised body (address case, an empty `options`) | Low | kept: the adapter's core does the same |

- **Against the deployed seller, 2026-11-17 [measured]:** the pinned `buy.mjs` from `buy.txt` (SHA-256 `ce610626…1311d`, as published) asked `https://crow.direct/agents/test-seller/quote` for `{"rows":5}`. It stopped with exit status 3 and 0 differences from the defaults, then approved and funded 2 tUSDC (1 price, 1 adjudication fee). The deal was Released at 09:42:48 UTC with the five squares delivered: commitment `0x955924726422d35adf74fc395c0f891547fa3cb4dfb4c7c8659703d060f59508`, decision transaction `0xef8745909fd5dcf57cc092c75857b06b027280c4a79ccc2e09931e09a02f91d7`. The test seller ran crow-test-agents `1adabc54` (deployed 09:39 UTC).

## Decisions

- No D number: the route adds a way in to a test service and uses the quote and defaults shapes `buy.mjs` already reads. It changes no interface of the API, no schema and no defense.

## Handoff

**Done:** the quote address, its limits, the card's quoted offer, `buy.txt` step 2, s9 in the benchmark, the reviews and their fixes. Merged with CI green.

**Waits for Rafa, in this order:**

1. The test agents' Worker, `crow-test-agents`. It publishes `POST /agents/test-seller/quote`, `GET /agents/test-seller/defaults` and the card's fifth offer, `squares`. The old `buy.txt` still says Crow runs no quoting seller, which is only out of date, so this deploy can go first, at any time. Afterwards `https://crow.direct/agents/test-seller/agent.json` lists `squares` with its two addresses, and `/health` reads `operational`. The command: `node apps/test-agents/scripts/deploy.mjs` from the main checkout at `origin/main`.
2. The site, after the pilot's second buyer has funded its deal. It publishes the new `buy.txt` (step 2 names the test seller; step 3 names 503 with 429). The pinned `buy.mjs`, `try.mjs` and `setup.mjs` keep their hashes. Afterwards `https://crow.direct/buy.txt` step 2 names `https://crow.direct/agents/test-seller`. The command: `pnpm site:deploy` from the main checkout at `origin/main`.
3. Then one live check by hand, from any folder: `buy.txt`'s step 3 against `https://crow.direct/agents/test-seller/quote` with the scope `{"rows":5}` and a budget of `5000000`, then the approve command it prints. It ends `Released` in about 75 s, as the run on this branch did.
4. Then the live benchmark run, one at a time: `node tools/one-click/bench.mjs --scenario s9 --live --logs reports/scratch/one-click-bench/logs`, and with `--permissions sandbox-auto`.

**Not done:** a refund or a never-delivered ending by quote (the intake's named offers cover them); a time limit on the submit itself (it uses the seller's existing `submit`, which the intake shares).
