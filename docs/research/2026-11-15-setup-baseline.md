# Setting up Crow today: the baseline

A dated record, 2026-11-15, for T-471 (`docs/tasks/T-471-setup-plan.md`; roadmap row N160). It lists what a new seller and a new buyer must do, from nothing to a first settled test deal, as the docs and code stood at commit `58ef0c7a` on `main`. Its numbers are measurements at that time.

Labels: **measured** (read in the file named, or in a recorded run), **inferred** (from reading, not from a run), **guessed**. Token figures marked "estimated" are bytes divided by 4, rounded up, the guides' own method (`site/guides.mjs`). Nothing was run, deployed or sent for this record; six plain GETs went to crow.direct.

## The state

1. **Neither role needs an account, a sign-up, an API token, an allow-list entry, Sepolia ETH or a person at Crow** (measured: no such gate in `apps/operator/src` or `apps/demo-cloud/src`; `site/ref/http.txt`, "Discover and get test tUSDC").
2. **Both roles need one thing from a Crow-run host before a first deal: a mandate in the demo club.** The operators refuse an offer or an agreement from a key that holds none (`packages/settlement/evm/evm-settlement.ts`, `scopeFor`, 403 `scope_exceeded`). Only Crow's faucet issues one; `POST /v1/agents` and `POST /v1/clubs` answer 501 (`docs/api.md`) (measured).
3. **A buyer's tools ask the faucet inside the first deal. The seller adapter asks at start, before any buyer exists** (`examples/seller-adapter-core.ts`, "no mandate, no start") (measured).
4. **A seller with an API of its own reads about 90 KB, runs 22 command lines and takes 10 actions by a person.** Nothing measures that path (measured for the files and commands; the counts are this record's own).
5. **A buyer has one pinned command that took 1 approval** (measured 2026-11-05, `docs/tasks/T-229-one-click-homepage.md`). A buyer's agent that starts from the docs took 8 to 28 approvals (measured 2026-11-14, `docs/tasks/T-412-benchmark-harness.md`).
6. **No command sets a party up, checks a setup or removes one.** A search of `examples/` for an init, doctor, self-test or conformance command finds none (measured).

## Is it true that the API needs nobody to be set up until their first deal?

**True as a person experiences it, false by one request for a seller.**

- **True:** nothing is registered ahead of time with Crow or anyone. No account, credential, approval, money or person is needed (measured).
- **False for a seller that runs the adapter:** its key must hold a faucet mandate before its first offer, and the adapter takes it when it starts. Crow's operator then knows the address of every seller that starts an adapter, with or without a buyer (measured).
- **Already true with one setting:** `"signingKey": "per-deal"` signs each deal with a fresh key and takes that key's faucet grant when the quote comes in (`site/ref/seller-adapter.txt`, "A fresh key for each deal"). The standing key then asks for nothing (measured in the code; no live run found).
- **The decision and the code differ.** Rafa's answer of 2026-11-14 (D69) makes a signed permission optional in an open club. The code still refuses a key without a mandate, and moving that check waits until after the pilot's first deal (ADR-0038) (measured).

## What must exist before a first deal

| Thing | A seller | A buyer | Does it involve Crow? |
| --- | --- | --- | --- |
| A signing key (and an x25519 key) | Yes | Yes | No. The party makes both on its own machine (`site/ref/http.txt`, "Make your keys") |
| Sepolia ETH | No | No | The operators pay the gas |
| Test tokens | No. The adapter still takes 1 base unit, because the faucet takes no zero amount | Yes: the price and the fees | Crow's faucet mints them. The token is open-mint, so a party with Sepolia ETH can mint without Crow (`contracts/script/TestUSDC.sol`) |
| A mandate in the club | Yes, to offer | Yes, to agree and fund | **Yes.** Only Crow's faucet issues one, signed by the demo club's test principal, a key the demo holds. It lasts 30 days. No person acts |
| Club membership | No separate step | No separate step | The demo club is open; the faucet's mandate is the admission |
| A quote credential or API token | No | Only when a seller sets one on its own quote address | No. For a seller hosted by Crow, a person hands the credential over (`docs/operations.md`) |
| An allow-list entry | No | No | No. Rate limits only |
| Three adjudicators in the terms | Yes; they default to discovery's | The seller names them | **In practice yes:** the defaults are Crow's three, and they decline terms that name another fallback or appeal adjudicator (`site/ref/http.txt`) |
| Terms with checks | Yes | The buyer checks them | No |
| A public address with TLS | Only for the adapter, when an outside buyer asks for a quote | No | No |
| A payout address | No; left out, the signing address is paid | not applicable | No |
| Spending or selling limits | None enforced | None enforced | None from Crow (ADR-0038) |

## A seller today

Four paths exist. All figures are measured unless labelled.

| Path | What it is | State |
| --- | --- | --- |
| a | The seller adapter (`examples/seller-adapter.ts`) on the seller's own host, from `site/sell.txt` and `examples/seller-adapter-service.md` | Documented end to end. The page's own test did not run its live step (`site/sell.txt`, step 9) |
| b | Hosted by Crow (`apps/hosted-sellers`, ADR-0037) | Not open to a stranger: a Worker on Crow's Cloudflare account, on the maintainer's go-ahead |
| c | Plain HTTP (`site/ref/http-seller.txt`, `site/ref/signing.txt`) | Works. The only seller path with measured runs |
| d | The signer's selling half (`examples/signer.ts`, T-443) | Not usable alone: its rules schema requires the buying half |

### Path a, step by step

| Step | The assistant reads | Commands | A person does | Secrets | What leaves the machine |
| --- | --- | --- | --- | --- | --- |
| Read the front door and the seller's page | `llms.txt` and `sell.txt`: 16,622 bytes, 4,156 tokens estimated, 83% of the 5,000-token budget (`https://crow.direct/guide-budget.json`) | 2 fetches | Approves them | none | GET crow.direct: an IP address |
| Clone and build | none | 1 line: clone, `corepack enable`, `pnpm install`, `pnpm build` | Approves; needs git and Node 22.18 or later | none | GitHub and npm: an IP address |
| Rehearse on a local chain | `examples/seller-adapter.config.json` | 6 lines in 3 terminals | nothing | none | nothing |
| Write the terms and checks from sample reports | `fixtures/terms/audit-report.yaml`, `site/ref/checks.txt` (10,166 bytes) | 1 line (`pnpm audit-deal --case all --report --terms`) | Writes the terms | none | nothing |
| Describe the API | `site/ref/seller-adapter.txt` (16,389 bytes), the job-API example, the template (10,815 bytes) | file edits | Maps the quote, start and result calls; writes the scope rules, the template and the windows | none | nothing |
| Make a signing key | `site/ref/http.txt` (8,936 bytes) | a 4-line script; no command is given | Keeps the key | `HOLDBACK_KEY`, made locally | nothing |
| Start on the test service | none | 1 line, with the key on the command line | nothing | `HOLDBACK_KEY` in the environment and in the shell's history (inferred) | Both operators: discovery (an IP address). **`POST /v1/faucet` with the seller's address**, and a mint of 1 base unit on Sepolia |
| Run as a service | `seller-adapter-service.md` (7,459 bytes) and two templates | 5 install lines, 2 copies, 4 `systemctl` lines, 2 files written | A Linux host with root, a DNS record, a payout address, the secrets typed into a root-only file | up to 4 more: quote credentials, the API's key, an alert secret, ready credentials | The certificate request names the hostname |
| Publish the card | `site/ref/intake.txt` (16,775 bytes) | none given | Writes a `crow-agent` block into a page by hand; the shipped Caddyfile answers 404 for it | none | The page is public |
| First deal | (the buyer's side) | the buyer's commands | **A buyer must exist** | the buyer's quote credential, out of band | The full public terms, the delivery's size, time and SHA-256 (`docs/privacy-baseline.md`) |

**Counts for path a** (this record's own count from the files above): 12 files, 90,475 bytes, about 22,619 tokens estimated; 22 command lines and 3 files written by hand; 10 actions by a person; 1 required secret and up to 4 more. No secret reaches Crow or the chat when the steps are followed (inferred).

### Path b: what the pilot's seller needed by hand

Crow built the design partner's seller folder with a private script and hand-written files (measured in the private repository; no name is copied here):

- an adapter configuration written from the partner's API documents and answers;
- terms and five checks written from sample output, rebuilt on 2026-11-15 after real output failed one check;
- a report mapping that removes personal fields;
- a scope pinned to one repository, commit and file list;
- the deploy and the secrets as the maintainer's steps on Crow's Cloudflare account, where **Crow makes and holds the seller's signing key and holds the partner's API key** (`docs/operations.md`, the hosted seller's runbook).

### Path c, measured

Scenario s3 of the benchmark, a seller that starts a deal with Crow's test buyer over plain HTTP: `Released` in 195,471 ms, 11 approvals, 579,928 tokens, USD 0.73, 66 API calls (live, 2026-11-14). It reads 6 guide files, 67,382 bytes, about 16,846 tokens estimated. It needs no hostname, TLS, deploy or login, and it sells a sample file, not the output of an API.

## A buyer today

| Path | What it is | Measured |
| --- | --- | --- |
| a | The one pinned command, `try.mjs`, against Crow's test seller (`site/llms.txt`, "Try it") | 1 approval, 79 s and 106 s to `Released`, about 141,000 tokens a run (2026-11-05, `docs/tasks/T-229-one-click-homepage.md`, `docs/tasks/T-370-revive-metrics.md`). Its keys live in memory, so nothing is kept |
| b | `buy.mjs` against a seller's quote address (`site/buy.txt`) | Not measured: Crow runs no quoting seller for strangers. By design a person approves 3 commands: the install, the quote, the payment |
| c | Plain HTTP (`site/ref/http.txt`, `signing.txt`, `http-buyer.txt`) | Scenarios s1, s2 and s5: 20, 25 and 28 approvals; 1,095,097, 1,918,005 and 3,581,026 tokens (2026-11-14) |
| d | A signer with a rules file (`examples/signer.ts`, `examples/own-buyer.ts`) | Never run live. It needs the repository, a build, three keys, a mandate signed in a wallet and a rules file written by hand |

**What a buyer's first deal sends** (path a, measured in `examples/try.ts`):

1. GET `llms.txt`, then npm and `try.mjs`: an IP address.
2. GET discovery on both operators: an IP address.
3. **`POST /v1/faucet` with the buyer's address:** the first request that names the buyer. It makes two public facts: a mint to the address, and a mandate at `GET /v1/agents/<address>` with its issue time.
4. A sealed proposal to the test seller, then the agreement and the funding: from the offer on, the whole terms are public (`docs/privacy-baseline.md`).

**No hard spending limit binds a buyer's agent on paths a to c.** The most it pays is an argument the agent passes. The faucet's mandate allows 1,000,000,000 tUSDC a deal, and on the test service the faucet mints a deal's total to any payment address, so no balance bounds spending either. The built hard limits are a person's own wallet (`CROW_PAYMENT_ADDRESS`: nothing funds until the wallet signs) and the signer of path d (measured).

## The benchmark's numbers

Six live runs, 2026-11-14, each a fresh Claude Code on `claude-opus-5-5` at medium effort, given one sentence and `https://crow.direct/llms.txt`, on Sepolia (`tools/one-click/bench.mjs`; `docs/tasks/T-412-benchmark-harness.md`) (measured).

| Run | Role | Ends | Approvals | Tokens | Time without the user | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| s1 | buyer | Released | 20 | 1,095,097 | 4 min 17 s | USD 1.06 |
| s2 | buyer | Released | 25 | 1,918,005 | 5 min 25 s | USD 1.29 |
| s3 | seller | Released | 11 | 579,928 | 3 min 15 s | USD 0.73 |
| s4 | buyer | Refunded | 8 | 353,945 | 1 min 38 s | USD 0.30 |
| s5 | buyer | Refunded by reclaim | 28 | 3,581,026 | 14 min 46 s | USD 1.83 |
| s6 | seller | Released | 10 | 680,590 | 3 min 21 s | USD 0.73 |

- **The headline is the median of all six: 11 approvals, 680,590 tokens, 3 min 21 s, against a target of 1 approval.** Its median records are the two seller runs. The four buyer runs alone give 20 approvals, 1,095,097 tokens and 4 min 17 s (inferred: computed here from the measured records with the summary's own median rule).
- **Reading costs most of the approvals.** Of 103 permission requests in the six runs, 47 fetched or read the docs (measured, T-412).
- **The harness cannot see a setup today.** Its only success is a commitment that ends `Released` or `Refunded`. Its network fence allows Crow's, npm's and Sepolia's hosts only, so a deploy on a party's own account cannot run inside it. It answers every question "yes", so a question such as "what is the most I may pay?" gets no real answer (measured in `tools/one-click/bench-live.mjs`).

## What the design must close

1. One file for the assistant, in place of 12 files and about 22,600 tokens for a seller.
2. One command that makes the key, writes the files and checks them, in place of 22 command lines and 3 hand-written files.
3. No request that names the party before its first deal: the adapter's start-up faucet call is the one that does today.
4. Terms checked against several real results before any offer: the pilot's checks failed real output after they passed one sample.
5. A key that is never on a command line or in the chat.
6. A first deal for a seller with no second person: the adapter's default windows and the stub's price do not fit the test buyer's published rules (604,800 s against 86,400 s; 500 tUSD against 50 tUSDC) (inferred from `examples/seller-adapter-core.ts` and `site/ref/intake.txt`), and no stand-in API prices in the Sepolia token.
7. A measure: no scenario starts the adapter or sets a party up.
8. A way out: nothing removes a setup or says what stays behind.

Two limits are not this plan's to close, and the design states them: a first deal on the live service needs Crow's faucet mandate and, by default, Crow's three adjudicators; and the offer and the agreement pass through an operator, both of which Crow runs today.
