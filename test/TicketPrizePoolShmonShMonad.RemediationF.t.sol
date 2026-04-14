// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {TicketPrizePoolShmonShMonad, IShMonad} from "../src/TicketPrizePoolShmonShMonad.sol";

contract RemediationShMonad is IShMonad {
    uint64 public nextEpoch = 1;
    uint256 public pendingShares;
    bool public ready = true;

    function setReady(bool v) external {
        ready = v;
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
        require(ready, "not ready");
        uint256 shares = pendingShares;
        pendingShares = 0;
        (bool ok,) = msg.sender.call{value: shares}("");
        require(ok, "pay failed");
    }

    receive() external payable {}
}

contract TicketPrizePoolShmonShMonad_RemediationF_Test is Test {
    TicketPrizePoolShmonShMonad pool;
    RemediationShMonad shmon;

    address keeper = address(0x1111);
    address alice = address(0xA11cE);
    address bob = address(0xB0b);
    address outsider = address(0xCAFE);

    uint96 constant TICKET_PRICE = 0.01 ether;
    uint32 constant COMMIT_DELAY = 5;
    uint32 constant ROUND_DUR = 90;

    function setUp() public {
        shmon = new RemediationShMonad();
        pool = new TicketPrizePoolShmonShMonad(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(shmon));
        pool.setKeeper(keeper, true);

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(outsider, 100 ether);
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

    function _commitAsKeeper(uint256 rid) internal {
        vm.prank(keeper);
        pool.executeNext(rid);
    }

    function _drawAsKeeper(uint256 rid) internal {
        vm.prank(keeper);
        pool.drawWinner(rid);
    }

    function test_F01_drawWinner_rejectsNonKeeper() public {
        _buy(alice, 1);
        _warpPastSalesEnd();
        pool.commitDraw(1);

        uint256 target = _targetBlock(1);
        vm.roll(target + 1);

        vm.prank(outsider);
        vm.expectRevert(TicketPrizePoolShmonShMonad.NotKeeper.selector);
        pool.drawWinner(1);
    }

    function test_F02_recommit_rejectsNonKeeper() public {
        _buy(alice, 1);
        _warpPastSalesEnd();
        pool.commitDraw(1);

        uint256 target = _targetBlock(1);
        vm.roll(target + 256);

        vm.prank(outsider);
        vm.expectRevert(TicketPrizePoolShmonShMonad.NotKeeper.selector);
        pool.recommit(1);
    }

    function test_F03_executeNext_rejectsNonKeeper() public {
        _buy(alice, 1);
        _warpPastSalesEnd();

        vm.prank(outsider);
        vm.expectRevert(TicketPrizePoolShmonShMonad.NotKeeper.selector);
        pool.executeNext();
    }

    function test_F04_recommit_revertsAtFourthAttempt() public {
        _buy(alice, 1);
        _warpPastSalesEnd();
        pool.commitDraw(1);

        for (uint256 i = 0; i < 3; i++) {
            uint256 target = _targetBlock(1);
            vm.roll(target + 256);
            vm.prank(keeper);
            pool.recommit(1);
        }

        uint256 target4 = _targetBlock(1);
        vm.roll(target4 + 256);
        vm.prank(keeper);
        vm.expectRevert(TicketPrizePoolShmonShMonad.RecommitLimitReached.selector);
        pool.recommit(1);
    }

    function test_F05_settleRound_transientFailure_roundStaysFinalizing() public {
        _buy(alice, 2);
        _warpPastSalesEnd();
        pool.commitDraw(1);

        uint256 target = _targetBlock(1);
        vm.roll(target + 1);
        vm.prank(keeper);
        pool.drawWinner(1);

        shmon.setReady(false);
        pool.settleRound(1);

        assertEq(uint8(pool.getRoundState(1)), uint8(TicketPrizePoolShmonShMonad.RoundState.Finalizing));
        assertEq(pool.getActiveFinalizer(), 1);
    }

    function test_F06_settleRound_retry_afterTransientFailure_succeeds() public {
        _buy(alice, 2);
        _warpPastSalesEnd();
        pool.commitDraw(1);

        uint256 target = _targetBlock(1);
        vm.roll(target + 1);
        vm.prank(keeper);
        pool.drawWinner(1);

        shmon.setReady(false);
        pool.settleRound(1);

        shmon.setReady(true);
        pool.settleRound(1);

        assertEq(uint8(pool.getRoundState(1)), uint8(TicketPrizePoolShmonShMonad.RoundState.Settled));
        assertEq(pool.getActiveFinalizer(), 0);
    }

    function test_F07_emergencyForceSettle_brokenShmon_setsSafeAccounting() public {
        _buy(alice, 2);
        _buy(bob, 3);

        _warpPastSalesEnd();
        pool.commitDraw(1);

        uint256 target = _targetBlock(1);
        vm.roll(target + 1);
        vm.prank(keeper);
        pool.drawWinner(1);

        shmon.setReady(false);
        vm.warp(block.timestamp + 14 days + 1);
        pool.emergencyForceSettle(1);

        (, , , , , , , , , uint256 monReceived, uint256 yieldMON, uint256 lossRatio, ) = pool.getRoundInfo(1);
        assertEq(monReceived, 0);
        assertEq(yieldMON, 0);
        assertEq(lossRatio, 1e18);
        assertEq(uint8(pool.getRoundState(1)), uint8(TicketPrizePoolShmonShMonad.RoundState.Settled));
        assertEq(pool.getActiveFinalizer(), 0);
    }

    function test_F08_recoverStrandedShares_and_claimRecovery_beforeWithdraw() public {
        _buy(alice, 2);
        _buy(bob, 3);

        _warpPastSalesEnd();
        pool.commitDraw(1);

        uint256 target = _targetBlock(1);
        vm.roll(target + 1);
        vm.prank(keeper);
        pool.drawWinner(1);

        shmon.setReady(false);
        vm.warp(block.timestamp + 14 days + 1);
        pool.emergencyForceSettle(1);

        shmon.setReady(true);
        pool.recoverStrandedShares(1);

        uint256 a0 = alice.balance;
        vm.prank(alice);
        pool.claimRecovery(1);
        uint256 a1 = alice.balance;
        assertTrue(a1 > a0, "alice should receive recovery");

        vm.prank(alice);
        vm.expectRevert(TicketPrizePoolShmonShMonad.AlreadyClaimedRecovery.selector);
        pool.withdrawPrincipal(1);
    }
}
