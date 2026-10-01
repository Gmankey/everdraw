// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {PrizeVaultV5} from "../../src/v5/PrizeVaultV5.sol";
import {ShmonStrategy} from "../../src/v5/strategies/ShmonStrategy.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";

interface IIncidentShmon {
    function balanceOf(address account) external view returns (uint256);
    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares);
    function transfer(address to, uint256 shares) external returns (bool);
    function previewWithdraw(uint256 assets) external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
}

interface IIncidentPrizeVault {
    function principalOf(address account) external view returns (uint256);
    function availableYield() external view returns (uint256);
    function strategy() external view returns (address);
    function STRATEGY_CHANGE_DELAY() external view returns (uint256);
    function queueStrategyChange(address newStrategy) external;
    function commitStrategyChange() external;
    function withdrawShmon(uint256 amount) external returns (uint256 shares);
}

contract ForceNativeToStrategy {
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}

contract PrizeVaultV5FullExitForkTest is Test {
    uint256 internal constant INCIDENT_BLOCK = 108_308_126;
    address internal constant MAINNET_SHMON = 0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c;
    address internal constant LIVE_VAULT = 0x97D9CA6DDD80869A32C951cc75b75D20e1300eDa;
    address internal constant LIVE_STRATEGY = 0xA3e037641825B17586cC9B5D4d9473A76f25c44b;
    address internal constant LIVE_PARTICIPANT = 0x69b3F8FA1759272EF770103E5B014A2379dC9EBc;
    address internal constant LIVE_OWNER = 0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2;

    EverdrawTwabController internal twab;
    ShmonStrategy internal strategy;
    PrizeVaultV5 internal vault;
    address internal alice = makeAddr("alice");

    function setUp() public {
        string memory rpcUrl = vm.envOr("MONAD_MAINNET_RPC_URL", string(""));
        vm.skip(bytes(rpcUrl).length == 0);
        vm.createSelectFork(rpcUrl, INCIDENT_BLOCK);

        twab = new EverdrawTwabController(1 hours, uint32(block.timestamp));
        strategy = new ShmonStrategy(MAINNET_SHMON);
        vault = new PrizeVaultV5(address(twab), address(strategy), 10 ether, "EVRDRAW-V5-MON");
        strategy.setVault(address(vault));
        twab.registerVault(address(vault));
    }

    function test_fork_reproducesLiveFullWithdrawalInsufficientShares() public {
        uint256 principal = IIncidentPrizeVault(LIVE_VAULT).principalOf(LIVE_PARTICIPANT);
        uint256 heldShares = IIncidentShmon(MAINNET_SHMON).balanceOf(LIVE_STRATEGY);
        uint256 redemptionShares = IIncidentShmon(MAINNET_SHMON).previewWithdraw(principal);
        uint256 ownershipShares = IIncidentShmon(MAINNET_SHMON).convertToShares(principal);

        assertEq(principal, 1_001_473_042_219_858_544);
        assertEq(heldShares, 616_510_436_451_682_373);
        assertEq(redemptionShares, 621_465_110_546_683_789);
        assertEq(ownershipShares, 615_772_575_235_795_973);
        assertGt(redemptionShares, heldShares);

        vm.prank(LIVE_PARTICIPANT);
        vm.expectRevert(abi.encodeWithSelector(ShmonStrategy.InsufficientShares.selector, redemptionShares, heldShares));
        IIncidentPrizeVault(LIVE_VAULT).withdrawShmon(principal);
    }

    function test_fork_governedStrategySwapUnblocksLiveIncidentFullExit() public {
        IIncidentPrizeVault incidentVault = IIncidentPrizeVault(LIVE_VAULT);
        uint256 principal = incidentVault.principalOf(LIVE_PARTICIPANT);
        uint256 heldShares = IIncidentShmon(MAINNET_SHMON).balanceOf(LIVE_STRATEGY);

        ShmonStrategy replacement = new ShmonStrategy(MAINNET_SHMON);
        replacement.setVault(LIVE_VAULT);
        replacement.setNativeMigrationSource(LIVE_STRATEGY);

        vm.startPrank(LIVE_OWNER);
        incidentVault.queueStrategyChange(address(replacement));
        vm.warp(block.timestamp + incidentVault.STRATEGY_CHANGE_DELAY());
        uint256 assetsBeforeMigration = IIncidentShmon(MAINNET_SHMON).convertToAssets(heldShares);
        uint256 yieldBeforeMigration = incidentVault.availableYield();
        incidentVault.commitStrategyChange();
        vm.stopPrank();

        assertEq(incidentVault.strategy(), address(replacement));
        assertEq(IIncidentShmon(MAINNET_SHMON).balanceOf(LIVE_STRATEGY), 0);
        assertEq(replacement.sharesHeld(), heldShares);
        assertEq(replacement.totalAssets(), assetsBeforeMigration);
        assertEq(incidentVault.availableYield(), yieldBeforeMigration);

        uint256 yieldBefore = incidentVault.availableYield();
        uint256 before = IIncidentShmon(MAINNET_SHMON).balanceOf(LIVE_PARTICIPANT);
        vm.prank(LIVE_PARTICIPANT);
        uint256 withdrawnShares = incidentVault.withdrawShmon(principal);

        assertEq(IIncidentShmon(MAINNET_SHMON).balanceOf(LIVE_PARTICIPANT) - before, withdrawnShares);
        assertEq(withdrawnShares, IIncidentShmon(MAINNET_SHMON).convertToShares(principal));
        assertEq(incidentVault.principalOf(LIVE_PARTICIPANT), 0);
        assertApproxEqAbs(incidentVault.availableYield(), yieldBefore, 2);
    }

    function test_fork_lastParticipantCanFullyExitAgainstRealShmonSpread() public {
        vm.deal(alice, 2 ether);
        vm.startPrank(alice, alice);
        vault.deposit{value: 1 ether}();
        uint256 donatedShares = IIncidentShmon(MAINNET_SHMON).deposit{value: 0.001 ether}(0.001 ether, alice);
        IIncidentShmon(MAINNET_SHMON).transfer(address(strategy), donatedShares);
        vm.stopPrank();

        uint256 principal = vault.principalOf(alice);
        uint256 heldShares = strategy.sharesHeld();
        uint256 yieldBefore = vault.availableYield();
        assertGt(IIncidentShmon(MAINNET_SHMON).previewWithdraw(principal), heldShares);
        assertGt(yieldBefore, 0);

        uint256 before = IIncidentShmon(MAINNET_SHMON).balanceOf(alice);
        vm.prank(alice);
        uint256 withdrawnShares = vault.withdrawShmon(principal);

        assertEq(withdrawnShares, IIncidentShmon(MAINNET_SHMON).balanceOf(alice) - before);
        assertEq(withdrawnShares, IIncidentShmon(MAINNET_SHMON).convertToShares(principal));
        assertEq(vault.principalOf(alice), 0);
        assertEq(vault.totalPrincipal(), 0);
        assertEq(twab.balanceOf(address(vault), alice), 0);
        assertApproxEqAbs(vault.availableYield(), yieldBefore, 2);
        assertLe(IIncidentShmon(MAINNET_SHMON).convertToAssets(withdrawnShares), principal);
        assertLe(principal - IIncidentShmon(MAINNET_SHMON).convertToAssets(withdrawnShares), 2);
    }

    function test_fork_forcedNativeSurvivesTwoGovernedMigrationsWithoutAffectingAccounting() public {
        IIncidentPrizeVault incidentVault = IIncidentPrizeVault(LIVE_VAULT);
        uint256 principal = incidentVault.principalOf(LIVE_PARTICIPANT);
        uint256 heldShares = IIncidentShmon(MAINNET_SHMON).balanceOf(LIVE_STRATEGY);
        uint256 assetsBefore = IIncidentShmon(MAINNET_SHMON).convertToAssets(heldShares);
        uint256 yieldBefore = incidentVault.availableYield();

        ShmonStrategy firstReplacement = new ShmonStrategy(MAINNET_SHMON);
        firstReplacement.setVault(LIVE_VAULT);
        firstReplacement.setNativeMigrationSource(LIVE_STRATEGY);

        vm.deal(address(this), 1 ether);
        new ForceNativeToStrategy{value: 1 wei}(payable(LIVE_STRATEGY));

        vm.startPrank(LIVE_OWNER);
        incidentVault.queueStrategyChange(address(firstReplacement));
        vm.warp(block.timestamp + incidentVault.STRATEGY_CHANGE_DELAY());
        incidentVault.commitStrategyChange();
        vm.stopPrank();

        assertEq(firstReplacement.sharesHeld(), heldShares);
        assertEq(address(firstReplacement).balance, 1 wei);
        assertEq(firstReplacement.totalAssets(), assetsBefore);
        assertEq(incidentVault.principalOf(LIVE_PARTICIPANT), principal);
        assertEq(incidentVault.availableYield(), yieldBefore);

        ShmonStrategy secondReplacement = new ShmonStrategy(MAINNET_SHMON);
        secondReplacement.setVault(LIVE_VAULT);
        secondReplacement.setNativeMigrationSource(address(firstReplacement));
        new ForceNativeToStrategy{value: 0.25 ether}(payable(address(firstReplacement)));

        vm.startPrank(LIVE_OWNER);
        incidentVault.queueStrategyChange(address(secondReplacement));
        vm.warp(block.timestamp + incidentVault.STRATEGY_CHANGE_DELAY());
        incidentVault.commitStrategyChange();
        vm.stopPrank();

        assertEq(incidentVault.strategy(), address(secondReplacement));
        assertEq(firstReplacement.sharesHeld(), 0);
        assertEq(address(firstReplacement).balance, 0);
        assertEq(secondReplacement.sharesHeld(), heldShares);
        assertEq(address(secondReplacement).balance, 0.25 ether + 1 wei);
        assertEq(secondReplacement.totalAssets(), assetsBefore);
        assertEq(incidentVault.principalOf(LIVE_PARTICIPANT), principal);
        assertEq(incidentVault.availableYield(), yieldBefore);

        uint256 participantSharesBefore = IIncidentShmon(MAINNET_SHMON).balanceOf(LIVE_PARTICIPANT);
        vm.prank(LIVE_PARTICIPANT);
        uint256 withdrawnShares = incidentVault.withdrawShmon(principal);

        assertEq(IIncidentShmon(MAINNET_SHMON).balanceOf(LIVE_PARTICIPANT) - participantSharesBefore, withdrawnShares);
        assertEq(incidentVault.principalOf(LIVE_PARTICIPANT), 0);
        assertEq(address(secondReplacement).balance, 0.25 ether + 1 wei);
    }
}
