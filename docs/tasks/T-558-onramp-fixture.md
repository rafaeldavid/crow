# T-558: give the on-ramp and the off-ramp their place in the neutrality test

- **Lane:** test
- **Phase:** 2
- **Kind:** a scenario fixture with its snapshot, and 2 (docs and records) for the neutrality rows; one red-team read of the fixture and the rows
- **Depends on:** none
- **Paths this task may touch:** `fixtures/scenarios/neutrality.onramp-*`, and since 2026-11-21 (the coordinator's brief for the second fixture) the scenario runner and parser in `packages/testkit/src/` and the step list in `fixtures/README.md`, `docs/neutrality.md`, one line in `tests/cut-feature-alignment.known.json` (the fixture's `expire` step is the cut feature SC-6, as in `neutrality.adjudicator-never-accepts`), this file. Never `contracts/`, `spec/schemas/`, `.github/`, `packages/`, `CLAUDE.md`, `AGENTS.md` or `.claude/`.
- **Human gate:** no
- **Status:** done
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
- [x] `neutrality.onramp-refuses` (a first source refuses, a second funds, the deal ends Released) passes `pnpm snap` on SimChain and `--settlement local`, with four new test-tooling steps (2026-11-21).

## Out of scope

- Any change to settlement, contracts, `spec/schemas/`, judgment or operator code. The 2026-11-21 steps are test tooling only.
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

**The second fixture, 2026-11-21,** in the worktree `t-558-onramp-refuses` from `origin/main` `38ba1a61`:

- **Measured:** the 3 new parser tests and 3 new runner tests failed before the implementation (`tsc` error: `outside` missing on `Scenario`; 3 parser tests failed) and pass after it: `vitest run scenario.test.ts runner.test.ts -t "T-558|scenario parser"`, 20 passed.
- **Measured:** `pnpm typecheck` exits 0; `pnpm lint` exits 0; `pnpm validate:spec`: 35 of 35 examples valid, `spec/openapi.json` ok.
- **Measured:** `pnpm test`: 293 files passed, 5 skipped; 5,498 tests passed, 158 skipped, 0 failed (511 s).
- **Measured:** `pnpm snap`: 52 passed, 0 failed.
- **Measured, the snapshot (read before committing):** step 3 agree is ok and the deal is Agreed; step 3 fund is refused with `insufficient_funds` ("balance 1000000000 is below 1550000000"); step 5 card-onramp's top-up is "refused (no call)" and Outages lists "Step 5: card-onramp refused to act"; step 6 bank-onramp tops up atlas-wallet at 00:06 (sim), well before `offerExpiresAt` (900 s), and the balances row reads 2,050 tUSD; step 7 fund through op-2 is ok and the deal is Held, with no second Agree; Bench A accepts on checks only and the deal is Released. Final balances: atlas-wallet 500 tUSD, tidewater-seller 1,500 tUSD, bench-a 25,050 tUSD, escrow 0. Replay of 6 SimChain journal entries matches; every invariant holds, conservation included.
- **Measured:** `pnpm snap --settlement local neutrality.onramp-refuses neutrality.onramp-offline-before-funding` on anvil (chain ID 31337): 2 passed, 0 failed; both transcripts are identical to SimChain's. `onramp-refuses` sends 3 adapter transactions for 504,097 gas; the top-up's mint is a setup-style transaction outside the adapter and is not counted.

## Decisions

- **One fixture, not the planned one.** The planned `neutrality.onramp-refuses` cannot be written today (Handoff). The fixture that can, `neutrality.onramp-offline-before-funding`, is the second case the brief allowed: the on-ramp goes offline after the buyer agrees and before it funds.
- **`fails: atlas-buyer`.** The scenario language lets `fails:` name only a party, an adjudicator or an operator, and records a failure only for the actor whose call is refused. Settlement never sees an on-ramp: it sees the buyer's funding refused as insufficient. The fixture names the buyer for that reason, and its description says the on-ramp is the cause. This is the design fact the row states: the on-ramp sits outside the protocol.
- **The payment address holds 1,000 tUSD, not 0.** A partly filled address shows that a refused funding holds none of it: the 1,000 tUSD is still there after the expiry.
- **No off-ramp fixture.** An off-ramp acts on no step of a deal, so no scenario can take it offline; settlement has finished before it is involved. The row says so and points to `two-addresses-released`, and residual 15 states the risk.

- **2026-11-21: four steps, all in `packages/testkit`.** `outside: [..]` lists actors outside the protocol (no key, no account, no faucet entry, names distinct from every actor). `fails:` and `offline` may name one. `refuses: { actor }` makes an outside actor refuse from then on and records outage kind `refused`. `top_up: { from, to, amount }` adds money to a party address (buyer, seller, payment or payout address; not an adjudicator, whose faucet money is its bond) from an outside actor: SimChain's test faucet, which its journal replays, or on anvil the test token's `mint`; the run's minted total grows by the amount, so conservation still holds. `fund: { by: buyer, via }` signs only the FundingAuthorization; `agree_and_fund` now calls the same code after its Agree.
- **No settlement or schema change was needed.** SimChain already had a journaled test faucet, and the anvil test token already mints to anyone. `refuses` is new rather than reusing `offline` because the fixture's on-ramp refuses rather than disappears, and the snapshot says which.
- **The top-up comes before `offerExpiresAt`,** per the 2026-11-19 Handoff, so the fixture runs the same on SimChain and the contract.
- **A second operator funds.** Step 7 goes through op-2, so the fixture also shows that funding after a refusal needs no particular operator.

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

**Done, 2026-11-21: `neutrality.onramp-refuses`** passes on SimChain and on anvil, with the steps in Decisions. The 2026-11-19 note that follows is kept as the record of what was missing:
1. A step that tops up an address from outside the protocol during a run. The faucet sets balances at genesis only.
2. A step that funds an agreed deal after a refused funding. `agree_and_fund` re-signs Agree, which settlement refuses with `invalid_state`.
3. A way for `fails:` to name an actor that is not a party, an adjudicator or an operator, such as an on-ramp. It would also need a way to record that actor's failure.

Before writing that fixture, check one more thing: a top-up that arrives between `offerExpiresAt` and `fundBy` funds on SimChain but not on a chain, so the fixture should top up before `offerExpiresAt`.

**On the contract:** the fixture passes `--settlement local` with the same transcript as SimChain (Evidence). CI runs SimChain only.

**For the coordinator:** `docs/plan.md`'s scenario index needs rows for `neutrality.onramp-offline-before-funding` and `neutrality.onramp-refuses`, both existing. No red-team read was run on the 2026-11-21 steps; they are test tooling, but a reviewer should check that `top_up` cannot make a fixture pass for the wrong reason (it only adds money, and the fixture pins the one refusal at step 3). CI runs SimChain only.
