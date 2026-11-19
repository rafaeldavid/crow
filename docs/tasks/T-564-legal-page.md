# T-564: A legal notice for a test-network service with no legal entity

- **Lane:** demo (the site)
- **Phase:** 2
- **Depends on:** T-421 (the trust page)
- **Paths this task may touch:** `site/trust.mjs`, `site/footer.ts`, `site/build.mjs`, `site/check.mjs`, the pages they build (`site/*.html`, `site/*.txt`, `site/pages.css`), this file
- **Human gate:** yes: Rafa reads the exact words before merge; the page goes live only with a site deploy, which is his word
- **Status:** done
- **Agent/session:** t-564-legal-page
- **Roadmap row:** N202

## What exists

The trust page (`/trust`, `/trust.txt`, built by `site/trust.mjs`) answers due-diligence questions about money, keys and data. `SECURITY.md` and `/.well-known/security.txt` cover security reports. Nothing says who runs Crow, that no legal entity or terms of service exist, or what applies meanwhile. Two outside evaluations named that gap (crow-private `roadmap/triage/2026-11-18-second-outside-evaluation.md`, "(c) Rafa's to settle", point 1).

## Intent

Rafa, 2026-11-19: "Add a short page saying \"test network only\" we don't have a legal entity yet so we need an industry standard placeholder". After a first, longer draft he asked for another pass: "may just need a \"Demo Now Live\" on the landing page, and then a briefer legal page (use hyperlinks not raw links, and minimize links) ... a sign-up page for a potential announcement should be very low risk." So: (a) one demo line on the home page, linked to (b) a legal page that reads in under a minute: a demo on a test network with worthless test tokens and no real money; one maintainer and no company yet; no terms of service, the Apache 2.0 licence's as-is terms meanwhile; what an early-access sign-up keeps and why; the trust page for the rest. Non-goals: a contract, a privacy policy, any entity, address, jurisdiction, governing law or email address, and any claim of compliance.

## Acceptance criteria

- [x] `/legal` and `/legal.txt` come from one source in `site/trust.mjs`: four short paragraphs, about 100 words, two links on words and no bare address.
- [x] The home page shows the kit's pill "Available today for demo only" above the eyebrow, linked to `/legal` (Rafa changed it from "Demo now live · Test network, no real money" on 2026-11-19, after seeing the page). The hero's own words still come from `llms.txt`.
- [x] The footer links Legal on every page except the home page, whose demo line links it; the trust page and `trust.txt` link the notice.
- [x] `site/check.mjs` holds the page to its words and its size (at most 1,200 bytes in `legal.txt`, at most 3 links in the page body), refuses an invented entity, jurisdiction, email address or compliance claim, and applies the trust page's refused words.
- [x] No agent page changes, so the first-deal budgets do not move; the pinned bundles do not change; `site/index.html` stays within its 8,000-byte cap.
- [x] Rafa reads the full text and gives his go (2026-11-19, in this session: "Go, build it").

## Out of scope

- Terms of service, a privacy policy and an entity: they wait for the entity.
- A deletion date or a contact address for sign-up emails, and a German site notice (Impressum): both concerns remain, and both are Rafa's to decide.
- The site deploy: Rafa's word.

## Evidence

- **Second pass: early demo and waitlist sites** (10 public pages, read 2026-11-19 as data; not legal advice) [measured]: mino.so, AgentPay's waitlist form (tally.so), Locus (paywithlocus.com and its YC launch post), Sponge (paysponge.com), nekuda.ai, Panoptic's Sepolia demo (panoptic.xyz), AEGIS (aegis-protocol.pages.dev), Abba Baba Labs (abbababa.com), Kite (gokite.ai), WaitlistKit (waitlistkit.pages.dev). Common: one status line near the hero or in a banner; a brand-name copyright line and no company (7 of 10); one sentence by the email form. Only some: separate terms and privacy pages (mostly those with a company or after launch), a named entity, a governing law (one site).
- **First pass: test-network notices** (read for structure; no text copied) [measured]: Celo's testnet terms, Bitcoin Computer's `LEGAL.md`, Golem Network's terms, Pipette's terms and privacy pages, Fossify's privacy page.
- **Facts checked in the repo** [measured]: test network and tUSDC (`docs/operations.md`, "Sepolia contracts (T-206)"); the sign-up keeps the email, the time and the page (`apps/early-access/worker.js`, its header); Apache 2.0's "as is" clause (`LICENSE`, section 7).
- **Commands** [measured]: `pnpm build`, `node site/build.mjs`, a publish build to `reports/site-out`, `node site/check.mjs`: PASS. `pnpm typecheck`: pass. `pnpm vitest run tests/site`: 5 files, 58 tests passed. The page was not opened in a browser [not measured].
- **Budgets, before and after** [measured, the check's estimate of bytes divided by four]: buyer `llms.txt + buy.txt` 4,881 of 5,000 tokens before and after; seller `llms.txt + sell.txt` 4,508 of 5,000 before and after; `setup.txt` unchanged. `site/index.html` 7,890 bytes before, 7,962 after, of 8,000. `site/buy.mjs`, `site/try.mjs` and `site/setup.mjs` unchanged.

## Decisions

- The notice lives in `site/trust.mjs` beside the trust and status pages, and reuses their head, header and stylesheet.
- The demo line is site trim, like the "Watch two agents close a deal" link: `llms.txt` already opens with "Test tokens only", so agents pay no new tokens.
- The home page's footer leaves out the Legal link: with it and the demo line the page was 8,003 bytes, over its 8,000-byte cap, and the demo line already links the notice. The cap was not raised and Rafa's words were not changed.

## Handoff

The notice and the demo line are built and checked. The merge waits for the coordinator's word that T-563's tag is pushed (the merge freeze of 2026-11-19); then `origin/main` comes into the branch and the site is rebuilt before the merge. The page goes live with the next site deploy, which is Rafa's word; a contract redeploy with a site step is running in another session today. The merged commit and the PR are in the session's closing report.
