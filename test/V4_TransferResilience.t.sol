// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {V4TestBase} from "./V4TestBase.t.sol";

contract V4_TransferResilience_Test is V4TestBase {
    function setUp() public {
        _deployNative(1, _oneWinnerAlloc());
    }

    function test_withdraw_defers_when_yield_vault_transfer_fails() public {
        _buyNative(alice, 1);
        _settleWithRandom(bytes32(uint256(1)));
        yieldVault.setTransfersPaused(true);
        vm.prank(alice);
        pool.withdrawPrincipal(1);
        assertGt(pool.pendingClaims(1, alice, 0xff), 0);
    }

    function test_deferred_retry_succeeds_after_unpause() public {
        _buyNative(alice, 1);
        _settleWithRandom(bytes32(uint256(1)));
        yieldVault.setTransfersPaused(true);
        vm.prank(alice);
        pool.withdrawPrincipal(1);
        yieldVault.setTransfersPaused(false);
        vm.prank(alice);
        pool.claimDeferred(1, 0xff);
        assertEq(pool.pendingClaims(1, alice, 0xff), 0);
    }
}
