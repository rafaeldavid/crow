// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/console.sol";
import {IHoldbackStandingSeller as IS} from "../../src/IHoldbackStandingSeller.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {StandingSellerBase} from "./StandingSellerBase.sol";

/// T-548: the gas of a take's `agreeAndFund` against a plain one, of its standing delivery against a per-buyer one,
/// and of the seller contract's deployment. Print the numbers with
/// `forge test --match-contract StandingSellerGas --isolate -vv`: as in `GasPerDeal.t.sol`, --isolate runs each
/// top-level call as its own transaction. Each budget is about 25% above its --isolate cost; a plain `forge test`
/// measures warm calls, so there the budgets only catch a gross regression.
contract StandingSellerGasTest is StandingSellerBase {
    uint256 internal constant PLAIN_FUND_BUDGET = 300_000; // GasPerDeal's FUND_BUDGET
    uint256 internal constant TAKE_FUND_BUDGET = 330_000; // measured 261,233 (--isolate, 2026-11-19)
    uint256 internal constant STANDING_DELIVER_BUDGET = 175_000; // measured 136,458 (--isolate, 2026-11-19)
    uint256 internal constant DEPLOY_BUDGET = 3_200_000; // measured 2,548,708 (--isolate, 2026-11-19)

    function setUp() public override {
        super.setUp();
        // A warm-up deal creates the operator's TokenStore clone, as GasPerDeal's setUp does.
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d,) = _delivery();
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), d, _deliverySig(id, d, SELLER_PK));
        vm.warp(block.timestamp + 1);
    }

    function _used(string memory step, uint256 budget) internal view returns (uint256 gas) {
        gas = vm.lastCallGas().gasTotalUsed;
        console.log(step, gas);
        assertLe(gas, budget, step);
    }

    function test_gas_takeAgainstPlain() public {
        // Plain: the seller's key signs the terms (an EOA seller).
        H.Terms memory p = _terms();
        bytes memory s = _sellerSig(p, SELLER_PK);
        H.Acceptance memory a = _acceptance(p, ADJ_PK);
        H.Agree memory g = _agree(p, BUYER_PK);
        H.Funding memory fu = _erc3009(p, BUYER_PK);
        vm.prank(relayer);
        bytes32 pid = rules.agreeAndFund(p, s, a, g, fu);
        uint256 plain = _used("agreeAndFund, plain", PLAIN_FUND_BUDGET);
        (H.Delivery memory d,) = _delivery();
        bytes memory ds = _deliverySig(pid, d, SELLER_PK);
        rules.deliver(p, d, ds);
        uint256 plainDeliver = _used("deliver, per-buyer key", STANDING_DELIVER_BUDGET);

        // A take: the same deal through the seller contract.
        IS.StandingOffer memory o = _offer();
        bytes memory sig = _offerSig(o, KEY_PK);
        IS.Fill memory f = _fill(1);
        H.Terms memory t = ss.termsOf(o, f);
        bytes memory blob = _blob(TAKE, o, sig, f);
        a = _acceptance(t, ADJ_PK);
        g = _agree(t, BUYER_PK);
        fu = _erc3009(t, BUYER_PK);
        vm.prank(relayer);
        rules.agreeAndFund(t, blob, a, g, fu);
        uint256 take = _used("agreeAndFund, take", TAKE_FUND_BUDGET);
        H.Delivery memory sd = _standingDelivery(o);
        bytes memory dblob = _blob(STANDING_DELIVERY, o, sig, f);
        rules.deliver(t, sd, dblob);
        uint256 standing = _used("deliver, standing", STANDING_DELIVER_BUDGET);
        console.log("take over plain, agreeAndFund", take - plain);
        console.log("standing over per-buyer, deliver", standing - plainDeliver);
        console.log("bytes, take blob", blob.length);
    }

    function test_gas_isValidSignature_take() public {
        IS.StandingOffer memory o = _offer();
        IS.Fill memory f = _fill(1);
        bytes32 digest = rules.typedDataHash(hx.id(ss.termsOf(o, f)));
        bytes memory blob = _blob(TAKE, o, _offerSig(o, KEY_PK), f);
        assertEq(ss.isValidSignature(digest, blob), YES);
        console.log("isValidSignature, take", vm.lastCallGas().gasTotalUsed);
    }

    function test_gas_deployment() public {
        bytes memory init = _initcode(vm.addr(0xD00D));
        vm.prank(makeAddr("payer"));
        (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(bytes32(0), init));
        assertTrue(ok);
        _used("deployment through the proxy", DEPLOY_BUDGET);
        console.log("bytes, init code", init.length);
        console.log("bytes, runtime", _predict(vm.addr(0xD00D), bytes32(0)).code.length);
    }
}
