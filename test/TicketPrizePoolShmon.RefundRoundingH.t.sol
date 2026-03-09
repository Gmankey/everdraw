// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "../src/TicketPrizePoolShmon.sol";
import "./TicketPrizePoolShmon.t.sol"; // TicketPrizePoolShmonV1Test + MockShmonStaker

contract TicketPrizePoolShmonRefundRoundingHTest is TicketPrizePoolShmonV1Test {
    function test_refundRounding_sumWithdrawn_leq_monReceived_underLoss() public {
        uint256 rid = 1;

        // Uneven principals to force rounding differences
        vm.prank(alice);
        pool.buyTickets{value: 3 ether}(3);

        vm.prank(bob);
        pool.buyTickets{value: 2 ether}(2);

        // End sales + commit
        vm.warp(block.timestamp + 2 days);
        pool.commitDraw(rid);

        // Simulate loss BEFORE drawWinner (matches your MockShmonStaker semantics)
        staker.slash(1 ether); // 5 -> 4 underlying

        // Advance blocks past target
        // targetBlockNumber is 6th
(, , , , , uint256 targetBlockNumber, , , , , , , ) = pool.getRoundInfo(rid);
        vm.roll(targetBlockNumber + 1);

        // Draw + settle
        pool.drawWinner(rid);
        vm.warp(block.timestamp + 18 hours + 1);
        pool.settleRound(rid);

        // Snapshot monReceived
       // monReceived is 9th
(, , , , , , , , uint256 monReceived, , , , ) = pool.getRoundInfo(rid);

        uint256 poolBalBefore = address(pool).balance;

        // Withdraw both principals; track how much actually paid out
        uint256 a0 = alice.balance;
        uint256 b0 = bob.balance;

        vm.prank(alice);
        pool.withdrawPrincipal(rid);

        vm.prank(bob);
        pool.withdrawPrincipal(rid);

        uint256 paidAlice = alice.balance - a0;
        uint256 paidBob   = bob.balance - b0;
        uint256 totalPaid = paidAlice + paidBob;

        // Must never exceed monReceived (allow dust to remain in pool)
        assertTrue(totalPaid <= monReceived, "refunds exceeded monReceived");

        // Pool balance should have dropped by exactly totalPaid
        uint256 poolBalAfter = address(pool).balance;
        assertEq(poolBalBefore - poolBalAfter, totalPaid, "pool balance delta mismatch");

        // Principal should be zeroed
        assertEq(pool.principalMON(rid, alice), 0, "alice principal not cleared");
        assertEq(pool.principalMON(rid, bob), 0, "bob principal not cleared");
    }
}
