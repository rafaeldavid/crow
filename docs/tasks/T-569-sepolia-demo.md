# T-569: one command plays the demo on Sepolia, and a measurement that it holds

- **Roadmap row:** none
- **Status:** in progress
- **Kind:** 9, live tests on testnet (the command is example code in `examples/`; no operator, adjudicator, settlement or schema code changes)
- **Started:** 2026-11-19, by the coordinator's list for the roadmap's demo stage (stage 2, "The initial demo, and design partners start")

## Intent

A person with a clean checkout and no key of Rafa's runs one command. It plays three deals on Ethereum Sepolia against the two live operators, each with fresh keys and faucet tokens:

1. **Release:** a good delivery that the live panel of two model families accepts. The deal ends Released.
2. **Reject:** a bad delivery that a deterministic check fails. The deal ends Refunded.
3. **Escalation:** a delivery the screen flags, so the primary adjudicator escalates. The appeal adjudicator's five-seat panel decides, and the deal ends by its decision.

The command prints a timeline a person can follow (each beat, each state, each explorer link, the seconds) and writes the same to `demo/out`. Then a measurement shows whether it holds: accepted of 5 runs of the good path, and whether the three beats fit in 5 minutes. The appeal beat stays on the SimChain demo (`pnpm demo`).

The bar, from the roadmap's stage 2: "one script plays release, reject and an escalation on Sepolia with live two-family judges in 5 minutes or less; the appeal beat plays on the SimChain demo; the good delivery is accepted on 5 of 5 runs [target guessed]".

## What already existed (2026-11-19, before this task)

| Beat | What existed | Why not used as is |
| --- | --- | --- |
| Release with a live panel | Round 1 scenario 1 (`examples/e2e-scenarios.ts`): a rubric deal, a French translation, the live panel | Derives its keys from the round's seed, which lives in 1Password (`E2E_SEPOLIA_SEED`) |
| Reject | Round 1 scenario 2: a checks-only deal whose delivery drops a row; also `site/try.mjs --outcome refund` | Same seed; `try.mjs` has no live panel |
| Escalation | Round 1 scenario 5b (`examples/e2e-scenarios-escalation.ts`): soft hyphens, the screen flags, the appeal adjudicator's panel decides; passed on the fixed contracts on 2026-11-19 in 99 s (measured, `reports/cutover-contracts-phase-one-2/e2e-rounds/2026-11-19T184703Z`) | Same seed |
| Release and refund with money addresses | Round 1 scenario 12 | Not needed for the demo's three beats |
| Rubric deal with fresh keys | `site/try-judged.mjs` | Buys from the test seller's quote route, which this task must not use |
| Appeal | Round 1's appeal group on SimChain (`examples/e2e-scenarios-appeal.ts`: 3c, 6, 7). `pnpm demo` has no runner for beat 8 (`no runner for beat 8; available: 1, 2, 3, 4, 5, 6, 7, 10`, measured 2026-11-19) | Phase one has no party appeal on chain (ADR-0031) |

## Acceptance criteria

- [ ] `pnpm demo:sepolia` plays the three beats against the live operators with fresh in-memory keys and faucet tokens, and needs no secret.
- [ ] It prints the timeline and writes it, with one JSON record per beat, to `demo/out/sepolia/<UTC time>/`.
- [ ] `--dry-run` reads discovery only, prints the plan and the judge budget left, and opens no deal.
- [ ] A test plays all three beats against the demo's own world on SimChain and checks the timeline, the records and that no key is printed or written.
- [ ] On Sepolia it refuses to start when the demo's live judge budget for the day cannot cover a run, so a run never ends with scripted judges standing in for live ones.
- [ ] `docs/demo.md` says how to run it in a few lines.
- [ ] Evidence holds the 5-run table, each number labelled measured.
- [ ] The appeal beat still plays on SimChain (`examples/e2e-scenarios-appeal.test.ts` passes).

## Evidence

**Plan of the measurement, set before run 2 (coordinator, 2026-11-19):** five runs of the good path on Sepolia, all recorded, none dropped. Runs 1 and 2 are full runs on 2026-11-19. After 00:00 UTC, run 3 is a full run, and runs 4 and 5 play the release beat alone (`--beat release`), because the demo's live judge cap cannot cover five full runs in a day (below). A run counts only if every panel in every judged beat was live. A panel is scripted when any seat's rationale starts with "[fake judge, no model ran]", since scripted seats still name the live models. From run 3 on, the command labels each panel live or scripted in its summary and its records (`panels`, `live`). It reads the judgment record every 3 s while a beat runs, because the operators serve only a deal's latest record, and the escalation's primary panel would otherwise be gone. Runs 1 and 2 were checked after the fact: every seat of their deciding panels has a model's own rationale and no mark (measured, the operators' judgment records).

### The five runs (every number measured)

Seconds are wall time on this machine for each beat, from opening its round to its last read; "all" is the whole command, from start to end. Each run's timeline and records are under `demo/out/sepolia/<UTC time>/` in the run's checkout (not committed); each deal's transactions are on Etherscan.

| Run | Start (UTC) | Commit | Release: state, s, checks | Reject: state, s, checks | Escalate: state, s, checks | All, s | Within 300 s | Good path accepted | Live calls (before → after) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2026-11-19 21:35:33 | `3ade3ec` (rebased as `f76d041`) | Released, 113, 11 of 11 | Refunded, 80, 11 of 11 | Released, 142, 22 of 22 | 142 | yes | yes, live panel | 8 → 19 |
| 2 | 2026-11-19 21:39:50 | `8622ffd` (rebased as `3299fb5`) | Released, 170, 11 of 11 | Refunded, 159, 11 of 11 | Released, 182, 22 of 22 | 183 | yes | yes, live panel | 19 → 30 |
| 3 | | | | | | | | | |
| 4 | | | (release beat only) | not played | not played | | n/a | | |
| 5 | | | (release beat only) | not played | not played | | n/a | | |

Accepted so far: 2 of 2 (measured). The table closes at 5.

**Builds (measured, discovery's `demo.build`):** runs 1 and 2 ran on operators at `c20ba52`, deployed 2026-11-19 21:13 UTC on both. Runs 3 to 5 wait for the deploy round of 2026-11-20 (main `254830bf`), so they measure the build a demo will use; each row names its build. The chain scheduled for 00:02 UTC never fired: the Mac slept, and no run started (measured, no run 3 log).

**The deals and their panels (measured):**
- Run 1, release `0xa66055182b03d8be6318547f225a75b869fb4283f6386618b9c2425391f0a016`. The primary's panel: deepseek-flash@2026-11-01 pass, claude-opus-5-5@2026-09-21 pass, deepseek-v4-pro@2026-11-01 pass. Decision accept.
- Run 1, reject `0x45df3064aee1882889664559a48deef697daa8aa1204d0279253da7a646de45e`. The `rows` check failed; decision reject; no panel ran.
- Run 1, escalate `0x58323c6352233b72fad8a39a5f39c971c7c3f31706ef06ff09fa3f80f315e2a9`. The screen flagged the hidden characters, so the primary escalated (its panel of 3: deepseek-flash, claude-opus-5-5, deepseek-v4-pro, all pass). The appeal adjudicator's panel of 5 (deepseek-v4-pro, claude-sonnet-5, claude-sonnet-5-5, claude-opus-5-5, deepseek-flash, all pass) accepted unanimously; Released.
- Run 2, release `0xa97529114fbf1c8e4c070d8a62c13f37ff503c0800a494e912b587b190b87921`. The primary's panel: claude-sonnet-5@2026-06-29 pass, claude-opus-5-5@2026-09-21 pass, deepseek-v4-pro@2026-11-01 pass. Decision accept.
- Run 2, reject `0xb8a0e3784c8888262b952e91b015be82b4f0b34c690b69d72f3f7bf720d00f4c`. The `rows` check failed; decision reject.
- Run 2, escalate `0x61ad4e33b28e8d3584ad46068c4c65609bd11a957b956bdbe9041c228d20768c`. The primary escalated on the screen flag (its panel: claude-sonnet-5-5, claude-opus-5-5, deepseek-v4-pro, all pass). The appeal adjudicator's panel of 5 (deepseek-flash, deepseek-v4-pro, claude-sonnet-5, claude-opus-5-5, claude-sonnet-5-5, all pass) accepted unanimously; Released.

**Who decides the escalation (documented).** The contracts name it the appeal adjudicator, `ROLE_APPEAL`, "which in phase one hears escalations only" (`contracts/src/HoldbackTypes.sol`). Both operators' `judgment.decided` events name `0x0cfd32...d796` with role `appeal`, and the adjudication fee of 1 tUSDC went to it (measured, run 2's escalate record). The fallback adjudicator (`ROLE_FALLBACK`) takes over only when the primary misses its deadline, which these runs do not show.

### The live judge cap (measured 2026-11-19)

- The operators allow 30 live judge calls per UTC day across the whole demo (`demo.judges.liveCallsPerDay` in discovery; the setting `LIVE_JUDGE_CALLS_PER_DAY`, default `DEFAULT_LIVE_CALLS_PER_DAY` in `apps/demo-cloud/src/judges.ts`).
- A full run used 11 calls each time: 3 for the release beat's panel and 8 for the escalation (the primary's 3 and the appeal adjudicator's 5). Discovery read 8, 19, then 30 calls around runs 1 and 2.
- So the cap covers about 2.5 full runs a day. Past it, every demo panel is scripted until 00:00 UTC, for every user and session. After run 2 the cap was spent for 2026-11-19.
- Tokens: the two full runs used 19,405 input and 4,461 output tokens together (discovery's `tokensToday`, 7,015 / 1,537 before run 1 and 26,420 / 5,998 after run 2, with no other calls in between). That is about 9,700 input and 2,200 output tokens per full run, at about 880 input tokens per call (measured). At list prices that is a few US cents per run (guessed).
- Raising the cap for a demo day is a change to `LIVE_JUDGE_CALLS_PER_DAY` on the operators plus an operator deploy. That is Rafa's call; this task changes nothing there.

### Tests and checks (measured)

- `/verify` for this kind (2026-11-19, after the rebase on `origin/main` at `22dd494`): `pnpm exec vitest run examples/demo-sepolia.test.ts examples/examples.test.ts tests/design-map.test.ts` passed 54 of 54 in 3 files; `pnpm -s typecheck` passed; `eslint` on both new files passed; `node scripts/id-check.mjs` passed ("names T-569"). No snapshot changed.
- `pnpm exec vitest run examples/demo-sepolia.test.ts`: 8 of 8 passed. They cover the three beats against the demo's own world on SimChain, the dry run, the re-roll refusal and `--rerun-after`, and a beat that cannot open its round. They also check that no seed or derived key is printed or written.
- `pnpm -s typecheck` and `eslint` on both files: no errors.
- `pnpm -s demo:sepolia --dry-run` against the live operators: exit 0; it printed the plan and "22 live calls left today (UTC); this run needs about 11" at 21:34 UTC.
- The appeal beat on SimChain: `pnpm exec vitest run examples/e2e-scenarios-appeal.test.ts` passed (2 passed, 1 skipped: the anvil variant, which needs anvil). That covers scenarios 3c, 6 and 7, the party appeals and the bond-paid overturn.

## Handoff

**State:** runs 1 and 2 passed on 2026-11-19. Runs 3 to 5 are scheduled from this task's worktree for 00:02 UTC on 2026-11-20, when the judge budget resets. Each run stops the chain if it exits non-zero; the re-roll guard refuses runs 4 and 5 if run 3's release beat is rejected by a live panel. The table above closes with them. To resume elsewhere: `pnpm demo:sepolia` for a full run, `pnpm demo:sepolia --beat release` for the good path alone, after checking `--dry-run` for the calls left.

**What was slow or flaky (for triage, not fixed here):**
- **Info · the demo primary sometimes takes about a minute to accept an offer.** In run 2 the release and reject offers, made at 21:40:16 UTC, reached AcceptedByAdjudicator 72 s later; in run 1 it took about 2 s (measured, the two timelines). It added about 70 s to run 2, which still fit in 300 s. Likely cause (inferred, not confirmed in Workers logs): the World's adjudicator pass backs off, doubling to once a minute, while nothing moves (`apps/demo-cloud/src/world.ts`, `nextPass`; `docs/operations.md`, the cadence paragraph). An offer that the fetch's `look()` does not see as a new settlement event does not `stir()` the world, so the acceptance waits for the next alarm. To confirm: Workers Logs for `alarmSet` and the pass times around 21:40 UTC. The owner is whoever next touches `apps/demo-cloud` (T-549's lane today). A demo that must stay under 5 minutes has about 2 minutes of slack (measured, run 2).
- **Low · the live judge cap fits about 2.5 full runs a day** (Evidence). A demo day needs the cap raised or the runs planned; that is Rafa's call.

**Review findings left open (Low, from the reviewer subagent):**
- A beat that stops mid-deal is not closed by the command. The operators send due timeouts themselves (T-231), and the windows are the club's shortest, so the deal closes within minutes (inferred). The refunded test tokens go to a key that only lived in memory. The timeline now prints the deal's state and deadlines when a beat ends unsettled.
- The live calls per beat (3 and 8) are constants in `examples/demo-sepolia.ts`, from the registry's panel sizes today. If the registry changes them, the budget refusal is off by the difference. The live-panel checks still fail a run whose panel turned scripted, so a scripted panel is never passed off as live.
- `pnpm demo` has no runner for beat 8 (the bond-paid wrongful decision); round 1's scenario 7 plays that story on SimChain.

**No deploy is needed:** the change is an example command and docs.
