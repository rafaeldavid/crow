# T-618: A judge's free text over its cap is cut to the cap, and the verdict counts (agg-5)

- **Lane:** judgment
- **Phase:** 2
- **Depends on:** T-615 (template pair 2 and the named filter reasons, PR 824, merged)
- **Paths this task may touch:** `packages/judgment/src/verdict.ts`, `packages/judgment/src/aggregate.ts`, `packages/judgment/src/pipeline.ts`, `packages/judgment/src/kept.ts`, `packages/judgment/src/kept/agg-4.ts`, `packages/judgment/src/kept/verdict-0.ts`, the judgment tests, `apps/adjudicator/src/kept-policies.json` and the adjudicator tests that read its default, `fixtures/replay/kept-policies.json`, `fixtures/recordings/`, `fixtures/scenarios/*.expect.md`, `tests/ci-gated.test.ts`, `CLAUDE.md` and `docs/team.md` (the one sentence D105 approved), `docs/judgment-and-defenses.md`, `examples/take.ts` and `examples/take.test.ts` (the separate CROW_SELLER fix), the rebuilt `site/setup.mjs`, `site/take.mjs` and `site/serve.mjs`, this file
- **Human gate:** no for this pull request; yes for the two deploys (carry agg-5, then the default), which are Rafa's
- **Status:** review
- **Agent/session:** agg5-cut-rule, 2026-11-25; branch `claude/agg5-cut-rule-887d79`
- **Roadmap row:** none (follows partner C's refund, 2026-11-25)

## What exists

Read on 2026-11-25 at `origin/main` `6f123c73`. The verdict filter (`packages/judgment/src/verdict.ts`) turns any schema failure into an abstention, so one character over a free-text cap discards the seat's scores. At the appeal after an escalation one lost seat rejects a unanimous pass (D27a), which refunded partner C's honest delivery. PR 824 (T-615) named each abstention's failing field in the record and added template pair 2, which states the limits in words; neither is the default yet. `agg-3` and `agg-4` shared the live filter. The default policy was screen-1, pair 1, agg-3.

## Intent

ADR-0049 / D105, adopted by Rafa on 2026-11-25. A judge's free text over its schema cap no longer costs the seat: the text is cut to the cap and marked, the record says so, and the verdict counts. Nothing else in a judge's output is repaired. Deals already signed keep the filter they bound.

1. `agg-5`: a criterion's evidence and the injection evidence over 300 code points, and the rationale over 600 or the policy's lower cap, keep `cap - 5` code points and end with `[cut]`. Counts are in code points, as the schema counts. The canary scan reads the whole output first; the URL step reads the kept text.
2. One reason line per cut seat in the aggregate, after the decision's reasons; never an escalation reason. `agg-5`'s decisions are `agg-4`'s.
3. `agg-3` and `agg-4` keep a frozen copy of the earlier filter, so their records do not move.
4. A separate commit makes screen-1, pair 2 and agg-5 the default for new deals.
5. The hard rule gains one sentence (D105).

- **Non-goals:** no schema, signed type, contract or API route change; no new judge call; coded verdicts are T-616 (`agg-6`), after a live calibration.

## Acceptance criteria

- [x] 301 code points are cut and the verdict counts; 300 are unchanged; each of the three fields, at 65,000 code points too (`cut.test.ts`).
- [x] A wrong key, an out-of-range score and every other schema fault still abstain with PR 824's named rule, also beside an overlong field (`cut.test.ts`).
- [x] The cut never changes a score, an id, a boolean or `overall` (property test, `cut.test.ts`).
- [x] Partner C's appeal accepts under `agg-5` and rejects under `agg-4`: the public model (`template-limits.test.ts`) and the private record (`partner-c-record.test.ts`, run with `CROW_PARTNER_C_DEAL`).
- [x] Pair 1's and pair 2's replay records under agg-3 and agg-4 are unchanged; agg-5's are recorded (`fixtures/replay/kept-policies.json`).
- [x] `kept-policies.json` carries agg-5, and a separate commit moves the default.
- [x] The sentence is in `CLAUDE.md` and `docs/team.md`.
- [x] The red team's attacks fail to move a decision, and its findings are fixed (`cut.redteam.test.ts`).

## Evidence

- Measured: `kept/verdict-0.ts` and `kept/agg-4.ts` differ from `6f123c73`'s `verdict.ts` and `aggregate.ts` only in their headers and import paths. Every agg-3 and agg-4 replay record is unchanged, for pair 1 and pair 2.
- Measured: agg-5 adds 48 replay records. 42 equal agg-4's; the 6 on the `filtered` path differ, because its overlong seat now counts.
- Measured: agg-5's decision digests equal agg-4's on both pinned corpora, and on every corpus input agg-5 returns agg-4's aggregate, with the cut lines appended when given.
- Measured: `partner-c-record.test.ts` with `CROW_PARTNER_C_DEAL` set to the private deal folder: under agg-4 the replay gives the recorded decision (reject) and both recorded reasons exactly; under agg-5 it accepts, 5 passes from 2 families, with one cut line per Claude seat.
- Inferred: the Claude seats' rebuilt outputs (the DeepSeek flash verdict with its first evidence run to 340 code points) match the live cause. The record keeps no raw output, so the cause stays an inference until a live run under pair 2 and agg-5.
- Measured: the default flip re-seats every recording (32 authored, 69 fake, no live) and updates all 63 snapshots. Masking hashes, the diffs show only redrawn seats, their families and pass families; no fixture's Aggregate decision or Released or Refunded outcome changed.
- Measured: the red team (Opus, `red-teamer`, given CLAUDE.md, ADR-0006, ADR-0036, ADR-0049 and the threat model) ran the nine attacks and more in 212 tests. It found no High.
  - M1 fixed: a base64 canary across the scan's 4,096-character window went unseen past the cut, and a panel agg-4 escalated accepted. agg-5's scan now decodes each run whole.
  - L1 fixed for agg-5: MIME-wrapped, off-grid and padded base64. The frozen agg-4 filter keeps these gaps; three `KEPT GAP` tests hold them as expected failures.
  - L2 fixed: a recut that completed an IPv4 pattern now leaves only `[link removed]`.
  - I1 fixed: a redaction that swallowed the mark puts it back.
  - I3 not done: a scenario with an overlong seat needs recordings that hold raw output; today's recording format refuses a verdict over the schema. The pipeline tests cover the same path.
  - After the fixes: 209 pass and 3 are the frozen version's expected failures; no replay hash moved.
- Measured: `take.mjs approve` with a mismatched or malformed `CROW_SELLER` is refused before the key file is read; with the check removed the new test fails.
- Bundles (measured sha256): `buy.mjs` `b5992bfd…` and `try.mjs` `71634a90…` unchanged. `setup.mjs` `1cb79b43…` to `ef1c150d…`; `take.mjs` `5cf411ed…` to `15cb5fd6…`; `serve.mjs` `e1f7a4a0…` to `85c014da…`.
- Commands run and results (measured, 2026-11-25, recipe 5):
  - `pnpm typecheck`: exit 0. `pnpm lint`: exit 0. `pnpm validate:spec`: ok.
  - `pnpm snap`: 63 passed.
  - `pnpm test`: 6406 passed, 3 expected fail, 325 skipped, 0 failed.
  - `node site/build.mjs && node site/check.mjs`: PASS.
- Snapshot diffs: all 63 move by the new policy hash: commitment IDs, input hashes, the redrawn seats and their pass families. No decision or outcome moved.

## Decisions

- The default keeps screen-1. Moving it to screen-2 is ADR-0044's own second deploy, not this task's.
- The default's flip re-seats the recordings with `scripts/reseat-recordings.mjs`: the new policy hash moves every commitment ID and so every panel. No recording is live (32 authored, 69 fake), so no live verdict claims a prompt it was not given.
- A redaction that lengthens evidence past 300 is cut by the same function and counted as a cut of that criterion.
- A policy cap under 5 code points keeps its first `cap` code points without the mark; the reason line records the cut.
- `docs/team.md` had no Rules and checks row for the verdict-schema rule, so the approved sentence lands in a new row with its checks.
- `take.mjs approve` checks `CROW_SELLER` before it reads the key file, so a funded take resumed through `approve` stops too.

## Handoff

Done: agg-5 in code, kept and recorded; the default flip in its own commit; the hard-rule sentence; the red team's findings; the `take.mjs` fix; the bundles.

Not done:
- The two deploys, which are Rafa's. The deploy guard refuses a default the live build does not carry, so deploy first the commit before the flip, `fix(judgment): the red team's findings on agg-5's filter` (agg-5 carried, with the fixes; at that commit the judgment, testkit and adjudicator suites pass 1882 and `pnpm snap` 63, measured), then the flip. The site bundles are current only from the branch's head.
- A live run of partner C's deal on the unchanged terms under pair 2 and agg-5.
- A scenario fixture with an overlong seat (red team I3), which needs a recording format that keeps raw output.
- Red team I2 (a URL only past the cut is a lost hijack signal) and I5 (`validatePolicy` accepts a rationale cap of 0 to 600, the schema 1 to 2000) are left as they are.

Next: T-616, coded verdicts as `agg-6`, after a live calibration.
