# T-526: the operators post the delivery before a reject or an escalation

- **Lane:** settlement
- **Phase:** 2
- **Kind:** 5, settlement and judgment code (`docs/team.md`, Change recipes): the package's tests with anvil, and a red team
- **Depends on:** T-523 (the triage of an outside scan's findings), D4 (two transactions on the happy path)
- **Paths this task may touch:** `packages/settlement/evm/evm-settlement.ts`, `packages/settlement/evm/evm-settlement.test.ts`, `docs/decisions-today.md` (one entry), this file
- **Human gate:** no for the change; a deploy of the operators is Rafa's
- **Status:** in review
- **Agent/session:** scan-fixes-main, started by the coordinator on 2026-11-18
- **Roadmap row:** N189

## Intent

An outside scan's finding, group G1: a contract call that carries the seller's delivery re-checks the seller's signature inside the caller's transaction. The seller can make that call revert, by posting another delivery first or by having its wallet refuse, after the call's calldata has made the primary's panel seed public. The seller then knows the seed when it delivers again.

Only a decision other than an accept gives the seller a reason to do that. So the EVM adapter carries a held delivery only in an accept or an early accept. A reject or an escalation on a carried delivery is sent as `deliver`, then `decide` once the delivery is posted. An accept keeps D4's two transactions.

Non-goals: no contract change (the deployed contracts keep the carried path, and anyone who relays directly can still use it); no change to the hosted sellers; no change to the early accept.

## Acceptance criteria

- [x] With a carried delivery in Held, a primary's reject or escalation is relayed as `deliver` then `decide`, and the decision's calldata holds no delivery. An accept still carries it in one `decide`.
- [x] A carried reject the contract would refuse sends no transaction, the delivery included.
- [x] A restart between the two transactions lands the delivery as a plain relay with no Idempotency-Key, so the decision's key answers only once the decision lands.
- [x] Each test fails before the change and passes after it (the refusal test guards the new path, so it passes before too).
- [x] A red team has read the change, and its blocking finding is fixed.
- [x] `docs/decisions-today.md` records the agent's call (D79) that a carried reject is three transactions where it was two.

## Evidence

Measured on 2026-11-18 in the worktree `t-526-scan-fixes-main`, on anvil (127.0.0.1, chain 31337), unless marked.

- **Where the carried path runs.** The operator's deliver route posts every delivery the seller submits (`apps/operator/src/server.ts`, `submit({ kind: 'deliver' })`). `carryDelivery` has one caller outside tests, the gas harness (`packages/settlement/evm/gas.ts:44`). So the live operators never carry a delivery, and this change alters no live deal; it guards the carry path for whoever uses it.
- **Before the change.** In `packages/settlement/evm/evm-settlement.test.ts`, with the adapter at `origin/main`, 4 of the 5 new or changed tests failed:
  - "a carried delivery travels only with an accept: a reject or an escalation is sent after the delivery is posted (G1)";
  - "gas per deal: reject (fee-only capture + void) settles Refunded in 3 transactions (D4)";
  - "gas per deal: escalation, then the appeal adjudicator decides settles Released in 4 transactions (D4)";
  - "a restart after a carried reject's delivery lands applies the delivery alone, and the reject's key replays nothing (G1)".
  - "a carried reject the contract would refuse sends nothing, the delivery included (G1)" passed: the old path sent nothing either, and the test guards the new one.
- **After the change.** `evm-settlement.test.ts` and the red team's `t526-redteam.test.ts`: 2 of 2 files and 49 of 49 tests pass. The whole package with the lint-rule tests (`vitest run packages/settlement tests/read-after-write.lint.test.ts tests/read-after-write.lint-bypass.test.ts`): 24 of 24 files and 388 of 388 tests pass, none skipped. That run includes the T-232 red-team tests for O-3 and O-4 (`t232-redteam.test.ts`) and the O-2 bypass cases, which T-409 fixed.
- **Red team (kind 5), on its own anvil.** Five fixtures in `packages/settlement/evm/t526-redteam.test.ts`:
  - `attack.t526-seller-frontruns-posted-delivery` (reject, escalate): the decision is refused, the seed is in no calldata, and a retry under the decision's key does not replay. Passes.
  - `attack.t526-decide-send-fails-after-deliver`: an RPC error on the `decide` after the delivery landed; the book follows the chain, and the retry lands `decide` once. Passes.
  - `attack.t526-accept-path-unchanged`: an early accept on a carried delivery is still one `earlyAccept`. Passes.
  - `attack.t526-decide-calldata-holds-delivery`: failed on the first version, which sent the posted delivery and the seller's signature in the `decide` after it. The contract reads neither outside Held, so nothing was exploitable [inferred from the contract and measured by the front-run test]. Fixed: that `decide` sends no delivery. Passes.
  - Not blocking, recorded in D79: the posted delivery tells a mempool watcher that the decision is not an accept, so the seller gets one free look at the verdict per deal (Medium). The alternative that closes it is Rafa's to choose.
  - Info, not regressions: the book trails the chain after a seller's direct delivery until a sync pass (T-218); after a failure the key stays unstored, as before.
  - BLOCKED for the red team: an ERC-1271 seller whose answer changes; the package has no such test wallet. Its revert takes the same refusal branch as the front-run [inferred].
- **Types and lint.** `pnpm typecheck` and `eslint` on the changed files exit 0.

## Handoff

**Done:** the relay rule, its tests, the red team's fixtures and D79.

**A deploy of the operators would carry:** no behaviour change for today's deals, because no live path carries a delivery. The adapter's carried reject and escalation would take three and four transactions where they took two and three.

**Open:** the free look (D79) stays until Rafa chooses between the rule as built and "no decision carries a delivery". The docs batch corrects the bound for contract signers in `docs/audit/` (the plan's D-2, decided). The on-chain lever stays for anyone who relays directly; the contract lane owns its documenting test.
