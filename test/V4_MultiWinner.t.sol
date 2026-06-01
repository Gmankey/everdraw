// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {V4TestBase} from "./V4TestBase.t.sol";

contract V4_MultiWinner_Test is V4TestBase {
    function setUp() public {
        _deployNative(2, _twoWinnerAlloc());
    }

    function test_two_winners_are_recorded() public {
        _buyNative(alice, 1);
        _buyNative(bob, 1);
        yieldVault.setRate(2e18);
        _settleWithRandom(bytes32(uint256(123)));
        (address[] memory winners, uint32[] memory tickets, uint256[] memory prizes) = pool.getRoundWinners(1);
        assertEq(winners.length, 2);
        assertEq(tickets.length, 2);
        assertEq(prizes.length, 2);
        assertTrue(winners[0] != winners[1]);
    }

    function test_effective_winners_less_than_config_sets_forfeit() public {
        _buyNative(alice, 1);
        yieldVault.setRate(2e18);
        _settleWithRandom(bytes32(uint256(1)));
        (,,,,,,,, uint16 forfeitBps,) = pool.getRoundInfo(1);
        assertEq(forfeitBps, 3000);
    }
}
