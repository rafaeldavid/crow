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

## Review

The `reviewer` agent returned ISSUES with three findings, all fixed in the second commit [inferred, each checked against its source line]: the disclosure route exists (only `publish` is planned), so the page now says private deals wait for adjudicators that open sealed terms; the adapter's seller-signed refund and the deal for a finished job were missing and are now listed. It confirmed the test fails on a route the spec lacks and on a missing `core` route [measured by the reviewer on scratch copies].

## Handoff

Done: the page, the template section, the two pointers and the check. For Rafa, the line for `CLAUDE.md`'s "Start here" list, as a new item 2: "Before you design a build, read `docs/what-a-deal-can-do.md`: what a deal on Sepolia can already do. Each task's 'What exists' section starts from it." The simplicity review's tidy (its part 7) may move routes; the test then names the page line to change.
