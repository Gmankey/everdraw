// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {TicketPrizePoolV4} from "../src/TicketPrizePoolV4.sol";
import {MockERC4626YieldVault} from "./mocks/MockERC4626YieldVault.sol";
import {MockRandomnessOracle} from "./mocks/MockRandomnessOracle.sol";
import {V4TestBase} from "./V4TestBase.t.sol";

contract V4_ShmonDeposit_Test is V4TestBase {
    address carol = makeAddr("carol");

    function setUp() public {
        _deployNative(1, _oneWinnerAlloc());
    }

    function _fundAndApproveShmon(address user, uint256 shares) internal {
        yieldVault.mintShares(user, shares);
        vm.prank(user);
        yieldVault.approve(address(pool), shares);
    }

    function _buyShmon(address user, uint32 tickets) internal returns (uint256 shares) {
        shares = yieldVault.previewDeposit(uint256(tickets) * PRICE);
        _fundAndApproveShmon(user, shares);
        vm.prank(user);
        pool.buyTicketsShmon(tickets);
    }

    function _deployNativeWinners(uint8 winners, uint16[] memory allocations) internal {
        yieldVault = new MockERC4626YieldVault(address(0));
        oracle = new MockRandomnessOracle();
        pool = new TicketPrizePoolV4(_cfg(TicketPrizePoolV4.DepositMode.Native, address(0), address(yieldVault), winners, allocations));
        vm.deal(address(pool), 10 ether);
    }

    function test_equivalence_shmon_and_mon_deposits_same_accounting() public {
        _buyNative(alice, 2);
        uint256 bobSharesIn = _buyShmon(bob, 2);

        (uint128 aliceAsset, uint128 aliceShares) = pool.getUserPosition(1, alice);
        (uint128 bobAsset, uint128 bobShares) = pool.getUserPosition(1, bob);
        (,,, uint32 totalTickets, uint256 totalPrincipalAsset, uint256 totalPrincipalShares,,,,) = pool.getRoundInfo(1);

        assertEq(aliceAsset, 2 ether);
        assertEq(bobAsset, 2 ether);
        assertEq(aliceShares, bobShares);
        assertEq(uint256(bobShares), bobSharesIn);
        assertEq(totalTickets, 4);
        assertEq(totalPrincipalAsset, 4 ether);
        assertEq(totalPrincipalShares, uint256(aliceShares) + uint256(bobShares));
        assertEq(pool.balanceOf(alice), 2 ether);
        assertEq(pool.balanceOf(bob), 2 ether);
    }

    function test_mixed_round_settles_and_both_paths_withdraw_correct_shmon() public {
        _buyNative(alice, 1);
        _buyShmon(bob, 1);
        yieldVault.setRate(2e18);

        _settleWithRandom(bytes32(uint256(123)));

        (address[] memory winners,, uint256[] memory prizes) = pool.getRoundWinners(1);
        assertEq(winners.length, 1);
        assertEq(prizes.length, 1);

        uint256 winnerBefore = yieldVault.balanceOf(winners[0]);
        vm.prank(winners[0]);
        pool.claimPrize(1);
        assertEq(yieldVault.balanceOf(winners[0]) - winnerBefore, prizes[0], "winner prize");

        uint256 aliceWithdrawable = pool.getWithdrawableShares(1, alice);
        uint256 bobWithdrawable = pool.getWithdrawableShares(1, bob);
        assertEq(aliceWithdrawable, 0.5 ether);
        assertEq(bobWithdrawable, 0.5 ether);

        uint256 aliceBefore = yieldVault.balanceOf(alice);
        vm.prank(alice);
        pool.withdrawPrincipal(1);
        assertEq(yieldVault.balanceOf(alice) - aliceBefore, aliceWithdrawable, "alice principal");

        uint256 bobBefore = yieldVault.balanceOf(bob);
        vm.prank(bob);
        pool.withdrawPrincipal(1);
        assertEq(yieldVault.balanceOf(bob) - bobBefore, bobWithdrawable, "bob principal");
    }

    function test_no_under_collection_at_preview_deposit_rate() public {
        uint256 monCost = 3 * PRICE;
        uint256 requiredShares = yieldVault.previewDeposit(monCost);

        assertGe(yieldVault.previewRedeem(requiredShares), monCost);

        _fundAndApproveShmon(alice, requiredShares);
        vm.prank(alice);
        pool.buyTicketsShmon(3);

        (uint128 principalAsset, uint128 principalShares) = pool.getUserPosition(1, alice);
        assertEq(principalAsset, monCost);
        assertEq(principalShares, requiredShares);
    }

    function test_reverts_for_shmon_deposit_guards() public {
        uint256 oneTicketShares = yieldVault.previewDeposit(PRICE);

        pool.pause();
        _fundAndApproveShmon(alice, oneTicketShares);
        vm.prank(alice);
        vm.expectRevert(bytes("paused"));
        pool.buyTicketsShmon(1);
        pool.unpause();

        vm.expectRevert(TicketPrizePoolV4.ZeroTickets.selector);
        pool.buyTicketsShmon(0);

        vm.warp(block.timestamp + ROUND_SEC + 1);
        _fundAndApproveShmon(bob, oneTicketShares);
        vm.prank(bob);
        vm.expectRevert(TicketPrizePoolV4.SalesEnded.selector);
        pool.buyTicketsShmon(1);

        _deployNative(1, _oneWinnerAlloc());
        _fundAndApproveShmon(alice, oneTicketShares);
        pool.stop();
        vm.prank(alice);
        vm.expectRevert(TicketPrizePoolV4.VaultIsStopped.selector);
        pool.buyTicketsShmon(1);

        _deployNative(1, _oneWinnerAlloc());
        yieldVault.mintShares(alice, oneTicketShares);
        vm.prank(alice);
        vm.expectRevert(TicketPrizePoolV4.BadAssetTransfer.selector);
        pool.buyTicketsShmon(1);

        vm.prank(bob);
        yieldVault.approve(address(pool), oneTicketShares);
        vm.prank(bob);
        vm.expectRevert(TicketPrizePoolV4.BadAssetTransfer.selector);
        pool.buyTicketsShmon(1);

        _deployERC20(1, _oneWinnerAlloc());
        vm.expectRevert(TicketPrizePoolV4.ShmonPathNativeOnly.selector);
        pool.buyTicketsShmon(1);
    }

    function test_getWithdrawableShares_matches_actual_normal_and_forfeit() public {
        _buyShmon(alice, 1);
        yieldVault.setRate(2e18);
        _settleWithRandom(bytes32(uint256(7)));

        uint256 normalWithdrawable = pool.getWithdrawableShares(1, alice);
        uint256 normalBefore = yieldVault.balanceOf(alice);
        vm.prank(alice);
        pool.withdrawPrincipal(1);
        assertEq(yieldVault.balanceOf(alice) - normalBefore, normalWithdrawable, "normal withdrawable");

        _deployNativeWinners(2, _twoWinnerAlloc());
        _buyShmon(carol, 1);
        yieldVault.setRate(2e18);
        _settleWithRandom(bytes32(uint256(9)));

        (,,,,,,,, uint16 forfeitBps,) = pool.getRoundInfo(1);
        assertEq(forfeitBps, 3000);

        uint256 forfeitWithdrawable = pool.getWithdrawableShares(1, carol);
        assertEq(forfeitWithdrawable, 0.65 ether);

        uint256 forfeitBefore = yieldVault.balanceOf(carol);
        vm.prank(carol);
        pool.withdrawPrincipal(1);
        assertEq(yieldVault.balanceOf(carol) - forfeitBefore, forfeitWithdrawable, "forfeit withdrawable");
    }

    function test_getRoundTicketPrice_returns_round_snapshot() public {
        assertEq(pool.getRoundTicketPrice(1), PRICE);
        pool.setTicketPrice(2 ether);
        assertEq(pool.getRoundTicketPrice(1), PRICE);

        vm.warp(block.timestamp + ROUND_SEC + 1);
        pool.executeNext(1);
        assertEq(pool.getRoundTicketPrice(2), 2 ether);
    }
}
