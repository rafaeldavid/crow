# T-500: the demo page shows a security-review deal like the pilot's

- **Lane:** site (the demo page's own files) and `tools/duet`
- **Phase:** 2, settlement on EVM (stable EVM operations, D53)
- **Kind:** 1 (copy), with the demo generator's tests (`tools/duet/duet.test.ts`), and one kind 9 run (three live test deals on Sepolia, test tokens only); one `reviewer` pass on the page and the code; no red team, since no live product is added
- **Depends on:** T-427 (the three endings), T-239 (Crow's test buyer), T-391 (the two-agent replay)
- **Paths this task may touch:** `site/demo/index.html`, `tools/duet/` (new `review.ts`, `review-deals.ts`, `review-job-api.ts`, `review/`; changes to `scenarios.ts`, `world.ts`, `scripted.ts`, `replay.ts`, `endings.ts`, `endings.json`, `duet.test.ts`, `README.md`), this file. Never: `apps/test-agents`, `apps/hosted-sellers`, `examples/` (the stub is bundled into `buy.mjs` and `setup.mjs`), `packages/`, `contracts/src/`, the guides, `site/try.mjs`, `site/buy.mjs`, `site/setup.mjs` or any other pinned bundle.
- **Human gate:** the site deploy is Rafa's.
- **Status:** in progress
- **Agent/session:** the T-500 session, 2026-11-17, branch `t-500-demo-security-review`
- **Roadmap row:** N102

## Intent

Rafa decided on 2026-11-17 that the demo page at crow.direct/demo should show the kind of deal Crow's first pilot runs: an agent buys a security review of a smart-contract repository under five declarative checks, priced by quote, with the price refunded when a check fails and everything refunded when nothing arrives. The page shows that deal end to end and in its three endings, from deals actually run against Crow's own test counterparty, on a public open-source repository, in test tokens. It names no pilot party and links to no pilot deal. It says the checks test a report's shape and scope, not the quality of the review, and that a report with no findings passes.

## Design

**The repository.** Damn Vulnerable DeFi v4 (`theredguild/damn-vulnerable-defi`, MIT license), a set of contracts written to be broken for practice. Commit `64fddf9f96de2782f8868898d68673acb295119c` (master on 2026-11-17), two files in scope: `src/truster/TrusterLenderPool.sol` (36 lines) and `src/side-entrance/SideEntranceLenderPool.sol` (44 lines). No real project is accused of anything: the findings describe the flaws the exercises were written to hold, are written for this page, and the report and the page label them demo findings.

**The checks.** The five checks of the repository's public audit-report template (`examples/seller-adapter.template.json`), filled from the scope: `report` (the report's shape: the commit, the files reviewed, each finding with an ID, a severity, a title, its code locations, the root cause and a fix), `proof` (each Medium-or-higher finding carries proof-of-concept files), `scope` (the agreed commit; every location in a file in scope), `coverage` (exactly the files in scope reviewed, none left out) and `hidden` (no hidden characters). The same template already drives the page's replay, and it has the pilot's shape without the pilot's own terms.

**Options weighed.**

| Option | What it takes | Verdict |
| --- | --- | --- |
| (a) A security-review product in Crow's test seller | A change to `apps/test-agents`, a red team of its limits, a Worker deploy by Rafa before any deal can run, then the deals | Heavier, and it serializes on a deploy |
| (b) The three deals in the in-process test world only | No live records: the cards lose their Etherscan links, the thing a reader can check | Too weak for the endings |
| (c) A seller script with fresh keys selling to Crow's live test buyer | One new script in `tools/duet`, no Worker change, no deploy before the deals | **Chosen** |

**Option (c).** Crow's test buyer (`crow.direct/agents/test-buyer`, T-239) already takes any checks-only offer whose checks are declarative types it lists (`json_schema` and `hidden_characters_max` among them), up to 50 tUSDC, with the work due within a day. `apps/test-agents/scripts/sell-to-test-buyer.mjs` sells it a dataset this way. `tools/duet/review-deals.ts` does the same for the review: a fresh seller key held in memory, admitted by the faucet; it offers the review at a quoted price of 40 tUSDC under the five checks, posts the offer to the test buyer, waits for Held, then delivers the demo report (`release`), a report whose High finding has no proof of concept (`refund`, the `proof` check fails), or nothing (`reclaim`, with the work due 5 minutes after the offer). It prints the deal's ID and transactions. Neither party holds a secret beyond the run. The test buyer's own limits (3 deals per seller an hour, 50 a day, 10 open) bound the cost.

**The windows.** The pilot gives the seller 7 days. The test buyer takes at most a day, and a demo should end in minutes, so the passing and failing deals give an hour and the silent one 5 minutes. The page says so.

**The replay.** The page's player replays a local scripted run of the two agents (Enterprise Procurement Agent and Enterprise Sales Agent) buying "a security review of 3 smart-contract files (400 lines)" of an invented repository. It is re-run on the same repository, commit, files and report as the live deals, so the page shows one deal: `scenarios.ts` takes the new scope, and a small job API in `tools/duet/review-job-api.ts` serves the demo report at the quoted price (the repository's stub cannot: it is bundled into `buy.mjs` and `setup.mjs`, and its sample findings name other files). The replay stays labelled as a local run with no public records.

**The page.** Structure, style and length stay. The endings section becomes the security-review deal on Sepolia: what the buyer asked for (repository, commit, files), the quoted price, the five checks in plain words, funding and delivery, and each ending with its outcome and its two links. One sentence says this is the kind of deal Crow's first pilot runs. One says what the checks prove and do not prove.

## Acceptance criteria

- [ ] Three live deals on Sepolia, one per ending, with their records and transactions in `tools/duet/endings.json`.
- [ ] The replay re-run on the new scope and published; the endings section rebuilt from the new data.
- [ ] The page names no pilot party, links no pilot deal, and states what the checks do not prove; a test fails the page without those sentences.
- [ ] No private name in the diff (`roadmap/deny.txt`); no refused word on the page.
- [ ] `node site/build.mjs && node site/check.mjs` and `pnpm exec vitest run tools/duet` pass; pinned bundles unchanged.
- [ ] One `reviewer` pass; findings fixed or recorded.
- [ ] Merged by hand when every check passes; deploy commands handed to the coordinator.

## Evidence

All measured on 2026-11-17 in this branch's worktree unless marked otherwise.

- **Test first:** `tools/duet/review.test.ts` (8 tests) runs the adjudicator's own stage-one code (`preflightDelivery` from `packages/judgment`) on the demo report: all five checks pass and the result is accept; the report without F-01's proof of concept fails `proof` only; the report missing a file fails `coverage` only; a report with no findings is accepted. It also pins the demo labels and the replay job API's one scope.
- **Three live deals on Sepolia** (`node tools/duet/review-deals.ts --outcome …`, each with a fresh seller key; Crow's test buyer `0xd0a29422…dc29` agreed and funded each; times from each deal's public events):

| Ending | Deal | Offered | Ended | Time | Money | Settlement transaction |
| --- | --- | --- | --- | --- | --- | --- |
| Passes | `0x341562cc…2e9b` | 08:44:19 UTC | released 08:45:00 UTC | 41 s | 41 tUSDC held; 40 tUSDC to the seller, 1 tUSDC fee | `0xe47168fa…ae96` |
| Fails | `0x9908966e…4272` | 08:47:33 UTC | refunded 08:48:24 UTC | 51 s | 41 tUSDC held; 40 tUSDC back to the buyer, the 1 tUSDC fee kept | `0x652d1c6a…5b52` |
| Silent | `0x8aedfce0…22e6` | 08:49:39 UTC; work due 08:54:38 UTC | reclaimed 08:55:00 UTC, with no delivery | 5 min 21 s | 41 tUSDC held, all 41 tUSDC back to the buyer | `0x97ffd900…58ae` |

- **The judgment records** (`GET /v1/commitments/<id>/judgment`): the passing deal shows all five checks passed, no panel ran, decision accept ("all deterministic checks passed and the rubric is empty"); the failing deal shows `proof` failed ("anyOf not satisfied" on finding 0), the other four passed, no panel ran, decision reject.

- **The replay:** `node tools/duet/duet.ts run --scenario paid --buyer scripted --seller scripted` on the local phase-one world ended Released, the buyer opened the report, deal `0x94ec643c…a8e3`, 40 test dollars to the seller and 1 to the reviewer; `node tools/duet/duet.ts publish <run>` wrote `site/demo/index.html`.
- **Site checks:** `node site/build.mjs --op1 https://api.crow.direct --op2 https://api2.crow.direct --out reports/scratch/t500/site-out && node site/check.mjs`: PASS. `try.mjs` SHA-256 `fd7d9a4a…`, the same as `https://crow.direct/try.mjs` served at 09:00 UTC, and no file under `site/` changed but `site/demo/index.html`, so no pinned bundle moved.
- **Types and lint:** `tsc -p tools/duet/tsconfig.json --noEmit` and `eslint tools/duet`: clean.
- **No private name:** the branch's diff checked against crow-private `roadmap/deny.txt`, whole words, no case: no hit.

## Handoff
