// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "solady/utils/ECDSA.sol";
import {EIP712} from "solady/utils/EIP712.sol";

import {IHoldbackStandingSeller} from "./IHoldbackStandingSeller.sol";
import {HoldbackTypes as H} from "./HoldbackTypes.sol";

/// @title HoldbackStandingSeller
/// @notice A seller's address for standing offers (ADR-0040 §1). `IHoldbackStandingSeller` describes every type,
///         event, error and function.
/// @dev No owner, role, pause, upgrade, fallback or receive. One immutable key, one mapping, one one-way flag.
contract HoldbackStandingSeller is EIP712, IHoldbackStandingSeller {
    // State

    /// @inheritdoc IHoldbackStandingSeller
    address public immutable KEY;
    /// @inheritdoc IHoldbackStandingSeller
    mapping(bytes32 templateHash => bool) public revoked;
    /// @inheritdoc IHoldbackStandingSeller
    bool public retired;

    // Blob kinds (the first word of a signature that is not 64 or 65 bytes).
    uint8 internal constant TAKE = 1;
    uint8 internal constant STANDING_DELIVERY = 2;

    bytes4 internal constant YES = 0x1626ba7e; // ERC-1271 magic value
    bytes4 internal constant NO = 0xffffffff;

    // EIP-712 types: the template's own, and the terms' nested types it shares (HoldbackTypes).
    string internal constant TIMING_OFFSETS_T =
        "TimingOffsets(uint64 offerExpiresAt,uint64 fundBy,uint64 deliverBy,uint64 judgeBy,uint64 fallbackBy,uint64 appealWindowSec,uint64 appealDecideSec,uint8 maxSubmissions,uint64 disputeBy,uint64 disputeJudgeSec,uint64 disputeFallbackSec)";
    string internal constant CIPHERTEXT_T = "Ciphertext(string uri,string sha256,uint64 bytes,string cipher)";
    string internal constant STANDING_DELIVERY_T =
        "StandingDelivery(Ciphertext ciphertext,string plaintextSha256,string plaintextMime,EncryptedKey[] encryptedKeys,uint64 submittedAt)";

    bytes32 internal constant TIMING_OFFSETS_TYPEHASH = keccak256(bytes(TIMING_OFFSETS_T));
    bytes32 internal constant STANDING_DELIVERY_TYPEHASH =
        keccak256(abi.encodePacked(STANDING_DELIVERY_T, CIPHERTEXT_T, H.ENCRYPTED_KEY_T, H.KEY_UNLOCK_T));
    bytes32 internal constant STANDING_OFFER_TYPEHASH = keccak256(
        abi.encodePacked(
            "StandingOffer(address rules,uint64 expiresAt,string offerId,string schemaVersion,string clubId,bytes32 rulebookHash,address sellerPayoutAddress,bytes32 deliverableHash,bytes32 acceptanceHash,TokenAmount price,Adjudication adjudication,TimingOffsets timing,Remedy remedy,StandingDelivery[] delivery)",
            H.ADJUDICATION_T,
            CIPHERTEXT_T,
            H.ENCRYPTED_KEY_T,
            H.KEY_UNLOCK_T,
            "Remedy(string onReject)",
            STANDING_DELIVERY_T,
            TIMING_OFFSETS_T,
            H.TOKEN_AMOUNT_T
        )
    );
    bytes32 internal constant REVOKE_TYPEHASH = keccak256("Revoke(bytes32 templateHash)");
    bytes32 internal constant RETIRE_TYPEHASH = keccak256("Retire()");

    /// @dev The rules contract's EIP-712 domain, name "Holdback" and version "0.8" (as in
    ///      `HoldbackRules._domainNameAndVersion`), rebuilt for the template's `rules` address so that no code at that
    ///      address is called (red team H-1).
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant RULES_NAME_HASH = keccak256("Holdback");
    bytes32 internal constant RULES_VERSION_HASH = keccak256("0.8");

    /// @dev The struct hash of the terms' `Disclosure("public")`: standing offers are public deals (ADR-0040 §7).
    bytes32 internal constant PUBLIC_DISCLOSURE_HASH =
        keccak256(abi.encode(keccak256("Disclosure(string level)"), keccak256("public")));

    constructor(address key) {
        if (key == address(0)) revert ZeroAddress();
        KEY = key;
    }

    // ERC-1271

    /// @inheritdoc IHoldbackStandingSeller
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (signature.length == 64 || signature.length == 65) {
            return ECDSA.tryRecoverCalldata(hash, signature) == KEY ? YES : NO;
        }
        (uint8 kind, StandingOffer memory offer, bytes memory keySignature, Fill memory fill) =
            abi.decode(signature, (uint8, StandingOffer, bytes, Fill));
        bytes32 th = templateHash(offer);
        if (kind == TAKE) {
            if (retired || revoked[th] || block.timestamp >= offer.expiresAt || fill.createdAt > block.timestamp) {
                return NO;
            }
        } else if (kind != STANDING_DELIVERY || offer.delivery.length == 0) {
            return NO;
        }
        if (ECDSA.tryRecover(_hashTypedData(th), keySignature) != KEY) return NO;
        bytes32 structHash = this.commitmentId(_termsOf(offer, fill, th));
        if (kind == STANDING_DELIVERY) structHash = this.deliveryHash(structHash, _delivery(offer.delivery[0]));
        return hash == _rulesDigest(offer.rules, structHash) ? YES : NO;
    }

    // The key's two writes

    /// @inheritdoc IHoldbackStandingSeller
    function revoke(bytes32 th, bytes calldata keySignature) external {
        if (msg.sender != KEY) _requireKey(keccak256(abi.encode(REVOKE_TYPEHASH, th)), keySignature);
        if (!revoked[th]) {
            revoked[th] = true;
            emit Revoked(th);
        }
    }

    /// @inheritdoc IHoldbackStandingSeller
    function retire(bytes calldata keySignature) external {
        if (msg.sender != KEY) _requireKey(keccak256(abi.encode(RETIRE_TYPEHASH)), keySignature);
        if (!retired) {
            retired = true;
            emit Retired();
        }
    }

    // Views

    /// @inheritdoc IHoldbackStandingSeller
    function templateHash(StandingOffer memory o) public pure returns (bytes32) {
        if (o.delivery.length > 1) revert TooManyDeliveries();
        bytes32 tokenHash = H.tokenIdHash(o.token);
        bytes32 adjudication = keccak256(
            abi.encode(
                H.ADJUDICATION_TYPEHASH,
                o.adjudicator,
                o.fallbackAdjudicator,
                o.appealAdjudicator,
                o.policyIdHash,
                H.tokenAmountHash(tokenHash, o.fee),
                o.registryHash,
                o.policyHash
            )
        );
        bytes32 deliveries = keccak256("");
        if (o.delivery.length == 1) {
            StandingDelivery memory d = o.delivery[0];
            deliveries = keccak256(
                abi.encodePacked(
                    keccak256(
                        abi.encode(
                            STANDING_DELIVERY_TYPEHASH,
                            d.ciphertextHash,
                            d.plaintextSha256Hash,
                            d.plaintextMimeHash,
                            d.encryptedKeysHash,
                            d.submittedAt
                        )
                    )
                )
            );
        }
        bytes memory head = abi.encode(
            STANDING_OFFER_TYPEHASH,
            o.rules,
            o.expiresAt,
            o.offerIdHash,
            o.schemaVersionHash,
            o.clubIdHash,
            o.rulebookHash,
            o.sellerPayoutAddress
        );
        bytes memory tail = abi.encode(
            o.deliverableHash,
            o.acceptanceHash,
            H.tokenAmountHash(tokenHash, o.price),
            adjudication,
            keccak256(abi.encode(TIMING_OFFSETS_TYPEHASH, o.timing)),
            o.remedyHash,
            deliveries
        );
        return keccak256(bytes.concat(head, tail));
    }

    /// @inheritdoc IHoldbackStandingSeller
    function termsOf(StandingOffer memory offer, Fill memory fill) public view returns (H.Terms memory) {
        return _termsOf(offer, fill, templateHash(offer));
    }

    /// @inheritdoc IHoldbackStandingSeller
    function commitmentId(H.Terms calldata t) external pure returns (bytes32) {
        return H.commitmentId(t);
    }

    /// @inheritdoc IHoldbackStandingSeller
    function deliveryHash(bytes32 id, H.Delivery calldata d) external pure returns (bytes32) {
        return H.deliveryHash(id, d);
    }

    // Internal

    /// @dev The take's terms, for the template whose hash is `th`.
    function _termsOf(StandingOffer memory o, Fill memory f, bytes32 th) internal view returns (H.Terms memory t) {
        if (o.sellerPayoutAddress == address(this)) revert PaysThisContract();
        TimingOffsets memory off = o.timing;
        uint64 at = f.createdAt;
        t = H.Terms({
            schemaVersionHash: o.schemaVersionHash,
            clubIdHash: o.clubIdHash,
            rulebookHash: o.rulebookHash,
            buyer: f.buyer,
            seller: address(this),
            buyerPaymentAddress: f.buyerPaymentAddress,
            sellerPayoutAddress: o.sellerPayoutAddress,
            deliverableHash: o.deliverableHash,
            acceptanceHash: o.acceptanceHash,
            token: o.token,
            price: o.price,
            adjudicator: o.adjudicator,
            fallbackAdjudicator: o.fallbackAdjudicator,
            appealAdjudicator: o.appealAdjudicator,
            policyIdHash: o.policyIdHash,
            fee: o.fee,
            registryHash: o.registryHash,
            policyHash: o.policyHash,
            timing: H.Timing({
                offerExpiresAt: _after(at, off.offerExpiresAt),
                fundBy: _after(at, off.fundBy),
                deliverBy: _after(at, off.deliverBy),
                judgeBy: _after(at, off.judgeBy),
                fallbackBy: _after(at, off.fallbackBy),
                appealWindowSec: off.appealWindowSec,
                appealDecideSec: off.appealDecideSec,
                maxSubmissions: off.maxSubmissions,
                disputeBy: off.disputeBy == 0 ? 0 : _after(at, off.disputeBy),
                disputeJudgeSec: off.disputeJudgeSec,
                disputeFallbackSec: off.disputeFallbackSec
            }),
            remedyHash: o.remedyHash,
            disclosureHash: PUBLIC_DISCLOSURE_HASH,
            buyerKeyHash: f.buyerKeyHash,
            nonce: keccak256(abi.encode(th, f.nonceSeed)),
            createdAt: at
        });
    }

    /// @dev `createdAt + offset`, refused above 64 bits.
    function _after(uint64 createdAt, uint64 offset) internal pure returns (uint64) {
        uint256 v = uint256(createdAt) + offset;
        if (v > type(uint64).max) revert Unrepresentable();
        return uint64(v);
    }

    /// @dev The take's delivery: attempt 1 and the standing delivery's fields.
    function _delivery(StandingDelivery memory d) internal pure returns (H.Delivery memory) {
        return H.Delivery({
            attempt: 1,
            ciphertextHash: d.ciphertextHash,
            plaintextSha256Hash: d.plaintextSha256Hash,
            plaintextMimeHash: d.plaintextMimeHash,
            encryptedKeysHash: d.encryptedKeysHash,
            submittedAt: d.submittedAt
        });
    }

    /// @dev The digest the rules deployment at `rules` signs `structHash` under: its EIP-712 domain on this chain.
    function _rulesDigest(address rules, bytes32 structHash) internal view returns (bytes32) {
        bytes32 domain =
            keccak256(abi.encode(DOMAIN_TYPEHASH, RULES_NAME_HASH, RULES_VERSION_HASH, block.chainid, rules));
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    /// @dev Requires `KEY`'s ECDSA signature over `structHash` under this contract's domain. Reverts `BadSignature`.
    function _requireKey(bytes32 structHash, bytes calldata keySignature) internal view {
        if (ECDSA.tryRecoverCalldata(_hashTypedData(structHash), keySignature) != KEY) revert BadSignature();
    }

    /// @dev The EIP-712 domain: name "HoldbackStandingSeller", version "1".
    function _domainNameAndVersion() internal pure override returns (string memory, string memory) {
        return ("HoldbackStandingSeller", "1");
    }
}
