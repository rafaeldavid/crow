# T-602: relayer lanes hold enough for a seller deploy

- **Lane:** demo
- **Phase:** 2
- **Depends on:** T-549 (the first take's deployment)
- **Paths this task may touch:** `packages/settlement/evm/live.ts`, `packages/settlement/evm/lane-gas.test.ts`, `apps/demo-cloud/src/world.ts`, `docs/operations.md`, this file.
- **Human gate:** no. The deploy waits for Rafa.
- **Status:** in review
- **Agent/session:** lane-floor, 2026-11-25; branch `relayer-lane-floor`
- **Roadmap row:** N216
- **Change kind:** 3 (relayer code)

## Intent

A buyer's first take of a new standing offer failed on Sepolia with `relay_refused: relayer 0xDB94… has too little test ETH for this transaction's gas` [measured by a smoke test, 2026-11-25]. The deal lanes held 0.011, 0.013 and 0.035 test ETH; the deployment estimates 18,295,444 gas [measured, `cast estimate`], and the lanes' floor (0.01) and top-up (0.03) were sized for an ordinary deal of 1.56 million gas. The funding lane held about 2.6 test ETH. A lane must hold enough for the send it is about to make.

## Changes

- `LiveChain.keepLanes(floor, topUp)` sets a gas policy. With it set, a deal lane's send reads the lane's balance (at the funding lane's last top-up block or later) and, when it is below the send's own cost (gas at the fee cap plus value), the funding lane sends the shortfall plus `topUp` first. An empty funding lane gives `RelayRefused` and the deal lane sends nothing. Without the policy, nothing changes.
- `PublicWorld.open` sets it from the first request: `LANE_FLOOR` 0.03 test ETH (was 0.01), `LANE_TOP_UP` 0.1 (was 0.03).
- The lane for a commitment stays the one its ID names (nonce order and in-flight rows depend on it); the lane is filled, not swapped.

## Sizing

- Deployment: 18,007,470 gas used, gas limit 19,210,420, gas price 0.13 gwei (about 0.00234 test ETH), tx `0x72c2f53cec090e08dd904a8e2fa2bf3a082db2f784f5aeef1820d615e6f8719e`, block 12208509 [measured, a Sepolia receipt, 2026-11-25]. `cast estimate` gave 18,295,444 [measured]; anvil used 2,548,720 [measured, T-549]. The send's check reserves the limit at the fee cap.
- Cost at 1 gwei tip and a 15 wei base fee: 0.0192 test ETH; at the 2 gwei tip clamp: 0.0384.
- Floor 0.03: one deployment at 1 gwei plus half again. Top-up 0.1: about 5 deployments or 64 ordinary deals. The funding lane's 2.6 test ETH fills the three lanes 8 times over.

## Client behavior [measured by reading the code]

`relay_refused` is HTTP 403 ("send it to another operator"). `examples/take.ts` (bundled as `site/take.mjs`, pinned) does not branch on it: the take's POST error reaches its final catch and the command prints `Stopped: ...`. `Agent.call` retries only a lost network answer (3 attempts, 1 s then 2 s), not a 403. A retryable status would need a new problem type in `spec/schemas`, which is an ADR plus a version bump: out of scope. With this change the refusal arises only when the funding lane is empty.

## Evidence

- `packages/settlement/evm/lane-gas.test.ts` (anvil): a lane between the old floor and the deployment's cost is topped up before the deployment, which mines; the deployment funds the lane its commitment names and leaves the others; an ordinary deal sends nothing from the funding lane; an empty funding lane gives `RelayRefused` and no deal-lane transaction.

- Checks [measured, 2026-11-25]: typecheck and lint clean; `lane-gas.test.ts` 4 of 4 on anvil; `pnpm snap` 53 of 53; `node site/build.mjs && node site/check.mjs` PASS with no bundle hash change; `pnpm test` 5,904 passed and 28 failed, all in `deploy-script.test.ts` (27) and the creation-code pin in `examples/take.test.ts` (1). The 28 compare against `contracts/out`, which this worktree built locally with a bytecode that differs from the pinned one [inferred: environment, the branch touches no contract or deploy file; not re-run on main].
- Reviewer pass: PASS. Open notes: the once-a-minute `topUpLanes` can fill a lane the per-send check just filled (benign, bounded); the funding-lane refusal is matched by the node's error text, and an unmatched wording gives a 500 and sends nothing.

## Handoff

Deploy of holdback-op1 and op2 is Rafa's. Then run the smoke test's first take again. Pinned bundle hash: no change (`site/take.mjs`, `site/buy.mjs`, `site/try.mjs` are untouched).
