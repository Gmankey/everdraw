// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {PrizeVaultV5} from "../../src/v5/PrizeVaultV5.sol";
import {ShmonStrategy} from "../../src/v5/strategies/ShmonStrategy.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";
import {MockERC4626YieldVault} from "../mocks/MockERC4626YieldVault.sol";

contract ShareBackingDrawManager {}

contract ForceNativeToStrategy {
    constructor(address payable recipient) payable {
        selfdestruct(recipient);
    }
}

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

    function test_rawNativeMonIsExcludedFromYieldAndParticipantExit() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();

        address donor = makeAddr("native donor");
        vm.deal(donor, 1 ether);
        vm.prank(donor);
        (bool donated,) = payable(address(strategy)).call{value: 1 ether}("");
        assertTrue(donated);

        assertEq(address(strategy).balance, 1 ether);
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
        assertEq(address(strategy).balance, 1 ether);
    }

    function test_participantFullExitIgnoresUnderlyingRedeemFee() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();
        shmon.setWithdrawFeeBps(5);

        uint256 heldShares = strategy.sharesHeld();
        vm.prank(alice);
        uint256 shares = vault.withdrawShmon(4 ether);

        assertEq(shares, heldShares);
        assertEq(shmon.balanceOf(alice), heldShares);
        assertEq(vault.principalOf(alice), 0);
        assertEq(vault.totalParticipantPrincipal(), 0);
        assertEq(vault.totalPrincipal(), 0);
        assertEq(twab.balanceOf(address(vault), alice), 0);
        assertEq(strategy.sharesHeld(), 0);
    }

    function test_sponsorFullExitIgnoresUnderlyingRedeemFee() public {
        vm.deal(sponsor, 10 ether);
        vm.prank(sponsor);
        vault.sponsorDeposit{value: 4 ether}();
        shmon.setWithdrawFeeBps(5);

        uint256 heldShares = strategy.sharesHeld();
        vm.prank(sponsor);
        uint256 shares = vault.withdrawSponsorShmon(4 ether);

        assertEq(shares, heldShares);
        assertEq(shmon.balanceOf(sponsor), heldShares);
        assertEq(vault.sponsorPrincipalOf(sponsor), 0);
        assertEq(vault.totalSponsorPrincipal(), 0);
        assertEq(vault.totalPrincipal(), 0);
        assertEq(twab.delegateBalanceOf(address(vault), twab.SPONSOR_DELEGATE()), 0);
        assertEq(strategy.sharesHeld(), 0);
    }

    function test_patronFullExitIgnoresUnderlyingRedeemFee() public {
        vm.deal(patron, 10 ether);
        vm.prank(patron);
        vault.boostDeposit{value: 4 ether}();
        shmon.setWithdrawFeeBps(5);

        uint256 heldShares = strategy.sharesHeld();
        vm.prank(patron);
        uint256 shares = vault.boostWithdrawShmon(4 ether);

        assertEq(shares, heldShares);
        assertEq(shmon.balanceOf(patron), heldShares);
        assertEq(vault.boosterPrincipalOf(patron), 0);
        assertEq(vault.totalBoosterPrincipal(), 0);
        assertEq(vault.totalPrincipal(), 0);
        assertEq(twab.delegateBalanceOf(address(vault), twab.BOOSTER_DELEGATE()), 0);
        assertEq(strategy.sharesHeld(), 0);
    }

    function test_roundingNeverDeficitsRemainingParticipant() public {
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
        assertGe(strategy.totalAssets(), vault.totalPrincipal());

        uint256 heldBefore = strategy.sharesHeld();
        vm.prank(bob);
        uint256 bobShares = vault.withdrawShmon(5 ether);

        assertLe(heldBefore - bobShares, 1);
        assertEq(vault.principalOf(bob), 0);
        assertEq(vault.totalPrincipal(), 0);
        assertEq(twab.balanceOf(address(vault), bob), 0);
        assertLe(strategy.totalAssets(), 3);
    }

    function test_sameShareTokenStrategyMigrationStillSucceeds() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();

        vm.startPrank(alice);
        ShmonStrategy next = new ShmonStrategy(address(shmon));
        next.setVault(address(vault));
        vm.stopPrank();

        assertEq(next.owner(), alice);
        assertEq(address(next).codehash, vault.strategyCodehash());
        vault.queueStrategyChange(address(next));
        vm.warp(block.timestamp + vault.STRATEGY_CHANGE_DELAY());
        vault.commitStrategyChange();

        assertEq(address(vault.strategy()), address(next));
        assertEq(strategy.sharesHeld(), 0);
        assertEq(next.sharesHeld(), 4 ether);
        assertEq(vault.principalOf(alice), 4 ether);
    }

    function test_forcedNativeDustMigratesWithoutAffectingSharesOrPrincipal() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();

        ShmonStrategy next = new ShmonStrategy(address(shmon));
        next.setVault(address(vault));
        uint256 sharesBefore = strategy.sharesHeld();
        uint256 principalBefore = vault.totalPrincipal();
        uint256 assetsBefore = strategy.totalAssets();

        vault.queueStrategyChange(address(next));
        vm.deal(address(this), 1 wei);
        new ForceNativeToStrategy{value: 1 wei}(payable(address(strategy)));
        assertEq(address(strategy).balance, 1 wei);
        assertEq(strategy.totalAssets(), assetsBefore);
        assertEq(vault.availableYield(), 0);

        vm.warp(block.timestamp + vault.STRATEGY_CHANGE_DELAY());
        vault.commitStrategyChange();

        assertEq(address(vault.strategy()), address(next));
        assertEq(strategy.sharesHeld(), 0);
        assertEq(next.sharesHeld(), sharesBefore);
        assertEq(address(strategy).balance, 0);
        assertEq(address(next).balance, 1 wei);
        assertEq(next.totalAssets(), assetsBefore);
        assertEq(vault.totalPrincipal(), principalBefore);
        assertEq(vault.availableYield(), 0);

        uint256 remainingPrincipal = vault.principalOf(alice);
        vm.prank(alice);
        vault.withdrawShmon(remainingPrincipal);
        assertEq(vault.principalOf(alice), 0);
        assertEq(next.sharesHeld(), 0);
        assertEq(address(next).balance, 1 wei);
    }

    function test_differentStrategyRuntimeIsRejectedBeforeQueue() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();

        MockERC4626YieldVault otherShmon = new MockERC4626YieldVault(address(0));
        ShmonStrategy next = new ShmonStrategy(address(otherShmon));
        next.setVault(address(vault));

        vm.expectRevert(
            abi.encodeWithSelector(
                PrizeVaultV5.StrategyCodehashMismatch.selector, vault.strategyCodehash(), address(next).codehash
            )
        );
        vault.queueStrategyChange(address(next));

        assertEq(address(vault.strategy()), address(strategy));
        assertEq(vault.pendingStrategy(), address(0));
        assertEq(vault.pendingStrategyEffectiveAt(), 0);
        assertEq(strategy.sharesHeld(), 4 ether);
        assertEq(next.sharesHeld(), 0);
        assertEq(vault.principalOf(alice), 4 ether);
        assertEq(twab.balanceOf(address(vault), alice), 4 ether);
    }

    function test_directShareDepositUsesFeeFreeBackingValue() public {
        shmon.setRate(2 ether);
        shmon.setWithdrawFeeBps(500);
        shmon.mintShares(alice, 4 ether);

        vm.startPrank(alice);
        shmon.approve(address(strategy), 4 ether);
        uint256 assets = vault.depositShmon(4 ether);
        vm.stopPrank();

        assertEq(assets, 8 ether);
        assertEq(vault.principalOf(alice), 8 ether);
        assertEq(strategy.totalAssets(), 8 ether);
        assertEq(shmon.previewRedeem(4 ether), 7.6 ether);
    }

    function test_patronExitCannotConsumeParticipantBacking() public {
        vm.deal(alice, 10 ether);
        vm.deal(patron, 50 ether);
        vm.prank(alice);
        vault.deposit{value: 4 ether}();
        vm.prank(patron);
        vault.boostDeposit{value: 40 ether}();
        shmon.setWithdrawFeeBps(500);

        uint256 participantPrincipal = vault.principalOf(alice);
        uint256 patronPrincipal = vault.boosterPrincipalOf(patron);
        vm.prank(patron);
        vault.boostWithdrawShmon(patronPrincipal);

        assertEq(vault.principalOf(alice), participantPrincipal);
        assertEq(vault.boosterPrincipalOf(patron), 0);
        assertGe(strategy.totalAssets(), participantPrincipal);
        assertLe(strategy.totalAssets() - participantPrincipal, 1);
    }

    function test_emergencyBoosterExitIsLiveAndDoesNotTakeYield() public {
        vm.deal(patron, 10 ether);
        vm.prank(patron);
        vault.boostDeposit{value: 4 ether}();
        shmon.setRate(2 ether);
        vault.pause();
        vault.stop();

        vm.prank(patron);
        uint256 shares = vault.emergencyRedeemBoosterShares(4 ether);

        assertEq(shares, 2 ether);
        assertEq(shmon.balanceOf(patron), 2 ether);
        assertEq(vault.boosterPrincipalOf(patron), 0);
        assertEq(vault.totalBoosterPrincipal(), 0);
        assertEq(vault.totalPrincipal(), 0);
        assertEq(strategy.totalAssets(), 4 ether);
        assertEq(twab.delegateBalanceOf(address(vault), twab.BOOSTER_DELEGATE()), 0);
    }

    function test_emergencyBoosterExitPaysProRataInShortfall() public {
        vm.deal(patron, 10 ether);
        vm.prank(patron);
        vault.boostDeposit{value: 4 ether}();
        shmon.setRate(0.5 ether);

        vm.prank(patron);
        uint256 shares = vault.emergencyRedeemBoosterShares(4 ether);

        assertEq(shares, 4 ether);
        assertEq(shmon.balanceOf(patron), 4 ether);
        assertEq(vault.boosterPrincipalOf(patron), 0);
        assertEq(vault.totalPrincipal(), 0);
        assertEq(strategy.sharesHeld(), 0);
    }
}
