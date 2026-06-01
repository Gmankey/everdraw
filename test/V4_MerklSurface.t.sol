// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {V4TestBase} from "./V4TestBase.t.sol";

contract V4_MerklSurface_Test is V4TestBase {
    function setUp() public {
        _deployNative(1, _oneWinnerAlloc());
    }

    function test_balanceOf_zero_for_user_without_deposits() public {
        assertEq(pool.balanceOf(alice), 0);
        assertEq(pool.totalSupply(), 0);
    }

    function test_deposit_updates_balanceOf_and_totalSupply() public {
        _buyNative(alice, 5);
        assertEq(pool.balanceOf(alice), 5 ether);
        assertEq(pool.totalSupply(), 5 ether);
    }

    function test_withdraw_clears_merkl_position() public {
        _buyNative(alice, 5);
        _settleWithRandom(bytes32(uint256(1)));
        vm.prank(alice);
        pool.withdrawPrincipal(1);
        assertEq(pool.balanceOf(alice), 0);
        assertEq(pool.totalSupply(), 0);
    }
}
