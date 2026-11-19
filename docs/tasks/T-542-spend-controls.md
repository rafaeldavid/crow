# T-542: Spend controls on the home page and in the limits reference

- **Lane:** no-crypto
- **Roadmap row:** N201
- **Change kind:** 1, copy and agent docs
- **Paths this task may touch:** `site/build.mjs` (the value props), `site/vignettes.mjs` (one comment), `site/index.html` (built), `site/buy.txt`, `site/ref/limits.txt`, this file
- **Human gate:** no (the site deploy after the merge is Rafa's word)
- **Status:** review
- **Agent/session:** `money-path`, Opus 5.5

## Intent

Rafa, 2026-11-19, after the private research on card and bank money (crow-private `strategy/2026-11-18-card-and-bank-money.md`): keep the site simple and change only current pages. Replace the home page's "Your Existing Rails" value prop with a budget value prop, marked coming soon. Give agents the facts to explain spend controls to their principal.

In my words: the owner, not the agent, loads the agent's payment address, and the agent spends only what it holds. That cap works today on the test service. Loading it by card or bank is what is coming. The page names no on-ramp: naming one waits for Rafa's decision 1 in the private research (an adviser on UK financial promotion rules first).

## The title, checked against the research

A desk-research pass on 2026-11-19 read how 16 products name the feature: Stripe Issuing and Link, Coinbase, Visa, Mastercard, Privacy.com, Ramp, Brex, Crossmint, Circle, Privy, Turnkey, Skyfire, Lithic, Google AP2 and Payman.
- "Spend controls" is the umbrella name. Stripe, Link, Ramp, Brex, Privacy, Circle and Marqeta use it [documented, e.g. docs.stripe.com/issuing/agents, ramp.com/blog/ai-agent-spending-controls, brex.com/platform/spend-limits].
- "Spending limits" or "spend limits" names the control itself, used by 10 or more of them.
- "Budget Controls" was found as a heading nowhere. At Brex a budget plans spending and does not decline a payment [documented, brex.com/support/manage-budgets-and-spend-limits].
- Product pages do not use a prepaid card as the analogy for an agent wallet; wallet, budget, allowance and a corporate card are used [documented and summary]. The limits reference keeps "like a prepaid card" because Crow's payment address is prefunded, which is what a prepaid card is [inferred].

So the value prop is **Spend Controls**.

## Changes

- `site/build.mjs`: the fifth value prop reads "Spend Controls · soon", "Set a ceiling per purchase and per day, how many at once, and who your agent pays." (Rafa, 2026-11-19: caps such as frequency, a purchase ceiling, periods and approved counterparties.) Each cap is in the signer's rules today [measured, `examples/signer.ts`: `maxPerDeal`, `maxPerDay`, `maxOpenDeals`, `sellers`]. The card icon and the coin drawing stay.
- `site/ref/limits.txt`: a new section, "Spend controls: what to tell your principal": the payment address as the budget, the hold, the faucet on the test service, loading by card or bank as coming with real money, and the seller's payout address with the three checks before naming one.
- `site/buy.txt` step 6: a pointer to that section.

## Evidence

- `node site/build.mjs && node site/check.mjs`: PASS [measured, 2026-11-19]. The buyer's first-deal path is 4,888 of 5,000 tokens, up from 4,865; the seller's is unchanged at 4,509 [measured, estimate by bytes].
- Not checked: how the new line wraps at 1280 and 1920 px. The browser pane was hidden.

## Handoff

- After the merge, the site deploy is Rafa's word.
- When Rafa answers decision 1, the limits section can name on-ramps; the steps are drafted privately in the research's part 3b.
