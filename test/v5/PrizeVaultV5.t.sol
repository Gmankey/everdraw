// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {PrizeVaultV5} from "../../src/v5/PrizeVaultV5.sol";
import {ShmonStrategy} from "../../src/v5/strategies/ShmonStrategy.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";
import {MockERC4626YieldVault} from "../mocks/MockERC4626YieldVault.sol";

contract DummyDrawManager {}

contract PrizeVaultV5Test is Test {
    EverdrawTwabController twab;
    MockERC4626YieldVault shmon;
    ShmonStrategy strategy;
    PrizeVaultV5 vault;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address sponsor = makeAddr("sponsor");
    address booster = makeAddr("booster");

    event BoostDeposit(address indexed booster, uint256 amount, uint256 balance, uint64 timestamp);
    event BoostWithdraw(address indexed booster, uint256 amount, uint256 balance, uint64 timestamp);
    event DrawManagerSet(address indexed drawManager);
    event DrawManagerChangeQueued(address indexed drawManager, uint64 effectiveAt);
    event DrawManagerChangeCancelled();

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

    function test_transferMovesParticipantSharesAndUpdatesTwab() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 5 ether}();

        vm.warp(block.timestamp + 1 hours);
        vm.prank(alice);
        assertTrue(vault.transfer(bob, 2 ether));
        vm.warp(block.timestamp + 2 hours);

        assertEq(vault.balanceOf(alice), 3 ether);
        assertEq(vault.balanceOf(bob), 2 ether);
        assertEq(vault.totalSupply(), 5 ether);
        assertEq(vault.totalParticipantPrincipal(), 5 ether);
        assertEq(vault.totalPrincipal(), 5 ether);
        assertEq(twab.totalParticipantSupply(address(vault)), 5 ether);
        assertEq(twab.totalPrincipalSupply(address(vault)), 5 ether);
        assertEq(twab.getTwabBetween(address(vault), bob, 1_000_000, 1_000_000 + 3 hours), 1_333_333_333_333_333_333);
    }

    function test_transferFromSpendsAllowanceAndUpdatesTwab() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 5 ether}();

        vm.prank(alice);
        assertTrue(vault.approve(bob, 3 ether));

        vm.prank(bob);
        assertTrue(vault.transferFrom(alice, bob, 2 ether));

        assertEq(vault.allowance(alice, bob), 1 ether);
        assertEq(vault.balanceOf(alice), 3 ether);
        assertEq(vault.balanceOf(bob), 2 ether);
        assertEq(twab.balanceOf(address(vault), alice), 3 ether);
        assertEq(twab.balanceOf(address(vault), bob), 2 ether);
    }

    function test_transferAtPeriodBoundaryDoesNotBuyPreviousPeriodOdds() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 5 ether}();

        vm.warp(1_000_000 + 1 hours);
        vm.prank(alice);
        vault.transfer(bob, 5 ether);
        vm.warp(1_000_000 + 2 hours);

        assertEq(twab.getTwabBetween(address(vault), bob, 1_000_000, 1_000_000 + 1 hours), 0);
        assertEq(twab.getTwabBetween(address(vault), bob, 1_000_000 + 1 hours, 1_000_000 + 2 hours), 5 ether);
    }

    function test_sponsorPrincipalCannotTransferAndStaysExcludedFromParticipantOdds() public {
        vm.deal(sponsor, 10 ether);
        vm.prank(sponsor);
        vault.sponsorDeposit{value: 5 ether}();

        vm.prank(sponsor);
        vm.expectRevert(PrizeVaultV5.InsufficientBalance.selector);
        vault.transfer(bob, 1 ether);

        assertEq(vault.balanceOf(sponsor), 0);
        assertEq(vault.sponsorPrincipalOf(sponsor), 5 ether);
        assertEq(twab.totalParticipantSupply(address(vault)), 0);
        assertEq(twab.totalPrincipalSupply(address(vault)), 5 ether);
        assertEq(twab.delegateBalanceOf(address(vault), twab.SPONSOR_DELEGATE()), 5 ether);
    }

    function test_boostDepositCreditsBoosterLedgerAndZeroOdds() public {
        vm.deal(booster, 10 ether);

        vm.prank(booster);
        vm.expectEmit(true, false, false, true, address(vault));
        emit BoostDeposit(booster, 5 ether, 5 ether, uint64(block.timestamp));
        vault.boostDeposit{value: 5 ether}();

        assertEq(vault.boosterPrincipalOf(booster), 5 ether);
        assertEq(vault.principalOf(booster), 0);
        assertEq(vault.sponsorPrincipalOf(booster), 0);
        assertEq(vault.totalBoosterPrincipal(), 5 ether);
        assertEq(vault.totalPrincipal(), 5 ether);
        assertEq(vault.totalSupply(), 0);
        assertEq(twab.balanceOf(address(vault), booster), 5 ether);
        assertEq(twab.delegateBalanceOf(address(vault), booster), 0);
        assertEq(twab.totalParticipantSupply(address(vault)), 0);
        assertEq(twab.totalPrincipalSupply(address(vault)), 5 ether);
        assertEq(twab.delegateBalanceOf(address(vault), twab.BOOSTER_DELEGATE()), 5 ether);
    }

    function test_boostDepositShmonCreditsAssetValue() public {
        shmon.mintShares(booster, 5 ether);

        vm.startPrank(booster);
        shmon.approve(address(strategy), 5 ether);
        vault.boostDepositShmon(2 ether);
        vm.stopPrank();

        assertEq(vault.boosterPrincipalOf(booster), 2 ether);
        assertEq(strategy.sharesHeld(), 2 ether);
        assertEq(twab.balanceOf(address(vault), booster), 2 ether);
        assertEq(twab.delegateBalanceOf(address(vault), twab.BOOSTER_DELEGATE()), 2 ether);
    }

    function test_boostWithdrawPaysPrincipalAndKeepsWithdrawalLiveWhenPaused() public {
        vm.deal(booster, 10 ether);
        vm.prank(booster);
        vault.boostDeposit{value: 4 ether}();

        vault.pause();

        uint256 before = booster.balance;
        vm.prank(booster);
        vm.expectEmit(true, false, false, true, address(vault));
        emit BoostWithdraw(booster, 1.5 ether, 2.5 ether, uint64(block.timestamp));
        vault.boostWithdraw(1.5 ether);

        assertEq(booster.balance - before, 1.5 ether);
        assertEq(vault.boosterPrincipalOf(booster), 2.5 ether);
        assertEq(vault.totalBoosterPrincipal(), 2.5 ether);
        assertEq(vault.totalPrincipal(), 2.5 ether);
        assertEq(twab.balanceOf(address(vault), booster), 2.5 ether);
        assertEq(twab.delegateBalanceOf(address(vault), twab.BOOSTER_DELEGATE()), 2.5 ether);
    }

    function test_boosterPrincipalCannotTransfer() public {
        vm.deal(booster, 10 ether);
        vm.prank(booster);
        vault.boostDeposit{value: 5 ether}();

        vm.prank(booster);
        vm.expectRevert(PrizeVaultV5.InsufficientBalance.selector);
        vault.transfer(bob, 1 ether);

        assertEq(vault.balanceOf(booster), 0);
        assertEq(vault.boosterPrincipalOf(booster), 5 ether);
        assertEq(vault.balanceOf(bob), 0);
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

    function test_depositCapAppliesToDirectShmonAndSponsorDeposits() public {
        vault.setDepositCap(3 ether);

        shmon.mintShares(alice, 5 ether);
        vm.startPrank(alice);
        shmon.approve(address(strategy), 5 ether);
        vault.depositShmon(2 ether);
        vm.expectRevert(PrizeVaultV5.DepositCapExceeded.selector);
        vault.depositShmon(2 ether);
        assertEq(shmon.balanceOf(alice), 3 ether);
        vm.stopPrank();

        vm.deal(sponsor, 10 ether);
        vm.prank(sponsor);
        vm.expectRevert(PrizeVaultV5.DepositCapExceeded.selector);
        vault.sponsorDeposit{value: 2 ether}();
    }

    function test_loweringDepositCapBelowCurrentPrincipalDoesNotBlockWithdrawals() public {
        vault.setDepositCap(10 ether);

        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();

        vault.setDepositCap(2 ether);

        vm.deal(bob, 10 ether);
        vm.prank(bob);
        vm.expectRevert(PrizeVaultV5.DepositCapExceeded.selector);
        vault.deposit{value: 1 ether}();

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(1 ether);

        assertEq(alice.balance - before, 1 ether);
        assertEq(vault.principalOf(alice), 3 ether);
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

    function test_drawManagerInitialSetIsImmediateThenChangesUseTimelock() public {
        DummyDrawManager first = new DummyDrawManager();
        DummyDrawManager next = new DummyDrawManager();

        vm.expectEmit(true, false, false, true, address(vault));
        emit DrawManagerSet(address(first));
        vault.setDrawManager(address(first));
        assertEq(vault.drawManager(), address(first));

        uint64 effectiveAt = uint64(block.timestamp + vault.STRATEGY_CHANGE_DELAY());
        vm.expectEmit(true, false, false, true, address(vault));
        emit DrawManagerChangeQueued(address(next), effectiveAt);
        vault.setDrawManager(address(next));

        assertEq(vault.drawManager(), address(first));
        assertEq(vault.pendingDrawManager(), address(next));
        assertEq(vault.pendingDrawManagerEffectiveAt(), effectiveAt);

        vm.expectRevert(PrizeVaultV5.TimelockNotElapsed.selector);
        vault.commitDrawManagerChange();

        vm.warp(effectiveAt);
        vault.commitDrawManagerChange();

        assertEq(vault.drawManager(), address(next));
        assertEq(vault.pendingDrawManager(), address(0));
        assertEq(vault.pendingDrawManagerEffectiveAt(), 0);
    }

    function test_drawManagerChangeCanBeCancelled() public {
        DummyDrawManager first = new DummyDrawManager();
        DummyDrawManager next = new DummyDrawManager();

        vault.setDrawManager(address(first));
        vault.setDrawManager(address(next));

        vm.expectEmit(false, false, false, true, address(vault));
        emit DrawManagerChangeCancelled();
        vault.cancelDrawManagerChange();

        assertEq(vault.drawManager(), address(first));
        assertEq(vault.pendingDrawManager(), address(0));
        assertEq(vault.pendingDrawManagerEffectiveAt(), 0);

        vm.expectRevert(PrizeVaultV5.NoPendingDrawManagerChange.selector);
        vault.commitDrawManagerChange();
    }

    function test_withdrawRemainsLiveDuringDrawManagerTimelock() public {
        DummyDrawManager first = new DummyDrawManager();
        DummyDrawManager next = new DummyDrawManager();

        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();

        vault.setDrawManager(address(first));
        vault.setDrawManager(address(next));

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(1 ether);

        assertEq(alice.balance - before, 1 ether);
        assertEq(vault.principalOf(alice), 3 ether);
        assertEq(vault.drawManager(), address(first));
        assertEq(vault.pendingDrawManager(), address(next));
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
