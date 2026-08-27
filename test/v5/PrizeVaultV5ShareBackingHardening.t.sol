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

    function test_participantExitRevertsAtomicallyWhenStrategyLacksRequiredShares() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();
        shmon.setWithdrawFeeBps(5);

        uint256 requiredShares = shmon.previewWithdraw(4 ether);
        uint256 heldShares = strategy.sharesHeld();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ShmonStrategy.InsufficientShares.selector, requiredShares, heldShares));
        vault.withdrawShmon(4 ether);

        assertEq(vault.principalOf(alice), 4 ether);
        assertEq(vault.totalParticipantPrincipal(), 4 ether);
        assertEq(vault.totalPrincipal(), 4 ether);
        assertEq(twab.balanceOf(address(vault), alice), 4 ether);
        assertEq(twab.totalParticipantSupply(address(vault)), 4 ether);
        assertEq(twab.totalPrincipalSupply(address(vault)), 4 ether);
        assertEq(strategy.sharesHeld(), heldShares);
        assertEq(shmon.balanceOf(alice), 0);
    }

    function test_sponsorExitRevertsAtomicallyWhenStrategyLacksRequiredShares() public {
        vm.deal(sponsor, 10 ether);
        vm.prank(sponsor);
        vault.sponsorDeposit{value: 4 ether}();
        shmon.setWithdrawFeeBps(5);

        uint256 requiredShares = shmon.previewWithdraw(4 ether);
        uint256 heldShares = strategy.sharesHeld();
        vm.prank(sponsor);
        vm.expectRevert(abi.encodeWithSelector(ShmonStrategy.InsufficientShares.selector, requiredShares, heldShares));
        vault.withdrawSponsorShmon(4 ether);

        assertEq(vault.sponsorPrincipalOf(sponsor), 4 ether);
        assertEq(vault.totalSponsorPrincipal(), 4 ether);
        assertEq(vault.totalPrincipal(), 4 ether);
        assertEq(twab.balanceOf(address(vault), sponsor), 4 ether);
        assertEq(twab.delegateBalanceOf(address(vault), twab.SPONSOR_DELEGATE()), 4 ether);
        assertEq(twab.totalPrincipalSupply(address(vault)), 4 ether);
        assertEq(strategy.sharesHeld(), heldShares);
        assertEq(shmon.balanceOf(sponsor), 0);
    }

    function test_patronExitRevertsAtomicallyWhenStrategyLacksRequiredShares() public {
        vm.deal(patron, 10 ether);
        vm.prank(patron);
        vault.boostDeposit{value: 4 ether}();
        shmon.setWithdrawFeeBps(5);

        uint256 requiredShares = shmon.previewWithdraw(4 ether);
        uint256 heldShares = strategy.sharesHeld();
        vm.prank(patron);
        vm.expectRevert(abi.encodeWithSelector(ShmonStrategy.InsufficientShares.selector, requiredShares, heldShares));
        vault.boostWithdrawShmon(4 ether);

        assertEq(vault.boosterPrincipalOf(patron), 4 ether);
        assertEq(vault.totalBoosterPrincipal(), 4 ether);
        assertEq(vault.totalPrincipal(), 4 ether);
        assertEq(twab.balanceOf(address(vault), patron), 4 ether);
        assertEq(twab.delegateBalanceOf(address(vault), twab.BOOSTER_DELEGATE()), 4 ether);
        assertEq(twab.totalPrincipalSupply(address(vault)), 4 ether);
        assertEq(strategy.sharesHeld(), heldShares);
        assertEq(shmon.balanceOf(patron), 0);
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
}
