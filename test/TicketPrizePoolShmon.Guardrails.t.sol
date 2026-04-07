// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "../src/TicketPrizePoolShmon.sol";

// Reuse your existing MockShmonStaker definition (same pattern as LifecycleA)
import "./TicketPrizePoolShmon.t.sol";

contract TicketPrizePoolShmonGuardrailsTest is Test {
    TicketPrizePoolShmon pool;
    MockShmonStaker staker;

    address alice = address(0xA11cE);
    address bob   = address(0xB0b);

    uint96  constant TICKET_PRICE = 0.01 ether;
    uint32  constant COMMIT_DELAY = 5;
    uint32  constant ROUND_DUR    = 10 minutes;

    function setUp() public {
        staker = new MockShmonStaker(18 hours);

        pool = new TicketPrizePoolShmon(
            TICKET_PRICE,
            COMMIT_DELAY,
            ROUND_DUR,
            address(staker)
        );

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // -------------------------
    // Helpers
    // -------------------------

    function _buy(address user, uint32 n) internal {
        vm.prank(user);
        pool.buyTickets{value: uint256(TICKET_PRICE) * n}(n);
    }

    function _warpPastSalesEnd() internal {
        vm.warp(block.timestamp + ROUND_DUR + 1);
    }

    function _commit(uint256 rid) internal {
        pool.commitDraw(rid);
    }

    function _targetBlock(uint256 rid) internal view returns (uint256) {
        // targetBlockNumber is the 6th return (index 5)
        (, , , , , uint256 targetBlockNumber, , , , , , , ) = pool.getRoundInfo(rid);
        return targetBlockNumber;
    }

    // =========================================================
    // A1. commitDraw too early (before salesEndTime) -> revert
    // =========================================================
    function test_A1_commitDraw_beforeSalesEnd_reverts() public {
        uint256 rid = 1;
        _buy(alice, 1);

        vm.expectRevert(bytes("sales not ended"));
        _commit(rid);
    }

    // =========================================================
    // A2. buyTickets after sales end -> revert ("sales ended")
    // =========================================================
    function test_A2_buyTickets_afterSalesEnd_reverts() public {
        uint256 rid = 1;
        _buy(alice, 1);

        _warpPastSalesEnd();

        vm.prank(bob);
        vm.expectRevert(bytes("sales ended"));
        pool.buyTickets{value: TICKET_PRICE}(1);
    }

    // =========================================================
    // A3. drawWinner too early (before target block) -> revert ("too early")
    // contract requires block.number > targetBlockNumber
    // =========================================================
    function test_A3_drawWinner_beforeTargetBlock_reverts() public {
        uint256 rid = 1;
        _buy(alice, 2);
        _warpPastSalesEnd();

        _commit(rid);
        uint256 target = _targetBlock(rid);

        vm.roll(target);

        vm.expectRevert(bytes("too early"));
        pool.drawWinner(rid);
    }

    // =========================================================
    // A4. blockhash expiry path (after target + 255) -> revert ("blockhash expired")
    // Expired when block.number >= target + 256.
    // =========================================================
    function test_A4_drawWinner_afterBlockhashExpiry_reverts() public {
        uint256 rid = 1;
        _buy(alice, 1);
        _warpPastSalesEnd();

        _commit(rid);
        uint256 target = _targetBlock(rid);

        vm.roll(target + 256);

        vm.expectRevert(bytes("blockhash expired"));
        pool.drawWinner(rid);
    }

    // =========================================================
    // A5. double draw -> should revert "bad state"
    // =========================================================
    function test_A5_doubleDraw_reverts() public {
        uint256 rid = 1;
        _buy(alice, 2);
        _buy(bob, 1);

        _warpPastSalesEnd();
        _commit(rid);

        uint256 target = _targetBlock(rid);
        vm.roll(target + 1);

        pool.drawWinner(rid);

        vm.expectRevert(bytes("bad state"));
        pool.drawWinner(rid);
    }

    // =========================================================
    // A6. settle called in wrong state -> revert ("bad state")
    // =========================================================
    function test_A6_settle_inOpen_reverts() public {
        uint256 rid = 1;
        vm.expectRevert(bytes("bad state"));
        pool.settleRound(rid);
    }

    function test_A6_settle_inCommitted_reverts() public {
        uint256 rid = 1;
        _buy(alice, 1);
        _warpPastSalesEnd();
        _commit(rid);

        vm.expectRevert(bytes("bad state"));
        pool.settleRound(rid);
    }

    function test_A6_settle_inSettled_reverts() public {
        uint256 rid = 1;
        _buy(alice, 1);
        _warpPastSalesEnd();
        _commit(rid);

        uint256 target = _targetBlock(rid);
        vm.roll(target + 1);
        pool.drawWinner(rid);

        vm.warp(block.timestamp + 18 hours + 1);
        pool.settleRound(rid);

        vm.expectRevert(bytes("bad state"));
        pool.settleRound(rid);
    }

    // =========================================================
    // A7. double settle -> revert ("bad state")
    // =========================================================
    function test_A7_doubleSettle_reverts() public {
        uint256 rid = 1;
        _buy(alice, 2);
        _warpPastSalesEnd();
        _commit(rid);

        uint256 target = _targetBlock(rid);
        vm.roll(target + 1);
        pool.drawWinner(rid);

        vm.warp(block.timestamp + 18 hours + 1);
        pool.settleRound(rid);

        vm.expectRevert(bytes("bad state"));
        pool.settleRound(rid);
    }

    // Bonus guardrail: settle while Finalizing but unstake NOT ready
    function test_settle_finalizing_butNotReady_reverts() public {
        uint256 rid = 1;
        _buy(alice, 1);
        _warpPastSalesEnd();
        _commit(rid);

        uint256 target = _targetBlock(rid);
        vm.roll(target + 1);
        pool.drawWinner(rid);

        vm.expectRevert(bytes("unstake not ready"));
        pool.settleRound(rid);
    }

    // =========================================================
    // A8. new round creation invariants after commitDraw
    // =========================================================
    function test_A8_newRoundClean_afterCommit() public {
        uint256 rid = 1;
        _buy(alice, 1);
        _warpPastSalesEnd();

        _commit(rid);

        assertEq(pool.currentRoundId(), 2, "currentRoundId not advanced");

        assertEq(
            uint8(pool.getRoundState(2)),
            uint8(TicketPrizePoolShmon.RoundState.Open),
            "round2 not open"
        );

        (
            TicketPrizePoolShmon.RoundState state,
            uint64 salesEndTime,
            uint32 totalTickets,
            uint256 totalPrincipalMON,
            uint256 totalShmonStaked,
            uint256 targetBlockNumber,
            address winner,
            uint32 winningTicket,
            uint256 monReceived,
            uint256 yieldMON,
            uint256 lossRatio,
            bool prizeClaimed,
            bool settled
        ) = pool.getRoundInfo(2);

        // unused-but-typed to avoid warnings
        totalShmonStaked;
        targetBlockNumber;
        winner;
        winningTicket;
        monReceived;
        yieldMON;
        lossRatio;
        settled;

        assertEq(uint8(state), uint8(TicketPrizePoolShmon.RoundState.Open), "round2 state mismatch");
        assertEq(totalTickets, 0, "round2 totalTickets != 0");
        assertEq(totalPrincipalMON, 0, "round2 totalPrincipalMON != 0");
        assertEq(pool.rangesLength(2), 0, "round2 rangesLength != 0");
        assertEq(pool.principalMON(2, alice), 0, "round2 alice principal != 0");
        assertEq(pool.principalMON(2, bob), 0, "round2 bob principal != 0");
        assertEq(prizeClaimed, false, "round2 prizeClaimed should be false");

        assertTrue(salesEndTime > block.timestamp, "round2 salesEndTime not in future");
    }
}
