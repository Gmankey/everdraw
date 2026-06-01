// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {V4TestBase} from "./V4TestBase.t.sol";

contract V4_GenericAsset_Native_Test is V4TestBase {
    function setUp() public {
        _deployNative(1, _oneWinnerAlloc());
    }

    function test_native_full_lifecycle() public {
        _buyNative(alice, 1);
        yieldVault.setRate(2e18);
        _settleWithRandom(bytes32(uint256(0)));
        vm.prank(alice);
        pool.claimPrize(1);
        vm.prank(alice);
        pool.withdrawPrincipal(1);
        assertGt(yieldVault.balanceOf(alice), 0);
    }

    function test_native_rejects_wrong_value() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        pool.buyTickets{value: 0.5 ether}(1);
    }
}
