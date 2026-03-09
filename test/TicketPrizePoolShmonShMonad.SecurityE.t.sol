// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {TicketPrizePoolShmonShMonad, IShMonad} from "../src/TicketPrizePoolShmonShMonad.sol";

contract SecurityShMonad is IShMonad {
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
        pendingShares = 0;

        uint256 paidPrincipal = (shares * uint256(payoutBps)) / 10000;
        uint256 amount = paidPrincipal + bonusWei;

        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "mock transfer failed");
    }

    receive() external payable {}
}

contract ReenterWinnerShMonad {
    TicketPrizePoolShmonShMonad public pool;
    uint256 public rid;

    bool public tryReenterClaim;
    bool public tryReenterWithdraw;

    bool public reenterClaimAttempted;
    bool public reenterWithdrawAttempted;

    bool public reenterClaimOk;
    bool public reenterWithdrawOk;

    constructor(address payable _pool, uint256 _rid) {
        pool = TicketPrizePoolShmonShMonad(_pool);
        rid = _rid;
    }

    function buy(uint32 n) external payable {
        pool.buyTickets{value: msg.value}(n);
    }

    function setAttack(bool _claim, bool _withdraw) external {
        tryReenterClaim = _claim;
        tryReenterWithdraw = _withdraw;
    }

    function attackClaim() external {
        pool.claimPrize(rid);
    }

    function attackWithdraw() external {
        pool.withdrawPrincipal(rid);
    }

    receive() external payable {
        if (tryReenterClaim && !reenterClaimAttempted) {
            reenterClaimAttempted = true;
            (bool ok,) = address(pool).call(abi.encodeWithSignature("claimPrize(uint256)", rid));
            reenterClaimOk = ok;
        }

        if (tryReenterWithdraw && !reenterWithdrawAttempted) {
            reenterWithdrawAttempted = true;
            (bool ok,) = address(pool).call(abi.encodeWithSignature("withdrawPrincipal(uint256)", rid));
            reenterWithdrawOk = ok;
        }
    }
}

contract TicketPrizePoolShmonShMonad_SecurityE_Test is Test {
    TicketPrizePoolShmonShMonad pool;
    SecurityShMonad shmon;

    uint96 constant TICKET_PRICE = 0.01 ether;
    uint32 constant COMMIT_DELAY = 5;
    uint32 constant ROUND_DUR = 90;

    uint256 constant RID = 1;

    function _deploy(uint16 payoutBps, uint256 bonusWei) internal {
        shmon = new SecurityShMonad(payoutBps, bonusWei);
        pool = new TicketPrizePoolShmonShMonad(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(shmon));

        if (bonusWei > 0) vm.deal(address(shmon), bonusWei);
    }

    function _warpPastSalesEnd() internal {
        vm.warp(block.timestamp + ROUND_DUR + 1);
    }

    function _targetBlock(uint256 rid) internal view returns (uint256) {
        (, , , , , uint256 targetBlockNumber, , , , , , , ) = pool.getRoundInfo(rid);
        return targetBlockNumber;
    }

    function _fullRoundToSettled() internal {
        _warpPastSalesEnd();
        pool.commitDraw(RID);

        uint256 target = _targetBlock(RID);
        vm.roll(target + 1);

        pool.drawWinner(RID);
        pool.settleRound(RID);

        assertEq(uint8(pool.getRoundState(RID)), uint8(TicketPrizePoolShmonShMonad.RoundState.Settled), "not settled");
    }

    function test_E23_reentrancy_claimPrize_cannotDoubleClaim() public {
        uint256 bonus = 0.5 ether;
        _deploy(10000, bonus);

        ReenterWinnerShMonad attacker = new ReenterWinnerShMonad(payable(address(pool)), RID);
        vm.deal(address(attacker), 10 ether);

        attacker.setAttack(true, false);

        vm.prank(address(attacker));
        attacker.buy{value: uint256(TICKET_PRICE) * 3}(3);

        _fullRoundToSettled();

        (, , , , , , address winner, , , , uint256 yieldMON, , ) = pool.getRoundInfo(RID);
        assertEq(winner, address(attacker), "attacker not winner");
        assertTrue(yieldMON > 0, "expected yield > 0");

        uint256 w0 = address(attacker).balance;

        vm.prank(address(attacker));
        attacker.attackClaim();

        uint256 w1 = address(attacker).balance;
        assertEq(w1, w0 + yieldMON, "attacker did not receive exactly 1x yield");
        assertEq(attacker.reenterClaimAttempted(), true, "reenter claim not attempted");
        assertEq(attacker.reenterClaimOk(), false, "reenter claim unexpectedly succeeded");

        vm.prank(address(attacker));
        vm.expectRevert(TicketPrizePoolShmonShMonad.PrizeAlreadyClaimed.selector);
        pool.claimPrize(RID);
    }

    function test_E23_reentrancy_withdrawPrincipal_cannotWithdrawTwice() public {
        _deploy(10000, 0);

        ReenterWinnerShMonad attacker = new ReenterWinnerShMonad(payable(address(pool)), RID);
        vm.deal(address(attacker), 10 ether);

        attacker.setAttack(false, true);

        vm.prank(address(attacker));
        attacker.buy{value: uint256(TICKET_PRICE) * 4}(4);

        _fullRoundToSettled();

        uint256 principal = pool.principalMON(RID, address(attacker));
        assertEq(principal, uint256(TICKET_PRICE) * 4, "principal wrong");

        uint256 b0 = address(attacker).balance;

        vm.prank(address(attacker));
        attacker.attackWithdraw();

        uint256 b1 = address(attacker).balance;
        assertEq(b1, b0 + principal, "attacker did not receive exact principal");
        assertEq(attacker.reenterWithdrawAttempted(), true, "reenter withdraw not attempted");
        assertEq(attacker.reenterWithdrawOk(), false, "reenter withdraw unexpectedly succeeded");

        vm.prank(address(attacker));
        vm.expectRevert(TicketPrizePoolShmonShMonad.NothingToWithdraw.selector);
        pool.withdrawPrincipal(RID);
    }

    function test_E24_grief_spamTinyBuys_stillSettles() public {
        _deploy(10000, 0);

        uint256 numBuys = 200;

        for (uint256 i = 0; i < numBuys; i++) {
            address u = address(uint160(0x3000 + i));
            vm.deal(u, 1 ether);
            vm.prank(u);
            pool.buyTickets{value: TICKET_PRICE}(1);
        }

        assertEq(pool.rangesLength(RID), numBuys, "unexpected merging; check buyer rotation");

        _fullRoundToSettled();

        address sample = address(uint160(0x3000 + 42));
        uint256 p = pool.principalMON(RID, sample);
        assertEq(p, uint256(TICKET_PRICE), "sample principal wrong");

        uint256 s0 = sample.balance;
        vm.prank(sample);
        pool.withdrawPrincipal(RID);
        uint256 s1 = sample.balance;

        assertEq(s1, s0 + p, "sample withdraw failed after spam scenario");
    }

    function test_E25_largeRanges_drawAndSettle_succeeds() public {
        _deploy(10000, 0);

        uint256 numBuys = 600;

        for (uint256 i = 0; i < numBuys; i++) {
            address u = address(uint160(0x5000 + i));
            vm.deal(u, 1 ether);
            vm.prank(u);
            pool.buyTickets{value: TICKET_PRICE}(1);
        }

        assertEq(pool.rangesLength(RID), numBuys, "ranges not as expected");

        _fullRoundToSettled();

        (, , uint32 totalTickets, , , , address winner, uint32 winningTicket, , , , , ) = pool.getRoundInfo(RID);
        assertEq(totalTickets, uint32(numBuys), "totalTickets mismatch");
        assertTrue(winner != address(0), "winner is zero");
        assertTrue(winningTicket < totalTickets, "winningTicket OOB");

        address owner = pool.ownerOfTicket(RID, winningTicket);
        assertEq(owner, winner, "winner/owner mismatch under large ranges");
    }
}
