# Amending a funded deal: how terms bind today, and how others change terms after funding

**State: research for ADR-0039 (D78, T-524, roadmap row N188), 2026-11-18. Recommendation in the ADR. One scratch test ran on a local chain (section 2a); nothing was built, deployed or sent.**

Labels: **measured** (read at the cited line: `contracts/src/` at the tag `contracts-phase-one-1`, commit `27ab44e8`; the rest at `origin/main` `1c9ffacf`), **documented** (a repository doc states it), **checked** (an outside page said it when this pass opened it on 2026-11-18), **search** (a search result's summary said it on 2026-11-18; the page itself was not opened), **recalled** (from the model's knowledge, not opened that day), **inferred**, **guessed**. A claim with a file and line and no label is measured.

Short forms: `R:` is `contracts/src/HoldbackRules.sol` and `T:` is `contracts/src/HoldbackTypes.sol`, both at the tag.

## 1. The need, measured

Both pilot deals so far ended the same way. A finished report met the deal's signed checks for the first time, and the seller's own check refused to deliver it. Both deals were `Held` with nothing delivered, and nothing was lost [measured: the private record, `docs/private-materials.md`; names and IDs stay there].

- **First case, a pilot buyer's deal on 2026-11-17.** The kit's stand-in for the pilot seller's API had the wrong shape, and the checks were written from a mock report. The real report failed two of the five signed checks.
- **Second case, Crow's own scan on 2026-11-18.** The checks were already corrected against the first case's real report from the same seller. Crow's report failed the same two checks on two new shapes of a known finding: no location at all, and no issue ID. Neither shape was in the mock or in the first real report.

Each fix took four moves: new terms, a redeploy of the hosted seller, a second deal that takes over the finished job (T-501), and a full refund of the first deal that both parties sign (T-503). The second case's run sheet has six steps by a person: redeploy, quote, name the job, go, the seller's refund signature, the buyer's refund signature [measured, private run sheet].

### What the gate before signing removes

Since 2026-11-18 no deal is signed until its checks have run on one real delivery from that seller.

- It would have caught the first case: the checks had never met a real report [inferred].
- It would not have caught the second case. The checks had met one real report from that seller, and Crow's report still carried shapes that report did not have [inferred from the measured causes].
- So each new job can bring shapes no earlier delivery showed. The gate makes the need rarer; it does not remove it [inferred].
- Changes to deadlines, scope or price have no measured case yet. Longer jobs will likely bring them [guessed].

## 2. How a deal's terms bind today, end to end

### The commitment both parties sign

- The seller signs the commitment ID, which is the domain-free EIP-712 struct hash of `CommitmentTerms` (ADR-0016; `T:307`). The buyer signs `Agree {commitmentId, buyer, nonce, expiresAt}`. The primary adjudicator signs `AdjudicatorAcceptance {commitmentId, adjudicator, seedCommitment, policyHash, registryHash, fee, bondReserved, nonce, expiresAt}`. `agreeAndFund` checks all three, then the buyer's payment address's ERC-3009 authorization (`R:146`).
- Every later entry point takes the full terms in calldata and recomputes the ID (`R:212` `decide`, `R:360` `mutualSettle`, `R:424` `reclaim`). The contract stores no terms. It stores one word per deal and the posted delivery's hash.
- So on chain the terms of a deal are fixed by its name. Any changed field gives another ID and so another deal.

### What the hold binds to

- `_paymentInfo` (`R:117`) derives the escrow's `PaymentInfo` from the terms: payer `buyerPaymentAddress`, receiver `sellerPayoutAddress`, token, `maxAmount` price plus fee, `preApprovalExpiry` `fundBy`, `authorizationExpiry` and `refundExpiry` from `_escrowExpiry` (`R:479`: `fallbackBy + appealDecideSec + EXPIRY_MARGIN`), salt the commitment ID (`R:138`).
- The Commerce Payments escrow identifies a payment by the hash of `PaymentInfo` with the chain ID and the escrow's address. It authorizes a payment once, for at most `maxAmount`. No function raises the amount or the expiries. `void` takes no amount and returns everything still capturable [checked: `base/commerce-payments` README and `docs/operations/Authorize.md`, `Void.md`].
- So any amendment that changes the payer, the receiver, the token, the amount above the hold, or the expiry beyond the funded one cannot be processed by this escrow. A new funding is a new deal.

### What the contracts read, and what they only carry

`T:36-44` names them:
- **Enforced:** `buyer`, `seller`, `buyerPaymentAddress`, `sellerPayoutAddress`, `token`, `price`, `fee`, `adjudicator`, `fallbackAdjudicator`, `appealAdjudicator`, the timing (`offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy`, `appealDecideSec ≥ 1`, `appealWindowSec = 0`, `maxSubmissions = 1`; `R:166-172`). `policyHash` and `registryHash` enter the primary's acceptance and every decision (`T:410`).
- **Signed only:** `schemaVersionHash`, `clubIdHash`, `rulebookHash`, `deliverableHash`, `acceptanceHash`, `policyIdHash`, `remedyHash`, `disclosureHash`, `buyerKeyHash`, `nonce`, `createdAt`, and the dispute timing fields.

The acceptance checks and the rubric sit behind `acceptanceHash`. No contract check reads it. `docs/audit/state-model.md` section 8.3 records the verdict on each signed-only field [documented].

### What the adjudicator and the operators read

- The adjudicator judges the terms the operators hand it, and refuses terms that do not hash to the commitment ID (`apps/adjudicator/src/service.ts:590`, `#termsMismatch`). It judges under the policy whose hash the terms bound (ADR-0036).
- A decision names the commitment, the attempt, the posted delivery's hash, the role, the outcome, the seed, `policyHash`, `registryHash` and `judgmentRecordHash` (`T:410`). The contract checks the role, the attempt, the delivery, the seed and the signature (`R:212` onward). It does not check which checks the adjudicator ran.
- The hosted seller's own check before delivery runs the signed terms read from `GET /v1/commitments/{id}/terms` (`apps/hosted-sellers/src/check-report.ts:34`, `:88`).

### The settlement both parties sign

`MutualSettlement {commitmentId, hasDelivery, deliveryHash, payouts, releaseKey, nonce, expiresAt}` (`R:360`). It works in `Held`, `Delivered`, `FallbackJudging` and `Escalated`. Outside `Held` it must name the posted delivery (`R:374`). In `Held` it may name a delivery the buyer holds and release its key (settling late work; `site/ref/after-funding.txt`). The payouts must sum to the price and go only to the two money addresses; the fee returns to the buyer. It ends the deal, and it cannot change terms.

### The delivery count

`maxSubmissions` must be 1 (`R:168`), the only attempt is 1 (`R:47`), and `_acceptDelivery` writes `deliveryHashOf` once, before `deliverBy` (`R:69`, `R:524`). The first decision by the primary or the fallback is final (ADR-0031).

### The deadlines and the hold's expiry

Each deadline is read from the terms; each opposing pair splits time at one instant (`docs/audit/state-model.md` section 6). The operators send `reclaim` one to two minutes after `deliverBy` when nothing is delivered (`site/ref/after-funding.txt`). The escrow's expiry follows the last possible decision by `EXPIRY_MARGIN`.

### The per-deal keys

In private and judgment-level deals the `buyer` and `seller` addresses are per-deal keys, attested by a `Delegation` (ADR-0024 section 7). Private deals stay deferred through the pilots (D70).

### What the phase-one contracts allow with no change

- **Replacing a deal in one transaction,** for any change of terms (section 2a) [measured].
- **An in-place amendment of `acceptanceHash` or `deliverableHash`** that the operators and the adjudicators honour off chain: the decision would settle on the same ID, since the contract never reads those fields [inferred from `R:212` onward]. No other field can change in place: every other field is enforced, or is part of `PaymentInfo`.

## 2a. Replacing a deal in one transaction, tested on a local chain

Rafa asked on 2026-11-18 for this path to be weighed equally: the API helps sign one atomic transaction that refunds the old deal and funds a new one from the refund. The test below answers whether the frozen contracts allow it.

**Why it should work, from the code.** Every entry point is permissionless and the rules contract never reads `msg.sender` (`R`'s contract comment; `docs/neutrality.md`, the operator row). `mutualSettle` voids the old hold to the buyer's payment address (`R:360`). `agreeAndFund` then authorizes a new hold through the ERC-3009 collector from the same address (`R:146`). The escrow authorizes as the rules contract, whoever sent the transaction [inferred].

**The test** [measured, 2026-11-18]. A scratch Foundry project linked the main checkout's `contracts/src/`, which `git diff contracts-phase-one-1 HEAD -- contracts/src` shows equal to the tag, and the repository's own test base (`contracts/test/unit/Base.sol`). A small `Batch` contract, standing in for Multicall3, calls `mutualSettle` and then `agreeAndFund` in one call. The test is kept as [`2026-11-18-amending-a-funded-deal/Replace.t.sol.txt`](2026-11-18-amending-a-funded-deal/Replace.t.sol.txt). `forge test --match-contract ReplaceTest`: 4 passed, 0 failed.

| Case | Result |
| --- | --- |
| The buyer's wallet holds nothing but the old hold. One call refunds the old deal in full, with the new commitment ID as the refund's `nonce`, and funds a new deal with other checks | Old deal `Settled`, nothing capturable; new deal `Held` with price plus fee capturable; the token store holds one hold; the wallet at 0 |
| The same, with the new deal's `Agree` signed by another key | The whole call reverts with `BadSignature`; the old deal stays `Held` with its hold intact; the wallet at 0 |
| The same, with a new price 1 base unit above what the refund returns | The whole call reverts; the old deal stays `Held` with its hold intact |
| The refund alone, its `nonce` naming a deal that is never funded | It settles, as today's agreed refund does |

The first run's two assertions were wrong: one prank and one expected revert were spent on a helper's call, and `_held` reads the whole token store, not one deal. They were fixed and rerun; the contracts were not touched.

**On Sepolia.** Multicall3 has code at `0xcA11bde05977b3631167028862bE2a173976CA11` [measured: `eth_getCode` through `ethereum-sepolia-rpc.publicnode.com`, 2026-11-18]. Gas for one replacement is about 840,000: a settlement measured at 272,170 plus a funding measured at 569,768 to 572,680 on Sepolia [inferred from the private record's measured figures].

**The tie.** Rafa decided the default on 2026-11-18: transaction data signed by both the buyer's and the seller's original keys. The refund's `nonce` is a free 32-byte value both parties sign (`T:164-168`). It enters only the settlement's struct hash (`T:439-458`), and no line of `R` names it, so it can carry a hash with no contract change. The test used the new commitment ID as the nonce. ADR-0039 uses the hash of a `SettlementNote` instead, so the same field also records a waiver. The commitment schema has no field that names an earlier deal and allows no extra fields [measured by the coordinator], so the new terms cannot carry the tie without a schema change.

## 2b. The waiver, and why neither pilot used it

- **The money path exists.** In `Held`, the settlement both parties sign can name a delivery the buyer holds and release its key ("settling late work", `site/ref/after-funding.txt`). The kit's case 9 ran it to `Settled` with the key released [measured, private record]. `docs/what-a-deal-can-do.md:27` says it "also serves a seller that holds back work that fails a check and shows the failures, then settles with the buyer" [documented]. The buyer must not hold its own envelope before it signs, or it could open the work and decline; so in a waiver the seller submits, with the envelope (ADR-0039 section 2).
- **The hosted seller never offers it.** On a failed check it "delivers nothing, alerts you with each failed check, and waits for your fixed report until `deliverBy`" (`site/ref/seller-adapter.txt:12`). Its routes are `ready`, `job` and `refund` (`examples/seller-adapter-core.ts:1974-1981`). None hands the signed work to the buyer. In Crow's case it fetched the result again every 600 s with the same refusal [measured, private record].
- **What the buyer can see before a waiver.** `/health` lists each refused deal's failing checks, with `checkId`, `pointer` and a message rebuilt from fixed phrases, and no report content (`site/ref/seller-adapter.txt:44`). The content stays encrypted until the key is released (ADR-0012).
- **What a reader can already tell.** `MutuallySettled` and `KeyReleased`'s `path` (`KEY_MUTUAL` 2 against `KEY_DECISION` 0) tell a release by agreement from a release on the checks (`contracts/src/IHoldbackRules.sol:205-224`, `:287-293`). No field says which checks were waived; the note in ADR-0039 section 4 adds that.
- **Would a waiver have served the pilots?** Crow's case: yes. The refused bytes later passed the corrected checks unchanged [measured, private]. The first case: only after the seller fixed its conversion, which first read no artifacts at all [measured, private].

## 2c. Trade theory against the recommendation

Rafa asked on 2026-11-18 for his recommendation to be challenged from strategy and trade theory. The ADR's section 7 gives the verdicts. The sources:

- **Waivers in letters of credit.** Mann's 500 bank files: the documents met the terms 27% of the time, the buyer waived the defects in every file but one, 59% of defective presentations showed no failure by the seller, and over half the waivers came within one business day [documented: Mann (2000), read for the reading list on 2026-11-18, `2026-11-18-reading-list.md`; the figures as Crow's private reading notes record them].
- **Hold-up after sunk cost.** When one side has made an investment specific to the deal, the other can renegotiate for part of its value [recalled: Klein, Crawford and Alchian, "Vertical Integration, Appropriable Rents, and the Competitive Contracting Process" (1978); Williamson, *The Economic Institutions of Capitalism* (1985)]. Contracts that cannot say everything in advance are renegotiated, and the rules for renegotiation shape what is signed first [recalled: Hart and Moore, "Incomplete Contracts and Renegotiation" (1988)].
- **Unravelling of optional disclosure.** When a party can disclose verifiable information for free, silence is read as bad news, so most disclose [recalled: Grossman, "The Informational Role of Warranties and Private Disclosure about Product Quality" (1981); Milgrom, "Good News and Bad News" (1981)].
- **Discrepancy fees.** Banks charge the beneficiary a fee on a presentation with discrepancies [recalled: common documentary-credit practice; no tariff was opened on the day].
- **Substituted contract.** The parties may agree to discharge a contract and take a new one in its place [recalled: Restatement (Second) of Contracts § 279].

## 3. How others do it

Each source with the plain lesson for Crow.

### Contract law: variation by agreement

- **United States, sales of goods.** UCC § 2-209(1): a modification needs no consideration to bind. The official comment holds it to good faith, and a modification extorted without a legitimate commercial reason is ineffective [search: the official comments to Article 2; state code pages such as New York's § 2-209]. A clause requiring signed writing binds too (§ 2-209(2)) [recalled].
- **England and Wales.** *Rock Advertising v MWB* [2018] UKSC 24: a clause that "all variations … must be set out in writing and signed on behalf of both parties" binds; an oral variation does not take effect [search: the judgment at caselaw.nationalarchives.gov.uk/uksc/2018/24 and firm summaries]. *Pakistan International Airline v Times Travel* [2021] UKSC 40: lawful pressure to accept new terms is rarely duress; the court declined to widen the doctrine [search: the Supreme Court's press summary].
- **International sales.** CISG Article 29: a contract may be modified by the mere agreement of the parties; a written contract that requires written modification can only be modified that way, unless one party's conduct led the other to rely on it [search: cisg-online.org, Art. 29].

**Lesson:** a change both parties sign is the normal way terms change, and the law gives effect to a rule that only a signed change counts. Pressure to agree is for the law, and courts rarely undo a hard bargain. The protocol should require both signatures and leave fairness alone (D28).

### Procurement: change orders

- **US federal contracts.** FAR 43.103: a bilateral modification (supplemental agreement) is signed by the contractor and the contracting officer; a unilateral one, by the contracting officer only, issues change orders within the contract's general scope, with an equitable adjustment agreed after [search: acquisition.gov, FAR 43.103].
- **Construction.** AIA G701, the standard change order, is "not valid until signed by the architect, contractor and owner", and records the change to the work, the contract sum and the time [search: AIA's G701 instructions and summary].

**Lesson:** a change order names what changes, the price and the time in one document, and the party that certifies the work signs it too. In a replacement, the new primary's acceptance of the new offer plays that part. Crow has no unilateral change order: no party may change a funded deal alone.

### Letters of credit

- UCP 600 Article 10(a): a credit can be neither amended nor cancelled without the agreement of the issuing bank, any confirming bank, and the beneficiary [search: summaries of UCP 600 Article 10].
- Article 10(c): the original credit stays in force for the beneficiary until it communicates acceptance of the amendment; Article 10(e): partial acceptance is not allowed and counts as rejection; Article 10(f): a provision that an amendment takes effect unless rejected is disregarded [recalled; the one practitioner page that would confirm it refused the fetch].

**Lesson:** every party that pays or examines must agree; silence is never consent; an amendment is accepted whole or not at all; and the original terms govern until then. ADR-0039's replacement follows all four. Both parties and the new primary sign, nothing is deemed accepted, the new terms are agreed whole, and the old deal stays in force unless the whole transaction lands.

### Agent-payment protocols

- **AP2.** The user's signed mandates bind what an agent may buy: an intent mandate sets the limits, a cart mandate fixes the items and price. Sources say a 2026 revision renamed them to checkout and payment mandates [search: ap2-protocol.org and secondary guides]. A different cart is a new cart mandate signed again [inferred].
- **Agentic Commerce Protocol.** The agent updates a checkout session (`POST /checkout_sessions/{id}`) until it completes it (`/complete`); the merchant may refuse an update [search: Stripe's and OpenAI's ACP pages].
- **x402.** Pays per request with no hold, so nothing to amend [recalled].

**Lesson:** these change terms only before payment, and a change is a new signed mandate. None has a path for a funded hold. Crow's amendment is the step they lack, and it should read the same way: a new signed set of terms.

### On-chain escrow designs

- **ERC-8183, agentic commerce (draft, 2026).** A job's budget changes only while it is Open, before funding, by `setBudget`; the evaluator and the expiry are set at creation and never change; the core has no amendment or mutual-change function [checked: eips.ethereum.org/EIPS/eip-8183].
- **Commerce Payments' `AuthCaptureEscrow`.** A payment is the hash of `PaymentInfo`; it cannot be raised or extended after `authorize` [checked, as above].
- **Kleros-style escrow.** Funds wait for one party's release or a ruling. This pass saw no amendment path in the search results it got [search].

**Lesson:** on-chain escrows fix terms at funding and treat any change as cancel and recreate. Today's four moves do that in four separate steps. Doing it in one atomic transaction keeps the cancel-and-recreate model, which the audited code already handles, and removes the gap between the steps.

Contract law has a name for this: a **substituted contract**, where the parties agree to discharge the old contract and take a new one in its place (Restatement (Second) of Contracts § 279) [recalled]. It is the standard word for what the replacement does.

## 4. What follows for the design

1. Both parties sign, and the party that examines the work accepts. Silence is never consent. [Sections 3.1 to 3.3]
2. The new terms are agreed whole, and the old terms govern until the change is complete. [3.3]
3. A funded hold never changes: no higher amount, no new payer or receiver, no later expiry. A change that needs any of these needs a new hold. [2, 3.5]
4. The frozen contracts can already discharge a deal and fund its substitute in one transaction, for any change of terms. [2a]
5. Before any change of terms comes the trade's lightest tool: the buyer waives the defects on the same deal, which the contracts already pay. [2b, 2c]
6. Fairness stays with the parties and the law, and the buyer's tools stop for the principal's yes. [3.1]

## Sources

Opened on 2026-11-18:
- EIP-8183, Agentic Commerce: https://eips.ethereum.org/EIPS/eip-8183
- base/commerce-payments: https://github.com/base/commerce-payments, `docs/README.md`, `docs/operations/Authorize.md`, `docs/operations/Void.md`

Seen in search results on 2026-11-18, not opened:
- *Rock Advertising Ltd v MWB Business Exchange Centres Ltd* [2018] UKSC 24: https://caselaw.nationalarchives.gov.uk/uksc/2018/24
- *Pakistan International Airline Corporation v Times Travel (UK) Ltd* [2021] UKSC 40: https://caselaw.nationalarchives.gov.uk/uksc/2021/40
- UCC § 2-209, New York: https://www.nysenate.gov/legislation/laws/UCC/2-209; official comments to Article 2: https://cali.org/lessons/web/ct11/official_comments_to_article_2.htm
- CISG Article 29: https://www.cisg-online.org/cisg-article-by-article/part-3/art.-29-cisg
- FAR 43.103: https://www.acquisition.gov/far/43.103
- AIA G701 instructions: https://help.aiacontracts.com/hc/en-us/articles/1500009322061-Instructions-G701-2017-Change-Order
- UCP 600 Article 10, a practitioner summary: https://tradefinanceexpertise.blogspot.com/2022/12/article-10-ucp-600-amendments.html
- AP2: https://ap2-protocol.org/
- Agentic Commerce Protocol, checkout: https://developers.openai.com/commerce/specs/checkout and https://docs.stripe.com/agentic-commerce/protocol/specification

Read for the reading list on 2026-11-18 (`2026-11-18-reading-list.md`):
- Ronald J. Mann, "The Role of Letters of Credit in Payment Transactions", 98 Mich. L. Rev. 2494 (2000): https://academiccommons.columbia.edu/doi/10.7916/D8SF2VKC

Recalled, not opened on the day: Klein, Crawford and Alchian (1978); Williamson (1985); Hart and Moore (1988); Grossman (1981); Milgrom (1981); Restatement (Second) of Contracts § 279; the identity precompile at address `0x04`.

Refused the fetch: Nordea's note on amendments to documentary credits (HTTP 403).
