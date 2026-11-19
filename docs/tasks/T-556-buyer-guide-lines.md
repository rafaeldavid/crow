# T-556: The buyer's and seller's guides say what to check before naming an address

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-423 (the limits page's guidance), T-542 (its spend-controls section)
- **Paths this task may touch:** `site/buy.txt`, `site/sell.txt`, `site/ref/limits.txt`, `site/ref/buyer-signer.txt`, this file
- **Human gate:** no (the site deploy that publishes it waits for Rafa)
- **Status:** review
- **Agent/session:** buyer-guide-lines (local_6b78eea6 started it), 2026-11-19
- **Roadmap row:** N8, N202, N201

## What exists

- `site/ref/buyer-signer.txt`, "Payment from a separate wallet", shows how to make a wallet with Foundry's `cast` and sign the funding. Before this task `buy.txt` linked it only in step 6. The payment address is first needed in step 3.
- `site/ref/limits.txt`, "Spend controls: what to tell your principal" (T-542), says how an owner caps spending. `buy.txt` step 6 cited it, but no line said the two ways in words.
- The same section's last bullet named three of the seller's payout checks: the chain, the minimum and that the address stays open. It did not say that the address is final once signed, or that a payment from a contract may be held for review. No guide said that an exchange balance cannot fund a hold.
- A price of 0: the contract tests (`contracts/test/unit/ZeroPrice.t.sol`, 21 tests, T-345) show what each outcome does. Any decision by the primary, the fallback or the appeal adjudicator, accept or reject, pays the fee to that adjudicator. A missed `deliverBy`, a default, an early accept by the buyer and every mutual settlement return the fee to the buyer. A price of 0 with a fee of 0 cannot be funded (D58 item 6). `docs/what-a-deal-can-do.md` records a price-0 deal that ran to `Released` on Sepolia. `buy.txt` step 4 had no line on it.

## Intent

Five gaps on the agent pages close, inside the token budgets and with no change to a pinned bundle.

1. Where `buy.txt` first needs a payment address (step 3), it links the page that shows how to make the wallet.
2. `buy.txt` step 4 gets one line on a price of 0.
3. `buy.txt` gets the line that roadmap row N8 still owed: the two ways to cap spending, with a link to the limits page.
4. The buyer's and the seller's guides say what a party checks before it names an address. They state requirements only and name no provider.

Non-goals: no change to `setup.txt` (published at 9,999 of its 10,000 bytes), to the plain-HTTP path's files, to the bundles, or to any code.

## Context

- Private repository: `roadmap/triage/2026-11-19-fix-review-deal.md`, items 1 and 2 (a buyer agent working without prior context stumbled twice); `strategy/2026-11-18-card-and-bank-money.md`, part 7.1 task 1 and its two risks.
- Roadmap rows N8 (owner spending guidance), N202 and N201 (the card-and-bank-money follow-ups).
- ADR-0033 (the two money addresses), D58 (a price of 0), `site/guides.mjs` (the budgets).

## Acceptance criteria

- [x] `buy.txt` step 3 links `ref/buyer-signer.txt`, "Payment from a separate wallet", where `CROW_PAYMENT_ADDRESS` first appears.
- [x] `buy.txt` step 4 says a price of 0 is valid, that the buyer pays the fees only, and that any adjudicator's decision keeps the adjudication fee, as the contract tests show.
- [x] `buy.txt` says the two ways an owner caps spending and links `ref/limits.txt`, "Spend controls: what to tell your principal".
- [x] The buyer's guide says that the payment address's key must be held by the principal or its signer, and that an exchange balance cannot fund a hold. The seller's guide says that the payout address is final once signed and points to the checks. The limits page lists them: the token on the deal's chain, the minimum deposit, that the address stays open for the deal's life, and that a payment from a contract may be held for review. No provider is named.
- [x] `node site/build.mjs && node site/check.mjs` pass. No path is over its budget, and every new word on a path is paid for by cuts on that path.
- [x] A cold reader that sees only the built guides lists the payout checks.

## Out of scope

- `setup.txt`: its "Where are you paid?" question would benefit from the same pointer, but it is published at 9,999 of 10,000 bytes.
- The plain-HTTP buyer's path (`ref/http.txt`, `ref/signing.txt`, `ref/http-buyer.txt`): at 9,450 of 9,450 tokens, it has no room for a price-0 line.

## Evidence

- **Commands run** (measured, worktree at `origin/main` d9da8a00 plus this change): `node site/build.mjs && node site/check.mjs` ends `site check PASS`. `pnpm exec vitest run tests/site-guides.test.ts tests/guide-budget.test.ts tests/audit-report-template.test.ts`: 57 of 57 tests pass. `git status` after the build lists only the four `.txt` files, so no bundle or bundle hash changed.
- **Budgets** (measured, as bytes divided by four; no count key was set):

  | Path | Before | After | Limit |
  | --- | --- | --- | --- |
  | Buyer, `llms.txt` + `buy.txt` | 4,888 tokens (19,549 bytes) | 4,881 tokens (19,524 bytes) | 5,000 |
  | Seller, `llms.txt` + `sell.txt` | 4,509 tokens (18,036 bytes) | 4,508 tokens (18,030 bytes) | 5,000 |
  | Plain-HTTP buyer, `llms.txt` + 3 reference pages | 9,450 tokens (37,800 bytes) | 9,450 tokens (37,800 bytes) | 9,450 |

- **The cuts that pay for the new words** (on the same paths):
  - `buy.txt`: one `--help` line in place of three; the seller-facing list in step 3 (step 1 already says what goes where); the fee sentence in step 8 (step 4 now carries it); a step 8 sentence that repeated step 7; the record's field list in step 11; and a duplicated `cast` link in step 6.
  - `sell.txt`: shorter wording in steps 2, 5, 7, 8, 9 and 10, and the record's field list in step 10.
- **Cold check** (measured, 2026-11-19): a fresh subagent read only the published guides, written to a scratch folder by `publishedGuides`. It had no repository and no web. Its answers:
  - Asked what to check before naming a payout address, it listed all four checks: the token on the deal's chain, the minimum deposit, open for the deal's life, and a payment from a contract that may be held for review. It added that the address is final once signed. It opened 3 files: `llms.txt`, `sell.txt` step 9 and `ref/limits.txt`.
  - It found the wallet link at `buy.txt` step 3.
  - It found that an exchange balance cannot fund a hold, in step 3 and on the limits page.
  - It found the price-0 line and the fee rule in step 4.
  - It found the two ways to cap spending, through the rules line.
  - Its notes, none blocking: `sell.txt` points to the checks and does not list them; it is unclear what an escalation is without party appeals; `ref/limits.txt` has two sections on limits that overlap.

### The second pull request: example providers

The first pull request is holdback PR 691, merged as `184b92cb`. Rafa then answered the naming question, 2026-11-19, in the coordinator's thread: "Name requirements and example providers, don't frame as integrated partners or business partners".

- **Where:** `ref/limits.txt`, "Spend controls: what to tell your principal". `buy.txt` and `sell.txt` already point there, so no first-deal path gains a word.
- **Which names:** the routes in the private research `strategy/2026-11-18-card-and-bank-money.md`, parts 1.2, 2.2 and 6.1, that a person can use with no integration. Each one was checked against the research's own source pages on 2026-11-19 (measured):
  - **MoonPay:** its page `moonpay.com/buy/usdc` asks for the buyer's USDC wallet address and names Ethereum. Kept.
  - **Ramp Network:** its page `rampnetwork.com/buy` says crypto goes to the buyer's wallet, with an option to paste an address. Kept.
  - **Kraken:** its deposit page lists USDC on Ethereum and says a deposit below the minimum fails. Its withdrawal-holds page names a hold on some new card purchases. Kept.
  - **Stripe's link:** left out. Stripe's own page says the onramp needs an application and approval, so a person cannot use it with no integration.
  - **Coinbase:** left out. Its pages answered HTTP 403 to automated reads, and the research marks its Coinbase facts as summary only, so neither could verify them.
  - **Converting payout addresses** (the business-payout services in part 2.3): left out. Each is a business integration, not a route a person opens alone.
- **Wording:** each name follows "for example". The page does not say "partner", "integrated", "supported by" or "recommended". It carries no fee figure and no country list. One sentence says that Crow has no agreement with any provider named, does not hold or move the money on those steps, and that availability, fees and limits are each provider's own and change.
- **Budgets** (measured, as bytes divided by four):

  | Path | Before | After | Limit |
  | --- | --- | --- | --- |
  | Buyer | 4,881 tokens | 4,881 tokens | 5,000 |
  | Seller | 4,508 tokens | 4,508 tokens | 5,000 |
  | Plain-HTTP buyer | 9,450 tokens | 9,450 tokens | 9,450 |

## Decisions

- The payout checks are in `ref/limits.txt`, "Spend controls: what to tell your principal", the one section both guides already cite. `sell.txt` step 9 carries one sentence and the pointer, and costs the seller's path nothing net.
- The price-0 line is general: "any adjudicator's decision, accept or reject, keeps the adjudication fee". This holds for every price, so step 8 no longer needs its own fee sentence.

## Handoff

Done when the pull request merges. A site deploy would publish four pages: `buy.txt`, `sell.txt`, `ref/limits.txt` and `ref/buyer-signer.txt`, plus the combined `reference.txt`, which holds every `ref/` page. No bundle changes (`buy.mjs`, `try.mjs` and `setup.mjs` keep their hashes), so no install command changes. Left for later: the same payout pointer in `setup.txt` once it has bytes free, and a price-0 line on the plain-HTTP path once it has tokens free.

The second pull request changes `ref/limits.txt` only, so a deploy would carry `ref/limits.txt` and `reference.txt`. Coinbase and Stripe's link could join the examples once a reader can check their pages, and once Stripe's link works for a person with no application.
