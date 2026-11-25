# ADR-0046: A release needs the work to pass and the key the seller committed

- **Status:** Proposed, 2026-11-25 (D91). A decision Rafa can overrule. Design only: no code, schema or contract changes with this record.
- **Date:** 2026-11-25
- **Raised by:** roadmap row N226, the two-part release (plan task P-20). Rafa, 2026-11-23: payment is released only if the work passes the agreed checks and the key works.
- **Research:** [`docs/research/2026-11-25-two-part-release.md`](../research/2026-11-25-two-part-release.md): today's three paying paths, prior art with sources, the options, a measured run of the derived seal, and the changes layer by layer.
- **Builds on:** ADR-0001 (neutrality), ADR-0002 (the hold), ADR-0006 (deterministic checks first), ADR-0012 (the two-sided hold), ADR-0015 (user choice), ADR-0020 (privacy), ADR-0022 (no float in a hashed body), ADR-0029 (signatures name the delivery), ADR-0031 (phase one), ADR-0039 (the waiver), ADR-0040 (standing deliveries), ADR-0045 (proof checks and adjudicator discovery); D26, D28, D31, D32, D35, D81, D85, D88.
- **Amends when accepted:** ADR-0012, where an accept carries a key the adjudicator sealed. Under this rule it carries the key the seller committed. This record edits no other record now.
- **Changes when built, by later tasks:** a new version of `contracts/src/` under EIP-712 domain 0.9, a version bump of `spec/schemas/`, `packages/core`, `packages/settlement`, `apps/adjudicator`, `apps/operator`, `examples/`, `site/`, `formal/`, `fixtures/`, `docs/neutrality.md` and `docs/audit/`.

Labels: **measured** (read from the repository at `031bb08c`, or run, with the source), **reported** (another record's measurement), **recalled**, **inferred**, **guessed**. The research note carries the sources.

Four words recur. The **content key** encrypts the work. The **sealed key** is the content key encrypted to the buyer's encryption key: today's key envelope. A **decider** is the adjudicator whose turn it is to decide. A **free look** is a buyer reading the work before it pays.

## Summary

1. **The terms name the release rule.** `settlement.release` is `on_decision_and_key` or `on_decision`. The second is today's rule and stays for a standing delivery.
2. **The seller commits to the buyer's sealed key in the signed delivery.** The commitment is one hash in a new `proofs` list, in the shape the delivery-proofs note reserved.
3. **The buyer's sealed key becomes a pure function** of the content key, the commitment ID and the buyer's key. Whoever holds the content key can recompute it. Its layout does not change, and the buyer opens it as today.
4. **A decider recomputes the sealed key from the content key that opened the work.** A match passes the key check. A mismatch fails it like a required check: reject and refund.
5. **The rules contract pays only in a call that carries the committed key.** An accept with any other key reverts. An early accept and a settlement with the key release only the committed key.
6. **Nothing new is stored on chain, and the state machine gains no stage, deadline or timeout.**
7. **A buyer's own signature still stands for both parts.** Nothing checks the key for a buyer that accepts early or signs a waiver. A proof the buyer can run itself fits the same `proofs` list later, with no contract change.
8. **One contract version carries this rule and D85's two fixes.** The in-place amendment of ADR-0039 stays out.

## Context

- **Today a release follows one condition** [measured, research note section 1]. On an accept the decider seals the buyer's key itself, and `HoldbackRules._settleDecision` requires only that the key is not empty. On an early accept and on a settlement with `releaseKey`, the contract releases an envelope from the seller's delivery, and nothing shows that it opens the work.
- **Three faults follow** [measured and inferred]. A seller can seal the buyer's envelope to another key, and an early accept pays for it (fixture `error.early-accept-wrong-key-envelope`). A decider's wrong seal pays the seller the whole price. A delivery that lists two envelopes for the buyer lets the submitter choose which one is released.
- **Phase one has no party appeal** (ADR-0031), so nothing in the protocol returns that money. The loss is one deal's price.
- **A decider already holds what the check needs.** It opens its own envelope and decrypts the work against the signed plaintext hash before it judges [measured, `packages/core/src/crypto/content.ts`, `open`]. It cannot open the buyer's envelope, so it cannot say today whether that envelope holds the same key.
- **The delivery-proofs note reserved a `proofs` field for this rule** and asked for one contract change that serves both rows (`docs/research/2026-11-24-delivery-proofs.md`, section 6).
- **The next contract version is already due.** D85 put two fixes in it.
- **The chain may hold keys, hashes and amounts** (D35). The content key and the work never reach it, at any disclosure level (ADR-0020).

## Decision

### 1. The rule in the terms

```json
"settlement": { "mode": "guaranteed_on_decision", "token": "0x…", "release": "on_decision_and_key" }
```

| `release` | An accept pays when | The key the buyer gets |
| --- | --- | --- |
| `on_decision` | The decider signs it, as today | The key the decider seals |
| `on_decision_and_key` | The decider signs it and the call carries the key the delivery committed | The committed key |

- Both parties sign the rule with the terms. A club may narrow the choice. An adjudicator declines an offer whose rule it does not run (section 9).
- The tools write `on_decision_and_key` for a delivery made for one buyer. A standing delivery, which holds no key for its buyer (ADR-0040 section 2), uses `on_decision`.
- The field is a string. The rule adds no number to the terms, so ADR-0022 holds with nothing to check.
- The EIP-712 type becomes `Settlement(string mode,string token,string release)`.

### 2. The key commitment on the delivery

The delivery gains `proofs`, a list of `{ kind, format, verifier, publicInputs, sha256 }`:

```json
"proofs": [
  { "kind": "key_opens", "format": "x25519-xsalsa20poly1305", "verifier": "derived-seal/1",
    "publicInputs": ["0x<64 hex>"], "sha256": "sha256:<64 hex>" }
]
```

- **`kind` and `verifier` are closed lists.** `key_opens` and `derived-seal/1` are the first entries. A new one is an ADR and a schema bump. A verifier is pinned built-in code, never an address to call or code to load.
- **`publicInputs[0]` is the commitment:** the EIP-712 struct hash of the buyer's `EncryptedKey`, the value the contract computes today for the envelope it releases. `sha256` is the SHA-256 of the sealed key's text, so any tool can check a released key with one hash. For `key_opens`, `sha256` hashes the sealed key's text, not proof bytes; a later kind that carries proof bytes uses it as the delivery-proofs note (2026-11-24) defined it.
- **Under `on_decision_and_key`, `proofs[0]` is this entry.** A later `key_opens` entry, for another verifier, must commit to the same key.
- **The sealed key may also sit in `encryptedKeys`, as today.** That copy is optional transport for an early accept. When present it must hash to the commitment, and a delivery may address one envelope to the buyer at most.
- The EIP-712 types become `Delivery(bytes32 commitmentId,uint8 attempt,Ciphertext ciphertext,string plaintextSha256,string plaintextMime,EncryptedKey[] encryptedKeys,DeliveryProof[] proofs,uint64 submittedAt)` and `DeliveryProof(string kind,string format,string verifier,bytes32[] publicInputs,string sha256)`.

### 3. The derived seal

Under `derived-seal/1` the buyer's sealed key draws its one-time secret key and its nonce from the content key:

```
okm = HKDF-SHA256( key material = the content key (32 bytes),
                   salt         = the commitment ID (32 bytes),
                   info         = "holdback/derived-seal/1" ‖ 0x00 ‖ the buyer's address (20 bytes)
                                  ‖ the buyer's encryption key from the terms (32 bytes),
                   length       = 56 bytes )
one-time secret key = okm[0..32]        nonce = okm[32..56]
sealed key = one-time public key (32) ‖ nonce (24) ‖ box(content key) (48)
```

- **The layout and the scheme label stay** as `docs/api.md` gives them. No buyer changes its code.
- **`wrapKey` already takes its random source as an input** [measured, `packages/core/src/crypto/envelope.ts`]. A scratch run on 2026-11-25 passed 10 of 10 checks [measured, research note section 5.3]. Two holders of one content key derived the same 139-character sealed key. The buyer opened it and decrypted the work. Any changed input gave another sealed key. One seal took 1.7 ms.
- **The construction needs a review before the build starts,** by a second model family or a cryptographer. The content key serves as an AES key and as HKDF input. If the review objects, the fallback keeps fresh randomness and puts the buyer envelope's one-time secret inside each adjudicator's envelope. The decider's check is then the same comparison.
- **The adjudicators' own envelopes keep fresh randomness.**

### 4. What a decider checks and signs

At intake, before any check or judge runs, a decider:

1. opens its own envelope and decrypts the work against the signed plaintext hash, as today; if it cannot, it signs nothing and retries (D81);
2. reads `proofs[0]`, which under the rule must be `key_opens` with a verifier it runs;
3. recomputes the buyer's sealed key;
4. compares it with `publicInputs[0]` and `sha256`.

- **A match passes the key check.** No entry, another verifier, a second envelope for the buyer or a mismatch fails it.
- **The check is a pure function** of the delivery, the terms and the content key. Two adjudicators reach the same result, and the seller's own tool runs it before it delivers.
- **On an accept, `keyForBuyer` is the key the decider recomputed,** never a copy of the seller's. The decider needs no bytes from the seller or an operator.
- **Under `on_decision` a decider skips steps 2 to 4,** whatever the delivery carries. The reference adjudicator still seals by derivation there, so the seller can recompute what the decider released.

### 5. What the contract enforces

- **On an accept under `on_decision_and_key`:** the posted delivery travels in the call again, its hash must equal the stored one, and the decision's key must rebuild `proofs[0]`. Any other key reverts with the key-proof error. No money moves and no event fires.
- **On an early accept and on a settlement with `releaseKey`, under either rule:** the same check replaces today's membership proof. The released key is the committed one, so a submitter can no longer name another envelope addressed to the buyer.
- **On a reject or an escalation:** no key, as today.
- **Stored:** nothing new. The commitment lives inside the delivery hash the contract stores today. The contract never reads which verifier an entry names.
- **Events:** none is removed and none changes shape. The build may add one, `KeyMatched(id, keyHash)`, on a release that passed the check.
- **Because the decider sends its own recomputed key, the comparison also checks the decider's arithmetic.** A wrong recomputation cannot land an accept.

### 6. Outcomes

| The work | The key | The decider signs | The money |
| --- | --- | --- | --- |
| Passes | Matches the commitment | Accept, carrying the committed key | The price to the seller, the fee to the decider; the key is released in that call |
| Passes | Does not match, or no commitment | Reject, for the failed key check | The price back to the buyer, the fee to the decider |
| Fails | Either | Reject, as today | The same |
| Any | The decider cannot open its own envelope | Nothing (D81); the turn passes on by the terms | A default returns the whole hold |

- **The key check runs before the other checks and the panel.** A mismatch rejects without them.
- **A mismatch is a failed required check,** as the delivery-proofs note asked, so one sentence in the guides covers a failed proof and a failed key.
- **The buyer's loss is bounded** (D26): the adjudication fee on a reject, nothing on a default, and a wait that ends at the terms' own deadlines.

### 7. The paths a buyer signs alone

- **An early accept and a settlement with `releaseKey` stay the buyer's own acceptance** (D32). Its signature stands for the work part.
- **The contract still binds the key** on those paths (section 5). It does not show that the committed key opens the work, because no decider read it.
- **The buyer's tools say so before it signs.** A buyer that wants the check waits for the decision.
- **A proof the buyer can run itself is a second `key_opens` verifier.** Row N200's zero-knowledge proof states what such a buyer needs. It joins the closed list by its own ADR when a deal needs it, and the contract does not change.

### 8. Versions, and what the next contract version carries

- **Signed encoding:** `schemaVersion` and the EIP-712 domain move from 0.8 to 0.9. The schema takes the version after ADR-0045's.
- **Changed signed types:** the terms' `Settlement` and the `Delivery`, with the new `DeliveryProof`. A `Decision` keeps its type.
- **The same contract version carries D85's two fixes:** a decision that is not an accept refuses a carried delivery, and an escalation's beacon round is fixed by state.
- **The standing seller contract is rebuilt for the new domain** whatever this rule changes, because it pins the rules contract's domain version [measured, `HoldbackStandingSeller.sol`]. Its take's delivery sets an empty `proofs` list.
- **The amendments row (N188) adds no contract change** for its waiver and its replacement. A waiver then releases only the committed key. The named note hash of ADR-0039 section 4 may ride along as one field and one new event, if its build starts before this version freezes. The in-place amendment of ADR-0039 section 9 stays out.

### 9. Discovery and the decline rule

- **Each adjudicator's record gains `proofKinds`,** beside the `checkKinds` of ADR-0045 and outside `policy`, so no `policyHash` moves.
- **The primary posts no acceptance** for an offer under a rule or a verifier it does not run. The offer expires unfunded.
- **A decider that lacks a `proofKinds` entry signs nothing at any role** (D92, the rule of `checkKinds`); the deal runs to the next decider or its default.
- **The parties' tools read `proofKinds` for all three named adjudicators** before they sign (D32). An operator may warn and never refuses (D31).
- **A conformance file ships with the reference page:** a content key, a commitment ID, a buyer key and the sealed key they give, made in two languages.

### 10. What the build must add

- **Contracts:** a unit test for each row of section 6 and each line of section 5; an invariant that every `KeyReleased` under the rule carries the key its delivery committed; the EIP-712 vectors for the changed types; a code-size check against 24,576 bytes; measured gas for each changed call.
- **Core and SimChain:** the same guards in `packages/core/src/state.ts`, so SimChain and the contract refuse and release at the same steps. A local run that differs from SimChain by an unpinned line fails (D88).
- **The formal model:** what the delivery committed and which key a release carried; `ReleasedKeyIsCommitted` and `DecidedKeyOpens`; two planted faults that must fail them.
- **Neutrality fixtures,** each on a deal under the rule: `neutrality.key-check-primary-offline`, `neutrality.key-check-both-offline`, `neutrality.key-check-operators-refuse`, `neutrality.key-check-seller-offline`, `neutrality.adjudicator-lacks-proof-kind`, and `neutrality.buyer-silent` run again.
- **Attack fixtures:** `attack.seller-commits-wrong-key`, `attack.decider-accepts-with-other-key`, `attack.two-keys-for-the-buyer`, `attack.key-commitment-from-another-deal`, `attack.early-accept-names-another-envelope`.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| **The decider attests with a signed flag** and still seals the key itself | It names today's trust and checks nothing. A wrong seal still pays |
| **A bare hash-locked content key,** shown on chain at release | The content key becomes public, so whoever holds the ciphertext reads the work. Operators hold it (D35, ADR-0020) |
| **Accept first, then the key within a window** (two calls) | It also closes a known limit: a call that carries the key shows it in calldata even when it fails (`docs/audit/known-issues.md`, "H-2 limit"). It costs a stage, a deadline, a timeout and a second transaction on every judged deal. Kept as the first option to reopen (open point 1) |
| **A zero-knowledge proof checked on chain** | A verifier contract with an admin breaks "no admin keys", and a fixed one has no stop if its proof system breaks. One proof took 2,813 s to make [reported, T-541, one run] |
| **Release the seller's envelope on an accept, with no derived seal** | The decider cannot open the buyer's envelope, so nobody would have checked it |
| **Carry the buyer envelope's one-time secret in each adjudicator's envelope** | The same check with fresh randomness. It changes every adjudicator envelope's layout. Kept as the fallback if the review refuses the derived seal |
| **The commitment as a new top-level delivery field** | A second shape beside the reserved `proofs` list, and a later proof kind would need another contract version |
| **Keep the membership proof in the envelope list** | The submitter can name any envelope addressed to the buyer |
| **Escalate on a key mismatch** | A second adjudicator would recompute, which guards a seller against one decider's fault. It adds time, and Crow's three adjudicators run one build. Kept as open point 2 |
| **A release in two amounts** | It answers another question: part of the price on a first check, the rest on a second. It needs a rate, a stage and a second decision. No deal has asked (research note section 13) |
| **The in-place amendment in the same version** | A new entry point and a second stored word for each deal. ADR-0039 builds it only when measurements ask |

## Consequences

- **A judged release pays only for a key the seller committed and the decider recomputed.**
- **A decider's wrong seal can no longer pay the seller.** It can refund a deal that should have paid.
- **A dishonest decider is not bound by this.** It can still pass a key through unchecked, as it can accept work unread. That stays today's trust in the deciders the parties name (residuals 3 and 7 of `docs/neutrality.md`).
- **Every signer changes for two types,** and the new version is a new deployment and a new world (D49).
- **An accept costs about 5,000 to 7,000 gas more,** on 130,631 gas [guessed; the baseline measured on 2026-11-11 on a local chain]. No path gains a transaction.
- **`HoldbackRules` has 3,737 bytes of room** under the code-size limit [measured, `docs/audit/README.md`]. The rule should need 700 to 1,300 [guessed].
- **An outside seller implements the derived seal** from the reference page and the conformance file.
- **The key in a failed call's calldata stays a known limit.** This rule adds no case to it and removes none.
- **The guides and the browser game that teaches the swap say the same two sentences.** The seller commits to the buyer's key when it delivers. The money moves only in the transaction that hands the buyer that key.

## Litmus tests

- **Neutrality.** The verifier is built-in code in every decider, and the contract's check is a hash comparison, so the rule adds no party that can stop a deal. A decider that is offline, or that lacks the kind, leaves the fallback, the default or an unfunded offer, as today. No step after delivery needs the seller. Six fixtures show it (section 10).
- **The hold.** No stage, deadline or timeout changes, and nothing new is stored. Funds move on the same signatures and timeouts as today, with one more condition on a key-bearing call. Neither party can take the hold alone.
- **Defended judgment.** The key check is one more deterministic check that runs before the panel. Nothing from the delivery runs, and the verifier is pinned built-in code. The panel, its seed and its families are unchanged.

## Open points for Rafa

1. **One step or two.** Recommended: one step, as above. The alternative adds a stage and a second transaction, and also closes the key-in-calldata limit.
2. **A key mismatch.** Recommended: reject, like any failed required check. The alternative escalates, so that a second adjudicator recomputes before a final reject.
3. **The named note hash of the amendments row.** Recommended: add it to this version only if the amendments build starts before the freeze. The `nonce` carries the hash until then.
4. **The review of the derived seal.** Recommended: a second-family review before the contract build starts, with the fallback of section 3 ready.
5. **Two names for "commitment".** Section 2 calls `publicInputs[0]` "the commitment", and section 3 salts the seal with "the commitment ID", the deal's own ID. An implementer who salts with `publicInputs[0]` meets a fixed point: that hash covers the sealed key it would derive. Recommended: call `publicInputs[0]` the key commitment everywhere, and state that the salt is the delivery's `commitmentId` (raised by the second-family review of 2026-11-25, s09).
6. **A limit on `proofs` and `publicInputs`.** Under `on_decision_and_key` an accept posts the delivery again, and neither list has a maximum length. A seller can make the accept too large to land, so the hold runs to its default and refunds the buyer. The seller loses its own sale; the buyer waits until the deadline. Recommended: a `maxItems` on both lists in the schema bump, as for an encoding limit (D31 allows it), and a gas estimate in the decider before it signs (raised by the second-family review of 2026-11-25, s10).
