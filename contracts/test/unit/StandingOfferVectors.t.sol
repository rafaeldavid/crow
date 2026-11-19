// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackStandingSeller} from "../../src/HoldbackStandingSeller.sol";
import {IHoldbackStandingSeller as IS} from "../../src/IHoldbackStandingSeller.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {SimBeacon} from "../../script/SimBeacon.sol";

/// T-548: cross-language vectors for the seller contract (ADR-0040 §1). The generator is
/// `packages/core/src/eip712.vectors.test.ts`, which computes each value with viem from spec/examples, the way a wallet
/// signs the typed data. The template is the commitment example without its seller, disclosure and five take fields,
/// with the deadlines as offsets from createdAt and the delivery example as its standing delivery; the take fills the
/// example's own buyer fields back in. Field encodings are the ones `Vectors.t.sol` pins for the same examples.
contract StandingOfferVectorsTest is Test {
    address internal constant TOKEN = 0x000000000000000000000000000000000000bEEF;
    address internal constant RULES = 0x00000000000000000000000000000000000000A1;
    address internal constant SELLER = 0x00000000000000000000000000000000000000A2;
    uint256 internal constant KEY_PK = 0x5E1F;
    uint64 internal constant CREATED_AT = 1_793_354_400;
    bytes4 internal constant YES = 0x1626ba7e;

    bytes32 internal constant TEMPLATE_HASH = 0x071d690e6444834e84c36aaf51ac0a2c870fda94e33344044c48c8fbf53e24c8;
    bytes32 internal constant TEMPLATE_DIGEST = 0x031fa4e3462c3f5004485f3b008cc6db3ad14172e2fc7a5e84131afab3fc39ee;
    bytes32 internal constant REVOKE_DIGEST = 0x4a51d240561fa1dabf9654a5868a929df757925183361fc330c363dcc5baa447;
    bytes32 internal constant RETIRE_DIGEST = 0x1ff100a7dc122be06ffd4044bfba7a3c4eb154996b5f7550ea4bb7d7a6d8c10f;
    bytes32 internal constant TAKE_NONCE = 0x4ae1b56fe93213e2dae1bb08b2b87050acaeaccc2893f347d0b5d0f1c6813446;
    bytes32 internal constant TAKE_ID = 0x4524262835512bdbda5594f8533a7245d6ccddfc547bded422d94d28e9c39607;
    bytes32 internal constant TAKE_TERMS_DIGEST = 0xe657a52acfbfe4752c32c4e61aac46962413158de288eb2ebc5166e66083c4eb;
    bytes32 internal constant TAKE_DELIVERY_HASH = 0x74c4715dad3e71dc0e23328e80046d860417a2e6cb339d5c7fea228096769e4a;

    HoldbackStandingSeller internal ss;

    function setUp() public {
        vm.chainId(31337);
        // As in Vectors.t.sol: the rules contract's digest depends on its domain alone, so its constructor's addresses
        // are placeholders. The beacon placeholder holds a sim beacon's code, because the constructor asks it for a
        // round (T-527).
        vm.etch(address(0xBE), address(new SimBeacon(bytes32(0))).code);
        bytes memory args = abi.encode(address(0xE5), address(0xC0), uint64(0), address(0xBE), TOKEN, uint64(0));
        deployCodeTo("HoldbackRules.sol:HoldbackRules", args, RULES);
        deployCodeTo("HoldbackStandingSeller.sol:HoldbackStandingSeller", abi.encode(vm.addr(KEY_PK)), SELLER);
        ss = HoldbackStandingSeller(SELLER);
    }

    function _offer() internal pure returns (IS.StandingOffer memory o) {
        o.rules = RULES;
        o.expiresAt = 1_795_000_000;
        o.offerIdHash = keccak256("standing-offer-vectors");
        o.schemaVersionHash = 0x15e7a716d821b9602c70f6d0f574efbb8147fb465215d43354c7b3e69d03ed92;
        o.clubIdHash = 0x7b600434c72773d2aacdfc4846c576db4f5f847cab94ead38a22a3c4e01c7003;
        o.rulebookHash = 0xb70959b8b5a5a9d365df7471120396553ed1bc0bff83059e4862e6d11b36a556;
        o.sellerPayoutAddress = 0x7a1c3e5b9d2F4A6c8e0B1d3f5A7c9E1b3D5f7A9c;
        o.deliverableHash = 0x303342f144fa951dc84612d5d026d641ee77f3ae3b044d39b3e6d5661894d942;
        o.acceptanceHash = 0x731647db76ade2a3774a204fc9a7d13eb74798faf5e4d19891aa9d3f1642378b;
        o.token = TOKEN;
        o.price = 2_000_000_000;
        o.adjudicator = 0x5d10FecaB9242E66cb134b77309a3566eD75e3dd;
        o.fallbackAdjudicator = 0xf9E6283D068Ff7016653Ab6d36A7fab0294F4B8A;
        o.appealAdjudicator = 0xc372Bd536a0f63fe9fde6bCa1Db179Ce93612520;
        o.policyIdHash = 0xa7fcda573d388c38e9e41562983452a3ede149b3178f64a80b4943442b6bd0df;
        o.fee = 50_000_000;
        o.registryHash = 0x54bdcd5545af7f0a1d42fa9adad89dc6f5d20ea8c0e16b270d2160b78b16007a;
        o.policyHash = 0x04221c401f162ef3a3c07c9d97024f3a13eb30f262b0c088ee6f63fa2c893dbb;
        o.timing = IS.TimingOffsets({
            offerExpiresAt: 900,
            fundBy: 1800,
            deliverBy: 172_800,
            judgeBy: 172_920,
            fallbackBy: 173_040,
            appealWindowSec: 0,
            appealDecideSec: 300,
            maxSubmissions: 1,
            disputeBy: 0,
            disputeJudgeSec: 0,
            disputeFallbackSec: 0
        });
        o.remedyHash = 0xb3099e0ca3d62f5d64e5cdc2fefbfb1b1bacb5df470701ef7a01712767aec0fc;
        o.delivery = new IS.StandingDelivery[](1);
        o.delivery[0] = IS.StandingDelivery({
            ciphertextHash: 0x7e13908b9c3b8587f3cba826428532a23df07b2d0252d76727164d4eb2778b26,
            plaintextSha256Hash: 0x312256d554bbcaa14751ae42fbbc5cce2fd828ca4fb6a68b946d04ef527f7357,
            plaintextMimeHash: 0xd9fcb5a1963a15496f693a54c6815451aa808319f51b7fa94462ba55a869a52a,
            encryptedKeysHash: keccak256(
                abi.encodePacked(
                    bytes32(0xf33423a18f410bdbcfdb49aef9eba54b303e50136ab9fbb1bea530921a5c902a),
                    bytes32(0xe00649bdb073ee0d5c607ff0a8d900755537a66257925b58b9c6799e1f0e6e1f),
                    bytes32(0x91c107b44c911caeebe8a80b37bd583866389fa9d1d499d4da8cf3301c03cb14)
                )
            ),
            submittedAt: 1_793_463_600
        });
    }

    function _fill() internal pure returns (IS.Fill memory) {
        return IS.Fill({
            buyer: 0x04D6c65223896Ba94e731bc9eB765C19Bd289b0d,
            buyerPaymentAddress: 0x2B4D6f8a0c1E3A5C7e9b1D3F5A7c9E1b3D5f7a90,
            buyerKeyHash: 0xb08985bc1a36214c9bbdf466c2c71f95c8faa37b97430a0e19f820121cbe6f29,
            nonceSeed: bytes32(uint256(0x44) * (type(uint256).max / 0xff)),
            createdAt: CREATED_AT
        });
    }

    function _sellerDigest(bytes32 structHash) internal pure returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("HoldbackStandingSeller"),
                keccak256("1"),
                uint256(31337),
                SELLER
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _signRaw(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_templateHash_and_digest_matchCore() public view {
        assertEq(ss.templateHash(_offer()), TEMPLATE_HASH);
        assertEq(_sellerDigest(TEMPLATE_HASH), TEMPLATE_DIGEST);
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = ss.eip712Domain();
        assertEq(name, "HoldbackStandingSeller");
        assertEq(version, "1");
        assertEq(chainId, 31337);
        assertEq(verifying, SELLER);
    }

    function test_revoke_and_retire_digests_matchCore() public pure {
        assertEq(
            _sellerDigest(keccak256(abi.encode(keccak256("Revoke(bytes32 templateHash)"), TEMPLATE_HASH))),
            REVOKE_DIGEST
        );
        assertEq(_sellerDigest(keccak256(abi.encode(keccak256("Retire()")))), RETIRE_DIGEST);
    }

    /// The take's terms are the commitment example's with the seller contract as seller and the derived nonce, so
    /// core's commitment ID of those terms is the contract's.
    function test_takeTerms_matchCore() public view {
        H.Terms memory t = ss.termsOf(_offer(), _fill());
        assertEq(t.nonce, TAKE_NONCE);
        assertEq(t.nonce, keccak256(abi.encode(TEMPLATE_HASH, _fill().nonceSeed)));
        assertEq(ss.commitmentId(t), TAKE_ID);
        assertEq(HoldbackRules(RULES).typedDataHash(TAKE_ID), TAKE_TERMS_DIGEST);
    }

    /// A key that signs core's digests gets yes from the contract: for the template, the take, its standing delivery,
    /// the revoke and the retire.
    function test_contractAnswers_forCoreDigests() public {
        vm.warp(CREATED_AT + 60);
        bytes memory keySig = _signRaw(KEY_PK, TEMPLATE_DIGEST);
        assertEq(ss.isValidSignature(TAKE_TERMS_DIGEST, abi.encode(uint8(1), _offer(), keySig, _fill())), YES);
        bytes32 deliveryDigest = HoldbackRules(RULES).typedDataHash(TAKE_DELIVERY_HASH);
        assertEq(ss.isValidSignature(deliveryDigest, abi.encode(uint8(2), _offer(), keySig, _fill())), YES);
        H.Delivery memory d = H.Delivery({
            attempt: 1,
            ciphertextHash: _offer().delivery[0].ciphertextHash,
            plaintextSha256Hash: _offer().delivery[0].plaintextSha256Hash,
            plaintextMimeHash: _offer().delivery[0].plaintextMimeHash,
            encryptedKeysHash: _offer().delivery[0].encryptedKeysHash,
            submittedAt: _offer().delivery[0].submittedAt
        });
        assertEq(ss.deliveryHash(TAKE_ID, d), TAKE_DELIVERY_HASH);
        vm.prank(address(0xCAFE));
        ss.revoke(TEMPLATE_HASH, _signRaw(KEY_PK, REVOKE_DIGEST));
        assertTrue(ss.revoked(TEMPLATE_HASH));
        vm.prank(address(0xCAFE));
        ss.retire(_signRaw(KEY_PK, RETIRE_DIGEST));
        assertTrue(ss.retired());
    }
}
