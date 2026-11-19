# ADR-0041: Spend controls are a protocol of their own, and Holdback sees only a funded payer

- **Status:** Accepted, 2026-11-19 (D84). Rafa decided the split on 2026-11-19 (section "The decision already made") and approved this record's outline the same day ("ok continue, looks good"). The points under "Open points for Rafa" are his.
- **Raised by:** T-554, roadmap row N204, after D83 left "the contract's design, its fee and who may deploy it" open.
- **Research:** [`docs/research/2026-11-19-spend-controls.md`](../research/2026-11-19-spend-controls.md): what a contract payment address meets at Holdback's funding, and a spike budget contract that funds inside its caps against the unchanged rules contract and is followed by the operators to Released. The research behind the protocol itself moves with it to its own repository.
- **Builds on:** ADR-0001 (neutrality), ADR-0002 (the hold), ADR-0005 (access by API), ADR-0031 (the phase-one contracts), ADR-0033 (payment and payout addresses), ADR-0034 (the mainnet gate), ADR-0038 (mandates), ADR-0040 (standing offers); D26, D31, D32, D83.
- **Amends:** no ADR. It answers D83's open point by moving the contract's design to the new protocol's own design record.
- **Changes:** no code, no schema, no route. This record, D84, the paragraph "Spend controls" in `docs/architecture.md`, and the research note.

Labels: **measured** (read at the cited line at `origin/main` `07e00f6a`, or run as cited), **documented** (a doc or published standard states it), **inferred**, **guessed**.

## Summary

1. **Spend controls are their own protocol, in their own repository,** private until its design and its first review are in. Holdback's repository holds none of its code.
2. **Holdback does not change:** not its contracts, API, schemas or operators. It sees a payment address that funds a hold, as it does today.
3. **The dependency points one way.** The protocol relies on six facts of Holdback's funding, which section 2 names, so a change to any of them is a visible decision. Holdback never calls the protocol, so a deal settles whether or not the protocol exists.
4. **The principal takes back any money not yet in a hold and stops its agent at once; money in a hold returns only by the deal's terms.** Approved merchants stay hard through the escrow, because a hold pays out only to the payout address in the signed terms or back to the payment address.
5. **Three Holdback changes may follow, each on Rafa's word:** the operators relaying a budget's funding, reading a contract buyer for stepping in on open deals, and the owner's guide in a current page.

## Context

- **D83, decided 2026-11-19:** card and bank money goes through regulated third parties; an agent spends from a budget its owner loads, under hard spend controls in a contract Crow deploys and pays the gas for, for a nominal fee. Open: the contract's design, its fee and who may deploy it.
- **ADR-0038:** the spending limit is the payment address. The mandate is a permission the operators and the counterparty check; the contracts read none.
- **Today's caps are the off-chain signer's** (`examples/signer.ts`, rule codes B3 to B14): the most per deal and per day, the deals open at once and their total, the listed sellers and payout addresses, and a stop flag. They hold only while the signer's machine stays out of the agent's reach (`site/ref/buyer-signer.txt`, "A signer with rules").

## The decision already made

**Decided by Rafa, 2026-11-19:**
- **A separate protocol.** "In general, we should classify this as a separate protocol. Holdback is escrow, but this we should call something else and add in another repo. We shouldn't entangle them but make them modular. Very likely you'll need a factory approach so each ephemeral agent gets their own spend controls."
- **The controls draw on practice.** "The design needs to deeply consider current procurement control patterns, but then translate that into smart-contracts and potential agent delegation patterns."
- **Claw back, intervention, approved merchants.** "Agent principal needs to be able to claw back money, and intervene,,, and the vault needs to be able to have approved merchants, but still use Crow (since you an prove money can go to end agent)."
- **The repository** is private on GitHub to begin with; its name comes from candidates put to him.

## Decision

### 1. Two protocols, one direction of dependency

- **Holdback holds money for one deal until the work is judged.** Spend controls decide whether an agent may commit its owner's money at all, for Holdback or any other place it pays.
- **The spend-controls contract is the owner's own wallet, not a settlement contract.** Its owner has over it what any key has over its own balance, and nothing over a deal. So Holdback's hard rule on admin keys, which covers settlement contracts, does not reach it; the neutrality test does (section 6) [inferred from `CLAUDE.md`, hard rules].
- **Holdback is the protocol's first venue.** The module that pays a Holdback deal lives with the protocol, as an optional part outside its core, pinned to a Holdback release. Holdback's repository knows nothing of it.

### 2. What Holdback offers a payment address

The protocol relies on these six facts. A Holdback change that breaks one needs its own ADR, and says what it means for a contract payment address.

| Fact | Evidence |
| --- | --- |
| Any address can be the payment address. An address with code is asked through ERC-1271 when its funding is checked | `contracts/src/HoldbackRules.sol:128`, `:191`; `contracts/lib/commerce-payments/src/collectors/ERC3009PaymentCollector.sol:42`; `contracts/script/TestUSDC.sol:92` [measured] |
| A hold is funded only by ERC-3009, from the payment address, to the collector, for price plus fee | `HoldbackRules.sol:117-140`, `:191`; `contracts/test/unit/Erc3009Only.t.sol` [measured] |
| The deal's stage is written before the rules contract's one external call | `HoldbackRules.sol:186`, `:191` [measured] |
| A hold pays out only to the terms' payout address or back to the payment address, and a refund is a plain transfer that runs no code on the payer | `HoldbackRules.sol:400`; `AuthCaptureEscrow.sol:315` [measured] |
| The operators follow a funding whose rules call appears verbatim in a transaction's calldata, and check only the adjudicator's acceptance and the buyer's agreement | `packages/settlement/evm/sync.ts:163-175`; `packages/settlement/evm/evm-settlement.ts:2270` [measured]; the spike followed to Released (research note, section 2) [measured] |
| Anyone can read a deal's stage | `HoldbackRules.sol:106` (`dealOf`) [measured] |

After a rules redeploy the protocol pins the new deployment; a budget and its money stay where they are.

### 3. What Holdback does not do

- **No spend-control logic in Holdback.** The rules contract, the operators and the API stay as they are. The protocol adds no route, signed message or schema to Holdback for its first version.
- **The mandate stays as ADR-0038 made it.** The operators' check of the mandate and the protocol's on-chain controls both apply, and the tighter one wins. The operators read no budget.
- **Holdback pays no fee and charges none** for a deal funded from a budget; the operators publish `fees.operator` at 0 for the pilots (`site/ref/limits.txt`, "No operator fee for the first pilots").

### 4. Taking money back and stepping in

| What the principal wants | How | When |
| --- | --- | --- |
| Take back money not yet in a hold | The owner withdraws it from the budget | First version |
| Take back an agent's allowance, or stop the agent now | The owner lowers, pauses or closes what the agent may spend; the next funding is refused | First version |
| Get money back from a funded deal | Only by the deal's terms: a reject or a timeout refunds the payment address, or both sides sign a settlement | By design |
| Stop the agent accepting work early on a funded deal, or act as the buyer in its place | The budget becomes the deal's buyer, a contract signer, and honours the agent's signature only while the agent may still spend; the owner signs through it | Later, on Rafa's word |

- **A hold cannot be taken back by the buyer's side alone.** If it could, it would protect no seller (ADR-0002, the second litmus test).
- **What stays open in the first version:** on a funded deal the agent's key can still accept the work early (`HoldbackRules.sol:339`), which releases the hold. The loss reaches only an approved merchant, and only the holds already funded [inferred].
- **What the later step needs from Holdback:** the contracts already accept a contract buyer (`HoldbackRules.sol:567-571`) [measured]. The operators must read a contract buyer's signature (residual 13 of `docs/neutrality.md`; T-227), and the API must carry the buyer's longer signature, in the same schema version as ADR-0040's seller signature, not a second one.

### 5. Approved merchants, through the escrow

A payer that checks a seller and its payout address before it funds knows the money can reach only that payout address or come back to it (`HoldbackRules.sol:400`) [measured]. So a list of approved merchants stays a hard rule even though the money passes through the escrow first. A card's merchant lock trusts the merchant's own descriptor; this one rests on the signed terms [inferred].

### 6. Gas, deployment and the fee

- **Funding.** In the first version whoever holds Sepolia ETH sends the budget's funding call: the agent's key with a little test ETH from its owner, or the owner. That works with no Holdback change (section 2). It is a step back from today, where a buyer needs no ETH (`site/ref/http.txt:42`); the operators relaying a budget's funding closes it (open point 1).
- **Deployment.** Crow may create an owner's budget and pay the gas and gain no power over it, if the protocol's factory makes the address follow from the owner, as ADR-0040 section 4 does for the seller contract. That is the protocol's design.
- **Crow-paid creation on request** needs a request that carries the owner's choices: a field or a route on an operator service, outside Holdback's protocol API (open point 3).
- **The fee** is Rafa's decision. The recommendation is none for now, and no fee code in any contract.

### 7. The seller side

Unchanged. ADR-0040's seller contract fixes the payout address in each template and has a one-way `retire`. A seller's sales per day and deals open at once stay off chain, because a seller's signature check is a read-only call that cannot count (ADR-0040, section 2).

## Litmus tests

- **Neutrality.** No owner, controller, module or factory of the protocol can stop a funded deal from settling by its terms or move a hold: a hold sits in the escrow, only the rules contract releases or refunds it, and a refund runs no code on the payer (section 2). On a fork of Sepolia the owner stopped its budget, removed the Holdback module and withdrew everything after a funding, and the deal still ended Released [measured by the design research]. The protocol carries that as its own neutrality fixture; Holdback's `docs/neutrality.md` gains its row when the module ships.
- **The hold.** Unchanged. Taking money back stops at the hold.
- **Defended judgment.** Unchanged.

## Consequences

- **Holdback:** documentation only today.
- **The protocol's repository:** its design record (the base, the name, the hierarchy, the factory, the controls), its research, its contracts and their attack tests. Before any real money, a budget holds an owner's funds outside the escrow, so it needs its own review and its own line in the mainnet gate (ADR-0034).
- **One backstop narrows.** A payer may call the escrow's own `reclaim` after its expiry (ADR-0033); a budget that makes no arbitrary call cannot. Holdback's timeouts, which anyone may send, still return every hold (`HoldbackRules.sol:424-459`) [measured].
- **An EIP-7702 delegation turns a key into a contract signer.** Six of seven well-known test keys hold one on Sepolia, and their plain signatures then fail (research note, section 4). An owner's or an agent's tool reads its address's code first.

## Open points for Rafa

1. **The operators relaying a budget's funding,** so an agent needs no ETH: a change in operator behaviour, with no route or schema change.
2. **Stepping in on funded deals:** reading a contract buyer (T-227) and the buyer's longer signature in the standing-offer schema version. **Answered in part by Rafa, 2026-11-19, to "Should a vault that buys (a contract as the buyer) go into the same schema change as standing offers?": "Yes, same change".** Schema v0.12 (ADR-0040) carries the buyer's longer signature beside the seller's, and the operators and the reference adjudicator read a contract buyer in the same build (T-549). He gave the same answer the same day to the standing-offers build: "Yes, add it". T-549 builds the reading only. **Answered by Rafa, 2026-11-19, to "May a vault's owner stop or replace its agent's signature on a deal that is already funded?": "Yes, the owner may".** A contract buyer's own code decides who signs for it, so a vault's owner may stop its agent's signing on a funded deal or sign in its place; the hold still pays out only by the deal's terms. Holdback builds no stop for this.
3. **Crow-paid creation on request:** a field or a route on an operator service.
4. **The owner's guide** in `site/ref/buyer-signer.txt` or `site/ref/limits.txt`, with one pointer and no new page.
5. **The fee:** none now is recommended.

The base, the name and the protocol's design are decided in the protocol's own record.
