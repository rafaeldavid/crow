# T-586: Retire the demo and learn-more pages

- **Lane:** demo
- **Phase:** 2
- **Depends on:** none
- **Paths this task may touch:** `site/` (build, check, footer, trust page and the pages they write), `apps/site/worker.js`, `docs/archive/site/`, `docs/tasks/T-586-retire-demo-and-learn-more-pages.md`, the tests that cover the site (`tests/forwarding.test.ts`, `tests/site-headers.test.ts`, the demo-page block of `tools/duet/duet.test.ts`), and the two docs that pointed at the page (`docs/demo.md`, `docs/redeploy-contracts.md`)
- **Human gate:** no (the site deploy that makes it live is Rafa's word)
- **Status:** review
- **Agent/session:** site-archive-demo-learn
- **Roadmap row:** none (Rafa, 2026-11-25)

## What exists

Since 2026-11-23 the homepage carries the demo: an illustrative conversation between two agents and a use-case carousel. The homepage no longer links `/demo/`, so the page there is orphaned. `/demo/` holds the two-agent replay and, in the same file, the "Learn more · How Crow works" view (`/demo/#learn-more`) with six questions about the demo deal. The header and footer of the 404, trust, status and legal pages still link "Demo".

## Intent

Rafa (2026-11-25): "archive the /demo page and the previous learn more page, since now we've consolidated the demo on the front page, and the learn more page doesn't make sense anymore. Any leftover FAQ should go into the trust page only if needed."

After this task the site no longer builds or links `/demo/`. The site Worker answers every address of the page with a 301 to the homepage, so old links keep working. The last copy of the page is in `docs/archive/site/demo/`. The trust page gains only the answers that are still true, not yet covered and useful to a buyer, a seller or a security reviewer. Non-goals: no change to `tools/duet/` beyond the one test block that read the removed file; no deploy.

## Acceptance criteria

- [x] `site/demo/` is gone; `docs/archive/site/demo/` holds the page and a one-line README with the date and the reason.
- [x] No page the build writes links `/demo/`, and `site/check.mjs` fails if one does or if `site/demo/` comes back.
- [x] The sitemap no longer lists `demo/`.
- [x] `/demo`, `/demo/`, `/demo/index.html`, `/demo.html` and anything under `/demo/` answer 301 to `/` on the same host; look-alikes (`/demos`, `/demo-club`, `/visualdemox`) are served as before.
- [x] `/visualdemo/` is retired the same way, in its own last commit, which waits on Rafa's word (the coordinator, 2026-11-25): archived in `docs/archive/site/visualdemo/`, 301 to `/`, out of the sitemap and README.md, and its looser content security policy (inline styles, an outside font) removed, so every page now gets one policy.
- [x] The trust page answers the one Learn more topic it lacked: how a company caps what its agent spends.
- [x] No pinned bundle changes: `site/try.mjs`, `site/buy.mjs`, `site/setup.mjs`, `site/preflight.mjs` and the goal files (`site/try-sell.mjs`, `site/try-judged.mjs`, `site/try-reclaim.mjs`).

## Out of scope

- `tools/duet/`: `pnpm duet publish` still writes `site/demo/index.html` by default, `replay.ts` still passes `current: 'demo'` and uses `CARDS.demo`, and `tools/duet/README.md` still says the page is served at crow.direct/demo, beside /visualdemo/. That lane (PR 772 is open on it) should point the default output elsewhere and update its README.

## Evidence

- Measured: `corepack pnpm install --frozen-lockfile`, `corepack pnpm build`, `corepack pnpm typecheck` and `corepack pnpm lint` exit 0.
- Measured: `node site/build.mjs` leaves every `site/*.mjs` bundle unchanged (git status). A first run before `pnpm build` rewrote `site/setup.mjs` without the built packages; that copy was restored, and the run after `pnpm build` changed nothing.
- Measured: `node site/check.mjs` passes after the default build and after `node site/build.mjs --out reports/site-out --op1 https://api.crow.direct --op2 https://api2.crow.direct`. The publish build, written from empty, has no `demo/` or `visualdemo/` folder, and its sitemap names neither.
- Measured: `corepack pnpm exec vitest run tests/site-*.test.ts examples/try.test.ts tests/forwarding.test.ts tests/build-info.test.ts tests/health.test.ts tools/duet/duet.test.ts`: 10 files, 135 tests passed.
- Measured: `/verify` for the kinds touched (copy: `node site/build.mjs && node site/check.mjs`; the site Worker: its tests above) passes. Inferred: no snapshot can change, since no fixture, scenario or package under `pnpm snap` is touched; `pnpm snap` was not run.
- Measured: the added lines and the archived page match none of the private deny list's terms (whole words), and the added lines use none of the refused public words.

## Decisions

- The redirect goes to the homepage, not the trust page. A browser never sends the `#learn-more` fragment, so the Worker cannot route it apart from `/demo/`.
- The header link "Demo" is dropped from the 404, trust, status and legal pages, not pointed at the homepage: the brand mark already links the homepage, and the homepage's own header has no Demo link.
- With `/visualdemo/` gone, `withIcons`, `FOOTER_CSS` and `contentSecurityPolicy`'s `pathname` argument had no use left and were removed.
- `CARDS.demo` and the `'demo'` value of `footerHtml`'s `current` stay, for `tools/duet/replay.ts`, which still renders its replay page with them.

## Handoff

Done, in review. The change is live only after a site deploy (Rafa's word). The last commit (retire `/visualdemo/`) is separate so the coordinator can drop it if Rafa keeps that page; the earlier commits pass the checks without it. To resume: take over the `tools/duet/` follow-up under Out of scope.
