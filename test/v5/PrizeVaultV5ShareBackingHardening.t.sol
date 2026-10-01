// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {PrizeVaultV5} from "../../src/v5/PrizeVaultV5.sol";
import {ShmonStrategy} from "../../src/v5/strategies/ShmonStrategy.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";
import {MockERC4626YieldVault} from "../mocks/MockERC4626YieldVault.sol";

contract ShareBackingDrawManager {}

contract PrizeVaultV5ShareBackingHardeningTest is Test {
    EverdrawTwabController internal twab;
    MockERC4626YieldVault internal shmon;
    ShmonStrategy internal strategy;
    PrizeVaultV5 internal vault;

    address internal alice = makeAddr("alice");
    address internal sponsor = makeAddr("sponsor");
    address internal patron = makeAddr("patron");
    address internal claimManager = makeAddr("claim manager");

    function setUp() public {
        vm.warp(1_000_000);
        twab = new EverdrawTwabController(1 hours, uint32(block.timestamp));
        shmon = new MockERC4626YieldVault(address(0));
        strategy = new ShmonStrategy(address(shmon));
        vault = new PrizeVaultV5(address(twab), address(strategy), 100 ether, "EVRDRAW-V5-MON");
        strategy.setVault(address(vault));
        twab.registerVault(address(vault));
    }

    /// @dev Executable M-1 probe: this reproduces the raw-MON accounting precondition that
    /// previously exposed principal shares as apparent yield and allowed an underfunded exit.
    function test_rawNativeMonCannotBecomeYieldOrUnderfundParticipantExit() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();

        address donor = makeAddr("native donor");
        vm.deal(donor, 1 ether);
        vm.prank(donor);
        (bool donated, bytes memory data) = payable(address(strategy)).call{value: 1 ether}("");
        assertFalse(donated);
        assertEq(bytes4(data), ShmonStrategy.UnexpectedNativeTransfer.selector);

        assertEq(address(strategy).balance, 0);
        assertEq(strategy.totalAssets(), 4 ether);
        assertEq(vault.availableYield(), 0);

        ShareBackingDrawManager manager = new ShareBackingDrawManager();
        vault.queueDrawManagerChange(address(manager));
        vm.warp(block.timestamp + vault.STRATEGY_CHANGE_DELAY());
        vault.commitDrawManagerChange();

        vm.prank(address(manager));
        vm.expectRevert(abi.encodeWithSelector(PrizeVaultV5.InsufficientYield.selector, 1 ether, 0));
        vault.escrowYield(claimManager, 1 ether);
        assertEq(shmon.balanceOf(claimManager), 0);

        vm.prank(alice);
        uint256 shares = vault.withdrawShmon(4 ether);

        assertEq(shares, 4 ether);
        assertEq(shmon.balanceOf(alice), 4 ether);
        assertEq(vault.principalOf(alice), 0);
        assertEq(vault.totalPrincipal(), 0);
        assertEq(twab.balanceOf(address(vault), alice), 0);
        assertEq(address(strategy).balance, 0);
    }

    function test_participantFullExitIgnoresExternalUnstakingSpread() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();
        shmon.setWithdrawFeeBps(5);

        uint256 heldShares = strategy.sharesHeld();
        vm.prank(alice);
        uint256 shares = vault.withdrawShmon(4 ether);

        assertEq(shares, heldShares);
        assertEq(vault.principalOf(alice), 0);
        assertEq(vault.totalParticipantPrincipal(), 0);
        assertEq(vault.totalPrincipal(), 0);
        assertEq(twab.balanceOf(address(vault), alice), 0);
        assertEq(twab.totalParticipantSupply(address(vault)), 0);
        assertEq(twab.totalPrincipalSupply(address(vault)), 0);
        assertEq(strategy.sharesHeld(), 0);
        assertEq(shmon.balanceOf(alice), heldShares);
    }

    function test_sponsorFullExitIgnoresExternalUnstakingSpread() public {
        vm.deal(sponsor, 10 ether);
        vm.prank(sponsor);
        vault.sponsorDeposit{value: 4 ether}();
        shmon.setWithdrawFeeBps(5);

        uint256 heldShares = strategy.sharesHeld();
        vm.prank(sponsor);
        uint256 shares = vault.withdrawSponsorShmon(4 ether);
        assertEq(shares, heldShares);

        assertEq(vault.sponsorPrincipalOf(sponsor), 0);
        assertEq(vault.totalSponsorPrincipal(), 0);
        assertEq(vault.totalPrincipal(), 0);
        assertEq(twab.balanceOf(address(vault), sponsor), 0);
        assertEq(twab.delegateBalanceOf(address(vault), twab.SPONSOR_DELEGATE()), 0);
        assertEq(twab.totalPrincipalSupply(address(vault)), 0);
        assertEq(strategy.sharesHeld(), 0);
        assertEq(shmon.balanceOf(sponsor), heldShares);
    }

    function test_patronFullExitIgnoresExternalUnstakingSpread() public {
        vm.deal(patron, 10 ether);
        vm.prank(patron);
        vault.boostDeposit{value: 4 ether}();
        shmon.setWithdrawFeeBps(5);

        uint256 heldShares = strategy.sharesHeld();
        vm.prank(patron);
        uint256 shares = vault.boostWithdrawShmon(4 ether);
        assertEq(shares, heldShares);

        assertEq(vault.boosterPrincipalOf(patron), 0);
        assertEq(vault.totalBoosterPrincipal(), 0);
        assertEq(vault.totalPrincipal(), 0);
        assertEq(twab.balanceOf(address(vault), patron), 0);
        assertEq(twab.delegateBalanceOf(address(vault), twab.BOOSTER_DELEGATE()), 0);
        assertEq(twab.totalPrincipalSupply(address(vault)), 0);
        assertEq(strategy.sharesHeld(), 0);
        assertEq(shmon.balanceOf(patron), heldShares);
    }

    function test_multiUserExitOrderPreservesRemainingBacking() public {
        address bob = makeAddr("bob");
        vm.deal(alice, 4 ether);
        vm.deal(bob, 6 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();
        vm.prank(bob);
        vault.deposit{value: 6 ether}();
        shmon.setWithdrawFeeBps(75);

        vm.prank(alice);
        uint256 aliceShares = vault.withdrawShmon(4 ether);

        assertEq(shmon.convertToAssets(aliceShares), 4 ether);
        assertEq(strategy.totalAssets(), 6 ether);
        assertEq(vault.principalOf(bob), 6 ether);

        uint256 heldBeforeBob = strategy.sharesHeld();
        vm.prank(bob);
        uint256 bobShares = vault.withdrawShmon(6 ether);

        assertEq(bobShares, heldBeforeBob);
        assertEq(shmon.convertToAssets(bobShares), 6 ether);
        assertEq(vault.totalPrincipal(), 0);
        assertEq(strategy.sharesHeld(), 0);
    }

    function test_directShareDepositUsesGrossAssetsWithoutPhantomYield() public {
        shmon.setRate(2 ether);
        shmon.setWithdrawFeeBps(100);
        shmon.mintShares(alice, 2 ether);

        vm.startPrank(alice);
        shmon.approve(address(strategy), 2 ether);
        uint256 assets = vault.depositShmon(2 ether);
        vm.stopPrank();

        assertEq(assets, 4 ether);
        assertEq(vault.principalOf(alice), 4 ether);
        assertEq(strategy.totalAssets(), 4 ether);
        assertEq(vault.availableYield(), 0);
    }

    function test_subSharePrincipalDustCanFullyExitWithoutTakingYield() public {
        vm.deal(alice, 1 wei);
        vm.prank(alice);
        vault.deposit{value: 1 wei}();
        shmon.setRate(2 ether);

        vm.prank(alice);
        uint256 shares = vault.withdrawShmon(1 wei);

        assertEq(shares, 0);
        assertEq(vault.principalOf(alice), 0);
        assertEq(twab.balanceOf(address(vault), alice), 0);
        assertEq(strategy.sharesHeld(), 1);
        assertEq(vault.availableYield(), 2 wei);
    }

    function test_roundingShortfallCannotTrapLastParticipantExit() public {
        address bob = makeAddr("bob");
        vm.deal(alice, 10 ether);
        vm.deal(bob, 5 ether);
        vm.prank(alice);
        vault.deposit{value: 10 ether}();
        vm.prank(bob);
        vault.deposit{value: 5 ether}();

        shmon.setRate(3 ether);
        ShareBackingDrawManager manager = new ShareBackingDrawManager();
        vault.queueDrawManagerChange(address(manager));
        vm.warp(block.timestamp + vault.STRATEGY_CHANGE_DELAY());
        vault.commitDrawManagerChange();
        vm.prank(address(manager));
        vault.escrowYield(claimManager, 30 ether);

        vm.prank(alice);
        vault.withdrawShmon(10 ether);
        vm.prank(address(strategy));
        shmon.transfer(claimManager, 1);
        assertLt(strategy.totalAssets(), vault.totalPrincipal());

        uint256 heldBefore = strategy.sharesHeld();
        vm.prank(bob);
        uint256 bobShares = vault.withdrawShmon(5 ether);

        assertEq(bobShares, heldBefore);
        assertEq(vault.principalOf(bob), 0);
        assertEq(vault.totalPrincipal(), 0);
        assertEq(twab.balanceOf(address(vault), bob), 0);
        assertEq(strategy.sharesHeld(), 0);
    }

    function test_sameShareTokenStrategyMigrationStillSucceeds() public {
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
        assertEq(vault.principalOf(alice), 4 ether);
    }

    function test_differentShareTokenStrategyMigrationRevertsAndLeavesOldStrategyActive() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();

        MockERC4626YieldVault otherShmon = new MockERC4626YieldVault(address(0));
        ShmonStrategy next = new ShmonStrategy(address(otherShmon));
        next.setVault(address(vault));
        vault.queueStrategyChange(address(next));
        vm.warp(block.timestamp + vault.STRATEGY_CHANGE_DELAY());

        vm.expectRevert(
            abi.encodeWithSelector(
                PrizeVaultV5.StrategyShareTokenMismatch.selector, address(shmon), address(otherShmon)
            )
        );
        vault.commitStrategyChange();

        assertEq(address(vault.strategy()), address(strategy));
        assertEq(vault.pendingStrategy(), address(next));
        assertGt(vault.pendingStrategyEffectiveAt(), 0);
        assertEq(strategy.sharesHeld(), 4 ether);
        assertEq(next.sharesHeld(), 0);
        assertEq(vault.principalOf(alice), 4 ether);
        assertEq(twab.balanceOf(address(vault), alice), 4 ether);
    }

    function test_nativeMigrationSourceIsOneTimeAndDoesNotAffectAccounting() public {
        vm.deal(alice, 5 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();

        address predecessor = makeAddr("predecessor");
        address stranger = makeAddr("stranger");
        vm.deal(predecessor, 1 ether);
        vm.deal(stranger, 1 ether);

        vm.prank(alice);
        vm.expectRevert(ShmonStrategy.NotOwner.selector);
        strategy.setNativeMigrationSource(predecessor);

        vm.expectRevert(ShmonStrategy.ZeroAddress.selector);
        strategy.setNativeMigrationSource(address(0));

        vm.expectEmit(true, false, false, true, address(strategy));
        emit ShmonStrategy.NativeMigrationSourceSet(predecessor);
        strategy.setNativeMigrationSource(predecessor);

        vm.expectRevert(ShmonStrategy.MigrationSourceAlreadySet.selector);
        strategy.setNativeMigrationSource(stranger);

        vm.prank(stranger);
        (bool rejected,) = payable(address(strategy)).call{value: 1 ether}("");
        assertFalse(rejected);

        vm.prank(predecessor);
        (bool accepted,) = payable(address(strategy)).call{value: 0.25 ether}("");
        assertTrue(accepted);
        assertEq(address(strategy).balance, 0.25 ether);
        assertEq(strategy.totalAssets(), 4 ether);
        assertEq(vault.availableYield(), 0);
        assertEq(vault.principalOf(alice), 4 ether);
    }
}
