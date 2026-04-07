// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {TicketPrizePoolShmonShMonad, IShMonad} from "../src/TicketPrizePoolShmonShMonad.sol";

contract ExecuteShMonad is IShMonad {
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

contract TicketPrizePoolShmonShMonad_ExecuteNext_Test is Test {
    TicketPrizePoolShmonShMonad pool;
    ExecuteShMonad shmon;

    address alice = address(0xA11cE);

    uint96 constant TICKET_PRICE = 0.01 ether;
    uint32 constant COMMIT_DELAY = 5;
    uint32 constant ROUND_DUR = 90;

    function setUp() public {
        shmon = new ExecuteShMonad();
        pool = new TicketPrizePoolShmonShMonad(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(shmon));
        vm.deal(alice, 100 ether);
    }

    function _buyOneRound() internal {
        vm.prank(alice);
        pool.buyTickets{value: TICKET_PRICE}(1);
    }

    function _targetBlock(uint256 rid) internal view returns (uint256) {
        (, , , , , uint256 targetBlockNumber, , , , , , , ) = pool.getRoundInfo(rid);
        return targetBlockNumber;
    }

    function test_executeNext_fullLifecycle_commit_draw_settle() public {
        _buyOneRound();

        vm.warp(block.timestamp + ROUND_DUR + 1);

        (uint256 rid1, TicketPrizePoolShmonShMonad.NextAction a1) = pool.executeNext();
        assertEq(rid1, 1);
        assertEq(uint8(a1), uint8(TicketPrizePoolShmonShMonad.NextAction.Commit));

        uint256 target = _targetBlock(1);
        vm.roll(target + 1);

        (uint256 rid2, TicketPrizePoolShmonShMonad.NextAction a2) = pool.executeNext();
        assertEq(rid2, 1);
        assertEq(uint8(a2), uint8(TicketPrizePoolShmonShMonad.NextAction.Draw));

        (uint256 rid3, TicketPrizePoolShmonShMonad.NextAction a3) = pool.executeNext();
        assertEq(rid3, 1);
        assertEq(uint8(a3), uint8(TicketPrizePoolShmonShMonad.NextAction.Settle));

        assertEq(uint8(pool.getRoundState(1)), uint8(TicketPrizePoolShmonShMonad.RoundState.Settled));
    }

    function test_executeNext_recommit_after_blockhash_expiry() public {
        _buyOneRound();

        vm.warp(block.timestamp + ROUND_DUR + 1);
        pool.executeNext(); // commit

        uint256 oldTarget = _targetBlock(1);
        vm.roll(oldTarget + 256);

        TicketPrizePoolShmonShMonad.NextAction a = pool.executeNext(1);
        assertEq(uint8(a), uint8(TicketPrizePoolShmonShMonad.NextAction.Recommit));

        uint256 newTarget = _targetBlock(1);
        assertTrue(newTarget > oldTarget, "target not updated");
    }

    function test_emergencyForceSettle_after_timeout() public {
        _buyOneRound();

        vm.warp(block.timestamp + ROUND_DUR + 1);
        pool.executeNext(); // commit

        uint256 target = _targetBlock(1);
        vm.roll(target + 1);
        pool.executeNext(); // draw

        shmon.setReady(false);

        vm.warp(block.timestamp + 14 days + 1);
        pool.emergencyForceSettle(1);

        (
            TicketPrizePoolShmonShMonad.RoundState state,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint256 monReceived,
            uint256 yieldMON,
            uint256 lossRatio,
            
        ) = pool.getRoundInfo(1);

        assertEq(uint8(state), uint8(TicketPrizePoolShmonShMonad.RoundState.Settled));
        assertEq(monReceived, 0);
        assertEq(yieldMON, 0);
        assertEq(lossRatio, 0);
        assertEq(pool.getActiveFinalizer(), 0);
    }
}
