// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "../src/TicketPrizePoolShmon.sol";
import "./TicketPrizePoolShmon.t.sol"; // MockShmonStaker

contract TicketPrizePoolShmonStakerDustGTest is Test {
    TicketPrizePoolShmon pool;
    MockShmonStaker staker;

    address alice = address(0xA11CE);
    address bob   = address(0xB0B);

    function setUp() public {
        // Use tiny ticket price so we can test "tiny msg.value"
        uint96  price = 1;          // 1 wei
        uint32  delay = 5;
        uint32  dur   = 10 minutes;

        staker = new MockShmonStaker(18 hours);
        pool = new TicketPrizePoolShmon(price, delay, dur, address(staker));

        vm.deal(alice, 1 ether);
        vm.deal(bob,   1 ether);
    }

    function test_stakeRoundingToZeroShares_reverts_depositTooSmall() public {
        // First, seed the staker so totalShmonSupply > 0 and totalUnderlyingMON > 0
        // Easiest: buy 1 ticket at 1 wei (calls stake()).
        vm.prank(alice);
        pool.buyTickets{value: 1}(1);

        // Now inflate underlying without increasing shares => share price skyrockets
        // This makes shmonAmount = msg.value * totalShmonSupply / totalUnderlyingMON round to 0.
        staker.addYield{value: 0}(1_000_000 ether);

        // Now a 1 wei deposit should mint 0 shares and the staker should revert "deposit too small"
        vm.prank(bob);
        vm.expectRevert(bytes("deposit too small"));
        pool.buyTickets{value: 1}(1);
    }
}
