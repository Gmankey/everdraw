// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {TicketPrizePoolV4} from "../src/TicketPrizePoolV4.sol";
import {V4TestBase} from "./V4TestBase.t.sol";

contract V4_FeeRouter_Test is V4TestBase {
    function setUp() public {
        _deployNative(1, _oneWinnerAlloc());
    }

    function test_fee_allocation_sum_cap_enforced() public {
        TicketPrizePoolV4.FeeAllocation[] memory allocs = new TicketPrizePoolV4.FeeAllocation[](1);
        allocs[0] = TicketPrizePoolV4.FeeAllocation({recipient: treasury, bps: 2001});
        vm.expectRevert();
        pool.setFeeAllocations(allocs);
    }

    function test_fee_snapshot_applies_to_round() public {
        TicketPrizePoolV4.FeeAllocation[] memory allocs = new TicketPrizePoolV4.FeeAllocation[](1);
        allocs[0] = TicketPrizePoolV4.FeeAllocation({recipient: treasury, bps: 1000});
        pool.setFeeAllocations(allocs);
        vm.warp(block.timestamp + ROUND_SEC + 1);
        pool.executeNext(1);
        assertEq(pool.getRoundFeeAllocationLength(2), 1);
    }
}
