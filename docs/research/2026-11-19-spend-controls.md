# Spend controls at Holdback's funding: what a contract payment address can do today

**State: research for ADR-0041 (D84, T-554, roadmap row N204), 2026-11-19. Spend controls become a protocol of their own, in their own repository (D84); this note keeps only what Holdback offers such a protocol, measured against Holdback's code. Two scratch tests ran, one on a local chain with Foundry and one on anvil with the operator's settlement code; nothing was built, deployed or sent.**

Labels: **measured** (read at the cited line at `origin/main` `07e00f6a`, or run as cited), **documented** (a doc or published standard states it), **inferred**, **guessed**.

The research behind the protocol itself, its design, how payment and procurement products model spend controls, and which existing wallet standards could carry them, moves to that protocol's own repository with its design record.

## 1. What a payment address meets at funding

| Fact | Evidence |
| --- | --- |
| A hold is funded only by ERC-3009: `agreeAndFund` calls the escrow's `authorize` with Commerce Payments' ERC-3009 collector and the funding signature | `contracts/src/HoldbackRules.sol:191`; a Permit2 signature is refused, `contracts/test/unit/Erc3009Only.t.sol` [measured] |
| The collector asks the token to move the hold from `buyerPaymentAddress`, with the funding signature, by `receiveWithAuthorization` | `contracts/lib/commerce-payments/src/collectors/ERC3009PaymentCollector.sol:42` [measured] |
| Sepolia's tUSDC checks that signature with Solady's `isValidSignatureNow`, so a payment address with code is asked through ERC-1271 | `contracts/script/TestUSDC.sol:92` [measured]. Native USDC on mainnet does the same, by ADR-0034 [documented] |
| The rules contract writes the deal's stage before its one external call | `HoldbackRules.sol:186`, then `:191` [measured] |
| A hold pays out only to the terms' `sellerPayoutAddress` or back to `buyerPaymentAddress` | `HoldbackRules.sol:400`; every void returns to the payer, `:128` [measured] |
| A refund is a plain token transfer to the payment address: no code on the payer runs | the escrow's void sends to `paymentInfo.payer`, `contracts/lib/commerce-payments/src/AuthCaptureEscrow.sol:315` [measured by reading] |
| On a funded deal, the buyer key alone can accept early; a settlement needs the buyer and the seller | `HoldbackRules.sol:339`, `:377-378` [measured] |
| The operators follow a funding they did not relay when the rules call is at the top level, in a Multicall3 bundle, or written verbatim in another contract's calldata, and they check only the adjudicator's acceptance and the buyer's agreement | `packages/settlement/evm/sync.ts:163-175`; `packages/settlement/evm/evm-settlement.ts:2270` [measured] |
| Core's funding step checks the payer, the ID, the deadlines and the amounts, and verifies no funding signature | `packages/core/src/state.ts:323-350` [measured] |
| Agents hold no Sepolia ETH today: the operators pay the gas | `site/ref/http.txt:42` [measured] |
| The API carries a funding signature of exactly 65 bytes | `spec/schemas/common.schema.json:15-19` [measured] |

So a contract can be a buyer's payment address today, with no change to Holdback, as long as it approves the one funding it means to pay [inferred from the rows above].

## 2. The scratch tests: a budget contract as the payment address

**The test** [measured, 2026-11-19]. A spike budget contract ran against the unchanged `HoldbackRules`, the vendored Commerce Payments escrow and collector, and the repository's test base (`contracts/test/unit/Base.sol`). The spike and its tests are kept as text: [`2026-11-19-spend-controls/BudgetSpike.t.sol.txt`](2026-11-19-spend-controls/BudgetSpike.t.sol.txt) and [`budget-spike.test.ts.txt`](2026-11-19-spend-controls/budget-spike.test.ts.txt). It is a measurement, not the build: one agent key, no hierarchy, no review.

**Two ways to count a funding**, both against the unchanged rules contract:

| Mechanism | Funds inside the caps | Above a cap | Gas of the funding call |
| --- | --- | --- | --- |
| A plain key as the payment address | yes | n/a | 297,095 |
| W: the budget exposes the rules contract's own `agreeAndFund` (same selector and encoding), checks and counts its caps, approves the exact ERC-3009 digest in transient storage for the length of its own call, and forwards the call verbatim | yes | reverts with the cap's own error, `OverPerDeal()` or `TooManyOpen()` | 438,729 |
| P: the funding signature is an ERC-6492 blob whose prepare call, which the collector runs through Multicall3 before the token's check, counts the deal; the deal is already Held then | yes | the prepare's revert is swallowed by `tryAggregate(false)`, and the token refuses with "invalid signature" | 871,644 |

`forge test --match-path test/spike/BudgetSpike.t.sol -vv`: 8 of 8 passed [measured]. Also measured there:
- A funding for a budget-paid deal sent straight to the rules contract reverts: the budget approves no digest outside its own call (`test_W_directToRules_refused`).
- P's prepare called outside a funding reverts, because the deal is not Held (`test_P_prepareOutsideFunding_refused`).
- W's extra 141,634 gas is mostly first writes: the day's total, the open list, the hold and expiry per deal, the open total, five slots of about 22,100 gas each [inferred from the slot count].

**The operators' view follows a W funding with no node change** [measured: `pnpm build && pnpm vitest run packages/settlement/evm/budget-spike.test.ts`, anvil, the contracts from `contracts/out`, the operator's `EvmSettlement` on a `LiveChain`, TestUSDC; 1 of 1 passed in 17.29 s]:
- the owner deploys the budget, sets its caps and lists the seller with its payout address; a mint loads it;
- the agent, the deal's buyer key, sends the rules contract's own `agreeAndFund` calldata to the budget's address;
- above the cap per deal, the transaction reverts;
- inside the caps, one `ChainSync.pass()` applies it (`applied: 1, behind: 0`), the operator relays the delivery and the primary's accept, and the deal ends Released;
- the funding signature in the forwarded call is 65 bytes from an unrelated key: nothing checks it, so the stored funding keeps the API's shape.

**A wider sketch on a fork of Sepolia** [measured by the T-554 design research, 2026-11-19, at blocks 12,166,795 and 12,166,890, against the deployed rules contract, escrow, collector and tUSDC]: the flat budget passed 13 of 13 tests, and a vault with three levels of grants and a stateless Holdback adapter passed 18 of 18. After a funding, the vault's owner stopped the vault, removed the adapter and withdrew the whole balance; the seller still delivered, the primary accepted, the deal ended Released and the seller was paid. The fork tests stay with the protocol's repository.

## 3. Why an existing wallet module does not reach the funding

- **The token asks the payer with a digest only.** An account answers ERC-1271 from its owners' or a session key's signature, or from a message it marked signed earlier; none of the wallet modules the research read is asked at that moment with the deal in view [measured by reading each module's ERC-1271 path; listed in the protocol's research].
- **A rule on the signed fields cannot say who is paid.** The ERC-3009 nonce is the payer-agnostic hash of Commerce Payments' `PaymentInfo`. On a fork of Sepolia, an authorization to the collector for exactly a per-deal cap paid a stranger: its nonce named a payment of another operator of the same escrow, which any contract can be [measured by the design research; `contracts/lib/commerce-payments/src/AuthCaptureEscrow.sol:236-241`].
- **What these modules give today is a top-up:** a capped amount moved into the agent's own key per period. The agent's key then pays any deal with what it holds [inferred from the modules' code].
- **A Safe as the payment address funds only by a direct call its owners approve:** it marks the digest signed, and `agreeAndFund` passes with an empty funding signature, which the API's 65-byte field cannot carry [measured by the design research on the fork].

## 4. Two side findings

- **An EIP-7702 delegation changes how a key signs for Holdback.** Six of seven well-known test keys hold a 7702 delegation on Sepolia (23 bytes of code from `0xef0100`), and the rules contract then asks that code instead of recovering the key, so every plain signature from them fails `BadSignature` [measured by the design research, `cast code`, 2026-11-19]. An owner's or an agent's tool should read its address's code before it relies on a plain signature.
- **The payout restriction makes an approved-merchant list hard through the escrow.** A payer that checks the seller and its payout address before funding knows the money can reach only that payout address or come back (section 1, row 5) [inferred].
