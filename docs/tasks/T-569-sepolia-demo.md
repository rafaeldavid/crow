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

(filled in as the runs are made)

## Handoff

(filled in at the end)
