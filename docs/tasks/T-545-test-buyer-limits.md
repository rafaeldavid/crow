# T-545: Crow's test buyer pays up to 1,000 tUSDC for work due within 7 days

- **Lane:** demo (`apps/test-agents`)
- **Phase:** 2
- **Depends on:** T-239 (the test buyer)
- **Paths this task may touch:** `apps/test-agents/src/buyer-rules.ts`, `apps/test-agents/src/buyer.ts`, `apps/test-agents/src/buyer.test.ts`, `site/ref/intake.txt` ("Sell to Crow's test buyer"), `site/check.mjs` (its check of that section), comments in `examples/try-sell.ts` and `tools/duet/review.ts` that state the old cap, this file. Not `examples/setup*.ts`, `site/setup.txt`, `site/sell.txt` or `site/setup.mjs` (another session is building there).
- **Human gate:** yes, for the deploy only: the test agents' deploy and the site deploy are Rafa's. Everything before them is in the repository.
- **Status:** review
- **Agent/session:** the T-545 session, started from the `journeys` session, 2026-11-18, branch `t-545-test-buyer-limits`.
- **Roadmap row:** N196
- **Change kind:** 4 (agent code with its tests), with kind 1 for the intake guide's paragraph.

## Intent

Rafa decided on 2026-11-18, in the `journeys` design study (T-532), that Crow's test buyer pays up to 1,000 tUSDC for work due within 7 days ("yes that works"). Until this task it paid up to 50 tUSDC for work due within one day, so it refused most first offers a real seller makes. This task raises the two values. It also sets the counts that bound the buyer, since a deal may now stay open 7 times as long. It makes sure the buyer can still fund the bigger deals from the faucet, and corrects every page and comment that states the old limits.

- **Inputs:** Rafa's two numbers; the faucet's rules (`apps/demo-cloud/src/world.ts`, live discovery `demo.faucet`); the relayer's gas per deal (ADR-0023, the threat model).
- **Outputs:** the new values in `buyer-rules.ts`, on the card and the buyer's page, and in `site/ref/intake.txt`. Tests show that a 1,000 tUSDC deal due in 7 days is taken and funded, and that one base unit or one second more is refused with the rule named.
- **Non-goals:** the adjudication fee cap (reported below, left for Rafa); the setup command and its pages; protocol rules (these are the buyer's own choices as a party, D31).

## Acceptance criteria

- [x] `MAX_PRICE_UNITS` is 1,000 tUSDC (`1000000000` base units) and `WINDOWS.maxDeliverWithinSec` is 604,800 s.
- [x] The test buyer agrees to and funds an offer of 1,000 tUSDC due in 7 days, and a second one within the faucet's hour.
- [x] It refuses 1,000.000001 tUSDC (`accepts.maxPrice`) and 7 days plus one second (`accepts.windows.maxDeliverWithinSec`).
- [x] `open` is raised and the per-seller counts are checked against it; the reasoning is under Decisions.
- [x] The card and the buyer's page state the new limits; `site/ref/intake.txt` matches the code, and `site/check.mjs` compares them.
- [x] Handoff gives Rafa the deploy commands and the checks to run after them.

## Evidence

All measured on 2026-11-18 in the worktree, on branch `t-545-test-buyer-limits` from `origin/main` `21bb4e54`, unless labelled otherwise.

- **The tests first.** With the tests changed and the code not yet changed, `pnpm exec vitest run apps/test-agents/src/buyer.test.ts` failed 4 of 19: the card still said `50000000`, the 1,000 tUSDC offer was refused (422), the boundary check refused exactly 1,000 tUSDC, and the per-seller open cap did not exist.
- **The faucet's hour, found by the test.** With only the limits raised, the 1,000 tUSDC test still failed, on the second deal. Its status read `accepted`, with `retrying: POST /v1/faucet: rate_limited: 0x91c6…8446 was funded in the last 3600 seconds; one grant per address per window`. The buyer asked the faucet for one deal's total (1,001.10 tUSDC with the test world's operator fee), and the faucet grants an address once an hour. At 50 tUSDC a deal, the 1,000 tUSDC default grant covered about 19 deals. At 1,000 tUSDC it covers one, so every second deal in an hour would have waited until its funding window closed. The live faucet has the same rule: discovery on `api.crow.direct` reads `"perAddressEverySec": 3600` and `"maxGrant": 1000000000000` (1,000,000 tUSDC).
- **After the change:** `pnpm exec vitest run apps/test-agents` passed 135 of 135 tests in 10 files. The three new tests passed: the 1,000 tUSDC deal due in 7 days (860 ms), the boundary (259 ms), and the per-seller open cap (617 ms).
- **The world these tests run on** is the operators' own code (`@holdback/demo-cloud`), in process on SimChain, served on two HTTP origins. No anvil chain ran. The same steps on Sepolia are inferred from the same code path, not measured; the check after the deploy (Handoff) measures them.
- **Site:** `node site/build.mjs && node site/check.mjs` passed. Its check 9 reads the price, the windows and the limits from `buyer-rules.ts` and finds each in "Sell to Crow's test buyer". The build left every pinned bundle (`site/*.mjs`) byte for byte unchanged (`git status`). The first-deal paths stay within their budget: buyer 4,855 of 5,000 tokens, seller 4,302 of 5,000 (estimates, bytes divided by four). `tests/site-guides.test.ts`, `tests/card-schema.test.ts` and `examples/setup-bundle.test.ts` passed 52 of 52. The card with the new `limits.perSellerOpen` still passes the card schema.
- **Types and lint:** `pnpm typecheck` exit 0; ESLint on the changed files exit 0.
- **The review** (the `reviewer` agent, one round): PASS, no regression and no Critical or High finding. It reran the test-agents suite (135 of 135) and the site check (PASS). It raised three Low notes, all fixed in the second commit:
  1. The retry hint for `limits.perSellerOpen` said 60 s, though a slot frees only when one of that seller's deals closes. A stuck seller retrying each minute would cost about 6 operator reads a post. The hint is now the soonest one of the seller's deals can close: an unfunded deal's 120 s for the adjudicator, or a funded deal's `deliverBy`.
  2. The day's faucet ask left out the operator fee. It now adds the operator fee at the top price, from the schedule in discovery, read in the same call as `maxGrant`.
  3. No test showed the ask held to the faucet's cap. A new test runs a world whose faucet caps a grant at 2,000 tUSDC: the buyer asks for exactly 2,000 tUSDC and funds a 1,000 tUSDC deal.
- **After the fixes:** `pnpm exec vitest run apps/test-agents` passed 136 of 136 in 10 files; `pnpm typecheck` and ESLint exit 0.

## Decisions

- **The two values are Rafa's:** 1,000 tUSDC and 604,800 s.
- **One faucet grant covers a day's deals at the top price.** When the buyer lacks the funds or a live mandate, it asks the faucet for `perDay × (MAX_PRICE + MAX_ADJUDICATION_FEE + the operator fee at MAX_PRICE)`: 50 × 1,005 = 50,250 tUSDC while the live operator fee is 0. It never asks for less than the deal's own total, and never for more than the faucet's `demo.faucet.maxGrant` as discovery serves it. A refusal there would be final. That is one mint in place of one per deal, so the buyer uses fewer of the faucet's 600 mints a day than before, not more [inferred]. The token is open-mint and worth nothing, so the size of the grant costs nothing. The mint costs the same gas at any amount.
- **`open` goes from 10 to 30, and a new `perSellerOpen` is 5.** The numbers, and why:
  - **Gas is bounded by `perDay`, not by `open`.** A deal costs the relayer about 0.94 million gas to fund (938,547, ADR-0023, measured on Sepolia on 2026-11-03), and about 0.14 million more if the buyer reclaims it (140,019, the threat model). At 50 deals a day that is at most about 54 million gas, 0.054 Sepolia ETH at a 1 gwei tip [inferred]. `perDay` stays at 50, half the operators' 100 funded deals a day per client (`FUNDED_DEALS_PER_CLIENT_PER_DAY`), which the buyer shares with every Worker on Cloudflare's address (threat model, item 8).
  - **`open` bounds the reads and the slots.** Each pass of the buyer reads every open deal once from the first operator that answers. Passes run every 15 s while every deal waits for a far-off delivery, and every 3 s while one is being funded or is within 10 minutes of `deliverBy`. At 30 open deals that is about 120 reads a minute usually and 600 at most, against the operator's 1,200 reads a minute per client, which the buyer shares with the test seller [inferred from the code, not measured]. At 50 open deals the peak would reach 1,000 a minute, too close to the budget. So 30 is the ceiling until the buyer polls each deal on its own schedule (Handoff).
  - **`perSellerOpen` keeps one seller from holding every slot.** With `perSellerPerDay` at 10 and deals open up to 7 days, one seller that never delivered could fill all 30 slots in 3 days and hold them for a week. At 5 a seller, filling the buyer takes at least 6 seller addresses. Ten sellers that each leave one deal undelivered hold 10 slots and leave 20 free. Fresh addresses are free, so this bounds a careless or broken seller, not a determined one, as every per-seller count does. Over the cap, the buyer answers 429 `limits.perSellerOpen` with `retryAfterSec` set to the soonest one of that seller's deals can close, at least 60 s.
  - **`perSellerPerHour` (3), `perSellerPerDay` (10) and the per-client post counts (6 a minute, 60 an hour) stay.** One seller's first deal and a few retries fit within them.
- **The adjudication fee cap stays at 5 tUSDC, for Rafa (the brief's finding).** A default offer passes it: `prepare/offer` takes the primary adjudicator's published minimum when the offer names no fee, and the live Demo Adjudicator A publishes `fee.min` 1 tUSDC (`/v1/adjudicators/0xa909…23ed`, read on 2026-11-18). The seller adapter and the setup command offer that default unless the seller's template names a fee. An offer like the first pilot's, with a 50 tUSDC fee, is refused before anything is funded, with `422` and `rule: accepts.maxAdjudicationFee`. So a real first offer is refused on the fee only when the seller sets its own fee above 5 tUSDC. A pilot buyer that copies its own deal terms would hit it.

## Out of scope

- The adjudication fee cap (above).
- `examples/setup*.ts`, `site/setup.txt`, `site/sell.txt` and `site/setup.mjs`. None of them states the buyer's price, delivery window or counts. `examples/setup-seller.ts` line 34 states the setup command's own windows ("the work due within the hour"), which fit the new limits. `site/setup.txt` line 87 says only that the test buyer "keeps limits of its own". `examples/setup-bundle.test.ts` already reads `WINDOWS.maxDeliverWithinSec` from `buyer-rules.ts` and passed.
- Dated records that quote the old limits: `docs/research/2026-11-15-setup-baseline.md` item 6, `docs/research/2026-11-15-setup-design.md` item 3, and `docs/decisions-today.md`. They record what was true then.

## Handoff

**Done:** the code, its tests, the card and the buyer's page, `site/ref/intake.txt` and its site check, and two code comments. Nothing is deployed.

**Rafa's deploy, after the pull request is merged.** Run it from the main checkout on `main`, clean and up to date with `origin/main`; each script's pre-flight refuses anything else. The test agents first, then the site, which serves the corrected `ref/intake.txt`:

```bash
node apps/test-agents/scripts/deploy.mjs
```

```bash
pnpm site:deploy
```

**The checks after the deploy:**

1. The card states the new limits. This prints `1000000000 604800 30 5`:

```bash
curl -s https://crow.direct/agents/test-buyer/agent.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);console.log(c.accepts.maxPrice.amount,c.accepts.windows.maxDeliverWithinSec,c.limits.open,c.limits.perSellerOpen)})'
```

2. One live deal ends `released` (a live Sepolia run with test tokens: Rafa's call, as in `docs/operations.md`). It sells at the script's own price, inside the old cap, so it checks that nothing broke, not the new top price:

```bash
node apps/test-agents/scripts/sell-to-test-buyer.mjs
```

3. `https://crow.direct/ref/intake.txt`, "Sell to Crow's test buyer", reads "at most 1,000 tUSDC" and "604,800 s (7 days)".

**Not measured:** a 1,000 tUSDC deal due in 7 days on Sepolia. The first case study (a 25 tUSDC dataset, sold through the setup command) does not reach the new top price either. To measure it, run a seller offer of 1,000 tUSDC through `site/ref/intake.txt`'s steps once after the deploy, and record its transactions here.

**Follow-ups, not done here:**

- **Poll each deal on its own schedule.** Today every pass reads every open deal, so the 3 s cadence of one deal being funded makes the buyer read all of them every 3 s. Reading a funded deal far from `deliverBy` only every 15 s would let `open` rise past 30 within the operators' read budget.
- **The adjudication fee cap**, above, is Rafa's to set.
