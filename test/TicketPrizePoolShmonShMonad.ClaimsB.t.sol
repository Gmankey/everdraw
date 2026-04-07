// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {TicketPrizePoolShmonShMonad, IShMonad} from "../src/TicketPrizePoolShmonShMonad.sol";

contract ClaimsShMonad is IShMonad {
    uint16 public payoutBps;
    uint256 public bonusWei;

    uint64 public nextEpoch = 1;
    uint256 public pendingShares;

    constructor(uint16 _payoutBps, uint256 _bonusWei) {
        payoutBps = _payoutBps;
        bonusWei = _bonusWei;
    }

    function deposit(uint256 assets, address) external payable returns (uint256 shares) {
        require(msg.value == assets, "bad value");
        return assets; // 1:1 shares
    }

    function requestUnstake(uint256 shares) external returns (uint64 completionEpoch) {
        pendingShares = shares;
        completionEpoch = nextEpoch++;
    }

    function completeUnstake() external {
        uint256 shares = pendingShares;
        require(shares > 0, "nothing pending");
        pendingShares = 0;

        uint256 paidPrincipal = (shares * uint256(payoutBps)) / 10000;
        uint256 amount = paidPrincipal + bonusWei;

        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "pay failed");
    }

    receive() external payable {}
}

contract TicketPrizePoolShmonShMonad_ClaimsB_Test is Test {
    TicketPrizePoolShmonShMonad pool;
    ClaimsShMonad shmon;

    address alice = address(0xA11cE);
    address bob = address(0xB0b);

    uint96 constant PRICE = 0.01 ether;
    uint32 constant COMMIT_DELAY = 5;
    uint32 constant ROUND_SEC = 90;

    function _deploy(uint16 payoutBps, uint256 bonusWei) internal {
        shmon = new ClaimsShMonad(payoutBps, bonusWei);
        pool = new TicketPrizePoolShmonShMonad(PRICE, COMMIT_DELAY, ROUND_SEC, address(shmon));

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        if (bonusWei > 0) {
            vm.deal(address(shmon), bonusWei);
        }
    }

    function _buy(address user, uint32 n) internal {
        vm.prank(user);
        pool.buyTickets{value: uint256(PRICE) * n}(n);
    }

    function _warpPastSalesEnd() internal {
        vm.warp(block.timestamp + ROUND_SEC + 1);
    }

    function _targetBlock(uint256 rid) internal view returns (uint256) {
        (, , , , , uint256 targetBlockNumber, , , , , , , ) = pool.getRoundInfo(rid);
        return targetBlockNumber;
    }

    function _runToSettled(uint256 rid) internal {
        _warpPastSalesEnd();
        pool.commitDraw(rid);

        uint256 target = _targetBlock(rid);
        vm.roll(target + 1);

        pool.drawWinner(rid);
        pool.settleRound(rid);

        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmonShMonad.RoundState.Settled), "not settled");
    }

    function test_B9_onlyWinnerCanClaim() public {
        _deploy(10000, 0.5 ether);

        uint256 rid = 1;
        _buy(alice, 2);
        _buy(bob, 1);

        _runToSettled(rid);

        (, , , , , , address winner, , , , uint256 yieldMON, , ) = pool.getRoundInfo(rid);
        assertTrue(yieldMON > 0, "expected positive yield");

        address loser = (winner == alice) ? bob : alice;

        vm.prank(loser);
        vm.expectRevert(TicketPrizePoolShmonShMonad.NotWinner.selector);
        pool.claimPrize(rid);

        uint256 w0 = winner.balance;
        vm.prank(winner);
        pool.claimPrize(rid);
        uint256 w1 = winner.balance;

        assertEq(w1 - w0, yieldMON, "winner did not receive yield");
    }

    function test_B11_doubleClaim_reverts() public {
        _deploy(10000, 0.25 ether);

        uint256 rid = 1;
        _buy(alice, 2);
        _buy(bob, 1);

        _runToSettled(rid);

        (, , , , , , address winner, , , , , , bool prizeClaimedBefore) = pool.getRoundInfo(rid);
        assertTrue(!prizeClaimedBefore, "expected not claimed");

        vm.prank(winner);
        pool.claimPrize(rid);

        vm.prank(winner);
        vm.expectRevert(TicketPrizePoolShmonShMonad.PrizeAlreadyClaimed.selector);
        pool.claimPrize(rid);
    }

    function test_B12_zeroYield_claimSucceeds_marksClaimed_noTransfer() public {
        _deploy(10000, 0);

        uint256 rid = 1;
        _buy(alice, 2);
        _buy(bob, 1);

        _runToSettled(rid);

        (, , , , , , address winner, , , , uint256 yieldMON, , bool prizeClaimed) = pool.getRoundInfo(rid);
        assertEq(yieldMON, 0, "expected zero yield");
        assertTrue(!prizeClaimed, "expected not claimed");

        uint256 w0 = winner.balance;
        vm.prank(winner);
        pool.claimPrize(rid);
        uint256 w1 = winner.balance;

        assertEq(w1, w0, "winner balance should not change when yield is zero");

        (, , , , , , , , , , , , bool prizeClaimedAfter) = pool.getRoundInfo(rid);
        assertTrue(prizeClaimedAfter, "expected claimed=true");
    }

    function test_B14_winningTicket_mapsToWinner() public {
        _deploy(10000, 0.1 ether);

        uint256 rid = 1;
        _buy(alice, 3);
        _buy(bob, 2);

        _runToSettled(rid);

        (, , uint32 totalTickets, , , , address winner, uint32 winningTicket, , , , , ) = pool.getRoundInfo(rid);
        assertTrue(totalTickets > 0, "expected tickets");
        assertTrue(winner != address(0), "expected winner");

        address owner = pool.ownerOfTicket(rid, winningTicket);
        assertEq(owner, winner, "ownerOfTicket mismatch");
    }
}
