// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "./TicketPrizePoolShmon.t.sol"; // imports TicketPrizePoolShmonV1Test + MockShmonStaker + pool wiring

contract TicketPrizePoolShmonLifecycleCTest is TicketPrizePoolShmonV1Test {
    // Fixes getRoundInfo destructuring for the 13-return signature
    // AND fixes the loss simulation ordering to match MockShmonStaker semantics.

    function test_LifecycleC_LossRatioAppliedToPrincipal() public {
        uint256 rid = 1;

        // Round 1 buys: principal = 5 ether
        vm.prank(alice);
        pool.buyTickets{value: 3 ether}(3);

        vm.prank(bob);
        pool.buyTickets{value: 2 ether}(2);

        // End sales and commit draw
        vm.warp(block.timestamp + 2 days);
        pool.commitDraw(rid);

        // Simulate loss BEFORE drawWinner/requestUnstake (since requestUnstake "locks" underlying)
        staker.slash(1 ether); // underlying 5 -> 4

        // Move blocks to after target
        // getRoundInfo returns:
        // (state, salesEndTime, totalTickets, totalPrincipal, totalShmonStaked, targetBlockNumber, winner, winningTicket, monReceived, yieldMON, lossRatio, prizeClaimed, settled)
        (, , , , , uint256 targetBlockNumber, , , , , , , ) = pool.getRoundInfo(rid);
        vm.roll(targetBlockNumber + 1);

        // Draw winner -> request unstake (now based on reduced underlying)
        pool.drawWinner(rid);

        // Warp past delay and settle
        vm.warp(block.timestamp + 19 hours);
        pool.settleRound(rid);

        (
            TicketPrizePoolShmon.RoundState state,
            ,
            ,
            uint256 totalPrincipalMON,
            ,
            ,
            ,
            ,
            uint256 monReceived,
            uint256 yieldMON,
            uint256 lossRatio,
            bool prizeClaimed,
            bool settled
        ) = pool.getRoundInfo(rid);

        assertTrue(settled, "settled flag false");
        assertEq(uint8(state), uint8(TicketPrizePoolShmon.RoundState.Settled), "not settled");
        assertEq(totalPrincipalMON, 5 ether);

        // With 1 ether loss on 5 ether principal: received = 4, yield = 0, lossRatio = 0.8e18
        assertEq(monReceived, 4 ether);
        assertEq(yieldMON, 0);
        assertEq(lossRatio, (4 ether * 1e18) / (5 ether));
        assertEq(prizeClaimed, false);
    }
}
