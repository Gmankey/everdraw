// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "../src/TicketPrizePool.sol";


contract MockStaker {
    uint256 public total;

    function stake() external payable {
        total += msg.value;
    }

    function addYield(uint256 amount) external {
        total += amount;
    }

    function totalUnderlying() external view returns (uint256) {
        return total;
    }

    function unstake(uint256 amount, address to) external {
        require(total >= amount, "insolvent");
        total -= amount;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "pay fail");
    }

    receive() external payable {}
}

contract TicketPrizePoolHybridRangesTest is Test {
    TicketPrizePool pool;
    MockStaker staker;

    address alice = address(0xA11CE);
    address bob   = address(0xB0B);
    address carol = address(0xC0FFEE); // valid hex-only address

    function setUp() public {
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);

        staker = new MockStaker();
        vm.deal(address(staker), 100 ether);

        uint64 endTime = uint64(block.timestamp + 1 days);
        pool = new TicketPrizePool(endTime, 1 ether, 5, address(staker));
    }

    function _commitAndReveal(address user, bytes32 seed) internal {
        uint256 rid = pool.roundId();
        bytes32 commitHash = keccak256(abi.encodePacked(seed, user, rid));

        vm.prank(user);
        pool.commitSeed(commitHash);

        vm.prank(user);
        pool.revealSeed(seed);
    }

    function testConsecutiveBuysMergeIntoSingleRange() public {
        uint256 rid = pool.roundId();

        // Alice buys 1 ticket 5 times consecutively -> should be 1 range [0,5)
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(alice);
            pool.buyTickets{value: 1 ether}(1);
        }

        assertEq(pool.rangesLength(), 1);
        assertEq(pool.ownerOfTicket(0), alice);
        assertEq(pool.ownerOfTicket(4), alice);

        // Bob buys -> creates second range [5,7)
        vm.prank(bob);
        pool.buyTickets{value: 2 ether}(2);

        assertEq(pool.rangesLength(), 2);
        assertEq(pool.ownerOfTicket(5), bob);
        assertEq(pool.ownerOfTicket(6), bob);

        // Alice buys again (not contiguous with her last range, because bob was in between) -> new range [7,8)
        vm.prank(alice);
        pool.buyTickets{value: 1 ether}(1);

        assertEq(pool.rangesLength(), 3);
        assertEq(pool.ownerOfTicket(7), alice);

        // Ensure principal accounting
        assertEq(pool.principalOf(rid, alice), 6 ether);
        assertEq(pool.principalOf(rid, bob), 2 ether);
    }

    function testFinalizeUsesLogSearchAndStillWorksWithCommitReveal() public {
        uint256 rid = pool.roundId();

        // Mixed buys, some consecutive merging happens
        vm.prank(alice);
        pool.buyTickets{value: 2 ether}(2); // [0,2) alice
        vm.prank(alice);
        pool.buyTickets{value: 1 ether}(1); // merges -> [0,3)

        vm.prank(bob);
        pool.buyTickets{value: 2 ether}(2); // [3,5) bob

        vm.prank(carol);
        pool.buyTickets{value: 1 ether}(1); // [5,6) carol

        // yield
        staker.addYield(0.5 ether);

        // commit+reveal
        _commitAndReveal(alice, keccak256("seed-alice"));
        _commitAndReveal(bob, keccak256("seed-bob"));

        // end & commit draw
        vm.warp(block.timestamp + 2 days);
        pool.commitDraw();
        uint256 target = pool.targetBlockNumber();
        vm.roll(target + 1);

        bytes32 bh = blockhash(target);
        bytes32 mix = pool.currentEntropyMix();
        bytes32 rnd = keccak256(abi.encodePacked(bh, mix, rid));

        uint32 expectedTicket = uint32(uint256(rnd) % uint256(pool.totalTickets()));
        address expectedWinner = pool.ownerOfTicket(expectedTicket);

        pool.finalizeDraw();

        assertEq(pool.roundWinningTicket(rid), expectedTicket);
        assertEq(pool.roundWinner(rid), expectedWinner);
        assertEq(pool.roundPrize(rid), 0.5 ether);

        // start next round immediately (no withdrawals needed)
        pool.startNewRound(uint64(block.timestamp + 1 days));
        assertEq(pool.roundId(), rid + 1);
        assertEq(uint256(pool.state()), uint256(TicketPrizePool.State.Open));
    }
}
