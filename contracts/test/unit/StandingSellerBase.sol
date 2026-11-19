// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackStandingSeller} from "../../src/HoldbackStandingSeller.sol";
import {IHoldbackStandingSeller as IS} from "../../src/IHoldbackStandingSeller.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-548: the test world for the seller contract (ADR-0040). `Base`'s rules contract, token and adjudicators, plus
/// the public deterministic deployment proxy and a seller contract it deployed for the seller's key.
abstract contract StandingSellerBase is Base {
    /// Arachnid's deterministic deployment proxy: the address and runtime Foundry and most chains use (ADR-0040 §4;
    /// on Sepolia, `eth_getCode` measured on 2026-11-18).
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes internal constant CREATE2_RUNTIME =
        hex"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";
    uint256 internal constant KEY_PK = 0x5E1F;
    uint8 internal constant TAKE = 1;
    uint8 internal constant STANDING_DELIVERY = 2;
    bytes4 internal constant YES = 0x1626ba7e;
    bytes4 internal constant NO = 0xffffffff;

    HoldbackStandingSeller internal ss;
    address internal key;
    address internal payout;

    function setUp() public virtual override {
        super.setUp();
        vm.etch(CREATE2_DEPLOYER, CREATE2_RUNTIME);
        key = vm.addr(KEY_PK);
        payout = makeAddr("payout");
        ss = HoldbackStandingSeller(_deployVia(makeAddr("crow-relayer"), KEY_PK, bytes32(0)));
    }

    // ------------------------------------------------------------ deployment

    function _initcode(address k) internal pure returns (bytes memory) {
        return abi.encodePacked(type(HoldbackStandingSeller).creationCode, abi.encode(k));
    }

    function _predict(address k, bytes32 s) internal pure returns (address) {
        return vm.computeCreate2Address(s, keccak256(_initcode(k)), CREATE2_DEPLOYER);
    }

    /// Deploys through the proxy as `payer`, skipped when the address already has code (ADR-0040 §4).
    function _deployVia(address payer, uint256 pk, bytes32 s) internal returns (address a) {
        a = _predict(vm.addr(pk), s);
        if (a.code.length > 0) return a;
        vm.prank(payer);
        (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(s, _initcode(vm.addr(pk))));
        require(ok && a.code.length > 0, "deploy failed");
    }

    // ------------------------------------------------------------ templates and takes

    /// A template for a fixed file: Base's terms as offsets, the payout address apart from the key, and one standing
    /// delivery whose envelopes are the three adjudicators' (ADR-0040 §2).
    function _offer() internal returns (IS.StandingOffer memory o) {
        H.Terms memory b = _terms();
        o.rules = address(rules);
        o.expiresAt = uint64(block.timestamp + 30 days);
        o.offerIdHash = keccak256("csv-export");
        o.schemaVersionHash = b.schemaVersionHash;
        o.clubIdHash = b.clubIdHash;
        o.rulebookHash = b.rulebookHash;
        o.sellerPayoutAddress = payout;
        o.deliverableHash = b.deliverableHash;
        o.acceptanceHash = b.acceptanceHash;
        o.token = b.token;
        o.price = b.price;
        o.adjudicator = b.adjudicator;
        o.fallbackAdjudicator = b.fallbackAdjudicator;
        o.appealAdjudicator = b.appealAdjudicator;
        o.policyIdHash = b.policyIdHash;
        o.fee = b.fee;
        o.registryHash = b.registryHash;
        o.policyHash = b.policyHash;
        o.timing = IS.TimingOffsets({
            offerExpiresAt: 15 minutes,
            fundBy: 30 minutes,
            deliverBy: 1 days,
            judgeBy: 2 days,
            fallbackBy: 3 days,
            appealWindowSec: 0,
            appealDecideSec: 1 days,
            maxSubmissions: 1,
            disputeBy: 0,
            disputeJudgeSec: 0,
            disputeFallbackSec: 0
        });
        o.remedyHash = b.remedyHash;
        o.delivery = new IS.StandingDelivery[](1);
        o.delivery[0] = IS.StandingDelivery({
            ciphertextHash: keccak256("one ciphertext for every take"),
            plaintextSha256Hash: keccak256("sha256:file"),
            plaintextMimeHash: keccak256("text/csv"),
            encryptedKeysHash: keccak256("envelopes to the three adjudicators"),
            submittedAt: uint64(block.timestamp)
        });
    }

    /// A template for work done after funding: no standing delivery (Rafa's default, ADR-0040 §2).
    function _workOffer() internal returns (IS.StandingOffer memory o) {
        o = _offer();
        o.delivery = new IS.StandingDelivery[](0);
    }

    function _domainSeparatorOf(address c) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("HoldbackStandingSeller"),
                keccak256("1"),
                block.chainid,
                c
            )
        );
    }

    function _sellerDigestOf(address c, bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparatorOf(c), structHash));
    }

    /// The key's signature of a template for the seller contract `c`.
    function _offerSigFor(address c, IS.StandingOffer memory o, uint256 pk) internal view returns (bytes memory) {
        return _signRaw(pk, _sellerDigestOf(c, HoldbackStandingSeller(c).templateHash(o)));
    }

    function _offerSig(IS.StandingOffer memory o, uint256 pk) internal view returns (bytes memory) {
        return _offerSigFor(address(ss), o, pk);
    }

    function _fill(uint256 n) internal view returns (IS.Fill memory) {
        return IS.Fill({
            buyer: buyer,
            buyerPaymentAddress: buyer,
            buyerKeyHash: keccak256("buyer key"),
            nonceSeed: keccak256(abi.encode("take", n)),
            createdAt: uint64(block.timestamp)
        });
    }

    function _blob(uint8 kind, IS.StandingOffer memory o, bytes memory sig, IS.Fill memory f)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(kind, o, sig, f);
    }

    /// Funds a take: the terms the contract builds, the take blob as the seller's signature.
    function _take(IS.StandingOffer memory o, bytes memory sig, IS.Fill memory f)
        internal
        returns (H.Terms memory t, bytes32 id)
    {
        t = ss.termsOf(o, f);
        bytes memory blob = _blob(TAKE, o, sig, f);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory fu = _erc3009(t, BUYER_PK);
        vm.prank(relayer);
        id = rules.agreeAndFund(t, blob, acc, ag, fu);
    }

    /// Expects funding of `t` with the take blob `blob` to revert with `err`.
    function _expectTakeRefused(H.Terms memory t, bytes memory blob, bytes memory err) internal {
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory fu = _erc3009(t, BUYER_PK);
        vm.expectRevert(err);
        rules.agreeAndFund(t, blob, acc, ag, fu);
    }

    function _standingDelivery(IS.StandingOffer memory o) internal pure returns (H.Delivery memory) {
        IS.StandingDelivery memory d = o.delivery[0];
        return H.Delivery({
            attempt: 1,
            ciphertextHash: d.ciphertextHash,
            plaintextSha256Hash: d.plaintextSha256Hash,
            plaintextMimeHash: d.plaintextMimeHash,
            encryptedKeysHash: d.encryptedKeysHash,
            submittedAt: d.submittedAt
        });
    }

    function _revokeSig(bytes32 th, uint256 pk) internal view returns (bytes memory) {
        return _signRaw(
            pk, _sellerDigestOf(address(ss), keccak256(abi.encode(keccak256("Revoke(bytes32 templateHash)"), th)))
        );
    }

    function _retireSig(uint256 pk) internal view returns (bytes memory) {
        return _signRaw(pk, _sellerDigestOf(address(ss), keccak256(abi.encode(keccak256("Retire()")))));
    }

    function _revoke(IS.StandingOffer memory o) internal {
        bytes32 th = ss.templateHash(o);
        vm.prank(makeAddr("anyone"));
        ss.revoke(th, _revokeSig(th, KEY_PK));
    }
}
