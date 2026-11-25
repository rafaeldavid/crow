# The two-part release

**State: design note for roadmap row N226, the two-part release (plan task P-20), 2026-11-25. Research and a plan only: no schema, code or contract changes with it. ADR-0046 proposes its recommendation, which Rafa can overrule.**

Rafa asked on 2026-11-23 that payment be released only if two things hold: the work passes the agreed checks, and the key works. Today the first is a decision and the second is nobody's check. This note makes both one release rule, answers the row's five design questions, and says what the next contract version carries.

Four words recur. The **content key** encrypts the work. The **sealed key** is the content key encrypted to the buyer's encryption key: today's key envelope. A **decider** is the adjudicator whose turn it is to decide: the primary, the fallback, or the appeal adjudicator after an escalation. A **free look** is a buyer reading the work before it pays.

Labels: **measured** (read from the repository at `031bb08c`, or run, with the source), **documented** (a public page opened on 2026-11-25 says so; the address is under Sources), **reported** (another record's measurement), **recalled** (from the model's knowledge, not opened that day), **inferred** (this note's reasoning), **guessed**.

## Summary

- **Recommendation: the seller commits to the buyer's sealed key, every decider recomputes it, and the hold pays only against it.** The signed delivery carries a hash of the key as sealed to the buyer. A decider that opened the work recomputes that sealed key from the content key it judged with. The rules contract refuses a paying call whose key does not hash to the commitment.
- **The terms name the rule:** `settlement.release` is `on_decision_and_key`. Today's rule stays as `on_decision`, for a standing delivery, which cannot hold a key for a buyer it does not know yet.
- **No zero-knowledge proof is needed on a judged path.** The sealed key becomes a pure function of the content key, the commitment ID and the buyer's key. Today's sealing code already takes its randomness as an input. In a scratch run, two holders of the content key produced the same 139-character sealed key, and the buyer opened it. One seal took 1.7 ms [measured, section 5.3].
- **The state machine gains no stage, no deadline and no timeout, and the contract stores nothing new.** Two signed types change: the terms' `Settlement` and the `Delivery`.
- **Work passes and key fails: the decider rejects and the buyer is refunded,** as for any failed required check. Key works and work fails: the same. A decider that cannot open its own envelope still signs nothing (D81).
- **A buyer's own signature still stands for both parts.** An early accept and a settlement both sign release only the committed key, and nothing checks that key for the buyer on those paths. The seller's zero-knowledge proof (row N200) can fill that gap later with no contract change.
- **The delivery gains the `proofs` list that the delivery-proofs note reserved.** Its first kind is `key_opens`.
- **One contract version carries this rule and the two fixes D85 promised.** The amendments row (N188) adds no contract change for its waiver and its replacement. Its named note hash is a small option. Its in-place amendment stays out.
- **This is not a staged payout.** The row's two parts are two conditions for one release. A release in two amounts is weighed in section 13 and left out: no deal has asked for it.

## 1. The problem

### Three paying paths, and who checks the key on each

| Paying path | What authorizes it | The key the buyer gets | Who checks that it opens the work |
| --- | --- | --- | --- |
| A decider's accept (`decide`) | The signature of the adjudicator whose turn it is | A key that decider seals to the buyer itself, with fresh randomness [measured, `apps/adjudicator/src/service.ts`, `keyForBuyer = wrapKey(...)`] | The decider alone. The contract requires only a key that is not empty [measured, `HoldbackRules._settleDecision`] |
| The buyer's early accept (`earlyAccept`) | The buyer's signature | The buyer's envelope in the seller's delivery | Nobody, unless the seller hands the buyer that envelope first, and then the buyer holds the work before it pays [measured, `docs/api.md`, "Before an early accept, open your envelope"] |
| A settlement both sign with `releaseKey`, which the waiver of ADR-0039 uses (`mutualSettle`) | Both parties' signatures | The same envelope | Nobody. The buyer countersigns without holding it, so that it gets no free look [measured, ADR-0039 section 2] |

On the last two paths the contract checks that the released envelope is addressed to the buyer and sits in the delivery's list of envelope hashes (`_requireKeyProof`). It does not check which one, when a delivery lists two for the buyer [measured, `tools/envelope-proof/README.md`, "Bind the envelope"].

### What it means for the key to work

Three facts, in a chain:

1. the sealed key opens under the buyer's secret key;
2. what comes out is the content key;
3. the content key decrypts the delivered ciphertext to the plaintext whose hash the seller signed.

A decider checks fact 3 for its own envelope before it judges: `open` in `packages/core/src/crypto/content.ts` refuses a key whose plaintext does not hash to `plaintextSha256` [measured]. Nothing ties facts 1 and 2 to it. The buyer's key is a separate box, and only the buyer's secret key opens it.

### What goes wrong today

- **A seller seals the buyer's envelope to another key.** Settlement records the delivery all the same. A buyer that accepts early pays and cannot open the work [measured, fixture `error.early-accept-wrong-key-envelope`].
- **A decider's own seal is wrong,** through a fault or by intent. The contract pays the seller for any key that is not empty.
- **Phase one has no party appeal** (ADR-0031). The buyer holds the signed record and the law (D26), and nothing in the protocol returns its money.

The loss is bounded by one deal's price. The gap is still a release that follows one condition where the parties expect two.

### The robot case

A design partner's draft terms for a first robot-data deal, kept privately, release the price and the key in one step when every required check passes. The check kinds of ADR-0045 make the first part depend on a device signature. This note makes the second part a rule the contract enforces. The draft holds no payment in parts.

## 2. Prior art

| Source | What it does | What Crow takes from it |
| --- | --- | --- |
| **Delivery versus payment** in securities settlement (the BIS committee's 1992 report) [documented: title and date; the definition recalled] | Links the two legs so that one moves only if the other does | The frame ADR-0012 already uses: the key is the delivery leg |
| **Optimistic fair exchange** (Asokan, Schunter and Waidner 1997; Asokan, Shoup and Waidner 1998) [recalled; cited in ADR-0012] | A third party acts only when the two disagree | Crow's adjudicator is that third party |
| **The impossibility result** (Pagnia and Gärtner, 1999) [recalled; cited by later papers, original not opened] | Two parties cannot exchange fairly with no third party at all | Some party or some proof must vouch that the key fits the work. A hash alone cannot |
| **Hashed time-locked contracts** (BIP-199) [documented] | The payee claims by showing a hash's preimage; the payer reclaims after a timeout | The hold opens for a preimage of the committed hash |
| **Zero-knowledge contingent payment** (Maxwell's 2011 proposal; first paid on Bitcoin on 2016-02-26) [documented] | The seller proves in zero knowledge that a ciphertext decrypts to what the buyer wants under the key whose hash is Y. The payment is locked to Y. Collecting it shows the key on chain | The split into two parts: a proof that the committed key fits, and a hash-lock that pays only for that key |
| **Its later breaks** (Campanelli, Gennaro, Goldfeder and Nizzardo, 2017 [documented: the abstract]; Fuchsbauer, 2019 [found by search, not opened]) | A buyer that picks the proof system's parameters learns part of the goods unpaid; the first fixes were not enough | A zero-knowledge key proof needs its setup pinned and reviewed. It is not a small part |
| **FairSwap** (Dziembowski, Eckey and Faust, 2018) [documented] | No zero-knowledge proof. The seller commits to the key in a contract and the buyer pays in. The seller then shows the key to the contract. The buyer may send a short proof of misbehaviour for a refund | A contract can judge a key after the fact, but the key is public on chain, and the goods must be checkable by the contract |
| **ERC-8183** (draft of 2026-02-25) [documented] | One evaluator completes or rejects a job. `submit` takes a 32-byte reference. No key, no part payment, no dispute step | Crow's event names. It has nothing on the key |
| **The Fujisaki-Okamoto transform** (1999; Hofheinz, Hövelmanns and Kiltz, 2017) [documented: the paper; its T transform recalled] | Draws an encryption's randomness from a hash of the message, so whoever holds the message can encrypt again and compare | The derived seal of section 5.3 |
| **libsodium sealed boxes** [documented] | Make the one-time key inside the call and derive the nonce from the two public keys. The caller supplies neither | Crow's envelope is the plain box with an explicit one-time key, so its randomness can be derived. A sealed box could not |
| **RISC Zero's verifier contracts** [documented] | A router whose admin adds and removes verifiers, and an emergency stop a guardian can pull for good. A direct Groth16 verifier has neither | An on-chain proof check either adds a party that can stop a release, or has no stop when the proof system breaks |
| **Documentary credits** (UCP 600, articles 31 and 32) [documented in commentary; the rule text not opened] | A credit allows part drawings unless it says otherwise, and may set instalments | Prior art for a release in two amounts (section 13) |

**What the prior art says together** [inferred]:

1. A hash-lock makes the swap atomic. It says nothing about whether the locked key fits the goods.
2. Fit needs one of three things: a zero-knowledge proof, a proof of misbehaviour a contract can check, or a third party that looked.
3. Crow already has the third party. Both parties name three adjudicators, and the one that decides has read the plaintext.
4. So the cheapest complete rule is a hash-lock plus the decider's check. It needs one thing Crow lacks today: a decider must be able to check the buyer's sealed key, which it cannot open.

## 3. Options

| | Option | How the key is shown to work | What the contract checks | Privacy (D35) | Cost | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| A | **The decider attests** | A signed flag in the decision says the decider opened the work. The decider still seals the buyer's key itself | That the flag is set | As today | One field | Too weak: it names today's trust and checks nothing new |
| B | **A bare hash-locked key,** as a teaching game can show it | The delivery commits to the content key's hash; the paying call shows the content key | The preimage | **Fails.** The content key is public, so anyone that holds the ciphertext reads the work. Operators hold it | Smallest contract | No |
| C | **A committed sealed key that deciders recompute** | The delivery commits to the key as sealed to the buyer. A decider recomputes that sealed key from the content key it judged with | That the key in the paying call hashes to the commitment | Holds. The chain sees the sealed key at release, as today, and a hash before | Two signed types, about 5,000 to 7,000 gas more on an accept [guessed], a derived seal to review | **Recommended** |
| C2 | **Accept first, then the key within a window** | As C, in two calls. The accept carries no key and locks the price for the seller. Anyone then shows the committed key before a deadline, or the buyer is refunded | The same hash, in the second call | Holds, and the key never rides in a call that can fail for another reason | A new stage, a new deadline, a new timeout, a second transaction and about one block more on every judged release | Not now (section 15) |
| D | **A zero-knowledge proof checked on chain** | The seller proves that the buyer's envelope opens the work (row N200's statement) | The proof, through a verifier contract | Holds | 2,813 s to make one proof [reported, T-541, one run]; a verifier contract with an admin or with no stop | No |
| D2 | **The same proof checked by the buyer,** before it signs an early accept or a waiver | As D, off chain | Nothing new | Holds | The prover's time; a pinned program | Later, through the same `proofs` list, when a deal needs it |
| E | **A release in two amounts** | Part of the price on a first check and the rest on a second. It proves nothing about the key | A rate and a second step | Holds | A new stage and a second decision or timer | Out (section 13) |

**User choice (ADR-0015).** The parties pick the rule in the terms they both sign. A club may narrow the choice in its rulebook. An adjudicator declines an offer whose rule it does not run. Nobody gets `on_decision_and_key` without agreeing to it, and a seller that cannot commit a key (a standing delivery) offers `on_decision` and says so.

**Why C over C2.** C2 also closes a known limit: a call that carries the buyer's key shows it in its calldata even when the call then fails (`docs/audit/known-issues.md`, "H-2 limit"). It pays for that with a stage, a deadline and a second transaction on every judged deal. Crow builds machine-speed escrow, and a second transaction adds a block of waiting to every release. D26 prefers a bounded loss to a new step. C keeps the limit as it is today and adds nothing to it.

## 4. Answers to the row's five questions

1. **How is the key proven to work?** By two checks that meet in one transaction. The seller commits to the buyer's sealed key in the signed delivery: this is the hash-lock, with the sealed key as the preimage and never the bare key. Each decider recomputes that sealed key from the content key that opened the work: this is the adjudicator's attestation, made checkable. The contract pays only in a call that carries the committed key. A zero-knowledge proof is not needed where a decider reads the work. It stays the one way a buyer can check the key itself, so it waits as a second verifier for the paths a buyer signs alone.
2. **What happens when one part fails?** A refund in both cases. Work fails: the decider rejects, as today. Work passes and the key does not match: the decider rejects for the failed key check, which reads as a failed required check, so one sentence covers both. The contract refuses any accept that carries another key, so a decider's wrong seal can no longer pay the seller. If no decider settles it, the deal defaults at `fallbackBy`, or at the escalation's deadline, and the whole hold returns. The buyer's loss is the adjudication fee on a reject and nothing on a default. Its wait ends at deadlines its own terms set: `deliverBy` for the seller, then `judgeBy` and `fallbackBy` for the deciders.
3. **What must the contract hold?** Nothing new in storage. The delivery's hash, which the contract stores today, now covers one more hash: the list of proofs. At release the paying call carries the sealed key, as today, with three hashes that rebuild the commitment. The contract's verifier result is the comparison itself: a mismatch reverts. The content key, the plaintext, the one-time secret and the buyer's secret key never reach the chain.
4. **What changes in the schema and the API?** The terms gain `settlement.release`. The delivery gains `proofs`, in the shape the delivery-proofs note reserved, with `key_opens` as its first kind. Each adjudicator's record gains a `proofKinds` list. The signed encoding moves to 0.9 and the schema to the version after ADR-0045's. No route is added (section 10).
5. **Which neutrality fixture?** The verifier is built-in code in every decider, so no new party can stop a deal. Five fixtures show the deal ending by its terms when an actor is gone: the primary, both first deciders, every operator, the seller or the buyer. One more covers an adjudicator that lacks the proof kind (section 11).

## 5. The design

### 5.1 The rule in the terms

```json
"settlement": { "mode": "guaranteed_on_decision", "token": "0x…", "release": "on_decision_and_key" }
```

| `release` | An accept pays when | The key the buyer gets | For |
| --- | --- | --- | --- |
| `on_decision` | The decider signs it, as today | The key the decider seals | A standing delivery, which holds no key for the buyer (ADR-0040 section 2), and any pair that prefers today's rule |
| `on_decision_and_key` | The decider signs it and the call carries the key the delivery committed | The committed key | Every delivery made for one buyer. The tools write it by default |

Both values are strings. The rule adds no number to the terms, so ADR-0022's ban on floats in a hashed body holds with nothing to check. The EIP-712 type becomes `Settlement(string mode,string token,string release)`.

### 5.2 The proof on the delivery

The delivery gains the list the delivery-proofs note reserved (its section 6, point 3), with the same five fields:

```json
"proofs": [
  { "kind": "key_opens",
    "format": "x25519-xsalsa20poly1305",
    "verifier": "derived-seal/1",
    "publicInputs": ["0x<64 hex>"],
    "sha256": "sha256:<64 hex>" }
]
```

| Field | For `key_opens` | Rule |
| --- | --- | --- |
| `kind` | `key_opens`: the buyer's sealed key opens this delivery | A closed list. A new kind is an ADR and a schema bump |
| `format` | The sealing scheme of the committed key | Today's one scheme |
| `verifier` | `derived-seal/1`: built-in code that recomputes the sealed key from the content key (section 5.3) | A closed list of pinned built-in code. Never an address to call or code to load |
| `publicInputs` | One hash: the EIP-712 struct hash of the buyer's `EncryptedKey`, which `_requireKeyProof` computes today for the envelope it releases | Hashes only. This is the commitment the hold checks |
| `sha256` | The SHA-256 of the sealed key's text | Lets any tool check a released key against the delivery with one hash |

- **Under `on_decision_and_key`, `proofs[0]` is the `key_opens` entry with `derived-seal/1`.** A later `key_opens` entry, for a second verifier, must commit to the same key.
- **The sealed key itself may also sit in `encryptedKeys`, as today.** That copy is optional transport: it lets any relayer complete an early accept. When present it must hash to the commitment, and the delivery may address only one envelope to the buyer.
- **A standing delivery has no `proofs`.** Its hash is the hash of an empty list.
- **Under `on_decision` a delivery may carry the same entry.** It can then be accepted early or settled with its key. Without the entry it cannot, as a standing delivery cannot today.
- The EIP-712 types become `Delivery(bytes32 commitmentId,uint8 attempt,Ciphertext ciphertext,string plaintextSha256,string plaintextMime,EncryptedKey[] encryptedKeys,DeliveryProof[] proofs,uint64 submittedAt)` and `DeliveryProof(string kind,string format,string verifier,bytes32[] publicInputs,string sha256)`.

### 5.3 The derived seal

Today a seller seals the content key to each recipient with a fresh one-time key and a fresh nonce. Under `derived-seal/1` the buyer's sealed key takes both from the content key:

```
okm = HKDF-SHA256( key material = the content key (32 bytes),
                   salt         = the commitment ID (32 bytes),
                   info         = "holdback/derived-seal/1" ‖ 0x00 ‖ the buyer's address (20 bytes)
                                  ‖ the buyer's encryption key from the terms (32 bytes),
                   length       = 56 bytes )
one-time secret key = okm[0..32]        nonce = okm[32..56]
sealed key = one-time public key (32) ‖ nonce (24) ‖ box(content key) (48)
```

- **The layout and the scheme label do not change.** It is the envelope `docs/api.md` describes, in base64url. The buyer opens it with the code it has.
- **Whoever holds the content key can recompute the sealed key.** That is the seller, each adjudicator once it opens its own envelope, and later a court that either party hands the key to. Nobody else can: the content key is 32 random bytes.
- **It needs no new sealing code.** `wrapKey` in `packages/core/src/crypto/envelope.ts` draws the one-time secret and then the nonce from a random source the caller may pass [measured].
- **Measured on 2026-11-25** with a scratch script against the built `packages/core` (Node 22.23.4, arm64, load average about 9), 10 of 10 checks:
  - two holders of one content key derived the same 139-character sealed key;
  - the buyer's `unwrapKey` returned the content key, and `open` decrypted the ciphertext to the signed plaintext hash;
  - another content key, another commitment ID and another buyer key each gave another sealed key;
  - a sealed key that held another content key did not match the recomputed one;
  - a seal made with fresh randomness, as a decider makes it today, did not match;
  - one derived seal took 1.7 ms, over 2,000 runs.
- **The construction is the encrypt-again check of the Fujisaki-Okamoto transform** [recalled]: randomness drawn from a hash of a high-entropy message. HKDF's `info` holds only values that do not depend on the key material, as RFC 5869 asks [documented].
- **It needs a review before any build.** The content key serves as an AES key and as HKDF input. This note knows of no interaction between the two [recalled], and a reviewer from a second model family, or a cryptographer, must confirm it. If the review objects, the fallback keeps fresh randomness and puts the buyer envelope's one-time secret inside each adjudicator's envelope. The decider's check is then the same comparison, and each adjudicator's envelope grows by 32 bytes.

### 5.4 What a decider does

At intake, before any check or judge runs:

1. Open its own envelope and decrypt the work against the signed plaintext hash, as today. If it cannot, it signs nothing and retries (D81).
2. Read `proofs[0]`. Under `on_decision_and_key` it must be `key_opens` with a verifier the decider runs.
3. Recompute the buyer's sealed key from the content key, the commitment ID and the buyer's address and key in the terms.
4. Compare its `EncryptedKey` hash with `publicInputs[0]`, and its SHA-256 with `sha256`.

A match passes the key check. Anything else fails it: no entry, another verifier, a second envelope for the buyer, or a mismatch. The judgment record names the check `key_opens` with pass or fail and a detail line that holds no key bytes.

On an accept the decision's `keyForBuyer` is the key the decider recomputed, never a copy of the seller's. So the decider needs no bytes from the seller or an operator to release it. The contract's comparison then also checks the decider's own arithmetic: a wrong recomputation cannot land an accept.

The check is a pure function of the delivery, the terms and the content key. Two adjudicators reach the same result, and so does the seller's own run before it delivers. Under `on_decision` a decider skips steps 2 to 4.

### 5.5 Outcomes

| The work | The key | The decider signs | The money | The buyer's key |
| --- | --- | --- | --- | --- |
| Passes | Matches the commitment | Accept, carrying the committed key | The price to the seller, the fee to the decider | Released in that call |
| Passes | Does not match, or no commitment | Reject, for the failed key check | The price back to the buyer, the fee to the decider | Never released |
| Fails | Matches | Reject, as today | The same | Never released |
| Fails | Does not match | Reject | The same | Never released |
| Any | The decider cannot open its own envelope | Nothing (D81); the turn passes on by the terms | A default returns the whole hold | Never released |
| Any | A decider signs an accept with another key | The contract reverts the call | None moves | Not released by the contract |

- **The key check runs first and stops short.** A mismatch rejects before the panel, so no judge is paid to read work that cannot be released.
- **A mismatch rejects.** D81 keeps a decider from rejecting when the fault may be its own key, so it retries. Here the decider holds the right content key, since it decrypted the work. The rest is arithmetic that published vectors pin. A seller checks its own commitment with the same code before it delivers (D32).
- **A decider's sealing fault can no longer pay the seller.** Today a wrong seal pays the whole price for a key that opens nothing, and nothing in the protocol returns it. Under the rule a wrong recomputation cannot land an accept. It can still refund a deal that should have paid, which is the smaller loss (D26).
- **A dishonest decider is not bound by this.** One that passes the seller's key through without recomputing it, or accepts work it did not read, can still do so. That is today's trust in the deciders the parties name.

### 5.6 The paths a buyer signs alone

An early accept and a settlement with `releaseKey` are the buyer's own acceptance. Its signature stands for the work, as it always has. Under the new contracts they change in one way:

- **They release only the committed key.** The contract checks the released key against `proofs[0]`, in place of membership in the envelope list. A submitter can no longer name another envelope addressed to the buyer. That closes the hardening item the envelope-proof prototype named.
- **Nothing checks that key for the buyer.** No decider opens the work on these paths, and the buyer cannot recompute the seal without the content key. The buyer's tools say so before it signs. A buyer that wants the check waits for the decision.
- **The seller's proof fits here later.** Row N200's proof states exactly what a buyer needs. As a second `key_opens` entry it would travel in the same list, and the buyer's tool would verify it before signing. The contract would not change, because it never reads which verifier an entry names.

## 6. The state machine

No stage, deadline or timeout is added or removed. Three guards change.

| Step | Today | In the new version |
| --- | --- | --- |
| Deliver, or a call that carries the delivery | The seller's signature, before `deliverBy`, attempt 1 | The same. Core also refuses a delivery whose `proofs` break section 5.2 under the deal's rule. The contract does not read `proofs` here |
| An accept, at any role | A key that is not empty | Under `on_decision_and_key`: the decision's key hashes to the posted delivery's `proofs[0]`. Under `on_decision`: as today |
| A reject or an escalation | No key | The same |
| Early accept; a settlement with `releaseKey` | The released envelope sits in the delivery's envelope list | The released key hashes to the named delivery's `proofs[0]`, under either rule |
| Reclaim, fallback, default | By their deadlines | The same |

A delivery with no key commitment therefore cannot be accepted under `on_decision_and_key`, accepted early, or settled with its key. It ends in a reject or a default. That is what a standing delivery does today on the last two [measured, `packages/core/src/state.ts`, `withBuyerEnvelope`].

## 7. Contract changes

**`HoldbackTypes.sol`**

- `Terms` gains `release`, and `commitmentId` hashes it into `Settlement`, whose type string gains the field.
- `Delivery` gains `proofsHash`, a signed-only word, and `deliveryHash` covers it. The `Delivery` type string gains `DeliveryProof[] proofs` and the `DeliveryProof` type.
- A helper rebuilds `proofs[0]` from a key: it hashes the `EncryptedKey` as today, then the entry, then the list.

**`HoldbackRules.sol`**

- `decide`: on an accept under `on_decision_and_key`, the posted delivery travels in the call again, its hash must equal the stored one, and the decision's key must rebuild `proofs[0]`. The call takes three more hashes (the entry's format, verifier and SHA-256 fields) and the hashes of any later entries.
- `earlyAccept` and `mutualSettle`: the same check replaces `_requireKeyProof`. One key check then serves every path.
- The two fixes of D85 land in the same version: a decision that is not an accept refuses a carried delivery, and an escalation's beacon round is fixed by state.
- The EIP-712 domain version moves from 0.8 to 0.9. It is a new deployment that parties opt into, as every version is.

**`HoldbackStandingSeller.sol`**

- It pins the rules contract's domain version [measured, `RULES_VERSION_HASH`], so a new version is a new build of it at a new address whatever this rule changes.
- Its take's delivery sets the hash of an empty `proofs` list. Its template carries the terms' `release`, and a template with a standing delivery says `on_decision`.

**Events.** None is removed and none changes shape. `KeyReleased` carries the committed key on every path under the rule. One event may be added: `KeyMatched(id, keyHash)`, emitted when a release passes the commitment check, so a reader of logs can tell a two-part release without decoding calldata.

**Storage.** None is added. The commitment lives inside the delivery hash the contract stores today.

**Gas.** Each change is guessed from calldata and hashing arithmetic. The baselines are measured on a local chain, on earlier builds, so the build measures both again with the gas-per-deal test.

| Call | Baseline [measured] | Change [guessed] |
| --- | --- | --- |
| `agreeAndFund` | 233,994 gas (2026-11-11, `docs/research/2026-11-11-settlement-chain.md`) | About 200 gas more: one word in the terms |
| `deliver` | 83,535 gas (same source) | About 600 gas more: one word in the delivery |
| `decide`, an accept after a posted delivery | 130,631 gas (same source) | About 5,000 to 7,000 gas more, 4% to 5%: the delivery's fields again, three hashes, six short hash computations, and the new event if it is added |
| `earlyAccept` | 141,464 gas (2026-11-04, `docs/reviews/2026-11-04-evm-e2e-round-1.md`) | About the same: three hashes replace the list of envelope hashes |
| `mutualSettle` after a delivery, with the key | 158,825 gas (same source) | About the same |

No path gains a transaction, so no path gains a block of waiting.

**Code size.** `HoldbackRules` is 20,839 bytes at the deployed build, against the EIP-170 limit of 24,576 [measured, `docs/audit/README.md`]. That leaves 3,737 bytes. The rule should need 700 to 1,300 of them [guessed].

**Tests the build adds.** Unit tests for each row of section 5.5 and each guard of section 6. An invariant: every `KeyReleased` on a deal under the rule carries the key its delivery committed. The EIP-712 vectors for the two changed types, in `contracts/test/unit/Vectors.t.sol` and `packages/core/src/eip712.vectors.test.ts`. A size check. The side-by-side harness against the deployed build, with each difference named.

## 8. Core, SimChain and the EVM adapter

- **Core.** `types.ts` and `eip712.ts` carry the two changed types and the 0.9 domain. `crypto/envelope.ts` gains the derived random source, a seal that uses it and the commitment's hash. `state.ts` checks `proofs` at `deliver`, and the decision's key at an accept, where it already holds the posted delivery; `withBuyerEnvelope` becomes a check for the commitment.
- **SimChain** steps through core, so it takes the rule from there. Its own check that an accept carries a key stays [measured, `packages/settlement/sim/simchain.ts`, `decide`]. Under the full protocol a party-appeal decision that carries the key carries the committed one.
- **The EVM adapter.** `encode.ts` encodes `release`, `proofsHash` and the witness. On an accept under the rule it sends the posted delivery's fields again. `abis.json` and the error names follow. It simulates through core first, as today, so a refused accept shows core's reason [inferred].
- **The adjudicator service** runs section 5.4 at intake and seals by derivation under both rules. Under `on_decision` that costs nothing and lets the seller recompute what the decider released.
- **The seller's tools** derive the buyer's seal, write `proofs[0]`, and run the decider's check on their own delivery before they send it.
- **Parity (D88).** A local run fails on any transcript line that differs from SimChain's and is not pinned. This rule should add no line to `LOCAL_KNOWN_DIFFERENCES`: both layers refuse and release at the same steps [inferred]. If the build finds a difference, it pins the exact lines with the reason, or changes the design.

## 9. The formal model

`formal/Holdback.tla` has one fact about the key: whether the buyer holds it [measured]. The rule needs two more.

- **Variables.** `commit[c]`: what the delivery committed for the buyer, one of `none`, `good` (a sealed key that opens the work) or `bad`. `rel[c]`: which key a release carried, one of `none`, `committed` or `other`. A constant names the deal's rule.
- **Actions.** `Deliver`, and each step that carries a delivery, picks `commit[c]` freely: the seller may commit anything. Under the rule, an accept is enabled only when `commit[c]` is `good` and sets `rel[c]` to `committed`. An early accept and a settlement with the key need `commit[c]` other than `none` and set `rel[c]` to `committed`.
- **Properties.**
  - `ReleasedKeyIsCommitted`: under the rule `rel[c]` is never `other`. The contract enforces it.
  - `DecidedKeyOpens`: under the rule, a deal Released by a decision has `commit[c]` equal to `good`. An honest decider enforces it.
  - `KeyOnlyWithPayment`, `AtomicKey` and `FundedSettles` must still hold. A `bad` commitment ends in a reject or a default, so liveness does not change.
- **Planted faults,** each of which must fail: `accept_other_key` (the contract skips the comparison) against `ReleasedKeyIsCommitted`, and `accept_ignores_key` (a decider skips its recomputation) against `DecidedKeyOpens`.
- **Reach witnesses:** a release on a committed key; a refund for a bad commitment; an early accept of a bad commitment, which stays reachable and shows what section 5.6 says.
- The model already skips delivery identity [measured, `formal/README.md`, "Not modelled"]. It will not model the hash, only its three outcomes.

## 10. Schema and API

| File | Change |
| --- | --- |
| `commitment.schema.json` | `settlement.release`, required, one of the two values |
| `delivery.schema.json`, `common.schema.json` | `proofs`, a short list of `DeliveryProof`; closed lists for `kind` and `verifier` |
| `adjudicator.schema.json` | `proofKinds`, beside the `checkKinds` of ADR-0045 and outside `policy`, so no `policyHash` moves |
| `messages.schema.json` | No field changes. A `Decision`'s `keyForBuyer` is the committed key under the rule |
| Version | The schema version after ADR-0045's; `schemaVersion` and the EIP-712 domain 0.9 |

- **No route is added.** `GET /v1/commitments/{id}/recipients` adds the derivation's inputs for the buyer's entry. The prepare route for a delivery takes `proofs`. `GET /v1/commitments/{id}/key` serves the released key as today.
- **The decline rule of ADR-0045 applies.** The primary posts no acceptance for an offer whose rule it does not run. The parties' tools read `proofKinds` for all three named adjudicators before they sign (D32).
- **A conformance file** ships with the reference page: a content key, a commitment ID, a buyer key and the sealed key they give, from Node and from Python. Phase one has no appeal, so the vectors are how a second adjudicator shows it computes the same seal.
- **The guides and the game say the same two sentences.** The seller commits to the buyer's key when it delivers. The money moves only in the transaction that hands the buyer that key. A browser game may show the bare key for teaching, with a line that says Crow seals it.

## 11. Fixtures

The verifier is code inside each adjudicator, and the contract's check is a hash comparison. Neither adds an actor to `docs/neutrality.md`'s table. Each fixture runs a deal under `on_decision_and_key`.

| Fixture | The actor that refuses or is offline | The deal still ends by its terms because |
| --- | --- | --- |
| `neutrality.key-check-primary-offline` | The primary adjudicator | After `judgeBy` the fallback opens its own envelope, recomputes the key and decides. Released, with the committed key |
| `neutrality.key-check-both-offline` | The primary and the fallback | Anyone triggers the default at `fallbackBy`. The whole hold returns and no key is released |
| `neutrality.key-check-operators-refuse` | Every operator | The decider's signed accept goes straight to the contract. The witness comes from the delivery's fields and the decider's own key |
| `neutrality.key-check-seller-offline` | The seller, after it delivered | The decider releases the committed key without it. No step needs the seller again |
| `neutrality.adjudicator-lacks-proof-kind` | An adjudicator that does not run `derived-seal/1` | The primary declines, the offer expires unfunded and no funds move |
| `neutrality.buyer-silent`, run under the rule | The buyer | Judgment and release need nothing from the buyer |

The rules contract, the maintainers, the club operator, the ramps, the beacon and the model providers gain no power from this rule. Their existing fixtures and the no-admin checks cover them unchanged.

Attack fixtures, each ending with nothing paid to the attacker:

- `attack.seller-commits-wrong-key`: the work passes, and the committed key seals another key. Rejected and refunded.
- `attack.decider-accepts-with-other-key`: the contract reverts the accept, and SimChain refuses it.
- `attack.two-keys-for-the-buyer`: a delivery with two envelopes for the buyer, or two `key_opens` entries that differ. Core refuses it; on chain only `proofs[0]` counts.
- `attack.key-commitment-from-another-deal`: a commitment copied from another deal fails, because the seal binds the commitment ID.
- `attack.early-accept-names-another-envelope`: refused, where today's contract would release it.

## 12. What the amendments row (N188) adds in the same version

ADR-0039 decided three ways to change a funded deal. Each meets this version differently.

| Piece of N188 | Contract change | What it costs | In this version? |
| --- | --- | --- | --- |
| **The waiver and the replacement** | None. Both use the settlement both parties sign, and Multicall3 [measured, ADR-0039] | Their build is off chain: the seller's routes, a buyer command, the `SettlementNote` type | They run on the new version as on the old. A waiver then releases only the committed key (section 5.6), and its offer carries the delivery's `proofs` |
| **A named note hash,** in place of the settlement's `nonce` as carrier (ADR-0039 section 4) | One field in `MutualSettlement` and one new event beside `MutuallySettled`, which stays as it is | About 15 lines, one more changed signed type, about 1,500 gas a settlement [guessed] | Optional. Take it only if the N188 build starts before this version freezes. The `nonce` carries the hash today [measured, ADR-0039] |
| **The in-place amendment** (ADR-0039 section 9) | A new entry point, a second stored word for each deal, the current terms hash, and every later call bound to it | About 22,000 gas more at funding for the new word [recalled], a new signed type, and the largest change to what an audit reads | No. ADR-0039 builds it only when measurements ask, and none has |

One version and one audit scope cost less than two. That argues for adding the named note hash now only if its build is certain, and for keeping the in-place amendment out either way.

## 13. A release in two amounts

This task was also asked what a release in two amounts would take: part of the price on a checked proof, the rest later or on a second check. The row does not ask for it, and the robot draft pays in one step. This section records the shape, so that a later decision starts from it.

**The terms field it would need:**

```json
"settlement": { "mode": "guaranteed_on_decision", "token": "0x…", "release": "on_decision_and_key",
                "firstShareBps": 7000 }
```

- **The rate is an integer in basis points,** from 0 to 10,000 (`common.schema.json`, `Bps`). A share that basis points cannot state, such as one third, would use the `Fraction` pair, a numerator over a denominator.
- **The rounding rule is ADR-0022's rule for a split of one pot.** The first amount is the price times the rate, divided by 10,000 and rounded down. The second amount is the price less the first. Only one side is rounded, so the two always add up to the price.
- **No float enters the hashed terms.**

**What it would cost:**

- a new open stage between the two releases, and a second decision or a timer to close it;
- a rule for the key: with the first amount the buyer holds the work for part of the price; with the second the seller waits for all of it;
- a split of the adjudication fee, and a default for the rest;
- a settlement by agreement over what is left;
- new rows in the state model, the invariants and the formal model.

The escrow can already take part captures [measured, `docs/research/prior-art.md`]. The rest is new.

**What the parties can do today:**

- make two deals, one for each part, each with its own checks and deadlines;
- or settle one deal by agreement at any split, which the contracts pay today.

**Verdict: out.** It adds a stage and a second decision before any deal has asked for one. A deal that asks for it gets its own decision record.

## 14. Risks

| Risk | Bound | Mitigation |
| --- | --- | --- |
| **The derived seal is a new construction here** | A flaw could expose a content key or break the comparison | A review by a second model family or a cryptographer before the build; the fallback of section 5.3 |
| **A decider's wrong recomputation rejects good work,** and phase one has no appeal | One deal's sale; no money moves but the fee | Published vectors, the seller's own run before it delivers, `proofKinds`, the decline rule |
| **A dishonest decider** accepts work it did not check, with a commitment it did not check | As today (residuals 3 and 7 of `docs/neutrality.md`) | Unchanged: the parties name the deciders, and the signed decision is evidence |
| **The buyer pays blind on the paths it signs alone** | One deal's price, by its own signature | The tools say so; the seller's proof later (section 5.6) |
| **The key in a failed call's calldata** (known issue "H-2 limit") | Unchanged: this rule neither adds a case nor removes one | Relay a key-bearing call only after simulating it; option C2 if Rafa wants it closed |
| **Every signer changes,** and a new world is needed | Work only; no money is at risk | One version, one freeze, one deploy round (D49) |
| **Contract size** | 3,737 bytes of room [measured] | A size check in the build |
| **A standing delivery cannot use the rule** | Its buyers rely on the decider's seal, as today | The decider seals by derivation, so the seller can recompute what it released |
| **An outside seller must implement the seal** | It needs HKDF and the box with a chosen one-time key, which common libraries have [recalled] | The conformance file in two languages |

## 15. What stays out

| Left out | Why |
| --- | --- |
| **The two-step release (C2)** | A stage, a deadline and a second transaction on every judged deal, to close a limit that already has a bound. It comes back if party appeals return, since the limit grows with them, or if a key is seen published by a failed call |
| **An on-chain zero-knowledge check** | A verifier with an admin breaks "no admin keys"; a fixed one has no stop when its proof system breaks. One proof took 2,813 s [reported] |
| **The bare content key on chain** | It publishes the work to whoever holds the ciphertext (D35, ADR-0020) |
| **A key attestation by an adjudicator on the paths a buyer signs alone** | A new signed type, and an adjudicator would read work on a path where today nobody but the parties does (ADR-0020 section 2) |
| **A remedy for a buyer whose own encryption key is wrong** | It can check that key before it signs (D32). The primary already declines an offer whose buyer key it cannot seal to [measured, `service.ts`] |
| **Derived seals for the adjudicators' envelopes** | They would let any decider prove a broken envelope, which row N199 wants. That is its own decision |
| **More delivery attempts, a release in two amounts, the in-place amendment** | Each adds a stage or a stored word. None is needed for this rule |
| **Verifier code from a party** | Hard rule: no code from commitments or deliverables. A new verifier is a schema change with built-in code |

## Recommendation

1. **Adopt option C** as ADR-0046: the committed sealed key, recomputed by every decider and checked by the contract, named in the terms as `on_decision_and_key`.
2. **Add `proofs` to the delivery in the reserved shape,** with `key_opens` and `derived-seal/1` as its first kind and verifier.
3. **Get the derived seal reviewed before the contract build starts.**
4. **Carry the rule and D85's two fixes in one contract version.** Leave the in-place amendment out. Take the named note hash only if the amendments build starts before the freeze.
5. **Leave the two-step release, the on-chain proof and the release in two amounts out,** each with the trigger that would bring it back.

## Open questions

| Question | Owner |
| --- | --- |
| One step (C), or two steps (C2) to also close the key-in-calldata limit? | Rafa |
| On a key mismatch, reject as proposed, or escalate so that a second adjudicator recomputes? | Rafa |
| Does the named note hash of the amendments row ride in this version? | Rafa, with the next version's contents |
| Does the derived seal pass a second-family or cryptographer's review, or does the fallback apply? | The build task, before it starts |
| Is the `KeyMatched` event worth its gas, or do readers decode the terms? | The build task, with the audit package |
| Does the browser game show a sealed key, or a bare key with a line that says Crow seals it? | The guides task |
| Do the gas and size guesses of section 7 hold? | The build task, measured |

## Sources

- BIS, Committee on Payment and Settlement Systems, "Delivery versus payment in securities settlement systems", 1992-09-09: https://www.bis.org/cpmi/publ/d06.htm
- BIP-199, "Hashed Time-Locked Contract transactions": https://github.com/bitcoin/bips/blob/master/bip-0199.mediawiki
- Bitcoin Core, "The first successful Zero-Knowledge Contingent Payment", 2016-02-26: https://bitcoincore.org/en/2016/02/26/zero-knowledge-contingent-payments-announcement/
- Campanelli, Gennaro, Goldfeder and Nizzardo, "Zero-Knowledge Contingent Payments Revisited", CCS 2017: https://eprint.iacr.org/2017/566
- Fuchsbauer, "WI Is Not Enough: Zero-Knowledge Contingent (Service) Payments Revisited", CCS 2019: https://www.di.ens.fr/~fuchsbau/CCS19.pdf (found by search, not opened)
- Dziembowski, Eckey and Faust, "FairSwap: How to fairly exchange digital goods", CCS 2018: https://eprint.iacr.org/2018/740; a summary of its steps: https://blog.acolyer.org/2018/12/05/fairswap-how-to-fairly-exchange-digital-goods/
- ERC-8183, "Agentic Commerce", draft: https://eips.ethereum.org/EIPS/eip-8183
- Hofheinz, Hövelmanns and Kiltz, "A Modular Analysis of the Fujisaki-Okamoto Transformation", TCC 2017: https://eprint.iacr.org/2017/604
- libsodium, "Sealed boxes": https://doc.libsodium.org/public-key_cryptography/sealed_boxes
- RFC 5869, "HMAC-based Extract-and-Expand Key Derivation Function (HKDF)": https://www.rfc-editor.org/rfc/rfc5869
- RISC Zero, the verifier contracts' version management design: https://github.com/risc0/risc0-ethereum/blob/main/contracts/version-management-design.md
- ICC, UCP 600, articles 31 and 32: read in commentary found by search; the rule text was not opened.

No query or request carried a name, an address or any detail of a deal or a party.

## Scope

- **Read:** `CLAUDE.md`; `docs/writing.md`; `docs/research/2026-11-24-delivery-proofs.md`; ADR-0012, ADR-0020, ADR-0039 and ADR-0045 in full; ADR-0015, ADR-0022, ADR-0029 (sections 1 and 2), ADR-0031 (sections 8 and 10) and ADR-0040 (section 2) in part; `docs/decisions-today.md` (D77 to D90, and the summaries of D26, D28, D31, D32 and D35 in `CLAUDE.md`); `contracts/src/HoldbackRules.sol`, `IHoldbackRules.sol`, `HoldbackTypes.sol` and `HoldbackStandingSeller.sol`; `packages/core/src/state.ts`, `eip712.ts` and `crypto/`; `packages/settlement/sim/simchain.ts` (`decide`); `apps/adjudicator/src/service.ts` (the key lines); `spec/schemas/commitment.schema.json`, `delivery.schema.json` and `common.schema.json`; `formal/Holdback.tla` and its README; `docs/audit/invariants.md`, `known-issues.md` and `README.md`; `docs/neutrality.md`; `docs/api.md` (the envelope sections); `tools/envelope-proof/README.md`; the fixture `error.early-accept-wrong-key-envelope`. The roadmap rows for the two-part release, the amendments, the envelope proof and the on-chain envelope signal. A design partner's draft terms for a robot-data deal.
- **Run:** one scratch script for section 5.3, against `packages/core` built at `031bb08c`. It is not in the repository.
- **Not done:** no contract, schema or package file changed. No gas or code size was measured for the change. The browser game's source was not read. The derived seal has had no outside review. Every claim about the Fujisaki-Okamoto transform beyond the paper's abstract, about HKDF's use beside AES, and about common libraries is recalled or inferred and labelled so.
