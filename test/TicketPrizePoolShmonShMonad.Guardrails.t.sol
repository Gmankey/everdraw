// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {TicketPrizePoolShmonShMonad, IShMonad} from "../src/TicketPrizePoolShmonShMonad.sol";

contract GuardrailsShMonad is IShMonad {
    uint64 public nextEpoch = 1;
    uint256 public pendingShares;

    function deposit(uint256 assets, address) external payable returns (uint256 shares) {
        require(msg.value == assets, "bad value");
        return assets;
    }

    function requestUnstake(uint256 shares) external returns (uint64 completionEpoch) {
        pendingShares = shares;
        completionEpoch = nextEpoch++;
    }

    function completeUnstake() external {
        uint256 shares = pendingShares;
        pendingShares = 0;
        (bool ok,) = msg.sender.call{value: shares}("");
        require(ok, "pay failed");
    }

    receive() external payable {}
}

contract TicketPrizePoolShmonShMonad_Guardrails_Test is Test {
    TicketPrizePoolShmonShMonad pool;
    GuardrailsShMonad shmon;

    address alice = address(0xA11cE);
    address bob = address(0xB0b);

    uint96 constant TICKET_PRICE = 0.01 ether;
    uint32 constant COMMIT_DELAY = 5;
    uint32 constant ROUND_DUR = 90;

    function setUp() public {
        shmon = new GuardrailsShMonad();
        pool = new TicketPrizePoolShmonShMonad(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(shmon));

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function _buy(address user, uint32 n) internal {
        vm.prank(user);
        pool.buyTickets{value: uint256(TICKET_PRICE) * n}(n);
    }

    function _warpPastSalesEnd() internal {
        vm.warp(block.timestamp + ROUND_DUR + 1);
    }

    function _targetBlock(uint256 rid) internal view returns (uint256) {
        (, , , , , uint256 targetBlockNumber, , , , , , , ) = pool.getRoundInfo(rid);
        return targetBlockNumber;
    }

    function test_A1_commitDraw_beforeSalesEnd_reverts() public {
        _buy(alice, 1);
        vm.expectRevert(pool.legacyBytes("sales not ended"));
        pool.commitDraw(1);
    }

    function test_A2_buyTickets_afterSalesEnd_reverts() public {
        _buy(alice, 1);
        _warpPastSalesEnd();

        vm.prank(bob);
        vm.expectRevert(TicketPrizePoolShmonShMonad.SalesEnded.selector);
        pool.buyTickets{value: TICKET_PRICE}(1);
    }

    function test_A3_drawWinner_beforeTargetBlock_reverts() public {
        _buy(alice, 2);
        _warpPastSalesEnd();
        pool.commitDraw(1);

        uint256 target = _targetBlock(1);
        vm.roll(target);

        vm.expectRevert(pool.legacyBytes("too early"));
        pool.drawWinner(1);
    }

    function test_A4_drawWinner_afterBlockhashExpiry_reverts() public {
        _buy(alice, 1);
        _warpPastSalesEnd();
        pool.commitDraw(1);

        uint256 target = _targetBlock(1);
        vm.roll(target + 256);

        vm.expectRevert(pool.legacyBytes("blockhash expired"));
        pool.drawWinner(1);
    }

    function test_A5_doubleDraw_reverts() public {
        _buy(alice, 2);
        _buy(bob, 1);

        _warpPastSalesEnd();
        pool.commitDraw(1);

        uint256 target = _targetBlock(1);
        vm.roll(target + 1);

        pool.drawWinner(1);

        vm.expectRevert(pool.legacyBytes("finalization busy"));
        pool.drawWinner(1);
    }

    function test_A6_settle_wrongStates_revert() public {
        vm.expectRevert(pool.legacyBytes("bad state"));
        pool.settleRound(1);

        _buy(alice, 1);
        _warpPastSalesEnd();
        pool.commitDraw(1);

        vm.expectRevert(pool.legacyBytes("bad state"));
        pool.settleRound(1);
    }

    function test_A7_doubleSettle_reverts() public {
        _buy(alice, 2);
        _warpPastSalesEnd();
        pool.commitDraw(1);

        uint256 target = _targetBlock(1);
        vm.roll(target + 1);
        pool.drawWinner(1);
        pool.settleRound(1);

        vm.expectRevert(pool.legacyBytes("bad state"));
        pool.settleRound(1);
    }

    function test_A8_newRoundClean_afterCommit() public {
        _buy(alice, 1);
        _warpPastSalesEnd();

        pool.commitDraw(1);

        assertEq(pool.currentRoundId(), 2);
        assertEq(uint8(pool.getRoundState(2)), uint8(TicketPrizePoolShmonShMonad.RoundState.Open));

        (
            TicketPrizePoolShmonShMonad.RoundState state,
            uint64 salesEndTime,
            uint32 totalTickets,
            uint256 totalPrincipalMON,
            uint256 totalShmonShares,
            uint256 targetBlockNumber,
            address winner,
            uint32 winningTicket,
            uint64 unstakeCompletionEpoch,
            uint256 monReceived,
            uint256 yieldMON,
            uint256 lossRatio,
            bool prizeClaimed
        ) = pool.getRoundInfo(2);

        totalShmonShares;
        targetBlockNumber;
        winner;
        winningTicket;
        unstakeCompletionEpoch;
        monReceived;
        yieldMON;
        lossRatio;

        assertEq(uint8(state), uint8(TicketPrizePoolShmonShMonad.RoundState.Open));
        assertEq(totalTickets, 0);
        assertEq(totalPrincipalMON, 0);
        assertEq(pool.rangesLength(2), 0);
        assertEq(pool.principalMON(2, alice), 0);
        assertEq(pool.principalMON(2, bob), 0);
        assertEq(prizeClaimed, false);
        assertTrue(uint256(salesEndTime) > block.timestamp);
    }

    function test_pause_blocks_progression_but_not_withdrawals_after_settle() public {
        _buy(alice, 1);
        _warpPastSalesEnd();
        pool.commitDraw(1);

        pool.pause();

        vm.expectRevert(bytes("paused"));
        pool.executeNext();

        // settle still allowed if round is active finalizer
        uint256 target = _targetBlock(1);
        vm.roll(target + 1);

        pool.unpause();
        pool.drawWinner(1);
        pool.pause();

        // should still settle while paused for active finalizer
        pool.settleRound(1);

        vm.prank(alice);
        pool.withdrawPrincipal(1);
    }
}
