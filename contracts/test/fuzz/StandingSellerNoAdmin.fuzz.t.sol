// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {StandingSellerBase} from "../unit/StandingSellerBase.sol";

/// @title StandingSellerNoAdminFuzzTest
/// @notice T-548, hard rule "No admin keys" for the seller contract (ADR-0040 §1, §9 `attack.deployer-keeps-a-back-door`),
///         as `NoAdmin.fuzz.t.sol` checks the rules contract:
///         - its ABI is exactly the reviewed allowlist (a new external function is a visible diff here);
///         - it has no forbidden admin function, fallback or receive;
///         - fuzzed: any selector outside the ABI reverts, with any calldata and any caller, and ether is refused;
///         - its runtime bytecode has no SELFDESTRUCT, CALLCODE or DELEGATECALL.
contract StandingSellerNoAdminFuzzTest is StandingSellerBase {
    string internal constant ARTIFACT = "out/HoldbackStandingSeller.sol/HoldbackStandingSeller.json";
    mapping(bytes4 => bool) internal inAbi;

    function setUp() public override {
        super.setUp();
        string[] memory sigs = vm.parseJsonKeys(vm.readFile(ARTIFACT), ".methodIdentifiers");
        for (uint256 k; k < sigs.length; k++) {
            inAbi[bytes4(keccak256(bytes(sigs[k])))] = true;
        }
    }

    /// The reviewed allowlist: the key's two writes, ERC-1271, the getters and the pure or view helpers. Entries ending
    /// in "(" match any parameter list (the template and terms tuples are long).
    function _allowlist() internal pure returns (string[] memory s) {
        s = new string[](11);
        s[0] = "KEY()";
        s[1] = "commitmentId(";
        s[2] = "deliveryHash(";
        s[3] = "eip712Domain()";
        s[4] = "isValidSignature(bytes32,bytes)";
        s[5] = "retire(bytes)";
        s[6] = "retired()";
        s[7] = "revoke(bytes32,bytes)";
        s[8] = "revoked(bytes32)";
        s[9] = "templateHash(";
        s[10] = "termsOf(";
    }

    function _matches(string memory sig, string memory p) internal pure returns (bool) {
        bytes memory a = bytes(p);
        bytes memory b = bytes(sig);
        if (a[a.length - 1] != "(") return keccak256(a) == keccak256(b);
        if (b.length < a.length) return false;
        for (uint256 k; k < a.length; k++) {
            if (a[k] != b[k]) return false;
        }
        return true;
    }

    function _allowed(string memory sig) internal pure returns (bool) {
        string[] memory l = _allowlist();
        for (uint256 i; i < l.length; i++) {
            if (_matches(sig, l[i])) return true;
        }
        return false;
    }

    function test_abi_isTheReviewedAllowlist() public view {
        string memory json = vm.readFile(ARTIFACT);
        string[] memory sigs = vm.parseJsonKeys(json, ".methodIdentifiers");
        assertEq(sigs.length, _allowlist().length, "ABI size changed");
        for (uint256 k; k < sigs.length; k++) {
            assertTrue(_allowed(sigs[k]), string.concat("not on the reviewed allowlist: ", sigs[k]));
        }
        assertEq(vm.indexOf(json, '"type":"fallback"'), type(uint256).max, "fallback");
        assertEq(vm.indexOf(json, '"type":"receive"'), type(uint256).max, "receive");
    }

    function _forbidden() internal pure returns (string[18] memory) {
        return [
            "owner()",
            "transferOwnership(address)",
            "renounceOwnership()",
            "pause()",
            "unpause()",
            "upgradeTo(address)",
            "upgradeToAndCall(address,bytes)",
            "implementation()",
            "admin()",
            "setKey(address)",
            "changeKey(address)",
            "unretire()",
            "unrevoke(bytes32)",
            "grantRole(bytes32,address)",
            "sweep(address,uint256)",
            "execute(address,uint256,bytes)",
            "multicall(bytes[])",
            "kill()"
        ];
    }

    function test_forbiddenSelectors_absent_andCallsFail() public {
        string[18] memory f = _forbidden();
        for (uint256 k; k < f.length; k++) {
            bytes4 sel = bytes4(keccak256(bytes(f[k])));
            assertFalse(inAbi[sel], f[k]);
            (bool ok,) = address(ss).call(abi.encodeWithSelector(sel, address(this), uint256(1)));
            assertFalse(ok, f[k]);
        }
    }

    function testFuzz_unknownSelector_reverts(bytes4 sel, bytes calldata rest, address caller) public {
        vm.assume(!inAbi[sel]);
        vm.prank(caller);
        (bool ok,) = address(ss).call(bytes.concat(sel, rest));
        assertFalse(ok);
    }

    function testFuzz_etherRefused(uint96 amount) public {
        vm.assume(amount > 0);
        vm.deal(address(this), amount);
        (bool ok,) = address(ss).call{value: amount}("");
        assertFalse(ok);
        // Not even with a selector: no function is payable.
        (ok,) = address(ss).call{value: amount}(abi.encodeWithSignature("retire(bytes)", ""));
        assertFalse(ok);
    }

    /// Walks the runtime bytecode opcode by opcode, skipping PUSH data and the CBOR metadata trailer.
    function test_bytecode_noSelfdestruct_callcode_delegatecall() public view {
        bytes memory code = address(ss).code;
        uint256 end = code.length;
        uint256 metaLen = (uint256(uint8(code[end - 2])) << 8) | uint8(code[end - 1]);
        if (metaLen + 2 <= end && metaLen > 0 && uint8(code[end - metaLen - 2]) == 0xa2) end -= metaLen + 2;
        for (uint256 i; i < end; i++) {
            uint8 op = uint8(code[i]);
            assertTrue(op != 0xff, "SELFDESTRUCT");
            assertTrue(op != 0xf2, "CALLCODE");
            assertTrue(op != 0xf4, "DELEGATECALL");
            if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
        }
    }
}
