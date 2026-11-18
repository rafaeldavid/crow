# T-517: one page says what a deal can do today

- **Lane:** infra (process docs)
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 2 (process docs and records), with one small test that reads the page and `spec/openapi.json`
- **Depends on:** none
- **Paths this task may touch:** `docs/what-a-deal-can-do.md`, `docs/tasks/_template.md`, one line each in `docs/team.md` and `docs/plan.md`, `tests/what-a-deal-can-do.test.ts`, this file. Never: `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.github/`, `contracts/`, `spec/`, product code, the pinned bundles.
- **Human gate:** no. Nothing here deploys.
- **Status:** done
- **Agent/session:** the T-517 session, 2026-11-18, branch `t-517-what-exists`
- **Roadmap row:** T-252

## What exists

- The simplicity review of 2026-11-18 (crow-private, `strategy/2026-11-18-simplicity-review.md`, part 1) lists the happy path's calls and signed messages, but in a private dated record, with counts.
- `site/ref/after-funding.txt` defines every path after funding; `site/llms.txt`, `site/buy.txt` and `site/sell.txt` define the happy path; `docs/api.md` defines each route.
- No short page indexes all of it, so on 2026-11-18 two sessions proposed builds the protocol already had (a settlement that names a held delivery, and a zero-price deal with a fee). The task is still needed for that index and for the template step.

## Intent

Write one short page that indexes what a deal on Sepolia can do today, each line pointing at the page or schema that defines it, and make "what exists" the first step of every task file. The page restates nothing. Non-goals: retiring or rewriting other pages, changing the API or the guides.

## Acceptance criteria

- [x] `docs/what-a-deal-can-do.md`: the happy path, every path after funding, and what does not exist on Sepolia, each with a pointer; no counts, addresses or hashes.
- [x] A "What exists" section in `docs/tasks/_template.md`, before Intent.
- [x] One line in `docs/team.md` (task lifecycle) and one in `docs/plan.md`.
- [x] A test that fails when the page names a route the spec lacks, or the spec tags a `core` route the page lacks.

## Evidence

- **Each line checked against its source** [inferred, read at `origin/main` `fc616e9f`]: the happy path against `site/buy.txt`, `site/sell.txt`, `site/ref/http.txt`, `http-seller.txt`, `http-buyer.txt` and `signing.txt`; the after-funding paths against `site/ref/after-funding.txt` and `docs/api.md`; settling late work against `apps/operator/src/prepare-posted-delivery.test.ts`; the seller's refusal list against `apps/hosted-sellers/src/worker.ts` (`/health` returns `refused`) and `apps/hosted-sellers/scripts/check-report.ts`; the zero-price deal against D58 and `docs/api.md`'s prepare refusals; the offline check against `examples/evidence.ts`.
- **Not verified:** the zero-price deal with a fee has not run end to end on Sepolia [not run; the page says so]. The full refund closing the first pilot's first deal comes from the simplicity review [inferred, not traced on chain]. The adjudicator's steps (acceptance, decision) are named from `docs/api.md`; this task did not trace them in the adjudicator's code.
- **The check:** `spec/openapi.json` tags operations `core`, so `tests/what-a-deal-can-do.test.ts` compares the page's backticked `METHOD /path` routes with the spec. `pnpm exec vitest run tests/what-a-deal-can-do.test.ts tests/id-check.test.ts tests/design-map.test.ts`: 3 files, 135 tests passed [measured]. `pnpm exec eslint` on the test and `pnpm typecheck`: no errors [measured].

## Decisions

- The page lives in `docs/`, not `site/`: it is for the sessions that build Crow, not for outside agents, whose pages it points at.
- The check treats path parameters by position, so the page may write the spec's parameter names without a second list to keep.
- The test checks only operator routes (`/v1/` and `/.well-known/`) against the spec: the seller adapter's `/deals/…` routes and the hosted seller's `/health` are not in it.

## Live run: the zero-price deal with a fee, 2026-11-18

Rafa asked for the zero-price deal to run end to end on Sepolia. It reached `Released` [measured].

- **Command:** `node examples/try-sell.ts --work work.csv --terms terms.json`. The terms are the `customers` sample's deliverable and three checks with `"price": "0"`. The work is three CSV rows. The seller used fresh keys; Crow's test buyer was the buyer.
- **Result:** commitment `0xc36fbc917ab5e6b8ee2f51b72b4ceca21329af268567244bef5a827106c9f709` was `Released` in 44 s; all three checks passed and the decision was accept. Transactions: [funded](https://sepolia.etherscan.io/tx/0xe01c2f8371c3fd82d97dac20e8d64a1126bddf9981484abb9cd89806cb86ec53), [delivered](https://sepolia.etherscan.io/tx/0x5f54961d8553bfb4e10962f8179efc812f427c42d35b1c45652a107a05962f9b), [decided](https://sepolia.etherscan.io/tx/0x90b21c801069ef34b76552ab679971a1226dd9afaeba7196a3b9938dc51d2e23).
- **Money:** the buyer's signed transfer put 1.00 tUSDC into the escrow: price 0.00 tUSDC plus the adjudicator's fee. The decide transaction (status 1, block 12160884) made one token transfer: 1,000,000 base units (1.00 tUSDC) from the escrow to the primary adjudicator `0xa909f87a64fbe6982c838c1c1bf2973cda7823ed`. The seller received nothing [measured, the receipt's `Transfer` logs].
- **Offline check:** `node examples/evidence.ts fetch` then `check --receipt receipt.json`: PASSED, 57 checks [measured].
- **Not covered:** a deal where the buyer is an outside agent paying only for the judgment, through `buy.mjs`. The test seller's quote sets its own price, so `buy.mjs` cannot ask it for price 0 [inferred, `site/buy.txt` step 2]. The API path is the same, from `POST /v1/prepare/offer` on.

## Review

The `reviewer` agent returned ISSUES with three findings, all fixed in the second commit [inferred, each checked against its source line]: the disclosure route exists (only `publish` is planned), so the page now says private deals wait for adjudicators that open sealed terms; the adapter's seller-signed refund and the deal for a finished job were missing and are now listed. It confirmed the test fails on a route the spec lacks and on a missing `core` route [measured by the reviewer on scratch copies].

## Handoff

Done: the page, the template section, the two pointers and the check. For Rafa, the line for `CLAUDE.md`'s "Start here" list, as a new item 2: "Before you design a build, read `docs/what-a-deal-can-do.md`: what a deal on Sepolia can already do. Each task's 'What exists' section starts from it." The simplicity review's tidy (its part 7) may move routes; the test then names the page line to change.
