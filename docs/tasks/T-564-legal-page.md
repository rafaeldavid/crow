# T-564: A legal notice for a test-network service with no legal entity

- **Lane:** demo (the site)
- **Phase:** 2
- **Depends on:** T-421 (the trust page)
- **Paths this task may touch:** `site/trust.mjs`, `site/footer.ts`, `site/build.mjs`, `site/check.mjs`, the pages they build (`site/*.html`, `site/*.txt`, `site/pages.css`), this file
- **Human gate:** yes: Rafa reads the exact words before merge; the page goes live only with a site deploy, which is his word
- **Status:** review
- **Agent/session:** t-564-legal-page
- **Roadmap row:** N202

## What exists

The trust page (`/trust`, `/trust.txt`, built by `site/trust.mjs`) answers due-diligence questions about money, keys and data. `SECURITY.md` and `/.well-known/security.txt` cover security reports. Nothing says who runs Crow, that no legal entity or terms of service exist, or what applies meanwhile. Two outside evaluations named that gap (crow-private `roadmap/triage/2026-11-18-second-outside-evaluation.md`, "(c) Rafa's to settle", point 1).

## Intent

Rafa, 2026-11-19: "Add a short page saying \"test network only\" we don't have a legal entity yet so we need an industry standard placeholder". Give the site one short page, `/legal` with its plain-text copy `/legal.txt`, that says what is true: a test network and worthless test tokens, one maintainer and no entity yet, no terms of service and the Apache 2.0 licence's "as is" terms meanwhile, what the operators keep and for how long, that deals are public, how to reach Crow, and the date. Non-goals: a contract, a privacy policy, any entity, address, jurisdiction, governing law or email address, and any claim of compliance.

## Acceptance criteria

- [x] `/legal` and `/legal.txt` are built from one source in `site/trust.mjs`, in the trust page's look (`pages.css`), with a Source line of full links per section.
- [x] The footer links Legal on every built page; the trust page and `trust.txt` link the notice.
- [x] `site/check.mjs` holds the page to its words: it says "test network", "no legal entity", "not legal advice", "Apache License 2.0" and its date; it names no governing law, jurisdiction, company suffix or email address and claims no compliance; the trust page's refused words apply.
- [x] No agent page changes, so the first-deal budgets do not move; the pinned bundles do not change.
- [ ] Rafa reads the full text and gives his go in the session's thread.

## Out of scope

- Terms of service, a privacy policy and an entity: they wait for the entity.
- The site deploy: Rafa's word.

## Evidence

- **Sources read for the structure** (2026-11-19, read as data; no text copied) [measured]:
  - Celo's testnet terms, https://docs.celo.org/network/alfajores/disclaimer: no economic value, "as is", use at your own risk.
  - Bitcoin Computer's `LEGAL.md`, https://raw.githubusercontent.com/bitcoin-computer/monorepo/HEAD/LEGAL.md: licence and its no-warranty clause, test coins of no value, a "Last updated" line.
  - Golem Network's terms, https://docs.golem.network/docs/golem/terms: testnet tokens carry no value or claim; testnet activity is public on chain.
  - Pipette, a Base Sepolia faucet run by one builder, https://pipette-base.vercel.app/policy and https://pipette-base.vercel.app/privacy: no entity or jurisdiction, "Testnet only: no value", "as is", a short "what we keep", a date at the top.
  - Fossify's privacy page, https://www.fossify.org/privacy/: what the site keeps, what its host keeps, no entity.
  - Common order taken: date; what it is; no value; as is under the licence; what is kept; public chain data; contact; changes. The entity and jurisdiction sections appear only where an entity exists, so this page has none.
- **Facts checked in the repo** [measured]: test network and tUSDC (`docs/operations.md`, "Sepolia contracts (T-206)"; the trust page's "Is real money involved?"); no admin key, pause or upgrade path (`docs/audit/scope.md`, line 49 and "No admin keys"); the outside scan and fix review, not a human audit (`docs/audit/outside-scan.md`); the request log's 7 days (`apps/demo-cloud/src/telemetry.ts`, `RETENTION_MS`, read at build time); Workers Logs' 7 days and the feedback store's 90 days (`docs/operations.md`, "Telemetry (T-031)", "Feedback triage (T-032)"); the sign-up's fields and no deletion date (`apps/early-access/worker.js`; the trust page); deals public, chain keeps amounts and addresses but no terms text (`docs/privacy-baseline.md`, "The answer"); Apache 2.0 sections 7 and 8 (`LICENSE`).
- **Commands** [measured]: `pnpm build`, `node site/build.mjs`, `node site/check.mjs`: PASS. A publish build to `reports/site-out` writes `legal.html` and `legal.txt`, and the check passes against it. `pnpm typecheck`: pass. `pnpm vitest run tests/site`: 5 files, 58 tests passed.
- **Budgets, before and after** [measured, the check's estimate of bytes divided by four]: buyer `llms.txt + buy.txt` 4,881 of 5,000 tokens before and after; seller `llms.txt + sell.txt` 4,508 of 5,000 tokens before and after; `setup.txt` unchanged (10,241 bytes in the committed file), under `SETUP_MAX_BYTES`. No agent page changed. `site/buy.mjs`, `site/try.mjs` and `site/setup.mjs` unchanged.

## Decisions

- The notice lives in `site/trust.mjs` beside the trust and status pages, and reuses their head, header, stylesheet and Source lines; a new file would copy them.
- The link goes in the footer and on the trust page only; no agent page carries it, so no first-deal path pays for it.
- The page says Crow has no email or postal address yet, instead of naming one.

## Handoff

The page is built and checked. It goes live with the next site deploy, which is Rafa's word; a contract redeploy with a site step is running in another session today. The merged commit and the PR are in the session's closing report.
