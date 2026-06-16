// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {PrizeVaultV5} from "../../src/v5/PrizeVaultV5.sol";
import {ShmonStrategy} from "../../src/v5/strategies/ShmonStrategy.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";
import {MockERC4626YieldVault} from "../mocks/MockERC4626YieldVault.sol";

contract PrizeVaultV5Test is Test {
    EverdrawTwabController twab;
    MockERC4626YieldVault shmon;
    ShmonStrategy strategy;
    PrizeVaultV5 vault;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address sponsor = makeAddr("sponsor");

    function setUp() public {
        vm.warp(1_000_000);
        twab = new EverdrawTwabController(1 hours, uint32(block.timestamp));
        shmon = new MockERC4626YieldVault(address(0));
        strategy = new ShmonStrategy(address(shmon));
        vault = new PrizeVaultV5(address(twab), address(strategy), 100 ether, "EVRDRAW-V5-MON");
        strategy.setVault(address(vault));
        twab.registerVault(address(vault));
    }

    function test_nativeDepositCreditsPrincipalAndTwab() public {
        vm.deal(alice, 10 ether);

        vm.prank(alice);
        vault.deposit{value: 3 ether}();

        assertEq(vault.principalOf(alice), 3 ether);
        assertEq(vault.totalPrincipal(), 3 ether);
        assertEq(vault.totalParticipantPrincipal(), 3 ether);
        assertEq(twab.balanceOf(address(vault), alice), 3 ether);
        assertEq(twab.totalParticipantSupply(address(vault)), 3 ether);
    }

    function test_withdrawPaysPrincipalAndKeepsWithdrawalLiveWhenPaused() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();

        vault.pause();

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(1.5 ether);

        assertEq(alice.balance - before, 1.5 ether);
        assertEq(vault.principalOf(alice), 2.5 ether);
        assertEq(vault.totalPrincipal(), 2.5 ether);
        assertEq(twab.balanceOf(address(vault), alice), 2.5 ether);
    }

    function test_withdrawalLiveAfterStopButDepositsBlocked() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 2 ether}();

        vault.stop();

        vm.deal(bob, 10 ether);
        vm.prank(bob);
        vm.expectRevert(PrizeVaultV5.VaultIsStopped.selector);
        vault.deposit{value: 1 ether}();

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(2 ether);
        assertEq(alice.balance - before, 2 ether);
    }

    function test_sponsorWithdrawLiveWhenPausedAndStopped() public {
        vm.deal(sponsor, 10 ether);
        vm.prank(sponsor);
        vault.sponsorDeposit{value: 3 ether}();

        vault.pause();
        vault.stop();

        uint256 before = sponsor.balance;
        vm.prank(sponsor);
        vault.withdrawSponsor(3 ether);

        assertEq(sponsor.balance - before, 3 ether);
        assertEq(vault.totalPrincipal(), 0);
    }

    function test_depositCapAndMinDeposit() public {
        vault.setDepositCap(2 ether);
        vault.setMinDeposit(1 ether);

        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vm.expectRevert(PrizeVaultV5.DepositTooSmall.selector);
        vault.deposit{value: 0.5 ether}();

        vm.prank(alice);
        vault.deposit{value: 1.5 ether}();

        vm.prank(alice);
        vm.expectRevert(PrizeVaultV5.DepositCapExceeded.selector);
        vault.deposit{value: 1 ether}();
    }

    function test_directShmonDepositCreditsAssetValue() public {
        shmon.mintShares(alice, 5 ether);

        vm.startPrank(alice);
        shmon.approve(address(strategy), 5 ether);
        vault.depositShmon(2 ether);
        vm.stopPrank();

        assertEq(vault.principalOf(alice), 2 ether);
        assertEq(strategy.sharesHeld(), 2 ether);
        assertEq(twab.balanceOf(address(vault), alice), 2 ether);
    }

    function test_sponsorDepositHasNoParticipantOddsButCountsPrincipal() public {
        vm.deal(sponsor, 10 ether);

        vm.prank(sponsor);
        vault.sponsorDeposit{value: 3 ether}();

        assertEq(vault.sponsorPrincipalOf(sponsor), 3 ether);
        assertEq(vault.totalSponsorPrincipal(), 3 ether);
        assertEq(vault.totalPrincipal(), 3 ether);
        assertEq(twab.balanceOf(address(vault), sponsor), 3 ether);
        assertEq(twab.delegateBalanceOf(address(vault), sponsor), 0);
        assertEq(twab.totalParticipantSupply(address(vault)), 0);
        assertEq(twab.totalPrincipalSupply(address(vault)), 3 ether);
        assertEq(twab.delegateBalanceOf(address(vault), twab.SPONSOR_DELEGATE()), 3 ether);
    }

    function test_sponsorWithdrawPaysAndUpdatesTwab() public {
        vm.deal(sponsor, 10 ether);
        vm.prank(sponsor);
        vault.sponsorDeposit{value: 3 ether}();

        uint256 before = sponsor.balance;
        vm.prank(sponsor);
        vault.withdrawSponsor(1 ether);

        assertEq(sponsor.balance - before, 1 ether);
        assertEq(vault.sponsorPrincipalOf(sponsor), 2 ether);
        assertEq(twab.balanceOf(address(vault), sponsor), 2 ether);
        assertEq(twab.delegateBalanceOf(address(vault), twab.SPONSOR_DELEGATE()), 2 ether);
    }

    function test_shortfallWithdrawPaysProRataAndBlocksDeposits() public {
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();
        vm.prank(bob);
        vault.deposit{value: 6 ether}();

        shmon.setRate(0.5 ether);

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(4 ether);

        assertTrue(vault.shortfallMode());
        assertEq(alice.balance - before, 2 ether);
        assertEq(vault.totalPrincipal(), 6 ether);

        vm.deal(sponsor, 10 ether);
        vm.prank(sponsor);
        vm.expectRevert(PrizeVaultV5.VaultIsStopped.selector);
        vault.sponsorDeposit{value: 1 ether}();
    }

    function test_emergencyRedeemSharesBurnsPrincipalAndTransfersProRataShares() public {
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 2 ether}();
        vm.prank(bob);
        vault.deposit{value: 6 ether}();

        vm.prank(alice);
        vault.emergencyRedeemShares(2 ether);

        assertEq(vault.principalOf(alice), 0);
        assertEq(shmon.balanceOf(alice), 2 ether);
        assertEq(strategy.sharesHeld(), 6 ether);
    }

    function test_emergencyRedeemLiveWhenPausedAndStopped() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 2 ether}();

        vault.pause();
        vault.stop();

        vm.prank(alice);
        vault.emergencyRedeemShares(2 ether);

        assertEq(vault.principalOf(alice), 0);
        assertEq(shmon.balanceOf(alice), 2 ether);
    }

    function test_yieldDonationDoesNotIncreaseWithdrawablePrincipal() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();

        vm.deal(address(shmon), address(shmon).balance + 4 ether);
        shmon.setRate(2 ether);

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(4 ether);

        assertEq(alice.balance - before, 4 ether);
        assertEq(vault.totalPrincipal(), 0);
        assertEq(strategy.totalAssets(), 4 ether);
    }

    function test_withdrawUsesPreviewWithdrawNotPreviewDeposit() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();

        shmon.setWithdrawFeeBps(5);

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(1 ether);

        assertEq(alice.balance - before, 1 ether);
        assertEq(vault.principalOf(alice), 3 ether);
        assertLt(strategy.sharesHeld(), 3 ether);
    }

    function test_strategyChangeUsesTimelock() public {
        ShmonStrategy next = new ShmonStrategy(address(shmon));

        vault.queueStrategyChange(address(next));

        vm.expectRevert(PrizeVaultV5.TimelockNotElapsed.selector);
        vault.commitStrategyChange();

        vm.warp(block.timestamp + vault.STRATEGY_CHANGE_DELAY());
        vault.commitStrategyChange();

        assertEq(address(vault.strategy()), address(next));
    }

    function test_strategyChangeMigratesSharesToNewStrategy() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();

        ShmonStrategy next = new ShmonStrategy(address(shmon));
        next.setVault(address(vault));

        vault.queueStrategyChange(address(next));
        vm.warp(block.timestamp + vault.STRATEGY_CHANGE_DELAY());
        vault.commitStrategyChange();

        assertEq(address(vault.strategy()), address(next));
        assertEq(strategy.sharesHeld(), 0);
        assertEq(next.sharesHeld(), 4 ether);
        assertEq(next.totalAssets(), 4 ether);

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(1 ether);
        assertEq(alice.balance - before, 1 ether);
        assertEq(next.sharesHeld(), 3 ether);
    }

    function test_strategyChangeMigratesNativeDustToNewStrategy() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();

        shmon.setWithdrawFeeBps(5);

        vm.prank(alice);
        vault.withdraw(1 ether);
        assertGt(address(strategy).balance, 0);

        uint256 assetsBefore = strategy.totalAssets();
        ShmonStrategy next = new ShmonStrategy(address(shmon));
        next.setVault(address(vault));

        vault.queueStrategyChange(address(next));
        vm.warp(block.timestamp + vault.STRATEGY_CHANGE_DELAY());
        vault.commitStrategyChange();

        assertEq(strategy.sharesHeld(), 0);
        assertEq(address(strategy).balance, 0);
        assertGe(next.totalAssets(), assetsBefore - 1);
    }
}
