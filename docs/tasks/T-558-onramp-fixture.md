# T-558: give the on-ramp and the off-ramp their place in the neutrality test

- **Lane:** test
- **Phase:** 2
- **Kind:** a scenario fixture with its snapshot, and 2 (docs and records) for the neutrality rows; one red-team read of the fixture and the rows
- **Depends on:** none
- **Paths this task may touch:** `fixtures/scenarios/neutrality.onramp-*`, `docs/neutrality.md`, one line in `tests/cut-feature-alignment.known.json` (the fixture's `expire` step is the cut feature SC-6, as in `neutrality.adjudicator-never-accepts`), this file. Never `contracts/`, `spec/schemas/`, `.github/`, `packages/`, `CLAUDE.md`, `AGENTS.md` or `.claude/`.
- **Human gate:** no
- **Status:** in review
- **Agent/session:** the T-558 session, started by the coordinator on 2026-11-19
- **Roadmap row:** N201

## What exists

- `docs/neutrality.md` had one row for both ramps, with `neutrality.onramp-refuses` planned and no fixture (measured on `origin/main`, 2026-11-19: no `neutrality.*` fixture names an on-ramp or an off-ramp).
- `docs/plan.md`'s scenario index lists `neutrality.onramp-refuses` as planned, with the funding service (ADR-0026).
- The scenario language already names a buyer's payment address apart from its signing key (`parties.buyer_payment`, ADR-0033) and a seller's payout address (`parties.seller_payout`); `two-addresses-released` uses both.
- `neutrality.adjudicator-never-accepts` shows the same shape for an earlier stage: nothing is held, anyone expires the offer, every balance is unchanged.

## Intent

The neutrality test names on-ramps among the actors that must not be able to stop a valid deal, and asks for a fixture per actor. A hold is funded by one signature from the buyer's own payment address, so an on-ramp only fills that address and has no step in the deal. The task shows that with a fixture on today's product, and gives each ramp its own row: what it can and cannot do, which fixture shows it, and what risk is left.

Non-goals: no new protocol step, API route, message or schema field; no change to the scenario language. If a case cannot be written in today's language, the task records what is missing.

## Context

- `CLAUDE.md`, litmus test 1; ADR-0001; `docs/neutrality.md`.
- ADR-0033 (payment and payout addresses), D83 (card and bank money through regulated third parties), D32 (parties carry responsibility).
- Private research: `strategy/2026-11-18-card-and-bank-money.md`, parts 5 and 7.1 task 2.

## Acceptance criteria

- [x] A `neutrality.onramp-*` fixture passes `pnpm snap` on SimChain and its snapshot was read before committing.
- [x] `docs/neutrality.md` has an on-ramp row and an off-ramp row, each naming its fixture or why it has none, and a residual for an off-ramp that refuses a payout.
- [ ] `neutrality.onramp-refuses` (a first source refuses, a second funds, the deal ends Released): not expressible in today's scenario language; recorded below and kept planned.

## Out of scope

- Extending the scenario language with a top-up step or a fund-only step (see Handoff).
- `docs/plan.md`'s scenario index: the coordinator updates it in its daily docs commit.

## Evidence

All on 2026-11-19, in the T-558 worktree from `origin/main` `d9da8a00`.

- **Measured:** `pnpm build` (`tsc -b`, the typecheck) exits 0.
- **Measured:** `pnpm snap`: 49 passed, 0 failed, the new fixture included.
- **Measured:** `pnpm vitest run tests/design-map.test.ts packages/testkit`: 15 files, 193 tests passed, 1 skipped; this covers the standing-doc rule on `docs/neutrality.md`.
- **Measured:** after the review fixes, CI's static doc tests (`tests/cut-feature-alignment.test.ts`, `design-map`, `id-check`, `decisions-status`, `site-guides`): 5 files, 270 tests passed.
- **Measured:** `node scripts/id-check.mjs` with this PR's title, branch and `Closes T-558`: pass.
- **Measured, the snapshot (read before committing):** step 3 agree is ok and the deal is Agreed; step 3 fund is refused with `insufficient_funds` ("balance 1000000000 is below 2050000000"); at 30:04 (sim) anyone expires the deal through op-2 and it is Expired. The balances table has one row, the faucet: atlas-wallet 1,000 tUSD, escrow 0 tUSD, and nothing moves. Replay of 4 SimChain submissions matches; every applicable invariant holds.
- **Measured, the gap:** a scratch fixture (deleted, never committed) ran `agree_and_fund` twice on an underfunded address. The second run re-signs Agree, and settlement refuses it with `invalid_state` ("agree is not allowed in Agreed"), so no step funds an agreed deal after a refused funding.
- **Measured:** `snap --settlement local` on anvil (chain ID 31337), with `neutrality.adjudicator-never-accepts` as the reference: 2 passed, 0 failed. Both transcripts match SimChain's, and each fixture sends 0 transactions: the refused funding never reaches the chain.

## Decisions

- **One fixture, not the planned one.** The planned `neutrality.onramp-refuses` cannot be written today (Handoff). The fixture that can, `neutrality.onramp-offline-before-funding`, is the second case the brief allowed: the on-ramp goes offline after the buyer agrees and before it funds.
- **`fails: atlas-buyer`.** The scenario language lets `fails:` name only a party, an adjudicator or an operator, and records a failure only for the actor whose call is refused. Settlement never sees an on-ramp: it sees the buyer's funding refused as insufficient. The fixture names the buyer for that reason, and its description says the on-ramp is the cause. This is the design fact the row states: the on-ramp sits outside the protocol.
- **The payment address holds 1,000 tUSD, not 0.** A partly filled address shows that a refused funding holds none of it: the 1,000 tUSD is still there after the expiry.
- **No off-ramp fixture.** An off-ramp acts on no step of a deal, so no scenario can take it offline; settlement has finished before it is involved. The row says so and points to `two-addresses-released`, and residual 15 states the risk.

## Review

One red-team read (the `red-teamer` subagent), 2026-11-19. It found one blocking issue and five that don't block:
- **B1, High, fixed:** `tests/cut-feature-alignment.test.ts` failed: the fixture's `expire` step is the cut feature SC-6, and the file was not on the known list. Added the one line, as for `neutrality.adjudicator-never-accepts`.
- **N1, fixed:** naming another payment address takes a new deal the seller offers, because the address is in the terms the seller signs.
- **N2, fixed:** the wait differs by backend. SimChain takes funding until `fundBy`; on a chain the contract refuses funding from `offerExpiresAt`, which comes earlier, and the operators record the expiry.
- **N3, fixed:** the fixture could pass for the wrong reason (a refused agree past the deadline also ends Expired). `expect.problem` now pins `insufficient_funds` at step 3.
- **N4, no change:** the snapshot's outage line says "atlas-buyer timed out", the runner's generic text for a permissionless timeout.
- **N5, fixed:** gap 1 now reads "no step that tops up an address from outside the protocol", and this Handoff is filled.

## Handoff

**Done.** `neutrality.onramp-offline-before-funding` passes on SimChain. `docs/neutrality.md` has an on-ramp row and an off-ramp row and residual 15.

**Not done: `neutrality.onramp-refuses`.** Today's scenario language cannot write it (measured with a scratch fixture; the red team reached the same result). Three things are missing:
1. A step that tops up an address from outside the protocol during a run. The faucet sets balances at genesis only.
2. A step that funds an agreed deal after a refused funding. `agree_and_fund` re-signs Agree, which settlement refuses with `invalid_state`.
3. A way for `fails:` to name an actor that is not a party, an adjudicator or an operator, such as an on-ramp. It would also need a way to record that actor's failure.

Before writing that fixture, check one more thing: a top-up that arrives between `offerExpiresAt` and `fundBy` funds on SimChain but not on a chain, so the fixture should top up before `offerExpiresAt`.

**On the contract:** the fixture passes `--settlement local` with the same transcript as SimChain (Evidence). CI runs SimChain only.

**For the coordinator:** `docs/plan.md`'s scenario index needs a row for `neutrality.onramp-offline-before-funding` (exists), and `neutrality.onramp-refuses` stays planned for the reasons above.
