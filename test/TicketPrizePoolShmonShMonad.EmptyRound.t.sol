// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {TicketPrizePoolShmonShMonad, IShMonad} from "../src/TicketPrizePoolShmonShMonad.sol";

/// @dev Minimal ShMonad mock. Only deposit is used in this suite.
contract MockShMonad is IShMonad {
    function deposit(uint256 assets, address /*receiver*/)
        external
        payable
        returns (uint256 shares)
    {
        require(msg.value == assets, "bad value");
        return assets; // 1:1 shares
    }

    function requestUnstake(uint256 /*shares*/) external pure returns (uint64 completionEpoch) {
        return 0;
    }

    function completeUnstake() external pure {
        // no-op
    }
}

contract TicketPrizePoolShmonShMonad_EmptyRound_Test is Test {
    TicketPrizePoolShmonShMonad pool;
    MockShMonad shmon;

    address user = address(0xBEEF);

    uint96 constant PRICE = 0.01 ether;
    uint32 constant COMMIT_DELAY = 5;
    uint32 constant ROUND_SEC = 90;

    function setUp() public {
        shmon = new MockShMonad();
        pool = new TicketPrizePoolShmonShMonad(PRICE, COMMIT_DELAY, ROUND_SEC, address(shmon));
        vm.deal(user, 10 ether);
    }

    function _warpPastSalesEnd(uint256 rid) internal {
        // getRoundInfo returns 13 values in your suite now
        (, uint64 salesEndTime, , , , , , , , , , , ) = pool.getRoundInfo(rid);
        vm.warp(uint256(salesEndTime) + 1);
    }

    /// ---------------------------------------
    /// Empty round: commitDraw must revert
    /// ---------------------------------------
    function test_commitDraw_emptyRound_reverts_noTickets() public {
        uint256 rid = 1;
        _warpPastSalesEnd(rid);

        vm.expectRevert(pool.legacyBytes("no tickets"));
        pool.commitDraw(rid);
    }

    /// ---------------------------------------
    /// Empty round: skipRound advances to next
    /// ---------------------------------------
    function test_skipRound_emptyRound_advances_to_next_round() public {
        uint256 rid = 1;
        _warpPastSalesEnd(rid);

        pool.skipRound(rid);

        assertEq(pool.currentRoundId(), 2, "did not advance currentRoundId");

        assertEq(
            uint8(pool.getRoundState(2)),
            uint8(TicketPrizePoolShmonShMonad.RoundState.Open),
            "round2 not Open"
        );

        assertEq(
            uint8(pool.getRoundState(1)),
            uint8(TicketPrizePoolShmonShMonad.RoundState.Settled),
            "round1 not Settled"
        );

        (, uint64 salesEndTime2, , , , , , , , , , , ) = pool.getRoundInfo(2);
        assertTrue(uint256(salesEndTime2) > block.timestamp, "round2 salesEndTime not in future");
    }

    /// ---------------------------------------
    /// skipRound guardrail: sales must be ended
    /// ---------------------------------------
    function test_skipRound_reverts_if_sales_not_ended() public {
        uint256 rid = 1;

        vm.expectRevert(pool.legacyBytes("sales not ended"));
        pool.skipRound(rid);
    }

    /// ---------------------------------------
    /// skipRound guardrail: cannot skip if tickets exist
    /// ---------------------------------------
    function test_skipRound_reverts_if_round_has_tickets() public {
        uint256 rid = 1;

        vm.prank(user);
        pool.buyTickets{value: PRICE}(1);

        _warpPastSalesEnd(rid);

        vm.expectRevert(pool.legacyBytes("has tickets"));
        pool.skipRound(rid);
    }

    function test_nextExecutable_noneInitially() public {
        (uint256 execRid, TicketPrizePoolShmonShMonad.NextAction a) = pool.nextExecutable();
        execRid; // silence unused warning

        assertEq(uint8(a), uint8(TicketPrizePoolShmonShMonad.NextAction.None));
    }
}
