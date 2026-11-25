// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
import {HoldbackStandingSeller} from "../../src/HoldbackStandingSeller.sol";
import {IHoldbackStandingSeller as IS} from "../../src/IHoldbackStandingSeller.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {StandingSellerBase} from "../unit/StandingSellerBase.sol";

/// A seller contract with a back door: what a deployer would have to deploy instead. Test only.
contract BackDoorSeller {
    address public owner = tx.origin;
    address public key;

    constructor(address k) {
        key = k;
    }

    function setKey(address k) external {
        require(msg.sender == owner);
        key = k;
    }
}

/// A `rules` address that answers `typedDataHash` with whatever its owner stored (red team H-1). Test only.
contract HostileRules {
    bytes32 public answer;

    function set(bytes32 a) external {
        answer = a;
    }

    function typedDataHash(bytes32) external view returns (bytes32) {
        return answer;
    }
}

/// T-548: the forge tests ADR-0040 §9 assigns to T-548, each named after its fixture (`attack.take-replayed` is
/// `test_attack_takeReplayed`), against the unchanged rules contract. Scenario and local-chain fixtures of the same
/// table belong to T-549 and T-550.
contract StandingSellerAttackTest is StandingSellerBase {
    function _badSignature() internal pure returns (bytes memory) {
        return abi.encodePacked(IHoldbackRules.BadSignature.selector);
    }

    // ------------------------------------------------------------ the take

    /// attack.take-changes-a-fixed-field: the contract rebuilds the terms itself, so terms with any field changed
    /// from the template's are refused, whichever field it is.
    function test_attack_takeChangesAFixedField() public {
        IS.StandingOffer memory o = _offer();
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        bytes memory blob = _blob(TAKE, o, sig, f);
        for (uint256 i; i < 22; ++i) {
            H.Terms memory t = ss.termsOf(o, f);
            if (i == 0) {
                t.price += 1;
            } else if (i == 1) {
                t.price = 1;
            } else if (i == 2) {
                t.sellerPayoutAddress = makeAddr("thief");
            } else if (i == 3) {
                t.adjudicator = makeAddr("adj2");
            } else if (i == 4) {
                t.fallbackAdjudicator = makeAddr("fb2");
            } else if (i == 5) {
                t.appealAdjudicator = makeAddr("ap2");
            } else if (i == 6) {
                t.fee += 1;
            } else if (i == 7) {
                t.deliverableHash = keccak256("other work");
            } else if (i == 8) {
                t.acceptanceHash = keccak256("weaker checks");
            } else if (i == 9) {
                t.policyHash = keccak256("other policy");
            } else if (i == 10) {
                t.registryHash = keccak256("other registry");
            } else if (i == 11) {
                t.policyIdHash = keccak256("other policy id");
            } else if (i == 12) {
                t.timing.deliverBy += 1;
            } else if (i == 13) {
                t.timing.fallbackBy += 1;
            } else if (i == 14) {
                t.timing.appealDecideSec += 1;
            } else if (i == 15) {
                t.disclosureHash = keccak256(abi.encode(keccak256("Disclosure(string level)"), keccak256("private")));
            } else if (i == 16) {
                t.remedyHash = keccak256("other remedy");
            } else if (i == 17) {
                t.seller = seller;
            } // an EOA: the blob is not its signature
            else if (i == 18) {
                t.nonce = f.nonceSeed;
            } // the seed itself, not the derived nonce
            else if (i == 19) {
                t.rulebookHash = keccak256("other rulebook");
            } else if (i == 20) {
                t.clubIdHash = keccak256("other club");
            } else {
                t.schemaVersionHash = keccak256("0.9");
            }
            _expectTakeRefused(t, blob, _badSignature());
        }
        // Fields the rules contract refuses before the seller's check (token, maxSubmissions, appealWindowSec), and the
        // rest of the timing: the seller contract itself answers no for each.
        for (uint256 i; i < 9; ++i) {
            H.Terms memory t = ss.termsOf(o, f);
            if (i == 0) t.token = makeAddr("other token");
            else if (i == 1) t.timing.offerExpiresAt += 1;
            else if (i == 2) t.timing.fundBy += 1;
            else if (i == 3) t.timing.judgeBy += 1;
            else if (i == 4) t.timing.appealWindowSec += 1;
            else if (i == 5) t.timing.maxSubmissions += 1;
            else if (i == 6) t.timing.disputeBy += 1;
            else if (i == 7) t.timing.disputeJudgeSec += 1;
            else t.timing.disputeFallbackSec += 1;
            assertEq(ss.isValidSignature(rules.typedDataHash(hx.id(t)), blob), NO);
        }
        // The terms the contract builds fund.
        _take(o, sig, f);
    }

    /// attack.take-under-another-deployment: a template names one rules deployment; its take funds at no other.
    function test_attack_takeUnderAnotherDeployment() public {
        HoldbackRules other = new HoldbackRules(escrow, address(collector3009), MARGIN, sim, address(usdc), 0);
        IS.StandingOffer memory o = _offer();
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        H.Terms memory t = ss.termsOf(o, f);
        bytes memory blob = _blob(TAKE, o, sig, f);
        assertEq(ss.isValidSignature(other.typedDataHash(hx.id(t)), blob), NO);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        acc.signature = _signRaw(ADJ_PK, other.typedDataHash(hx.acceptance(hx.id(t), t, acc)));
        H.Agree memory ag = _agree(t, BUYER_PK);
        ag.signature = _signRaw(BUYER_PK, other.typedDataHash(hx.agree(hx.id(t), t.buyer, ag)));
        H.Funding memory fu = _erc3009(t, BUYER_PK);
        vm.expectRevert(IHoldbackRules.BadSignature.selector);
        other.agreeAndFund(t, blob, acc, ag, fu);
        // The same take funds at the deployment it names.
        _take(o, sig, f);
    }

    /// attack.template-replayed-to-another-contract: the template's domain names the seller contract, so a second
    /// contract of the same key does not take a template signed for the first.
    function test_attack_templateReplayedToAnotherContract() public {
        HoldbackStandingSeller ss2 = HoldbackStandingSeller(_deployVia(makeAddr("anyone"), KEY_PK, bytes32(uint256(1))));
        assertEq(ss2.KEY(), ss.KEY());
        IS.StandingOffer memory o = _offer();
        bytes memory sigForSs = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        H.Terms memory t2 = ss2.termsOf(o, f);
        assertEq(t2.seller, address(ss2));
        assertEq(ss2.isValidSignature(rules.typedDataHash(hx.id(t2)), _blob(TAKE, o, sigForSs, f)), NO);
        _expectTakeRefused(t2, _blob(TAKE, o, sigForSs, f), _badSignature());
        // The same template, signed for the second contract, funds there.
        assertEq(
            ss2.isValidSignature(
                rules.typedDataHash(hx.id(t2)), _blob(TAKE, o, _offerSigFor(address(ss2), o, KEY_PK), f)
            ),
            YES
        );
    }

    /// attack.take-replayed: one commitment ID funds once.
    function test_attack_takeReplayed() public {
        IS.StandingOffer memory o = _offer();
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        (H.Terms memory t,) = _take(o, sig, f);
        _expectTakeRefused(
            t,
            _blob(TAKE, o, sig, f),
            abi.encodeWithSelector(IHoldbackRules.WrongStage.selector, IHoldbackRules.Stage.Held)
        );
    }

    /// attack.take-backdated: the rules contract's offer expiry bounds backdating to the offer window, so the seller
    /// keeps at least deliverBy - offer window seconds to deliver.
    function test_attack_takeBackdated() public {
        IS.StandingOffer memory o = _offer();
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        f.createdAt = uint64(block.timestamp - o.timing.offerExpiresAt);
        _expectTakeRefused(
            ss.termsOf(o, f), _blob(TAKE, o, sig, f), abi.encodePacked(IHoldbackRules.DeadlinePassed.selector)
        );
        f.createdAt += 1;
        (H.Terms memory t,) = _take(o, sig, f);
        assertGe(t.timing.deliverBy - block.timestamp, o.timing.deliverBy - o.timing.offerExpiresAt, "time to deliver");
    }

    /// attack.take-dated-ahead: a take dated after the block's time is refused by the seller contract.
    function test_attack_takeDatedAhead() public {
        IS.StandingOffer memory o = _offer();
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        f.createdAt = uint64(block.timestamp + 1);
        H.Terms memory t = ss.termsOf(o, f);
        assertEq(ss.isValidSignature(rules.typedDataHash(hx.id(t)), _blob(TAKE, o, sig, f)), NO);
        _expectTakeRefused(t, _blob(TAKE, o, sig, f), _badSignature());
    }

    /// attack.take-offsets-overflow: an offset that takes a deadline above 64 bits is unrepresentable, refused before
    /// the value could wrap; the largest representable one is not.
    function test_attack_takeOffsetsOverflow() public {
        IS.StandingOffer memory o = _offer();
        IS.Fill memory f = _fill(1);
        uint64 room = type(uint64).max - f.createdAt;
        o.timing.fallbackBy = room;
        assertEq(ss.termsOf(o, f).timing.fallbackBy, type(uint64).max, "the largest value is representable");
        o.timing.fallbackBy = room + 1;
        vm.expectRevert(IS.Unrepresentable.selector);
        ss.termsOf(o, f);
        bytes memory sig = _offerSig(o, KEY_PK);
        // What the attacker would present: the wrapped deadline. The contract refuses to compute it.
        H.Terms memory t = _terms();
        t.seller = address(ss);
        bytes32 digest = rules.typedDataHash(hx.id(t));
        vm.expectRevert(IS.Unrepresentable.selector);
        ss.isValidSignature(digest, _blob(TAKE, o, sig, f));
        // The same for disputeBy and each of the other deadlines.
        IS.StandingOffer memory d = _offer();
        d.timing.disputeBy = room + 1;
        vm.expectRevert(IS.Unrepresentable.selector);
        ss.termsOf(d, f);
        d = _offer();
        d.timing.offerExpiresAt = type(uint64).max;
        vm.expectRevert(IS.Unrepresentable.selector);
        ss.termsOf(d, f);
    }

    /// attack.template-names-a-hostile-rules-address (red team H-1, T-548 review): the key signs a template whose
    /// `rules` is a contract that answers any digest, with a standing delivery, then revokes it and retires. The seller
    /// contract builds the rules digest itself and calls no code at `rules`, so the template approves nothing the
    /// real rules contract asks: no refund by agreement on a delivered deal, no offer paying a thief, no delivery.
    function test_attack_templateNamesAHostileRulesAddress() public {
        HostileRules hostile = new HostileRules();
        IS.StandingOffer memory p = _offer();
        p.rules = address(hostile);
        bytes memory sigP = _offerSig(p, KEY_PK);
        // A real deal of the seller, delivered.
        IS.StandingOffer memory o = _offer();
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        (H.Terms memory t, bytes32 id) = _take(o, sig, f);
        rules.deliver(t, _standingDelivery(o), _blob(STANDING_DELIVERY, o, sig, f));
        _revoke(p);
        vm.prank(key);
        ss.retire("");
        bytes memory poison = _blob(STANDING_DELIVERY, p, sigP, _fill(9));
        // A refund by agreement with the poisoned blob as the seller's signature.
        H.Mutual memory m;
        m.hasDelivery = true;
        m.deliveryHash = rules.deliveryHashOf(id);
        m.payouts = new H.Payout[](1);
        m.payouts[0] = H.Payout({to: t.buyerPaymentAddress, amount: PRICE});
        m.releaseKey = false;
        m.nonce = keccak256("poisoned refund");
        m.expiresAt = uint64(block.timestamp + 1 hours);
        bytes32 mh = hx.mutual(id, t.token, m);
        hostile.set(rules.typedDataHash(mh));
        assertEq(ss.isValidSignature(rules.typedDataHash(mh), poison), NO);
        m.buyerSignature = _sign(BUYER_PK, mh);
        m.sellerSignature = poison;
        H.KeyProof memory k;
        H.Delivery memory dv = _standingDelivery(o);
        vm.expectRevert(IHoldbackRules.BadSignature.selector);
        rules.mutualSettle(t, m, dv, k);
        // An offer paying a thief, with the poisoned blob as the seller's signature.
        H.Terms memory forged = _terms();
        forged.seller = address(ss);
        forged.sellerPayoutAddress = makeAddr("thief");
        hostile.set(rules.typedDataHash(hx.id(forged)));
        assertEq(ss.isValidSignature(rules.typedDataHash(hx.id(forged)), poison), NO);
        _expectTakeRefused(forged, poison, _badSignature());
        // The take blob of the poisoned template, before the revoke would have mattered, answers no as well.
        assertEq(ss.isValidSignature(rules.typedDataHash(hx.id(forged)), _blob(TAKE, p, sigP, _fill(9))), NO);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Delivered), "the real deal is untouched");
    }

    // ------------------------------------------------------------ the standing delivery

    /// attack.standing-delivery-other-file: the standing approval names one delivery's hashes.
    function test_attack_standingDeliveryOtherFile() public {
        IS.StandingOffer memory o = _offer();
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        (H.Terms memory t,) = _take(o, sig, f);
        bytes memory blob = _blob(STANDING_DELIVERY, o, sig, f);
        for (uint256 i; i < 5; ++i) {
            H.Delivery memory d = _standingDelivery(o);
            if (i == 0) d.ciphertextHash = keccak256("another file");
            else if (i == 1) d.plaintextSha256Hash = keccak256("sha256:another");
            else if (i == 2) d.plaintextMimeHash = keccak256("text/html");
            else if (i == 3) d.encryptedKeysHash = keccak256("envelopes to someone else");
            else d.submittedAt += 1;
            vm.expectRevert(IHoldbackRules.BadSignature.selector);
            rules.deliver(t, d, blob);
        }
        rules.deliver(t, _standingDelivery(o), blob);
    }

    /// attack.standing-delivery-crosses-templates: two live templates with equal terms and different files; one
    /// template's standing delivery does not land on the other's take, because the derived nonce gives each template
    /// its own commitment IDs.
    function test_attack_standingDeliveryCrossesTemplates() public {
        IS.StandingOffer memory a = _offer();
        IS.StandingOffer memory b = _offer();
        b.delivery[0].ciphertextHash = keccak256("the corrected file");
        bytes memory sigA = _offerSig(a, KEY_PK);
        bytes memory sigB = _offerSig(b, KEY_PK);
        IS.Fill memory f = _fill(1);
        assertTrue(hx.id(ss.termsOf(a, f)) != hx.id(ss.termsOf(b, f)), "one fill, two templates, two IDs");
        (H.Terms memory t,) = _take(b, sigB, f);
        vm.prank(makeAddr("griefer"));
        vm.expectRevert(IHoldbackRules.BadSignature.selector);
        rules.deliver(t, _standingDelivery(a), _blob(STANDING_DELIVERY, a, sigA, f));
        // A's file under B's blob is not B's file either.
        vm.expectRevert(IHoldbackRules.BadSignature.selector);
        rules.deliver(t, _standingDelivery(a), _blob(STANDING_DELIVERY, b, sigB, f));
        rules.deliver(t, _standingDelivery(b), _blob(STANDING_DELIVERY, b, sigB, f));
    }

    /// attack.standing-delivery-from-revoked-template: the seller replaces a file with a new template and revokes the
    /// old one; the old file never lands on a take of the new one, whether the new one carries a file or is work
    /// done after funding (red team finding 1 against the spike, High).
    function test_attack_standingDeliveryFromRevokedTemplate() public {
        IS.StandingOffer memory a = _offer();
        bytes memory sigA = _offerSig(a, KEY_PK);
        IS.StandingOffer memory b = _offer();
        b.delivery[0].ciphertextHash = keccak256("the corrected file");
        bytes memory sigB = _offerSig(b, KEY_PK);
        IS.StandingOffer memory w = _workOffer();
        bytes memory sigW = _offerSig(w, KEY_PK);
        _revoke(a);
        IS.Fill memory f = _fill(1);
        (H.Terms memory tb, bytes32 idb) = _take(b, sigB, f);
        (H.Terms memory tw, bytes32 idw) = _take(w, sigW, f);
        vm.startPrank(makeAddr("griefer"));
        vm.expectRevert(IHoldbackRules.BadSignature.selector);
        rules.deliver(tb, _standingDelivery(a), _blob(STANDING_DELIVERY, a, sigA, f));
        vm.expectRevert(IHoldbackRules.BadSignature.selector);
        rules.deliver(tw, _standingDelivery(a), _blob(STANDING_DELIVERY, a, sigA, f));
        vm.stopPrank();
        assertEq(rules.deliveryHashOf(idb), bytes32(0));
        assertEq(rules.deliveryHashOf(idw), bytes32(0), "the worker's take is still open for its own delivery");
    }

    // ------------------------------------------------------------ the template

    /// attack.revoked-template-variant: the template has no field the contract ignores. Each field changes the
    /// template hash, so a variant needs a new signature of the key and is not the revoked template; and each field
    /// reaches the take's terms, its approval or its digest. The struct's encoded size pins the field list, so a new
    /// field is a visible diff here.
    function test_attack_revokedTemplateVariant() public {
        IS.StandingOffer memory a = _offer();
        bytes memory sigA = _offerSig(a, KEY_PK);
        _revoke(a);
        IS.Fill memory f = _fill(1);
        bytes32 thA = ss.templateHash(a);
        H.Terms memory tA = ss.termsOf(a, f);
        // 21 top-level fields: 18 words, `timing` (11 words), `remedyHash`, and `delivery` (an offset and, empty, a
        // length word), after the encoding's own offset word.
        IS.StandingOffer memory empty;
        assertEq(abi.encode(empty).length, (1 + 18 + 11 + 1 + 2) * 32, "the template's field list changed");
        for (uint256 i; i < 36; ++i) {
            IS.StandingOffer memory v = _offer();
            v.expiresAt = a.expiresAt;
            v.delivery[0].submittedAt = a.delivery[0].submittedAt;
            bool termsField = true;
            if (i == 0) (v.rules, termsField) = (makeAddr("other rules"), false);
            else if (i == 1) (v.expiresAt, termsField) = (a.expiresAt + 1, false);
            else if (i == 2) (v.offerIdHash, termsField) = (keccak256("another offer id"), false);
            else if (i == 3) v.schemaVersionHash = keccak256("0.9");
            else if (i == 4) v.clubIdHash = keccak256("another club");
            else if (i == 5) v.rulebookHash = keccak256("another rulebook");
            else if (i == 6) v.sellerPayoutAddress = makeAddr("another payout");
            else if (i == 7) v.deliverableHash = keccak256("another deliverable");
            else if (i == 8) v.acceptanceHash = keccak256("another acceptance");
            else if (i == 9) v.token = makeAddr("another token");
            else if (i == 10) v.price += 1;
            else if (i == 11) v.adjudicator = makeAddr("x1");
            else if (i == 12) v.fallbackAdjudicator = makeAddr("x2");
            else if (i == 13) v.appealAdjudicator = makeAddr("x3");
            else if (i == 14) v.policyIdHash = keccak256("x4");
            else if (i == 15) v.fee += 1;
            else if (i == 16) v.registryHash = keccak256("x5");
            else if (i == 17) v.policyHash = keccak256("x6");
            else if (i == 18) v.timing.offerExpiresAt += 1;
            else if (i == 19) v.timing.fundBy += 1;
            else if (i == 20) v.timing.deliverBy += 1;
            else if (i == 21) v.timing.judgeBy += 1;
            else if (i == 22) v.timing.fallbackBy += 1;
            else if (i == 23) v.timing.appealWindowSec += 1;
            else if (i == 24) v.timing.appealDecideSec += 1;
            else if (i == 25) v.timing.maxSubmissions += 1;
            else if (i == 26) v.timing.disputeBy += 1;
            else if (i == 27) v.timing.disputeJudgeSec += 1;
            else if (i == 28) v.timing.disputeFallbackSec += 1;
            else if (i == 29) v.remedyHash = keccak256("x7");
            else if (i == 30) (v.delivery[0].ciphertextHash, termsField) = (keccak256("x8"), false);
            else if (i == 31) (v.delivery[0].plaintextSha256Hash, termsField) = (keccak256("x9"), false);
            else if (i == 32) (v.delivery[0].plaintextMimeHash, termsField) = (keccak256("x10"), false);
            else if (i == 33) (v.delivery[0].encryptedKeysHash, termsField) = (keccak256("x11"), false);
            else if (i == 34) (v.delivery[0].submittedAt, termsField) = (a.delivery[0].submittedAt + 1, false);
            else (v.delivery, termsField) = (new IS.StandingDelivery[](0), false);
            bytes32 thV = ss.templateHash(v);
            assertTrue(thV != thA, "the variant is another template");
            assertFalse(ss.revoked(thV));
            // The revoked template's signature does not sign the variant.
            H.Terms memory tV = ss.termsOf(v, f);
            assertEq(ss.isValidSignature(rules.typedDataHash(hx.id(tV)), _blob(TAKE, v, sigA, f)), NO);
            // Every terms field reaches the terms beyond the nonce; the rest reach the approval (rules, expiresAt),
            // the delivery, or, for offerId, only the template hash and so the nonce.
            tV.nonce = tA.nonce;
            if (termsField) assertTrue(hx.id(tV) != hx.id(tA), "a field the take's terms ignore");
            else assertEq(hx.id(tV), hx.id(tA));
        }
    }

    /// attack.take-pays-the-seller-contract: a template whose payout address is the seller contract is refused: the
    /// contract has no function to move money out.
    function test_attack_takePaysTheSellerContract() public {
        IS.StandingOffer memory o = _offer();
        o.sellerPayoutAddress = address(ss);
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        vm.expectRevert(IS.PaysThisContract.selector);
        ss.termsOf(o, f);
        // The terms the attacker would build by hand: the template's, paid into the contract.
        IS.StandingOffer memory honest = _offer();
        H.Terms memory t = ss.termsOf(honest, f);
        t.sellerPayoutAddress = address(ss);
        t.nonce = keccak256(abi.encode(ss.templateHash(o), f.nonceSeed));
        bytes32 digest = rules.typedDataHash(hx.id(t));
        vm.expectRevert(IS.PaysThisContract.selector);
        ss.isValidSignature(digest, _blob(TAKE, o, sig, f));
        _expectTakeRefused(t, _blob(TAKE, o, sig, f), _badSignature());
        assertEq(usdc.balanceOf(address(ss)), 0);
    }

    /// attack.leaked-key-after-retire: a leaked key signs a template with its own payout address. After the seller
    /// retires the contract, no take of it, or of any template, funds; nothing undoes the retirement; funded takes
    /// still get their delivery. The key path stays, so a leaked key can still sign per-buyer offers: the known limit
    /// in `IHoldbackStandingSeller`, whose answer is a new key and contract.
    function test_attack_leakedKeyAfterRetire() public {
        IS.StandingOffer memory honest = _offer();
        bytes memory sigH = _offerSig(honest, KEY_PK);
        (H.Terms memory tH,) = _take(honest, sigH, _fill(1));
        IS.StandingOffer memory stolen = _offer();
        stolen.sellerPayoutAddress = makeAddr("thief");
        bytes memory sigS = _offerSig(stolen, KEY_PK); // signed by the leaked key
        IS.Fill memory f = _fill(2);
        H.Terms memory tS = ss.termsOf(stolen, f);
        assertEq(ss.isValidSignature(rules.typedDataHash(hx.id(tS)), _blob(TAKE, stolen, sigS, f)), YES, "before");
        vm.prank(key);
        ss.retire("");
        _expectTakeRefused(tS, _blob(TAKE, stolen, sigS, f), _badSignature());
        IS.Fill memory f3 = _fill(3);
        _expectTakeRefused(ss.termsOf(honest, f3), _blob(TAKE, honest, sigH, f3), _badSignature());
        // The leaked key cannot undo it: a second retire changes nothing, and no other function writes `retired`.
        vm.prank(key);
        ss.retire("");
        assertTrue(ss.retired());
        // A take funded before the retirement still gets its standing delivery.
        rules.deliver(tH, _standingDelivery(honest), _blob(STANDING_DELIVERY, honest, sigH, _fill(1)));
        // Known limit: the key path still approves what the key signs, a per-buyer offer included.
        H.Terms memory perBuyer = _terms();
        perBuyer.seller = address(ss);
        perBuyer.sellerPayoutAddress = makeAddr("thief");
        bytes32 digest = rules.typedDataHash(hx.id(perBuyer));
        assertEq(ss.isValidSignature(digest, _signRaw(KEY_PK, digest)), YES);
    }

    // ------------------------------------------------------------ deployment

    /// attack.deployer-keeps-a-back-door: the payer gets no power. The constructor's only argument is the key; the
    /// address follows from the creation code and the key, so other code with a back door lands at another address;
    /// the payer cannot revoke or retire; nothing is stored at deployment. The ABI allowlist and the bytecode walk are
    /// `test/fuzz/StandingSellerNoAdmin.fuzz.t.sol`.
    function test_attack_deployerKeepsABackDoor() public {
        address crow = makeAddr("crow-relayer");
        // setUp deployed `ss` as Crow; the address is the creation code's with the seller's key.
        assertEq(address(ss), vm.computeCreate2Address(bytes32(0), keccak256(_initcode(key)), CREATE2_DEPLOYER));
        assertEq(ss.KEY(), key);
        bytes memory backDoor = abi.encodePacked(type(BackDoorSeller).creationCode, abi.encode(key));
        address elsewhere = vm.computeCreate2Address(bytes32(0), keccak256(backDoor), CREATE2_DEPLOYER);
        assertTrue(elsewhere != address(ss), "other code, other address");
        // Nothing stored: the mapping's slot and the flag's slot are empty.
        assertEq(vm.load(address(ss), bytes32(0)), bytes32(0));
        assertEq(vm.load(address(ss), bytes32(uint256(1))), bytes32(0));
        // The payer has no say.
        bytes32 th = ss.templateHash(_offer());
        vm.startPrank(crow);
        vm.expectRevert(IS.BadSignature.selector);
        ss.revoke(th, "");
        vm.expectRevert(IS.BadSignature.selector);
        ss.retire("");
        vm.stopPrank();
        assertEq(ss.isValidSignature(keccak256("x"), _signRaw(uint256(keccak256("crow's key")), keccak256("x"))), NO);
    }

    /// attack.standing-blob-malformed, fuzzed: a blob that is not a 64- or 65-byte signature and does not decode to
    /// the exact template, signature and fill reverts or answers no, never yes; the rules contract reads both as no.
    function testFuzz_attack_standingBlobMalformed(bytes calldata blob, bytes32 hash) public view {
        vm.assume(blob.length != 64 && blob.length != 65);
        try ss.isValidSignature(hash, blob) returns (bytes4 r) {
            assertTrue(r != YES);
        } catch {}
    }

    /// The same, from a valid take: a cut of its blob, or one byte changed in it, answers yes for the take's digest
    /// only when it decodes to the take's own values. `abi.decode` reads neither the signature's trailing padding nor
    /// its absence, and the key's signature may come back in its 64-byte form, so such a blob is the same take in other
    /// bytes, which the rules contract does not store.
    function testFuzz_attack_standingBlobMalformed_fromAValidTake(uint256 cut, uint256 at, uint8 xor) public {
        IS.StandingOffer memory o = _offer();
        IS.Fill memory f = _fill(1);
        bytes memory sig = _offerSig(o, KEY_PK);
        bytes memory blob = _blob(TAKE, o, sig, f);
        bytes32 digest = rules.typedDataHash(hx.id(ss.termsOf(o, f)));
        cut = bound(cut, 0, blob.length - 1);
        bytes memory head = new bytes(cut);
        for (uint256 i; i < cut; ++i) {
            head[i] = blob[i];
        }
        if (cut != 64 && cut != 65) _yesOnlyForTheTake(digest, head, o, sig, f);
        vm.assume(xor != 0);
        at = bound(at, 0, blob.length - 1);
        blob[at] = bytes1(uint8(blob[at]) ^ xor);
        _yesOnlyForTheTake(digest, blob, o, sig, f);
    }

    function _yesOnlyForTheTake(
        bytes32 digest,
        bytes memory blob,
        IS.StandingOffer memory o,
        bytes memory sig,
        IS.Fill memory f
    ) internal view {
        try ss.isValidSignature(digest, blob) returns (bytes4 r) {
            if (r != YES) return;
            (uint8 k, IS.StandingOffer memory o2, bytes memory s2, IS.Fill memory f2) =
                abi.decode(blob, (uint8, IS.StandingOffer, bytes, IS.Fill));
            assertEq(k, TAKE);
            assertEq(ss.templateHash(o2), ss.templateHash(o));
            // The key's signature, or the same signature in its EIP-2098 64-byte form: Solady's ECDSA, and the
            // off-chain `standingKeyOf`, read both as the key's. Changing the length word from 65 to 64 gives that form
            // whenever v is 27, since s is low.
            assertTrue(keccak256(s2) == keccak256(sig) || keccak256(s2) == keccak256(_compact(sig)));
            assertEq(keccak256(abi.encode(f2)), keccak256(abi.encode(f)));
        } catch {}
    }

    /// The EIP-2098 64-byte form of a 65-byte signature: r, then s with v - 27 in its top bit.
    function _compact(bytes memory sig) internal pure returns (bytes memory) {
        (bytes32 r, bytes32 s) = abi.decode(sig, (bytes32, bytes32));
        return abi.encodePacked(r, bytes32(uint256(s) | (uint256(uint8(sig[64]) - 27) << 255)));
    }

    /// Regression (CI run 45628031606, main at 08eb54f7): the counterexample that flips the key signature's length
    /// word from 65 to 64. The blob still names the take's own template, key and fill, so the yes is right.
    function test_attack_standingBlobMalformed_fromAValidTake_compactKeySignature() public {
        testFuzz_attack_standingBlobMalformed_fromAValidTake(
            9415675830583510059520467764709570885989032761661,
            4660714426626826352247221995680244665074143805987558179199,
            1
        );
    }

    /// The same class, built directly: a take whose key signature is in its 64-byte form answers yes for the take's
    /// digest, the same answer as the 65-byte form, and funds the same commitment, so the other form cannot fund it
    /// again.
    function test_attack_standingBlob_compactKeySignature_isTheSameTake() public {
        IS.StandingOffer memory o = _offer();
        IS.Fill memory f = _fill(1);
        bytes memory sig = _offerSig(o, KEY_PK);
        bytes memory short = _compact(sig);
        assertEq(short.length, 64);
        bytes32 digest = rules.typedDataHash(hx.id(ss.termsOf(o, f)));
        assertEq(ss.isValidSignature(digest, _blob(TAKE, o, sig, f)), YES);
        assertEq(ss.isValidSignature(digest, _blob(TAKE, o, short, f)), YES);
        (H.Terms memory t, bytes32 id) = _take(o, short, f);
        assertEq(id, hx.id(t));
        _expectTakeRefused(
            t,
            _blob(TAKE, o, sig, f),
            abi.encodeWithSelector(IHoldbackRules.WrongStage.selector, IHoldbackRules.Stage.Held)
        );
    }

    /// A malformed blob at funding is a plain `BadSignature`, as `Erc1271GasBurn.t.sol` shows for a reverting signer.
    function test_attack_standingBlobMalformed_atFunding() public {
        IS.StandingOffer memory o = _offer();
        H.Terms memory t = ss.termsOf(o, _fill(1));
        _expectTakeRefused(t, hex"01", _badSignature());
        _expectTakeRefused(t, new bytes(66), _badSignature());
        _expectTakeRefused(t, abi.encode(uint8(1), uint256(type(uint64).max)), _badSignature());
    }
}
