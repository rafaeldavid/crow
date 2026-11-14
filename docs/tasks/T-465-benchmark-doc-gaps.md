# T-465: the doc gaps the six live benchmark runs recorded, written up and closed

- **Lane:** site (the agent guides' reference pages under `site/ref/`)
- **Phase:** 2
- **Kind:** 2, docs (Change recipes): `node site/build.mjs && node site/check.mjs`, one `reviewer` pass, no red team.
- **Depends on:** T-412 (the benchmark and its six live runs), T-441 (holdback pull request 565, which answers 8 of the 18 rows)
- **Paths this task may touch:** `site/ref/checks.txt`, `site/ref/intake.txt`, `site/ref/http-seller.txt`, `site/ref/http.txt`, `site/ref/http-buyer.txt`, this file; in crow-private `control/metrics/bench/2026-11-14-doc-gaps.md`. Never `site/try.mjs`, `site/buy.mjs`, `site/llms.txt`, `site/buy.txt`, `site/sell.txt`, `examples/`, `apps/`, the trust and status pages.
- **Human gate:** no for the pull requests. The site's deploy is the coordinator's.
- **Status:** done on merge
- **Agent/session:** a side session of the coordinator, 2026-11-14, branch `t-465-benchmark-doc-gaps`
- **Roadmap row:** T-252

## Intent

On 2026-11-14 a fresh agent, given only `https://crow.direct/llms.txt`, finished one live deal per benchmark scenario, but wrote 18 `GUESS:` lines where the guides did not tell it what to do. Restated: sort each of the 18 into a real gap, one another pull request already answers, the agent's own miss, or not a docs matter; write that up for Rafa with what each cost; then answer every remaining real gap in the page the agent was reading when it guessed, without growing either role's first-deal path past 5,000 tokens, changing a pinned bundle, or saying anything the live service does not do.

Non-goals: the front door and the two role pages (pull request 565 rewrites `llms.txt`); the test agents' own rules; a live benchmark rerun (it spends Rafa's model credits).

## Acceptance criteria

- [x] The findings note lists all 18 rows with the scenario, the aim, the guess, whether it was right, the page and section, and a verdict; rows of one gap are grouped; the cost of each gap is measured from the run logs. (crow-private `control/metrics/bench/2026-11-14-doc-gaps.md`)
- [x] Every real gap is answered in the reference page the agent was reading, with the exact field, value or rule.
- [x] `node site/build.mjs && node site/check.mjs` passes; each role's first-deal path stays under 5,000 tokens, and the plain-HTTP buyer's path under its 9,450.
- [x] `site/try.mjs` and `site/buy.mjs` keep their SHA-256 values.
- [x] Each new sentence is checked against the code (writes) or a plain GET of the live service (reads).
- [x] One fresh subagent per gap group, given only the built pages, answers the question the benchmark agent guessed at, with the line it found it on.
- [x] One `reviewer` pass, its findings fixed.

## Evidence

- **The 18 lines** [measured]: the records in crow-private `control/metrics/bench/` scrub quoted strings to `<text>`, so the full lines come from the run logs (`reports/scratch/one-click-bench/logs/*.jsonl`, git-ignored). s1 4, s2 3, s3 4, s4 0, s5 4, s6 3.
- **The verdicts** [measured against the code and the pages at `main`]: 9 real gaps (rows 3, 4, 6, 7, 8, 9, 10, 11, 13), 8 answered by pull request 565 (rows 1, 2, 12, 14, 15, 16, 17, 18; open, all checks passed, not merged when this was written), 1 agent's miss (row 5: `ref/http-seller.txt` already says to add the windows "to `timing`"), and half of row 11 not docs (the test buyer's `CHECK_TYPES` leaves out `iso8601_date_column` while its comment says it takes every schema type).
- **What changed**, five gap groups:
  - A, `ref/intake.txt`, "Sell to Crow's test buyer": the default windows fit (the operator dates the offer at settlement time: `apps/operator/src/server.ts` gives `prepare` the registry's clock, the clock discovery reports as `settlementTime`, and `apps/test-agents/src/buyer.ts` measures `deliverBy` from settlement time when it reads the post); post the ID with no `Idempotency-Key` (`buyer.ts` `receive()` reads only the body; a repeat ID answers 200).
  - B, `ref/checks.txt`: the five hidden-character classes with their code points (`packages/judgment/src/hidden.ts`, `HIDDEN_KEYS` in `checks/index.ts`); `unique_key` over several columns is one key (`checks/index.ts`, `JSON.stringify` of the row's cells); `reference_row_match_min` (`checks/index.ts`, `references.ts`, `docs/api.md` "Reference files").
  - C, `ref/http-seller.txt`, "Offer": a judged offer, `"template": "default"` with `rubric` beside `checks` (`apps/operator/src/prepare.ts`, `defaultTerms`), the rubric's shape and limits from `spec/schemas/commitment.schema.json` (`$defs/Criterion`, `acceptance.rubric`), and that a proposal carries it in `terms` (`apps/test-agents/src/seller.ts` reads `proposal.terms.rubric`).
  - D, `ref/http.txt`, the faucet: a seller sends its address alone.
  - E, `ref/http-buyer.txt`, "Open the work": normally one key item; with several, try each.
- **Live reads** [measured, plain GETs, 2026-11-14 about 19:25 UTC]: `GET https://api.crow.direct/v1/commitments/0x34fc…d746/key?recipient=<its buyer>` answered 1 item with `recipient`, `scheme`, `ciphertext`; the s2 deal's terms carry the rubric in `acceptance.rubric` with `passThreshold` 300; the test buyer's card lists 8 check types without `iso8601_date_column`; discovery serves `settlementTime` and `limits.maxCiphertextBytes` 1,048,576.
- **Inferred, not measured:** that the live adjudicators run T-327's reference loading (merged 2026-11-11 in PR 306; the operators have been deployed since). No live deal with `reference_row_match_min` was run.
- **Budgets** [measured, bytes divided by four, no key set]: the buyer's first-deal path 4,547 of 5,000 tokens before and after; the seller's 4,160 of 5,000 before and after (no first-deal page changed); the plain-HTTP buyer's path 9,261 before, 9,322 after, of 9,450.
- **Pinned bundles** [measured, `shasum -a 256` before and after the build]: `site/try.mjs` `04ef4434fb4b5635bb3c49df69c7547f3200c6c41f903237ee37098be23f75c8`, `site/buy.mjs` `e74ff2230f0d4fd426525095731e42d50b65b55ab7792a43cab73c302b22eb88`, unchanged.
- **The checkers** [measured, 2026-11-14]: 4 fresh Sonnet subagents, each told to read only the named built pages and to answer "not stated" rather than guess; groups D and E shared one agent, as two separate questions. 9 questions, 9 right, each with the new line quoted: A 2 of 2 (no `Idempotency-Key`, a repeat ID answers 200; the default 86,400 s window fits), B 3 of 3 (`unique_key` is one key over the pair; U+200B is `otherIgnorable`, and the five class names; `reference_row_match_min`'s rule, fields and upload), C 2 of 2 (`rubric` inside `terms`; the shape and `"template": "default"`), D 1 of 1 (the address alone), E 1 of 1 (try each item, keep the one that opens). C's checker noted that `ref/intake.txt`'s proposal example still shows no `rubric` line, so the answer rests on `ref/http-seller.txt`'s sentence. This shows the pages answer; it does not measure approvals, which stay 11 per deal until Rafa reruns the benchmark.
- **Merges with pull request 565** [measured]: `git merge-tree` of this branch and `t-441-one-command-per-goal` writes a tree with no conflict.

- **Review** (one `reviewer` pass, at `c98050f4`): PASS, 3 Low and 4 Info. It checked each new sentence against the code and plain GETs, and found no step, warning or limit lost. Fixed in the review commit: the rubric's other limits (1 to 12 criteria, the `id` pattern, 500 and 300 characters); the reference file's three cautions from `docs/api.md` (the adjudicators' store, the size cap, tag characters); "needs no `Idempotency-Key`" for "with no"; two wordings in `checks.txt`; "five" pages, not "four", in the crow-private note. Recorded, not built: nothing in `site/check.mjs` ties the copied code points and rubric limits to `hidden.ts` and the schema (Handoff). Noted: the plain-HTTP buyer's path has 128 tokens left under its 9,450 ceiling and stands above its 8,700 target, as it did before (9,261).

## Handoff

**Done:** the findings note and the five gap groups' text. **Not done here:** a live benchmark rerun, which is Rafa's; the approvals number stays 11 per deal until then.

**Follow-ups, not built:**
- The test buyer's `CHECK_TYPES` (`apps/test-agents/src/buyer-rules.ts`) leaves out `iso8601_date_column` while its comment says every schema type: add it or fix the comment (the test agents' lane).
- Benchmark s2 asks for "a rubric you write", while the test seller counters any rubric but its own; the run spent 1 question card on it (the benchmark's lane).
- `site/check.mjs` does not compare the code points in `ref/checks.txt` with `packages/judgment/src/hidden.ts`, nor the rubric limits in `ref/http-seller.txt` with `spec/schemas/commitment.schema.json`; if either changes, the guide drifts without a failing check (`docs/writing.md`, "Numbers that drift"; the site lane).
- Pull request 565 answers 8 of the 18 rows; until it merges, those rows stay open on the live guides.
