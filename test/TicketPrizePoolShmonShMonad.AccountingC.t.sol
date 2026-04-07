// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {TicketPrizePoolShmonShMonad, IShMonad} from "../src/TicketPrizePoolShmonShMonad.sol";

contract AccountingShMonad is IShMonad {
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
        return assets;
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

contract TicketPrizePoolShmonShMonad_AccountingC_Test is Test {
    TicketPrizePoolShmonShMonad pool;
    AccountingShMonad shmon;

    address alice = address(0xA11cE);
    address bob = address(0xB0b);

    uint96 constant TICKET_PRICE = 0.01 ether;
    uint32 constant COMMIT_DELAY = 5;
    uint32 constant ROUND_DUR = 90;

    function _deploy(uint16 payoutBps, uint256 bonusWei) internal {
        shmon = new AccountingShMonad(payoutBps, bonusWei);
        pool = new TicketPrizePoolShmonShMonad(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(shmon));

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        if (bonusWei > 0) {
            vm.deal(address(shmon), bonusWei);
        }
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

    function _settleRound1() internal returns (uint256 rid) {
        rid = 1;

        _warpPastSalesEnd();
        pool.commitDraw(rid);

        uint256 target = _targetBlock(rid);
        vm.roll(target + 1);

        pool.drawWinner(rid);
        pool.settleRound(rid);

        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmonShMonad.RoundState.Settled), "not settled");
    }

    function test_C15_withdrawBeforeSettled_reverts() public {
        _deploy(10000, 0);

        uint256 rid = 1;
        _buy(alice, 2);

        vm.prank(alice);
        vm.expectRevert(TicketPrizePoolShmonShMonad.BadState.selector);
        pool.withdrawPrincipal(rid);

        _warpPastSalesEnd();
        pool.commitDraw(rid);

        vm.prank(alice);
        vm.expectRevert(TicketPrizePoolShmonShMonad.BadState.selector);
        pool.withdrawPrincipal(rid);
    }

    function test_C16_refundExactPrincipal_noLoss() public {
        _deploy(10000, 0);

        _buy(alice, 2);
        _buy(bob, 1);

        uint256 rid = _settleRound1();

        (
            ,
            ,
            ,
            uint256 totalPrincipal,
            ,
            ,
            ,
            ,
            ,
            uint256 monReceived,
            uint256 yieldMON,
            uint256 lossRatio,
            
        ) = pool.getRoundInfo(rid);

        assertEq(monReceived, totalPrincipal, "monReceived should equal totalPrincipal");
        assertEq(yieldMON, 0, "yield should be 0");
        assertEq(lossRatio, 1e18, "lossRatio should be 1e18");

        uint256 alicePrincipal = pool.principalMON(rid, alice);
        assertEq(alicePrincipal, uint256(TICKET_PRICE) * 2, "alice principal wrong");

        uint256 a0 = alice.balance;
        vm.prank(alice);
        pool.withdrawPrincipal(rid);
        uint256 a1 = alice.balance;

        assertEq(a1, a0 + alicePrincipal, "alice refund not exact");
        assertEq(pool.principalMON(rid, alice), 0, "alice principal not zeroed");

        uint256 bobPrincipal = pool.principalMON(rid, bob);
        assertEq(bobPrincipal, uint256(TICKET_PRICE), "bob principal wrong");

        uint256 b0 = bob.balance;
        vm.prank(bob);
        pool.withdrawPrincipal(rid);
        uint256 b1 = bob.balance;

        assertEq(b1, b0 + bobPrincipal, "bob refund not exact");
        assertEq(pool.principalMON(rid, bob), 0, "bob principal not zeroed");
    }

    function test_C17_loss_1percent() public {
        _deploy(9900, 0);

        _buy(alice, 2);
        _buy(bob, 1);
        uint256 rid = _settleRound1();

        (
            ,
            ,
            ,
            uint256 totalPrincipal,
            ,
            ,
            ,
            ,
            ,
            uint256 monReceived,
            uint256 yieldMON,
            uint256 lossRatio,
            
        ) = pool.getRoundInfo(rid);

        assertEq(yieldMON, 0, "yield must be 0 on loss");
        uint256 expectedReceived = (totalPrincipal * 9900) / 10000;
        assertEq(monReceived, expectedReceived, "monReceived mismatch");

        uint256 expectedLossRatio = (expectedReceived * 1e18) / totalPrincipal;
        assertEq(lossRatio, expectedLossRatio, "lossRatio mismatch");

        uint256 alicePrincipal = pool.principalMON(rid, alice);
        uint256 expectedAlice = (alicePrincipal * lossRatio) / 1e18;

        uint256 a0 = alice.balance;
        vm.prank(alice);
        pool.withdrawPrincipal(rid);
        uint256 a1 = alice.balance;

        assertEq(a1, a0 + expectedAlice, "alice slashed refund wrong");
    }

    function test_C17_loss_50percent() public {
        _deploy(5000, 0);

        _buy(alice, 2);
        _buy(bob, 1);
        uint256 rid = _settleRound1();

        (
            ,
            ,
            ,
            uint256 totalPrincipal,
            ,
            ,
            ,
            ,
            ,
            uint256 monReceived,
            uint256 yieldMON,
            uint256 lossRatio,
            
        ) = pool.getRoundInfo(rid);

        assertEq(yieldMON, 0, "yield must be 0 on loss");
        uint256 expectedReceived = (totalPrincipal * 5000) / 10000;
        assertEq(monReceived, expectedReceived, "monReceived mismatch");

        uint256 expectedLossRatio = (expectedReceived * 1e18) / totalPrincipal;
        assertEq(lossRatio, expectedLossRatio, "lossRatio mismatch");

        uint256 bobPrincipal = pool.principalMON(rid, bob);
        uint256 expectedBob = (bobPrincipal * lossRatio) / 1e18;

        uint256 b0 = bob.balance;
        vm.prank(bob);
        pool.withdrawPrincipal(rid);
        uint256 b1 = bob.balance;

        assertEq(b1, b0 + expectedBob, "bob 50% refund wrong");
    }

    function test_C17_loss_nearTotal() public {
        _deploy(10, 0);

        _buy(alice, 2);
        _buy(bob, 1);
        uint256 rid = _settleRound1();

        (
            ,
            ,
            ,
            uint256 totalPrincipal,
            ,
            ,
            ,
            ,
            ,
            uint256 monReceived,
            uint256 yieldMON,
            uint256 lossRatio,
            
        ) = pool.getRoundInfo(rid);

        assertEq(yieldMON, 0, "yield must be 0 on loss");
        uint256 expectedReceived = (totalPrincipal * 10) / 10000;
        assertEq(monReceived, expectedReceived, "monReceived mismatch");

        uint256 expectedLossRatio = (expectedReceived * 1e18) / totalPrincipal;
        assertEq(lossRatio, expectedLossRatio, "lossRatio mismatch");

        uint256 alicePrincipal = pool.principalMON(rid, alice);
        uint256 expectedAlice = (alicePrincipal * lossRatio) / 1e18;

        uint256 a0 = alice.balance;
        vm.prank(alice);
        pool.withdrawPrincipal(rid);
        uint256 a1 = alice.balance;

        assertEq(a1, a0 + expectedAlice, "alice near-total refund wrong");
    }

    function test_C19_multipleBuys_principalAccumulates_refundMatches() public {
        _deploy(10000, 0);

        uint256 rid = 1;

        _buy(alice, 1);
        _buy(alice, 3);

        uint256 expectedPrincipal = uint256(TICKET_PRICE) * 4;
        assertEq(pool.principalMON(rid, alice), expectedPrincipal, "principal did not accumulate");

        _settleRound1();

        uint256 a0 = alice.balance;
        vm.prank(alice);
        pool.withdrawPrincipal(rid);
        uint256 a1 = alice.balance;

        assertEq(a1, a0 + expectedPrincipal, "refund not equal to total principal");
    }

    function test_claimPrize_doesNotReducePrincipalRefunds() public {
        uint256 bonus = 0.5 ether;
        _deploy(10000, bonus);

        _buy(alice, 2);
        _buy(bob, 1);

        uint256 rid = _settleRound1();

        (, , , , , , address winner, , , , uint256 yieldMON, uint256 lossRatio, ) = pool.getRoundInfo(rid);
        assertTrue(yieldMON > 0, "expected positive yield");
        assertEq(lossRatio, 1e18, "no loss expected");

        uint256 w0 = winner.balance;
        vm.prank(winner);
        pool.claimPrize(rid);
        uint256 w1 = winner.balance;
        assertEq(w1, w0 + yieldMON, "winner did not receive yield");

        uint256 alicePrincipal = pool.principalMON(rid, alice);
        uint256 bobPrincipal = pool.principalMON(rid, bob);

        uint256 a0 = alice.balance;
        vm.prank(alice);
        pool.withdrawPrincipal(rid);
        uint256 a1 = alice.balance;
        assertEq(a1, a0 + alicePrincipal, "alice principal affected by prize claim");

        uint256 b0 = bob.balance;
        vm.prank(bob);
        pool.withdrawPrincipal(rid);
        uint256 b1 = bob.balance;
        assertEq(b1, b0 + bobPrincipal, "bob principal affected by prize claim");
    }
}
