// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {V4TestBase} from "./V4TestBase.t.sol";

contract V4_PauseRoleSeparation_Test is V4TestBase {
    function setUp() public {
        _deployNative(1, _oneWinnerAlloc());
    }

    function test_owner_can_set_pauser() public {
        pool.setPauser(alice);
        assertEq(pool.pauser(), alice);
    }

    function test_pauser_can_pause() public {
        pool.setPauser(alice);
        vm.prank(alice);
        pool.pause();
        assertTrue(pool.paused());
    }

    function test_non_pauser_cannot_pause() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.pause();
    }
}
