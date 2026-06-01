// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {V4TestBase} from "./V4TestBase.t.sol";
import {TicketPrizePoolV4} from "../src/TicketPrizePoolV4.sol";

contract V4_OracleAbstraction_Test is V4TestBase {
    function setUp() public {
        _deployNative(1, _oneWinnerAlloc());
    }

    function test_request_callback_finalize_flow() public {
        _buyNative(alice, 1);
        vm.warp(block.timestamp + ROUND_SEC + YIELD_SEC + 1);
        pool.executeNext(1);
        assertEq(uint8(pool.getRoundState(1)), uint8(TicketPrizePoolV4.RoundState.AwaitingVRF));
        oracle.fulfill(1, bytes32(uint256(7)));
        assertEq(uint8(pool.getRoundState(1)), uint8(TicketPrizePoolV4.RoundState.Drawn));
        pool.executeNext(1);
        assertEq(uint8(pool.getRoundState(1)), uint8(TicketPrizePoolV4.RoundState.Settled));
    }
}
