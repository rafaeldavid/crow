# ADR-0039: Both parties change a funded deal's terms in one step, by replacing it in one transaction

- **Status:** Proposed, 2026-11-18 (D78). Needs Rafa, except the tie between the two deals, which Rafa decided on 2026-11-18 (section 4). Nothing here is built.
- **Raised by:** T-524, roadmap row N188. Rafa, 2026-11-18: "contracts / API need to allow for mutually agreed contract amendments seamlessly. It needs to be a normal path of trade". His design direction the same day: weigh equally "having the API help sign an atomic transaction that refunds, creates new escrow, and sends money from first contract back to buyer to new contract atomically", and make the default tie "transaction data which is signed by both buyer and seller original keys".
- **Research:** [`docs/research/2026-11-18-amending-a-funded-deal.md`](../research/2026-11-18-amending-a-funded-deal.md): how a deal's terms bind today, with line references; what the gate before signing removes; the local-chain test of the one-transaction replacement; desk research with sources.
- **Builds on:** ADR-0001 (neutrality), ADR-0002 (the hold), ADR-0015 (user choice), ADR-0016 (the commitment ID), ADR-0029 (delivery binding), ADR-0031 (the phase-one contracts), ADR-0033 (the money addresses), ADR-0037 (the hosted seller adapter); D26, D28, D29, D31, D32, D35, D77.
- **Amends:** no ADR.
- **Changes when built, by later tasks:** `apps/operator` and `apps/demo-cloud` (one prepare route, one submit route), `spec/` (an additive version for those routes; no new signed type), `examples/` (the seller adapter, a buyer command, the deal record and the evidence check), `apps/hosted-sellers`, the guides under `site/`, `fixtures/`, `contracts/test/` (tests only), `docs/neutrality.md`. No change to `contracts/src/`. This record changes no code.

Labels: **measured** (read at the cited line: `contracts/src/` at the tag `contracts-phase-one-1`, commit `27ab44e8`; everything else at `origin/main` `1c9ffacf`; or run as cited), **documented** (a doc or outside source states it), **inferred**, **guessed**.

## Summary

**The recommendation, in five lines:**

1. Both parties change a funded deal's terms by **replacing it in one transaction**. The transaction refunds the old deal by agreement and funds a new deal on the new terms from that refund. It all lands, or none of it does.
2. It needs no contract change. On a local chain, the frozen phase-one contracts did exactly this through one batch call, and when the new funding failed, the whole transaction reverted with the old hold intact [measured, section 3]. Sepolia already has the batch contract, Multicall3, at its standard address [measured].
3. Every term can change, since the new deal is a whole new offer: the checks, the deadlines, the price, the adjudicators, the scope. The tools offer it while the deal is `Held` with no delivery posted; after a delivery, the parties settle by agreement, as today.
4. The tie is Rafa's decided default: the refund both original keys sign carries the new deal's commitment ID in its `nonce`, so anyone reading the chain can follow a replaced deal to the deal that completed it. A party can opt out with a random nonce.
5. One API call per party replaces today's four moves; the agreed refund (T-503) and the finished-job takeover (T-501) become steps inside it. An in-place amendment, which keeps one commitment ID, is designed here and not built until replacements show a measured cost.

**What Rafa decides:** section "Open points for Rafa", four questions.

## Context

### The need

Both pilot deals so far had a finished report refused by the deal's signed checks while the deal was `Held` with nothing delivered [measured, the private record]. Each fix took four moves: new terms, a redeploy of the hosted seller, a second deal that takes over the finished job, and a full refund of the first deal that both parties sign. The second case's run sheet has six steps by a person [measured, private]. The replacement is one prepare-and-sign per party and one transaction, so two approvals by a person: the seller's and the buyer's [inferred].

**The gate before signing removes some of the need, not all.** Since 2026-11-18 no deal is signed until its checks have run on one real delivery from that seller. It would have caught the first case [inferred]. It would not have caught the second: its checks had met a real report from the same seller, and the new report had two shapes of finding that report lacked [inferred from the measured causes]. Each new job can bring shapes no earlier delivery showed. Changes to deadlines, scope or price have no measured case yet [guessed: longer jobs will bring them].

### How a deal's terms bind today

Each line is measured; the research note has the full walk.

- **The commitment ID is the hash of the whole terms** (`HoldbackTypes.sol:307`). Every entry point takes the terms in calldata and recomputes it. A changed field is a different deal.
- **The hold is keyed to values from the terms.** `_paymentInfo` (`HoldbackRules.sol:117`) sets payer, receiver, amount price plus fee, expiry `fallbackBy + appealDecideSec + EXPIRY_MARGIN` (`:479`) and salt the commitment ID (`:138`). The escrow identifies a payment by the hash of that struct, authorizes it once, and cannot raise its amount or its expiries [documented: `base/commerce-payments` docs, read 2026-11-18].
- **Enforced fields:** the parties, the money addresses, the token, the price, the fee, the three adjudicators, the timing, and the policy and registry hashes (`HoldbackTypes.sol:36-44`, `:410`). **Signed-only fields,** which no check reads: among them `acceptanceHash` (the checks and the rubric) and `deliverableHash`.
- **One delivery, written once,** before `deliverBy` (`HoldbackRules.sol:47`, `:69`, `:168`, `:524`). The first decision is final (ADR-0031).
- **The settlement both parties sign** (`HoldbackRules.sol:360`) works in `Held`, `Delivered`, `FallbackJudging` and `Escalated`. It pays any split of the price to the two money addresses and returns the fee to the buyer. Its `nonce` is a free 32-byte value both parties sign, which no check reads (`HoldbackTypes.sol:164-168`).
- **Every entry point is permissionless** and the rules contract never reads `msg.sender` (`HoldbackRules.sol` contract comment; `docs/neutrality.md`), so a batch contract can call two of them in one transaction.
- **Who reads the checks.** The adjudicator refuses terms that do not hash to the commitment ID (`apps/adjudicator/src/service.ts:590`). The hosted seller's check before delivery runs the signed terms from the operator (`apps/hosted-sellers/src/check-report.ts:88`).
- **The commitment schema** has no field that names an earlier deal and allows no extra fields [measured by the coordinator, 2026-11-18].

### What a change of terms must touch

| Part | Replace in one transaction | Amend in place (deferred) |
| --- | --- | --- |
| Commitment ID | A new one for the new deal; the old one ends `Settled` | Kept |
| The hold | The old one voids to the buyer's payment address; a new one is authorized from it in the same transaction | Kept as funded |
| Which fields can change | Every field | Only those no contract reads, until a contract build changes more |
| Signed messages | Only today's: the refund both sign; the offer, the primary's acceptance, the buyer's agreement and the funding | A new `TermsAmendment` and an adjudicator's acceptance of it |
| Contracts | None | None at first; a new function, storage and struct fields later |
| Adjudicator | Accepts the new offer as any offer | Learns to judge under an amendment chain |
| Gas | About 840,000 per replacement on Sepolia [inferred: 272,170 for a settlement plus about 570,000 for a funding, measured on Sepolia in the private record] | None off chain |

## Decision

### 1. What a replacement may change

Everything, because the new deal is a new offer the seller signs, the primary accepts and the buyer agrees and funds. The checks bound only what settlement cannot process (D31):

- **The price may rise** only up to what the payment address holds after the refund lands; above that the whole transaction reverts [measured].
- **The parties may change their per-deal keys.** The money addresses may change too, since the new funding is the payment address's own new signature. The tools keep both the same by default, so the record reads as one relationship.
- **The adjudicators may change**, with the new primary's acceptance, as for any offer. An adjudicator may decline, as it may decline any offer (D29).
- **The deadlines are new**, with a fresh hold and a fresh escrow expiry, so no limit from the old hold carries over.
- **A club's rulebook** binds the new deal as any deal; a club may narrow replacements like any other option (ADR-0015).

Refused by the tools, not by the protocol: a replacement after a delivery is posted on the old deal. Judging is then under way; the parties settle by agreement on any split instead, which exists today. The contract would take a replacement in `Delivered` too, and the batch reverts whole if the adjudicator decides first [inferred from `HoldbackRules.sol:360-374`].

### 2. The messages and the one step

No new signed type. A replacement is today's messages, built together:

| Message | Signed by | Fields that matter here |
| --- | --- | --- |
| `MutualSettlement` on the old deal | the old deal's buyer and seller | `hasDelivery` false, one payout of the whole price to the buyer's payment address, `releaseKey` false, `nonce` the new commitment ID (the tie), `expiresAt` |
| `CommitmentTerms` of the new deal | the seller (the offer) | The new terms in full |
| `AdjudicatorAcceptance` of the new deal | the new primary | As for any offer |
| `Agree` to the new deal | the new deal's buyer | As for any offer |
| `ReceiveWithAuthorization` for the new hold | the buyer's payment address | As for any funding |

- **The one step, as an agent reads it:** "To change a funded deal's terms before delivery, replace it. Prepare a replacement with the new terms. You sign the new deal and a refund of the old deal that names it. One transaction ends the old deal and funds the new one, or does nothing."
- **The routes:** `POST /v1/prepare/replacement {commitmentId, terms}` answers the new deal's messages, the refund, and the list of differences from the old terms. `POST /v1/commitments/{commitmentId}/replacement` takes all the signatures and sends them as one Multicall3 transaction. The hosted seller gets `POST /deals/{commitmentId}/replace` behind its ready credential, with the new acceptance block. It signs the refund and the new offer, and moves the finished job to the new deal (T-501's step), with no redeploy.
- **Replay.** Each message is bound to its own commitment ID and the deployment's domain. The refund applies once, since the old deal leaves `Held`. The new deal funds once, since its ID can be funded only from stage `None`.
- **Order.** One transaction runs the refund, then the funding. Each half is a valid message alone, so atomicity holds only when the halves travel together. Section 5 bounds what a split costs.

### 3. Where it is enforced

**On chain, by the frozen contracts, with no change.** A local-chain test ran four cases on the code at `origin/main`, whose `contracts/src/` equals the tag [measured, 2026-11-18, `forge test`, 4 passed; the test is in the research note's folder]:

1. In one call, a batch contract settled a `Held` deal by agreement with a full refund and funded a new deal from that refund. The buyer's wallet held nothing else. The old deal ended `Settled` with nothing capturable, the new deal `Held` with its full hold, and the wallet at 0.
2. When the new deal's agreement carried the wrong signature, the whole call reverted with `BadSignature`, and the old deal stayed `Held` with its hold intact.
3. When the new hold exceeded what the refund returned, the whole call reverted, and the old deal stayed `Held`.
4. The refund alone, with a tie to a deal never funded, still settled, as it does today.

On Sepolia, Multicall3 has code at its standard address `0xcA11bde05977b3631167028862bE2a173976CA11` [measured: `eth_getCode` through a public RPC, 2026-11-18]. So the batch needs no deploy.

**Off chain, the operators only prepare and relay.** They check the signatures before they send, as for every message, and either party can send the same batch to Multicall3 directly.

**This can ship before the next contract build.** Nothing in this path waits for one.

### 4. The tie between the two deals (decided by Rafa)

**Decided by Rafa on 2026-11-18:** "Let's do the default as transaction data which is signed by both buyer and seller original keys. So that reputation public is easier to calculate, both for buyer and seller. They will care if someone reading the data can trace they do complete commitments".

- **How it is carried.** The refund's `nonce` is the new deal's commitment ID. The old deal's buyer and seller keys sign it, and it sits in the calldata of the transaction that also emits the new deal's `JobCreated`. No schema or contract change is needed.
- **How a reader follows it.** A refund whose `nonce` equals the commitment ID of a deal funded in the same transaction is a replacement, not a failed deal. The deal record and the evidence check report it as one.
- **How a party opts out.** The tools offer a random nonce instead. The two deals then read as a refund and an unrelated deal.
- **The tension, recorded without reopening it.** The default discloses that two deals belong together, which is more than the minimal disclosure D35 makes the general default. Rafa chose it for public reputation, and each party may opt out, which keeps D35's rule that disclosure is the party's choice.

### 5. Work already done

| Situation | Rule | Who pays |
| --- | --- | --- |
| The seller's own check refused the work; nothing posted (both pilot cases) | Replace. The finished job moves to the new deal and is delivered there | The new deal's fee only; the old fee returns to the buyer |
| Work signed and held back, not posted | Replace. The seller signs the same work again for the new deal, since a delivery names its commitment ID (ADR-0029) | Nothing extra |
| A delivery posted, judgment in progress | No replacement from the tools. The parties may settle by agreement | As the settlement says |
| A decision made, a key released, or a settlement landed | Final. A new deal if the parties want more | — |
| A reject by the adjudicator | Final (D28). A new deal may take the finished job (T-501) | The reject paid its fee |
| A second judgment's fee | Does not arise: the old deal was never judged | — |
| Gas | The sender pays: today the operators, as for every relayed step | The operator, about 840,000 gas [inferred] |

**Defaults when the parties say nothing:** the prepare call copies every field of the old terms that the request does not change, and gives the new deal fresh deadlines from the same windows. The tie is on. The money addresses and the adjudicators stay the same.

### 6. What can go wrong, the rule that stops it, and the test that proves it

| Threat | Rule | Test |
| --- | --- | --- |
| One party replaces alone | The refund needs both signatures; the new deal needs the seller's offer, the buyer's agreement and the payment address's funding. The contract checks each | `attack.replace-one-signature` |
| An operator invents or alters a replacement | It cannot sign for a party; each party rebuilds what it signs from its own intent (`examples/verify.ts`) | `neutrality.operator-lies-in-prepare`, extended to the replacement |
| An operator refuses or drops it | Either party sends the same batch to Multicall3 directly | `neutrality.replace-operator-refuses` |
| The new primary declines | No acceptance, so no batch; the old deal stays on its terms | `neutrality.replace-adjudicator-declines` |
| The halves are sent apart | The refund alone ends the old deal, as today's agreed refund does. The funding alone leaves the buyer with two holds until it sends the refund it already holds. Either way nothing is lost: bounded, as D26 asks | `attack.replace-split` |
| A delivery lands on the old deal first | The refund without a delivery needs `Held`, so the whole batch reverts | `attack.replace-after-delivery` |
| A timeout lands first | The refund needs an open deal, so the batch reverts; the buyer already has its money back | `attack.replace-after-reclaim` |
| The new hold exceeds the refund and the wallet | The whole batch reverts [measured] | forge test, case 3 |
| A false tie | Only a nonce both original keys signed counts; a reader checks that the named deal was funded in the same transaction | `attack.replace-false-tie` in the deal record's tests |
| A seller presses the buyer to loosen checks after a failure | Allowed: the buyer carries the burden of acceptance (D28, D32). The buyer's tools show each loosened check and stop for the principal's yes, in the signer, not as advice | `attack.replace-pressure`: no signature without the yes |
| Privacy | The tie links two deals in public by default; a party may opt out. Private deals stay deferred (D70) | — |

### 7. The bridge, and what it removes

The bridge question was whether one call should wrap today's four moves. On the frozen contracts that call is the design itself: it sends the moves as one atomic transaction, and no later amendment has to replace it. It adds no signed type and no contract code. Its new surface is two operator routes, one seller route and one buyer command [inferred].

- **The agreed refund used as a restart** (T-503) becomes a step inside the replacement. The standalone refund stays for a seller that will not deliver.
- **The takeover of a finished job** (T-501) becomes a step inside the seller's replace route. It stays alone for a deal the adjudicator rejected or that expired.
- **The hosted seller's redeploy** to change one deal's checks goes away. A redeploy still changes the checks the seller offers new buyers.

### 8. The in-place amendment, designed and deferred

If replacements later show a measured cost (gas, or readers confused by two IDs), a contract build can add an in-place amendment. Its design, for that build:

- **Message:** `TermsAmendment {commitmentId, sequence, priorTermsHash, newTermsHash, expiresAt}`, signed by both parties, plus the primary's signed acceptance.
- **Contract:** `amend` in `Held` with no posted delivery and `now < deliverBy`. It stores the current terms hash and sequence, keeps the hold's funded amount and expiry, and emits `TermsAmended`. `Delivery` and `Decision` name the current terms hash.
- **What it could change:** checks, rubric and deliverable; deadlines within the funded expiry; the price down only; the fee within the hold; the adjudicators with the new primary's acceptance. Never the parties, the money addresses, the token or the delivery count.
- **An off-chain version before any contract build** could change only the checks, rubric and deliverable. It would need a new signed type, chain-following logic in the adjudicator and the evidence check, and trust that the adjudicator honours it. The replacement does more with less.

## Alternatives considered

1. **The in-place amendment, off chain now and on chain later** (section 8). It keeps one commitment ID and costs no gas. Before a contract build it can change only the checks, and it adds more surface than the replacement. Not recommended now; designed for later.
2. **Keep the four moves and rely on the gate.** No new surface, but the second pilot case shows the gate misses new shapes in later work, at six steps by a person each time [measured]. Rejected as the normal path.
3. **Replacement as two separate transactions,** refund then fund. It works today with no new route, but the buyer's money sits outside any hold between them, and the seller has no guarantee the new deal is funded. Rejected; the batch costs nothing more.
4. **A second delivery attempt** (raising `maxSubmissions`). It needs a contract change and fits new work, not new checks. Rejected.

## Consequences

- An agent gets one new step, "replace before delivery, settle after", built only from messages it already signs.
- A replaced deal reads on chain as a settled refund tied to its successor. The deal record and the evidence check must learn to show that as one commitment completed.
- Each replacement costs one batched transaction of about 840,000 gas on Sepolia, which the operators sponsor today [inferred].
- Rafa's tie makes completed commitments traceable in public by default. A party that opts out loses that trace.

## Litmus tests

- **Neutrality.** No single actor can replace a deal: the refund needs both parties, and the new deal needs the seller, the primary, the buyer and the payment address. An operator that refuses is bypassed through Multicall3. An adjudicator that declines leaves the old deal on its signed terms. The contracts are unchanged.
- **The hold.** Neither party can take the old hold alone: the refund pays only the buyer's payment address and needs both signatures. The new hold is a normal hold with its own expiry. If the batch fails, the old hold stays as it was [measured].
- **Defended judgment.** No replacement after a delivery is posted, so none after a verdict. The new deal is judged like any deal, with its own seed from its own commitment ID.

## Open points for Rafa

1. **The path.** Recommended: replace in one transaction now, with no contract change. The alternative is the in-place amendment: off chain for the checks first, on chain in a contract build later.
2. **The in-place amendment in the rebuilt contracts.** Recommended: not built until replacements measure a cost. The alternative is to design it into the contract build after the fixes build (D77) anyway.
3. **After a posted delivery.** Recommended: the tools offer no replacement, and the parties settle by agreement. The alternative is to offer it, at the risk that the batch reverts when the adjudicator decides first.
4. **The buyer's stop.** Recommended: the buyer's tools stop for the principal's yes on every replacement, like a new offer. The alternative is to skip the stop when the new checks are only stricter.
