// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
import {HoldbackStandingSeller} from "../../src/HoldbackStandingSeller.sol";
import {IHoldbackStandingSeller as IS} from "../../src/IHoldbackStandingSeller.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {StandingSellerBase} from "./StandingSellerBase.sol";

/// T-548: the seller contract's paths against the unchanged rules contract (ADR-0040 §1, §2, §4, §7). The attacks of
/// ADR-0040 §9 are in `test/attack/StandingSeller.t.sol`.
contract StandingSellerTest is StandingSellerBase {
    // ------------------------------------------------------------ a fixed file: the seller acts once, at setup

    /// Two buyers take one template; one standing delivery, posted by anyone, serves both; both are paid on accept,
    /// to the template's payout address. The seller contract holds nothing.
    function test_twoTakes_oneStandingDelivery_bothPaid() public {
        IS.StandingOffer memory o = _offer();
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f1 = _fill(1);
        (H.Terms memory t1, bytes32 id1) = _take(o, sig, f1);
        vm.warp(block.timestamp + 1 hours);
        IS.Fill memory f2 = _fill(2);
        (H.Terms memory t2, bytes32 id2) = _take(o, sig, f2);
        assertTrue(id1 != id2, "one ID per take");
        vm.prank(makeAddr("anyone"));
        rules.deliver(t1, _standingDelivery(o), _blob(STANDING_DELIVERY, o, sig, f1));
        vm.prank(buyer);
        rules.deliver(t2, _standingDelivery(o), _blob(STANDING_DELIVERY, o, sig, f2));
        rules.decide(t1, _primary(t1, id1, H.OUTCOME_ACCEPT), _noDelivery(), "");
        rules.decide(t2, _primary(t2, id2, H.OUTCOME_ACCEPT), _noDelivery(), "");
        assertEq(usdc.balanceOf(payout), 2 * PRICE, "paid twice to the payout address");
        assertEq(usdc.balanceOf(address(ss)), 0, "the seller contract holds nothing");
        assertEq(usdc.balanceOf(key), 0, "the key holds nothing");
    }

    /// A decision may carry the standing delivery itself, in Held (ADR-0029), with the same blob.
    function test_decisionCarriesTheStandingDelivery() public {
        IS.StandingOffer memory o = _offer();
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        (H.Terms memory t, bytes32 id) = _take(o, sig, f);
        H.Delivery memory d = _standingDelivery(o);
        H.Decision memory m = _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT);
        m.deliveryHash = hx.delivery(id, d);
        m = _signDecision(t, id, m, adjudicator, ADJ_PK);
        rules.decide(t, m, d, _blob(STANDING_DELIVERY, o, sig, f));
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Released));
        assertEq(usdc.balanceOf(payout), PRICE);
    }

    // ------------------------------------------------------------ work done after funding: the key path

    /// A template with no standing delivery funds; the seller's worker delivers per buyer with its key (65 bytes), and
    /// is paid on accept.
    function test_workOffer_keyDeliversPerBuyer() public {
        IS.StandingOffer memory o = _workOffer();
        (H.Terms memory t, bytes32 id) = _take(o, _offerSig(o, KEY_PK), _fill(1));
        (H.Delivery memory d,) = _delivery();
        rules.deliver(t, d, _sign(KEY_PK, hx.delivery(id, d)));
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        assertEq(usdc.balanceOf(payout), PRICE);
    }

    /// A template with no standing delivery gives no standing approval: the delivery kind answers no.
    function test_workOffer_noStandingDelivery() public {
        IS.StandingOffer memory o = _workOffer();
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        (H.Terms memory t, bytes32 id) = _take(o, sig, f);
        (H.Delivery memory d,) = _delivery();
        assertEq(ss.isValidSignature(rules.typedDataHash(hx.delivery(id, d)), _blob(STANDING_DELIVERY, o, sig, f)), NO);
        vm.expectRevert(IHoldbackRules.BadSignature.selector);
        rules.deliver(t, d, _blob(STANDING_DELIVERY, o, sig, f));
    }

    /// The key path: a refund by agreement, signed by the seller's own key, lands for a take.
    function test_keyPath_mutualSettlementForATake() public {
        IS.StandingOffer memory o = _offer();
        (H.Terms memory t, bytes32 id) = _take(o, _offerSig(o, KEY_PK), _fill(1));
        H.Mutual memory m;
        m.payouts = new H.Payout[](1);
        m.payouts[0] = H.Payout({to: t.buyerPaymentAddress, amount: PRICE});
        m.nonce = keccak256("refund by agreement");
        m.expiresAt = uint64(block.timestamp + 1 hours);
        bytes32 mh = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, mh);
        m.sellerSignature = _sign(KEY_PK, mh);
        H.KeyProof memory k;
        rules.mutualSettle(t, m, _noDelivery(), k);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Settled));
    }

    /// The key path also takes EIP-2098 64-byte signatures, and refuses another key's.
    function test_keyPath_compactSignature_andAnotherKeyRefused() public view {
        bytes32 digest = keccak256("anything the key signs");
        (bytes32 r, bytes32 vs) = vm.signCompact(KEY_PK, digest);
        assertEq(ss.isValidSignature(digest, abi.encodePacked(r, vs)), YES);
        assertEq(ss.isValidSignature(digest, _signRaw(KEY_PK, digest)), YES);
        assertEq(ss.isValidSignature(digest, _signRaw(OTHER_PK, digest)), NO);
    }

    /// The key is checked by ECDSA alone (red team Info-1): if the key's address later has code (an EIP-7702
    /// delegation, say), nothing asks that code, and a funded take still gets its standing delivery.
    function test_keyWithCode_stillAnswersByEcdsa() public {
        IS.StandingOffer memory o = _offer();
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        (H.Terms memory t,) = _take(o, sig, f);
        vm.etch(key, hex"60006000fd"); // code that reverts on every call
        rules.deliver(t, _standingDelivery(o), _blob(STANDING_DELIVERY, o, sig, f));
        bytes32 digest = keccak256("anything the key signs");
        assertEq(ss.isValidSignature(digest, _signRaw(KEY_PK, digest)), YES);
    }

    /// The seller contract builds the rules digest itself from the rules contract's domain (red team H-1). This pins
    /// that domain to the rules contract's own, so a change of its name or version fails here.
    function test_rulesDigest_isTheRulesContractsOwn() public {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = rules.eip712Domain();
        assertEq(name, "Holdback");
        assertEq(version, "0.8");
        assertEq(chainId, block.chainid);
        assertEq(verifying, address(rules));
        IS.StandingOffer memory o = _offer();
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        bytes32 id = hx.id(ss.termsOf(o, f));
        assertEq(ss.isValidSignature(rules.typedDataHash(id), _blob(TAKE, o, sig, f)), YES);
        // On another chain the same take answers for that chain's digest only.
        bytes32 here = rules.typedDataHash(id);
        vm.chainId(11155111);
        assertEq(ss.isValidSignature(here, _blob(TAKE, o, _offerSig(o, KEY_PK), f)), NO);
        assertEq(ss.isValidSignature(rules.typedDataHash(id), _blob(TAKE, o, _offerSig(o, KEY_PK), f)), YES);
    }

    // ------------------------------------------------------------ the take's terms

    /// `termsOf` fills the template: the seller contract as seller, the buyer's five fields, the derived nonce, public
    /// disclosure, and each deadline at createdAt plus its offset; the windows as they are.
    function test_termsOf_fillsTheTemplate() public {
        IS.StandingOffer memory o = _offer();
        o.timing.disputeBy = 12 hours;
        o.timing.disputeJudgeSec = 7;
        o.timing.disputeFallbackSec = 9;
        IS.Fill memory f = IS.Fill({
            buyer: makeAddr("b"),
            buyerPaymentAddress: makeAddr("bp"),
            buyerKeyHash: keccak256("bk"),
            nonceSeed: keccak256("seed"),
            createdAt: 1_000
        });
        H.Terms memory t = ss.termsOf(o, f);
        assertEq(t.seller, address(ss));
        assertEq(t.buyer, f.buyer);
        assertEq(t.buyerPaymentAddress, f.buyerPaymentAddress);
        assertEq(t.buyerKeyHash, f.buyerKeyHash);
        assertEq(t.createdAt, 1_000);
        assertEq(t.nonce, keccak256(abi.encode(ss.templateHash(o), f.nonceSeed)));
        assertEq(t.disclosureHash, keccak256(abi.encode(keccak256("Disclosure(string level)"), keccak256("public"))));
        assertEq(t.sellerPayoutAddress, payout);
        assertEq(t.timing.offerExpiresAt, 1_000 + 15 minutes);
        assertEq(t.timing.fundBy, 1_000 + 30 minutes);
        assertEq(t.timing.deliverBy, 1_000 + 1 days);
        assertEq(t.timing.judgeBy, 1_000 + 2 days);
        assertEq(t.timing.fallbackBy, 1_000 + 3 days);
        assertEq(t.timing.disputeBy, 1_000 + 12 hours);
        assertEq(t.timing.appealWindowSec, 0);
        assertEq(t.timing.appealDecideSec, 1 days);
        assertEq(t.timing.maxSubmissions, 1);
        assertEq(t.timing.disputeJudgeSec, 7);
        assertEq(t.timing.disputeFallbackSec, 9);
        // A disputeBy offset of 0 means none.
        o.timing.disputeBy = 0;
        assertEq(ss.termsOf(o, f).timing.disputeBy, 0);
    }

    /// More than one standing delivery is malformed.
    function test_twoStandingDeliveries_refused() public {
        IS.StandingOffer memory o = _offer();
        IS.StandingDelivery memory d = o.delivery[0];
        o.delivery = new IS.StandingDelivery[](2);
        o.delivery[0] = d;
        o.delivery[1] = d;
        vm.expectRevert(IS.TooManyDeliveries.selector);
        ss.templateHash(o);
        vm.expectRevert(IS.TooManyDeliveries.selector);
        ss.termsOf(o, _fill(1));
    }

    // ------------------------------------------------------------ the take's window

    /// A template takes no new deal from its expiresAt on; one second before, it does.
    function test_template_expiresAt() public {
        IS.StandingOffer memory o = _offer();
        o.expiresAt = uint64(block.timestamp + 1);
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        bytes32 digest = rules.typedDataHash(hx.id(ss.termsOf(o, f)));
        assertEq(ss.isValidSignature(digest, _blob(TAKE, o, sig, f)), YES);
        vm.warp(block.timestamp + 1);
        assertEq(ss.isValidSignature(digest, _blob(TAKE, o, sig, f)), NO);
    }

    /// A template the key did not sign is refused.
    function test_templateSignedByAnotherKey_refused() public {
        IS.StandingOffer memory o = _offer();
        IS.Fill memory f = _fill(1);
        H.Terms memory t = ss.termsOf(o, f);
        _expectTakeRefused(
            t, _blob(TAKE, o, _offerSig(o, OTHER_PK), f), abi.encodeWithSelector(IHoldbackRules.BadSignature.selector)
        );
    }

    /// The approval names the digest: any other hash, the commitment ID itself among them, answers no.
    function test_isValidSignature_onlyTheDigest() public {
        IS.StandingOffer memory o = _offer();
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        bytes32 id = hx.id(ss.termsOf(o, f));
        assertEq(ss.isValidSignature(rules.typedDataHash(id), _blob(TAKE, o, sig, f)), YES);
        assertEq(ss.isValidSignature(id, _blob(TAKE, o, sig, f)), NO);
        assertEq(ss.isValidSignature(bytes32(0), _blob(TAKE, o, sig, f)), NO);
        // The take's approval is not the delivery's, and the other way round.
        assertEq(ss.isValidSignature(rules.typedDataHash(id), _blob(STANDING_DELIVERY, o, sig, f)), NO);
        bytes32 dd = rules.typedDataHash(hx.delivery(id, _standingDelivery(o)));
        assertEq(ss.isValidSignature(dd, _blob(STANDING_DELIVERY, o, sig, f)), YES);
        assertEq(ss.isValidSignature(dd, _blob(TAKE, o, sig, f)), NO);
        // Any other kind byte answers no.
        for (uint8 kind; kind < 8; ++kind) {
            if (kind == TAKE || kind == STANDING_DELIVERY) continue;
            assertEq(ss.isValidSignature(rules.typedDataHash(id), _blob(kind, o, sig, f)), NO);
        }
    }

    // ------------------------------------------------------------ revoke and retire

    function test_revoke_byKey_direct() public {
        IS.StandingOffer memory o = _offer();
        bytes32 th = ss.templateHash(o);
        vm.expectEmit(address(ss));
        emit IS.Revoked(th);
        vm.prank(key);
        ss.revoke(th, "");
        assertTrue(ss.revoked(th));
    }

    function test_revoke_relayedWithKeySignature_onceOnly() public {
        bytes32 th = ss.templateHash(_offer());
        bytes memory rsig = _revokeSig(th, KEY_PK);
        vm.recordLogs();
        vm.prank(makeAddr("relayer of the revoke"));
        ss.revoke(th, rsig);
        vm.prank(makeAddr("someone replaying it"));
        ss.revoke(th, rsig);
        assertEq(vm.getRecordedLogs().length, 1, "Revoked emitted once");
        assertTrue(ss.revoked(th));
    }

    function test_revoke_withoutKeySignature_refused() public {
        bytes32 th = ss.templateHash(_offer());
        vm.startPrank(makeAddr("stranger"));
        vm.expectRevert(IS.BadSignature.selector);
        ss.revoke(th, "");
        vm.expectRevert(IS.BadSignature.selector);
        ss.revoke(th, _revokeSig(th, OTHER_PK));
        // The key's signature of another template's revoke does not revoke this one.
        vm.expectRevert(IS.BadSignature.selector);
        ss.revoke(th, _revokeSig(keccak256("another template"), KEY_PK));
        vm.stopPrank();
        assertFalse(ss.revoked(th));
    }

    /// A revoked template takes no new deal; a deal already funded still takes its standing delivery and is paid.
    function test_revokedTemplate_noNewTake_fundedDealStillDelivers() public {
        IS.StandingOffer memory o = _offer();
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        (H.Terms memory t1, bytes32 id1) = _take(o, sig, f);
        _revoke(o);
        IS.Fill memory f2 = _fill(2);
        _expectTakeRefused(
            ss.termsOf(o, f2), _blob(TAKE, o, sig, f2), abi.encodeWithSelector(IHoldbackRules.BadSignature.selector)
        );
        rules.deliver(t1, _standingDelivery(o), _blob(STANDING_DELIVERY, o, sig, f));
        rules.decide(t1, _primary(t1, id1, H.OUTCOME_ACCEPT), _noDelivery(), "");
        assertEq(usdc.balanceOf(payout), PRICE);
    }

    function test_retire_byKey_relayed_andRefusedForOthers() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(IS.BadSignature.selector);
        ss.retire("");
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(IS.BadSignature.selector);
        ss.retire(_retireSig(OTHER_PK));
        assertFalse(ss.retired());
        vm.expectEmit(address(ss));
        emit IS.Retired();
        vm.prank(makeAddr("relayer of the retire"));
        ss.retire(_retireSig(KEY_PK));
        assertTrue(ss.retired());
        // One-way and idempotent: a second retire, by the key itself, changes nothing and emits nothing.
        vm.recordLogs();
        vm.prank(key);
        ss.retire("");
        assertEq(vm.getRecordedLogs().length, 0);
        assertTrue(ss.retired());
    }

    /// Retirement is not a pause: a funded take still gets its standing delivery and settles, and the key path still
    /// signs a refund by agreement.
    function test_retire_fundedDealsStillSettle() public {
        IS.StandingOffer memory o = _offer();
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f1 = _fill(1);
        IS.Fill memory f2 = _fill(2);
        (H.Terms memory t1, bytes32 id1) = _take(o, sig, f1);
        (H.Terms memory t2, bytes32 id2) = _take(o, sig, f2);
        vm.prank(key);
        ss.retire("");
        rules.deliver(t1, _standingDelivery(o), _blob(STANDING_DELIVERY, o, sig, f1));
        rules.decide(t1, _primary(t1, id1, H.OUTCOME_ACCEPT), _noDelivery(), "");
        assertEq(usdc.balanceOf(payout), PRICE);
        H.Mutual memory m;
        m.payouts = new H.Payout[](1);
        m.payouts[0] = H.Payout({to: t2.buyerPaymentAddress, amount: PRICE});
        m.nonce = keccak256("refund after retire");
        m.expiresAt = uint64(block.timestamp + 1 hours);
        bytes32 mh = hx.mutual(id2, t2.token, m);
        m.buyerSignature = _sign(BUYER_PK, mh);
        m.sellerSignature = _sign(KEY_PK, mh);
        H.KeyProof memory k;
        rules.mutualSettle(t2, m, _noDelivery(), k);
        assertEq(uint8(_stage(id2)), uint8(IHoldbackRules.Stage.Settled));
    }

    // ------------------------------------------------------------ deployment

    /// The constructor refuses the zero key, which no one can sign for.
    function test_constructor_zeroKey_refused() public {
        vm.expectRevert(IS.ZeroAddress.selector);
        new HoldbackStandingSeller(address(0));
    }

    /// Anyone computes the address before deployment from the code, the key and the salt; any payer deploys the same
    /// code there; a second deployment fails and changes nothing (ADR-0040 §4).
    function test_anyPayerDeploysTheSameAddress() public {
        uint256 pk = 0xD00D;
        address predicted = _predict(vm.addr(pk), bytes32(0));
        assertEq(predicted.code.length, 0, "no code before deployment");
        address bySeller = _deployVia(vm.addr(pk), pk, bytes32(0));
        assertEq(bySeller, predicted);
        assertEq(HoldbackStandingSeller(bySeller).KEY(), vm.addr(pk));
        bytes32 codeHash = bySeller.codehash;
        // A second deployment, by another payer, fails and changes nothing.
        vm.prank(makeAddr("crow"));
        (bool ok,) = CREATE2_DEPLOYER.call{gas: 3_000_000}(abi.encodePacked(bytes32(0), _initcode(vm.addr(pk))));
        assertFalse(ok, "already deployed");
        assertEq(bySeller.codehash, codeHash);
        // setUp's deployment, paid by Crow, sits where the seller's own would.
        assertEq(address(ss), _predict(key, bytes32(0)));
        // Another salt or another key is another address.
        assertTrue(_predict(vm.addr(pk), bytes32(uint256(1))) != predicted);
        assertTrue(_predict(key, bytes32(0)) != predicted);
    }
}
