// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {V4TestBase} from "./V4TestBase.t.sol";

contract V4_Stop_Test is V4TestBase {
    function setUp() public {
        _deployNative(1, _oneWinnerAlloc());
    }

    function test_stop_blocks_new_deposits() public {
        pool.stop();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        pool.buyTickets{value: 1 ether}(1);
    }

    function test_stop_does_not_block_existing_withdraw() public {
        _buyNative(alice, 1);
        pool.stop();
        _settleWithRandom(bytes32(uint256(1)));
        vm.prank(alice);
        pool.withdrawPrincipal(1);
        assertEq(pool.balanceOf(alice), 0);
    }
}
