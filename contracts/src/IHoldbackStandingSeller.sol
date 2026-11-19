// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HoldbackTypes as H} from "./HoldbackTypes.sol";

/// @title IHoldbackStandingSeller
/// @notice A seller's address for standing offers (ADR-0040 §1, D82): a contract that answers ERC-1271 for its seller
///         key, so one signed template serves every buyer. This file declares and describes the contract's external
///         surface: its types, events, errors, external functions and getters, with no logic.
///         `HoldbackStandingSeller.sol` holds the logic; `eip712Domain` (ERC-5267) comes from Solady's EIP712.
///
///         **What it is.** The seller's address in the terms (`terms.seller`). The rules contract checks every
///         signature by that address through ERC-1271 (`HoldbackRules._requireSigned`), so this contract decides what
///         the seller has signed. The rules contract is unchanged.
///
///         **Its one key.** `KEY`, the seller's own key, is the constructor's only argument and never changes. There
///         is no owner, role, pause, upgrade, fallback or receive. The deployer, whoever pays, gets no power: the
///         address follows from the creation code, the key and the salt through the deterministic deployment proxy
///         (ADR-0040 §4).
///
///         **What is stored.** One mapping, `revoked[templateHash]`, and one flag, `retired`. Nothing per take: the
///         rules contract funds one commitment ID once.
///
///         **It holds no money.** No function receives or moves funds. A template whose payout address is this
///         contract is refused (`PaysThisContract`), since the money would have no way out.
///
///         **`isValidSignature(hash, signature)` answers yes in exactly three cases** (ADR-0040 §1):
///         1. `signature` is 64 or 65 bytes and `KEY` signed `hash`: everything the key signs today (a settlement by
///            agreement, a per-buyer delivery, a per-buyer offer from this address).
///         2. `signature` is a take, `abi.encode(uint8(1), offer, keySignature, fill)`: `KEY` signed the offer
///            under this contract's EIP-712 domain; the offer is not revoked and the contract is not retired;
///            `block.timestamp < offer.expiresAt`; `fill.createdAt <= block.timestamp`; and `hash` is the named rules
///            deployment's digest (`typedDataHash`) of the commitment ID of `termsOf(offer, fill)`.
///         3. `signature` is a standing delivery, `abi.encode(uint8(2), offer, keySignature, fill)`: `KEY` signed
///            the offer; the offer carries one standing delivery; and `hash` is the named rules deployment's digest
///            of that delivery's hash for the commitment ID of `termsOf(offer, fill)`. Revocation, retirement and
///            expiry do not end this case, so a funded take always gets its delivery.
///         Any other input answers `0xffffffff` or reverts; the rules contract reads both as no (`BadSignature`).
///         The contract never trusts a commitment ID, terms or a digest from the caller: it rebuilds them with the
///         rules contract's own library, `HoldbackTypes.commitmentId` and `HoldbackTypes.deliveryHash`.
///
///         **The take's terms** (`termsOf`). Every field comes from the offer, except:
///         - `seller`: this contract;
///         - `buyer`, `buyerPaymentAddress`, `buyerKeyHash` and `createdAt`: from the fill;
///         - `nonce`: `keccak256(abi.encode(templateHash(offer), fill.nonceSeed))`, so a take's commitment ID binds the
///           template it came from, and one template's standing delivery never lands on another template's take;
///         - `disclosureHash`: the struct hash of `Disclosure("public")`, since standing offers are public deals
///           (ADR-0040 §7);
///         - the five deadlines: `createdAt` plus the offer's offsets; `disputeBy` the same way when its offset is not
///           0, and 0 otherwise. The windows and `maxSubmissions` are copied as they are.
///
///         **What the rules contract adds.** One commitment ID funds once, so a replayed take reverts `WrongStage`;
///         the offer expiry (`createdAt` plus the offer window) bounds how far a buyer can backdate a take; and the
///         order of the deadlines and the values settlement can represent are checked at `agreeAndFund`.
///
///         **Known limits** [inferred]:
///         - The key path (case 1) approves any digest `KEY` signs, so another application's digest signed by the key
///           is approved by every seller contract of that key. The contract holds nothing and grants no allowance, so
///           such an approval reaches nothing here. The seller's tools use the key for this contract only.
///         - `retire()` ends case 2 only. A leaked key can still sign per-buyer offers through case 1; the seller's
///           answer is a new key and a new contract, published on its card.
///         - The answer changes over time (revocation, retirement, expiry), as the rules contract's known issue on
///           contract signers describes (ADR-0031 §5): an offer checked off chain can be refused at funding.
///         - `abi.decode` accepts some other encodings of the same values (the key signature's trailing padding cut
///           or changed). They decode to the same take and get the same answer; the rules contract stores no
///           signature, so a tool that compares takes compares the decoded values, not the bytes.
interface IHoldbackStandingSeller {
    // Types

    /// @notice The take's deadlines as offsets in seconds from the take's `createdAt`, and its windows as they are.
    ///         Field for field the terms' `Timing`: `offerExpiresAt`, `fundBy`, `deliverBy`, `judgeBy` and
    ///         `fallbackBy` are offsets; `disputeBy` is an offset when not 0, and 0 means none; the rest are copied.
    /// @dev EIP-712: `TimingOffsets(uint64 offerExpiresAt,uint64 fundBy,uint64 deliverBy,uint64 judgeBy,
    ///      uint64 fallbackBy,uint64 appealWindowSec,uint64 appealDecideSec,uint8 maxSubmissions,uint64 disputeBy,
    ///      uint64 disputeJudgeSec,uint64 disputeFallbackSec)`.
    struct TimingOffsets {
        uint64 offerExpiresAt;
        uint64 fundBy;
        uint64 deliverBy;
        uint64 judgeBy;
        uint64 fallbackBy;
        uint64 appealWindowSec;
        uint64 appealDecideSec;
        uint8 maxSubmissions;
        uint64 disputeBy;
        uint64 disputeJudgeSec;
        uint64 disputeFallbackSec;
    }

    /// @notice A fixed file's delivery, approved once for every take (ADR-0040 §2): the terms' `Delivery` without
    ///         its commitment ID, as its field encodings. The take's delivery has attempt 1 and these fields.
    /// @dev EIP-712: `StandingDelivery(Ciphertext ciphertext,string plaintextSha256,string plaintextMime,
    ///      EncryptedKey[] encryptedKeys,uint64 submittedAt)`, with `Ciphertext`, `EncryptedKey` and `KeyUnlock` as in
    ///      the terms' `Delivery`.
    struct StandingDelivery {
        bytes32 ciphertextHash; // struct hash of Ciphertext
        bytes32 plaintextSha256Hash; // keccak256(plaintextSha256)
        bytes32 plaintextMimeHash; // keccak256(plaintextMime)
        bytes32 encryptedKeysHash; // keccak256(concat(struct hash of each EncryptedKey))
        uint64 submittedAt;
    }

    /// @notice The template the key signs: every field of the terms but `seller`, `disclosure` and the take's five
    ///         (`buyer`, `buyerPaymentAddress`, `buyerKeyHash`, `nonce`, `createdAt`), with the deadlines as offsets,
    ///         plus the rules deployment, the template's own expiry, the offer's ID and at most one standing delivery.
    ///         Every field is read: each reaches the take's terms, its approval or its digest, so one set of terms
    ///         has exactly one template hash. Strings and nested structs arrive as their EIP-712 encodings, as in
    ///         `HoldbackTypes.Terms`.
    /// @dev Signed under this contract's domain (name "HoldbackStandingSeller", version "1", the chain ID, this
    ///      contract). EIP-712: `StandingOffer(address rules,uint64 expiresAt,string offerId,string schemaVersion,
    ///      string clubId,bytes32 rulebookHash,address sellerPayoutAddress,bytes32 deliverableHash,
    ///      bytes32 acceptanceHash,TokenAmount price,Adjudication adjudication,TimingOffsets timing,Remedy remedy,
    ///      StandingDelivery[] delivery)`, with `Adjudication`, `Remedy` and `TokenAmount` as in the terms. The token
    ///      in `price` and in the fee is the lowercase 0x-hex string of `token` (ADR-0025).
    ///      - `rules`: the one rules deployment whose domain the take's and the delivery's digests are under.
    ///      - `expiresAt`: no take from this instant on (Unix seconds).
    ///      - `offerIdHash`: keccak256 of the offer's ID, equal to the card's `offers[].id`; it changes the template
    ///        hash and so each take's nonce, and nothing else reads it.
    ///      - `delivery`: empty for work done after funding, or one standing delivery; more than one is refused.
    struct StandingOffer {
        address rules;
        uint64 expiresAt;
        bytes32 offerIdHash; // keccak256(offerId)
        bytes32 schemaVersionHash; // keccak256(schemaVersion)
        bytes32 clubIdHash; // keccak256(clubId)
        bytes32 rulebookHash;
        address sellerPayoutAddress;
        bytes32 deliverableHash;
        bytes32 acceptanceHash;
        address token;
        uint256 price;
        address adjudicator;
        address fallbackAdjudicator;
        address appealAdjudicator;
        bytes32 policyIdHash; // keccak256(policyId)
        uint256 fee;
        bytes32 registryHash;
        bytes32 policyHash;
        TimingOffsets timing;
        bytes32 remedyHash; // struct hash of Remedy
        StandingDelivery[] delivery; // at most one
    }

    /// @notice The take's five fields, filled by the buyer. `nonceSeed` is any value the buyer picks; the terms'
    ///         nonce is derived from it and the template hash. Not signed by the key.
    struct Fill {
        address buyer;
        address buyerPaymentAddress;
        bytes32 buyerKeyHash; // keccak256(buyerEncryptionPublicKey)
        bytes32 nonceSeed;
        uint64 createdAt;
    }

    // Events

    /// @notice The key revoked a template: no new take of it from this block on. Emitted once per template.
    event Revoked(bytes32 indexed templateHash);

    /// @notice The key retired the contract: no new take of any template, for good. Emitted once.
    event Retired();

    // Errors

    /// @notice The constructor's key is the zero address, which no one can sign for.
    error ZeroAddress();

    /// @notice A revoke or retire not sent by `KEY` carries no valid signature of `KEY`.
    error BadSignature();

    /// @notice A deadline the offsets give is above 64 bits, which the terms cannot represent.
    error Unrepresentable();

    /// @notice The template's payout address is this contract, which has no function to move money out.
    error PaysThisContract();

    /// @notice The template carries more than one standing delivery.
    error TooManyDeliveries();

    // Functions

    /// @notice The seller's key: the only signer this contract answers for. Set once, at deployment.
    function KEY() external view returns (address);

    /// @notice Whether the key revoked the template with this hash.
    function revoked(bytes32 templateHash) external view returns (bool);

    /// @notice Whether the key retired the contract. One-way: nothing sets it back.
    function retired() external view returns (bool);

    /// @notice ERC-1271: `0x1626ba7e` when the seller approves `hash`, in the three cases this file's notice lists;
    ///         `0xffffffff` otherwise. A blob that does not decode reverts.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);

    /// @notice Revokes a template: no new take of it. Sent by `KEY` (`keySignature` is then not read), or relayed by
    ///         anyone with `KEY`'s EIP-712 signature of `Revoke(bytes32 templateHash)` under this contract's domain.
    ///         Idempotent. A funded take still gets its standing delivery.
    /// @dev Reverts `BadSignature` when the sender is not `KEY` and the signature is not `KEY`'s.
    function revoke(bytes32 templateHash, bytes calldata keySignature) external;

    /// @notice Retires the contract: no new take of any template, for good. Sent by `KEY`, or relayed by anyone with
    ///         `KEY`'s EIP-712 signature of `Retire()` under this contract's domain. Idempotent. Not a pause: the key
    ///         path and every standing delivery keep working, so funded deals settle as their terms say.
    /// @dev Reverts `BadSignature` when the sender is not `KEY` and the signature is not `KEY`'s.
    function retire(bytes calldata keySignature) external;

    /// @notice The EIP-712 struct hash of a template: what `revoked` is keyed by, and what the key signs under this
    ///         contract's domain.
    function templateHash(StandingOffer calldata offer) external pure returns (bytes32);

    /// @notice The terms of a take: the template filled by the buyer, as the rules contract receives them.
    /// @dev Reverts `PaysThisContract`, `TooManyDeliveries` or `Unrepresentable` for a template no take can use.
    function termsOf(StandingOffer calldata offer, Fill calldata fill) external view returns (H.Terms memory);

    /// @notice `HoldbackTypes.commitmentId(t)`, exposed because the library takes calldata; the contract calls it on
    ///         itself.
    function commitmentId(H.Terms calldata t) external pure returns (bytes32);

    /// @notice `HoldbackTypes.deliveryHash(id, d)`, exposed because the library takes calldata; the contract calls it
    ///         on itself.
    function deliveryHash(bytes32 id, H.Delivery calldata d) external pure returns (bytes32);
}
