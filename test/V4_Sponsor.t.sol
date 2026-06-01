// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {V4TestBase} from "./V4TestBase.t.sol";

contract V4_Sponsor_Test is V4TestBase {
    function setUp() public {
        _deployNative(1, _oneWinnerAlloc());
    }

    function test_sponsor_adds_refundable_shares_to_open_round() public {
        vm.deal(bob, 3 ether);
        vm.prank(bob);
        pool.sponsor{value: 3 ether}(1, "promo");
        assertGt(pool.sponsorContribution(1, bob), 0);
    }

    function test_sponsor_refund_on_skipped_round() public {
        vm.deal(bob, 3 ether);
        vm.prank(bob);
        pool.sponsor{value: 3 ether}(1, "promo");
        vm.warp(block.timestamp + ROUND_SEC + 1);
        pool.executeNext(1);
        vm.prank(bob);
        pool.claimSponsorRefund(1);
        assertGt(yieldVault.balanceOf(bob), 0);
    }
}
