// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {TicketPrizePoolShmonShMonad, IShMonad} from "../src/TicketPrizePoolShmonShMonad.sol";

contract YieldPeriodShMonad is IShMonad {
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

contract TicketPrizePoolShmonShMonad_YieldPeriod_Test is Test {
    TicketPrizePoolShmonShMonad pool;
    YieldPeriodShMonad shmon;

    address alice = address(0xA11cE);
    address randomUser = address(0xBEEF);

    uint96 constant PRICE = 0.01 ether;
    uint32 constant COMMIT_DELAY = 5;
    uint32 constant DEPOSIT_DUR = 90;
    uint32 constant YIELD_DUR = 3600;

    function setUp() public {
        shmon = new YieldPeriodShMonad();
        pool = new TicketPrizePoolShmonShMonad(PRICE, COMMIT_DELAY, DEPOSIT_DUR, YIELD_DUR, address(shmon));
        vm.deal(alice, 100 ether);
        vm.deal(randomUser, 100 ether);
    }

    function _buy() internal {
        vm.prank(alice);
        pool.buyTickets{value: PRICE}(1);
    }

    function _targetBlock(uint256 rid) internal view returns (uint256) {
        (, , , , , uint256 targetBlockNumber, , , , , , , ) = pool.getRoundInfo(rid);
        return targetBlockNumber;
    }

    function test_commitBlocked_duringYieldPeriod() public {
        _buy();
        vm.warp(block.timestamp + DEPOSIT_DUR + 1);

        (uint256 rid, TicketPrizePoolShmonShMonad.NextAction action) = pool.executeNext();
        assertEq(rid, 1);
        assertEq(uint8(action), uint8(TicketPrizePoolShmonShMonad.NextAction.None));
        assertEq(uint8(pool.nextAction(1)), uint8(TicketPrizePoolShmonShMonad.NextAction.None));
    }

    function test_commitAllowed_afterYieldPeriod() public {
        _buy();
        vm.warp(block.timestamp + DEPOSIT_DUR + YIELD_DUR + 1);

        (uint256 rid, TicketPrizePoolShmonShMonad.NextAction action) = pool.executeNext();
        assertEq(rid, 1);
        assertEq(uint8(action), uint8(TicketPrizePoolShmonShMonad.NextAction.Commit));
    }

    function test_skipNotBlocked_byYieldPeriod() public {
        vm.warp(block.timestamp + DEPOSIT_DUR + 1);

        (uint256 rid, TicketPrizePoolShmonShMonad.NextAction action) = pool.executeNext();
        assertEq(rid, 1);
        assertEq(uint8(action), uint8(TicketPrizePoolShmonShMonad.NextAction.Skip));
    }

    function test_legacyCommitDraw_blocked_duringYield() public {
        _buy();
        vm.warp(block.timestamp + DEPOSIT_DUR + 1);

        vm.expectRevert(pool.legacyBytes("yield not complete"));
        pool.commitDraw(1);
    }

    function test_executeNext_permissionless() public {
        _buy();
        vm.warp(block.timestamp + DEPOSIT_DUR + YIELD_DUR + 1);

        vm.prank(randomUser);
        (uint256 rid, TicketPrizePoolShmonShMonad.NextAction action) = pool.executeNext();
        assertEq(rid, 1);
        assertEq(uint8(action), uint8(TicketPrizePoolShmonShMonad.NextAction.Commit));
    }

    function test_drawWinner_permissionless() public {
        _buy();
        vm.warp(block.timestamp + DEPOSIT_DUR + YIELD_DUR + 1);
        pool.executeNext();

        uint256 target = _targetBlock(1);
        vm.roll(target + 1);

        vm.prank(randomUser);
        pool.drawWinner(1);

        assertEq(uint8(pool.getRoundState(1)), uint8(TicketPrizePoolShmonShMonad.RoundState.Finalizing));
    }

    function test_yieldPeriodZero_behavesLikeV1() public {
        TicketPrizePoolShmonShMonad zeroYieldPool = new TicketPrizePoolShmonShMonad(PRICE, COMMIT_DELAY, DEPOSIT_DUR, 0, address(shmon));

        vm.prank(alice);
        zeroYieldPool.buyTickets{value: PRICE}(1);

        vm.warp(block.timestamp + DEPOSIT_DUR + 1);
        (, TicketPrizePoolShmonShMonad.NextAction action) = zeroYieldPool.executeNext();
        assertEq(uint8(action), uint8(TicketPrizePoolShmonShMonad.NextAction.Commit));
    }

    function test_getCommitAfterTime() public view {
        uint64 commitAfter = pool.getCommitAfterTime(1);
        (, uint64 salesEndTime, , , , , , , , , , , ) = pool.getRoundInfo(1);
        assertEq(commitAfter, uint64(uint256(salesEndTime) + uint256(YIELD_DUR)));
    }
}
