# Standing offers: what binds an offer to one buyer, and what a seller contract can lift

**State: research for ADR-0040 (D82, T-544, roadmap row N196), 2026-11-18. Recommendation in the ADR. One scratch test ran on a local chain (section 2); nothing was built, deployed or sent.**

Labels: **measured** (read at the cited line at `origin/main` `21bb4e54`, or run as cited), **documented** (a doc or published standard states it), **recalled** (known to the author, not opened on 2026-11-18), **inferred**, **guessed**.

This note starts from the private design study of 2026-11-18 (T-532), which named the direction Rafa chose. Section 1 checks each of that study's claims.

## 1. The design study's claims, checked

| Claim | Verdict | Evidence |
| --- | --- | --- |
| The commitment ID is the hash of the terms, and the seller's signature over it is the offer | Holds | `contracts/src/HoldbackTypes.sol:36-37`, `:307-333`; `HoldbackRules.sol:153`, `:181` [measured] |
| The terms name the buyer five ways: `buyer`, `buyerPaymentAddress`, `buyerKeyHash`, `nonce`, `createdAt` | Holds | `HoldbackTypes.sol:49-69`. `nonce` and `createdAt` are not the buyer's by nature; they are the per-take fields [measured] |
| The terms carry five fixed dates | Holds | `HoldbackTypes.sol:22-34`; `agreeAndFund` requires them in strict order (`HoldbackRules.sol:166-172`) [measured] |
| The chain first sees a deal at funding, with three signatures in one call | Holds | `HoldbackRules.sol:146-192`, checks at `:181-183` [measured] |
| The delivery is signed for one deal | Holds | the delivery hash includes the commitment ID (`HoldbackTypes.sol:366-379`); checked at `HoldbackRules.sol:530-531` [measured] |
| The rules contract accepts ERC-1271 for an address with code | Holds, and is tested | `HoldbackRules.sol:567-571`; Solady's `isValidSignatureNowCalldata` branches on `extcodesize` (`contracts/lib/commerce-payments/lib/solady/src/utils/SignatureCheckerLib.sol:80-123`, Solady commit `5ea5d9f5`); `contracts/test/crosscheck/Erc1271Roles.t.sol:82` funds, delivers and pays a seller wallet [measured] |
| "This node checks plain-key signatures only" | Holds | `docs/neutrality.md:55`; every off-chain check recovers an ECDSA key through viem's `recoverTypedDataAddress` (`packages/core/src/eip712.ts:613-620`); `packages/settlement/evm/evm-settlement.ts:2003` says contract signers "are not read" [measured] |
| The buyer's pinned tool refuses a signature that is not the seller's key | Holds | `examples/buyer-signer.ts:792-793`; `site/buy.mjs:1724` says so in its own words [measured] |
| A new rules-contract function may not fit under the size limit (EIP-170) | **Does not hold** | T-499 records 20,502 bytes of runtime on chain and in its artifact (`docs/tasks/T-499-contracts-audit-ready.md:54`), so 4,074 bytes of the 24,576-byte limit are free [measured there]. A scratch `forge build --sizes` gave 20,455 bytes [measured, 2026-11-18], a command T-499 warns does not match the artifact. The size argument against way B falls; the audit argument stands |
| For a fixed file, a delivery can stand too | **Holds only with a core change** | core and the operators require an envelope for the deal's own buyer in every delivery (`packages/core/src/state.ts:362-368`; `apps/operator/src/prepare.ts:723-726`), and only the seller can make one. See section 3 [measured] |
| The adjudicator accepts terms a seller posts | Partly | the reference adjudicator polls the offers its settlement port lists (`apps/adjudicator/src/service.ts:442-446`); nobody posts to it. Who posted the terms makes no difference to it [measured] |

## 2. The scratch test: a seller contract against the unchanged rules contract

**The test** [measured, 2026-11-18]. A scratch copy of `contracts/` at `21bb4e54`, with the main checkout's libraries linked, ran a spike seller contract (136 lines) against the real `HoldbackRules`, the vendored Commerce Payments escrow and the repository's test base (`contracts/test/unit/Base.sol`). The spike and its test are kept as text: [`2026-11-18-standing-offers/StandingSellerSpike.sol.txt`](2026-11-18-standing-offers/StandingSellerSpike.sol.txt) and [`StandingSellerSpike.t.sol.txt`](2026-11-18-standing-offers/StandingSellerSpike.t.sol.txt). It is a measurement, not the build: it skips the review, the interface file and the fuzzing the build needs.

**What the spike does.** Its constructor takes one argument, the seller's key address. `isValidSignature(hash, sig)` answers in three ways:
- a 64- or 65-byte `sig` is the key's own signature over `hash`, for anything (a settlement, a per-buyer delivery);
- a longer `sig` decodes to a template, the key's signature over the template, and the buyer's fill. The contract rebuilds the whole terms itself, puts its own address in `seller`, counts the five dates from the fill's `createdAt`, computes the commitment ID with the rules contract's own library (`HoldbackTypes.commitmentId`), and asks the named rules deployment for the EIP-712 digest (`typedDataHash`, `HoldbackRules.sol:111`). It says yes only if that digest equals `hash`;
- the same blob with another kind byte approves the template's one standing delivery for that take's commitment ID.

**Results,** `forge test --match-path 'test/spike/*'`: 10 passed, 0 failed.

| Test | What it shows |
| --- | --- |
| `test_twoTakes_oneStandingDelivery_bothPaid` | two buyers take one template; each gets its own ID; one delivery body, posted by an outside address, serves both; both accepts pay the payout address twice the price; the seller contract holds 0 |
| `test_replayedTake_refused` | the same fill again reverts `WrongStage(Held)`: the rules contract's own stage check stops a replay |
| `test_alteredTerms_refused` | terms with any other price revert `BadSignature`: the contract builds the terms, it never trusts them |
| `test_futureCreatedAt_refused` | a take dated in the future reverts `BadSignature` |
| `test_backdatedCreatedAt_refusedByOfferExpiry` | a take dated one offer window back reverts `DeadlinePassed`: the rules contract's offer expiry bounds how far a buyer can backdate |
| `test_deliveryOfAnotherFile_refused` | a delivery with any other ciphertext hash reverts `BadSignature` |
| `test_templateSignedByAnotherKey_refused` | a template signed by another key reverts `BadSignature` |
| `test_revokedTemplate_noNewTake_fundedDealStillDelivers` | a revocation relayed by another address stops new takes; a deal already funded still takes its standing delivery |
| `test_anyPayerDeploysTheSameAddress` | the deterministic deployment proxy puts the contract at one address whoever pays; a second deploy fails and changes nothing |
| `test_keyPath_mutualSettlementForATake` | a refund both parties sign, the seller with its key, lands for a take |

**Size.** The spike's runtime is 9,430 bytes (`forge build --sizes`, `via_ir`, 200 optimizer runs) [measured]. Most of it is the decoder for the whole terms struct [guessed].

**Gas.** One take's `agreeAndFund`, with the test's own signing helpers, used 318,865 gas on the local chain [measured; an upper bound, since the helpers are inside the figure]. The rules contract's plain funding is measured in `contracts/test/unit/GasPerDeal.t.sol`; the build measures the difference.

**The red team's tests** [measured, 2026-11-18]. The red-team pass added 7 tests against the spike, kept as [`RedTeam.t.sol.txt`](2026-11-18-standing-offers/RedTeam.t.sol.txt). Against the first spike, two showed a High hole: a revoked template's standing delivery landed, and was paid, on a take of a new template with equal terms, because the commitment ID did not depend on the template. The spike kept here derives the terms' nonce from the template's hash (`termsOf`); rerun with it, the spike's 10 tests pass and those two attacks fail with `BadSignature` at the old file's delivery. The red team's other 5 tests pass and show what the record now handles in the build: a payout into the contract itself, a second template that differs only in a field the contract ignores, the key path approving another application's digest, the gas a failed second deployment burns (2,965,785 of 3,000,000 gas), and an early accept or key-releasing settlement reverting `BadKeyProof` when the buyer has no envelope.

**Not covered by the spike:** fuzzing of the decoder, a malformed blob, a template whose offsets overflow 64 bits (the spike refuses with `Unrepresentable`, untested), a template naming another rules deployment, and a gas-burning answer (the rules contract already survives one: `contracts/test/crosscheck/Erc1271GasBurn.t.sol`).

## 3. Delivery and keys

- **Recipients today.** Core requires an envelope for the primary, the fallback, the appeal adjudicator and the buyer (`packages/core/src/state.ts:366-367`), so that an early accept can never strand the buyer (its comment, `:362-364`). The operator's prepare step requires the same four (`apps/operator/src/prepare.ts:723-726`) [measured].
- **On the judged path the buyer's envelope is not used.** The primary opens its own envelope (`apps/adjudicator/src/service.ts:933-935`) and wraps the content key to the terms' `buyerEncryptionPublicKey` for an accept (`:1045`). The contract refuses an accept without that key (`HoldbackRules.sol:310`) [measured].
- **Without a buyer envelope, the buyer cannot accept early.** `earlyAccept` requires a key proof for an envelope addressed to the buyer (`HoldbackRules.sol:344`), and so does a settlement that releases the key (`:380-381`). So the money cannot move to the seller without the key moving to the buyer, except by a settlement that pays the seller and releases nothing, which the buyer would have to sign [measured].
- **Content keys are fresh per delivery today,** and nothing checks for reuse. The seller adapter draws a random key (`examples/agent.ts:267-270`); AES-GCM binds no associated data (`:270`; `packages/core/src/crypto/content.ts:77`); the envelopes are plain NaCl boxes (`packages/core/src/crypto/envelope.ts:84-88`). The commitment is bound only by the seller's signature over the delivery hash [measured].
- **`submittedAt` is signed and read by nothing** (`HoldbackTypes.sol:97-98`; `packages/core/src/state.ts:613`), so one fixed value can stand [measured].
- **The ciphertext lives in a store anyone can read.** `POST /v1/ciphertext` stores up to 10 MiB and returns a URI; `GET` needs no read token (`apps/operator/src/server.ts:1237-1279`, `:146-149`). An operator with a store relays a delivery only if it holds the bytes (`:820-838`) [measured].
- **The terms cannot pin a file's hash for a deterministic check.** The deliverable schema has no hash field (`spec/schemas/commitment.schema.json:107-170`), and no check type compares the output's hash (`packages/core/src/types.ts:86-95`) [measured]. The standing delivery's approval itself pins the file (section 2, `test_deliveryOfAnotherFile_refused`).

## 4. The operators and the tools

- **Offer route.** `POST /v1/commitments` takes terms from anyone; the schema requires `signatures.seller` (`spec/schemas/commitment.schema.json:383-397`) as a 65-byte `Signature` (`spec/schemas/common.schema.json:15-19`). The node checks it with `verifyTerms` (`evm-settlement.ts:936`) [measured].
- **Funding.** `POST /v1/commitments/{id}/agree` with a funding body and `POST /v1/holds` reach `fund()`, which passes the stored seller signature to `agreeAndFund` (`evm-settlement.ts:1266-1321`, `:1280`), alone or in a Multicall3 bundle with the operator's fee (`:1310-1319`) [measured].
- **No route deploys a contract** or sends an arbitrary transaction; the node's calls go to the rules contract, Multicall3 or the token (`evm-settlement.ts:1422-1424`, `:1320`, `:2587`) [measured].
- **Mandates.** The node looks the seller's mandate up by address and club (`evm-settlement.ts:905-911`). A mandate names its agent by address (`spec/schemas/mandate.schema.json:20`), so it can name a contract [measured; that nothing else in the lookup needs a key is inferred].
- **The buyer's pinned tool** is built from `examples/` by `site/build.mjs:180-211` and pinned by its SHA-256 (`site/check.mjs:394`, `:402`). Its rule that the bundles do not change is written in `docs/tasks/T-475-setup-buyer.md:25` [measured].

## 5. Work that depends on the buyer's input

The pilot's security-review template names the buyer's scope twice: in the deliverable ("Security review of the code at commit {{commit}}. Scope: {{files}}.", `examples/seller-adapter.template.json:9`) and in the checks (`"commit": {"const": "{{commit}}"}` at `:197-208`; a file `enum` at `:247`; coverage bounds at `:274-280`) [measured]. The terms carry both as hashes of canonical JSON (`packages/core/src/eip712.ts:303-307`) [measured]. So a filled scope changes two hashes per buyer.

A contract could rebuild those hashes from fixed pieces and the buyer's values. It would have to escape JSON strings and keep the canonical order on chain, for values the buyer chooses [inferred]. It would also let a buyer name any number of files of any size at the template's price: the checks' `maxItems` bounds the count, and nothing bounds the size [inferred]. Both go against the smallest contract that can be reviewed with confidence.

## 6. Outside practice

- **Signed orders that anyone fills** are the standard shape for standing offers on chain: a maker signs an order once, and any taker fills it until it expires or is cancelled; the contract tracks fills and cancellations [recalled: 0x limit orders, Seaport]. Holdback's rules contract already stops a second fill of one commitment ID (section 2), so the seller contract needs no fill counter.
- **ERC-1271** defines `isValidSignature(bytes32 hash, bytes signature)` returning `0x1626ba7e`; the signature bytes are the contract's own format [documented: the EIP]. The spike uses that freedom to carry the template.
- **Replay across smart accounts with one owner** is the problem ERC-7739 addresses [recalled]. For Holdback it does not arise: every message a seller signs binds the commitment ID, which binds the seller's address (`HoldbackTypes.sol:307-333`, `:366-379`, `:439-458`), and `contracts/test/crosscheck/Erc1271Replay.t.sol` covers the funding side [measured].
- **Counterfactual signatures (ERC-6492)** let a signer prove a signature before its contract is deployed [recalled]. The rules contract calls Solady's plain check, not its 6492 variant (`HoldbackRules.sol:568`), so the seller contract must have code before the first take funds [measured].
- **Delegated account code (EIP-7702)** lets a key's own address run contract code. A delegated address is checked by ERC-1271 alone (`contracts/test/crosscheck/Eip7702Signers.t.sol:53-60`) [measured].
