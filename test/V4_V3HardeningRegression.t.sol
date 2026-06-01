// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {V4TestBase} from "./V4TestBase.t.sol";
import {MockRandomnessOracle} from "./mocks/MockRandomnessOracle.sol";

contract V4_V3HardeningRegression_Test is V4TestBase {
    function setUp() public {
        _deployNative(1, _oneWinnerAlloc());
    }

    function test_two_step_ownership() public {
        pool.transferOwnership(alice);
        assertEq(pool.owner(), address(this));
        vm.prank(alice);
        pool.acceptOwnership();
        assertEq(pool.owner(), alice);
    }

    function test_oracle_change_timelock() public {
        MockRandomnessOracle newOracle = new MockRandomnessOracle();
        pool.queueOracleChange(address(newOracle));
        vm.expectRevert();
        pool.commitOracleChange();
        vm.warp(block.timestamp + pool.ORACLE_CHANGE_DELAY());
        pool.commitOracleChange();
        assertEq(address(pool.randomnessOracle()), address(newOracle));
    }

    function test_VERSION_is_v4() public {
        assertEq(pool.VERSION(), "4.0.0");
    }
}
