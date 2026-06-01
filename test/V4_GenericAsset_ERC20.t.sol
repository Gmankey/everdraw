// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {V4TestBase} from "./V4TestBase.t.sol";

contract V4_GenericAsset_ERC20_Test is V4TestBase {
    function setUp() public {
        _deployERC20(1, _oneWinnerAlloc());
    }

    function test_erc20_deposit_updates_merkl_surface() public {
        _buyERC20(alice, 5);
        assertEq(pool.balanceOf(alice), 5_000_000);
        assertEq(pool.totalSupply(), 5_000_000);
    }

    function test_fee_on_transfer_token_reverts() public {
        asset.setFeeBps(100);
        asset.mint(alice, 1_000_000);
        vm.startPrank(alice);
        asset.approve(address(pool), 1_000_000);
        vm.expectRevert();
        pool.buyTickets(1);
        vm.stopPrank();
    }
}
