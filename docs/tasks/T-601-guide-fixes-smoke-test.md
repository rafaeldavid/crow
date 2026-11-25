# T-601: guide fixes from the stranger smoke test

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-552
- **Paths this task may touch:** `site/setup.txt`, `site/sell.txt`, `site/buy.txt`, `site/llms.txt`, `site/ref/take.txt`; this file.
- **Human gate:** no. The site deploy waits for Rafa.
- **Status:** in review
- **Agent/session:** guide-fixes, 2026-11-25; branch `guide-fixes-smoke`
- **Roadmap row:** N216
- **Change kind:** 1 (guides)

## Intent

Fix the seven guide gaps a stranger found on 2026-11-25 while setting up and taking a standing offer. Change text pages only; the pinned bundles keep their hashes.

## Acceptance criteria

- [x] `setup.txt` tells the seller to make the `work/` folder before placing the work.
- [x] `sell.txt` and `ref/take.txt` agree that the first take deploys the seller contract, and both say that take can fail with `relay_refused` or `internal`, after which the buyer needs a new show and approve.
- [x] `buy.txt` and `llms.txt` point a standing offer to `ref/take.txt`.
- [x] `sell.txt` says to serve the card over https at a fixed address with no redirect.
- [x] `ref/take.txt` says to allow 3 minutes for the first take of a new seller contract.
- [x] `setup.txt` says to choose the offer ID with `--offer-id` (default `seller`).
- [x] `setup.txt` explains `"kept"`: from `examples/setup-publish.ts`, `kept` is true when the folder already held a live template that publish left as signed, and false when it signed a new one.

## Evidence

- `node site/build.mjs && node site/check.mjs`: PASS. `tests/site-*.test.ts`: 59 passed. `pnpm lint`: clean (measured).
- `site/setup.mjs` and `site/take.mjs` unchanged (`git status`; measured).
- To stay within the budgets (setup.txt 10,000 bytes; llms.txt + sell.txt 5,000 tokens; plain-HTTP buyer path 9,450 tokens), some wording elsewhere in `setup.txt` was shortened, and the llms.txt sentence "Crow is an open protocol for deals between agents." was removed.

## Not done

- Item 8 of the report (a `ref/standing.txt` reference for outside clients) is its own task.
- Bundle changes, none needed. Item 1 was fixed in the text. Item 6 would be a `publish` default in `setup.mjs`, which stays pinned.
- The relayer fix for the first take is separate work; the text describes today's behaviour.

## Handoff

Review, merge when CI passes, then deploy the site (Rafa's gate).
