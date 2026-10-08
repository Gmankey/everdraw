// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {PrizeVaultV5} from "../../src/v5/PrizeVaultV5.sol";
import {ShmonStrategy} from "../../src/v5/strategies/ShmonStrategy.sol";

interface IPatronMigrationShmon {
    function balanceOf(address account) external view returns (uint256);
}

contract ForceNativeToLiveStrategy {
    constructor(address payable recipient) payable {
        selfdestruct(recipient);
    }
}

contract PatronCapitalMigrationForkTest is Test {
    PrizeVaultV5 internal constant LIVE_VAULT = PrizeVaultV5(payable(0x97D9CA6DDD80869A32C951cc75b75D20e1300eDa));
    address internal constant SHMON = 0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c;
    address internal constant LIVE_HOLDER = 0x69b3F8FA1759272EF770103E5B014A2379dC9EBc;
    uint256 internal constant REVIEW_BLOCK = 111_477_200;

    function setUp() public {
        string memory rpcUrl = vm.envOr("MONAD_MAINNET_RPC_URL", string(""));
        vm.skip(bytes(rpcUrl).length == 0);
        vm.createSelectFork(rpcUrl, REVIEW_BLOCK);
    }

    function test_fork_correctedStrategyMigrationRestoresLiveFullExit() public {
        address owner = LIVE_VAULT.owner();
        uint256 principal = LIVE_VAULT.principalOf(LIVE_HOLDER);
        address oldStrategy = address(LIVE_VAULT.strategy());
        uint256 assetsBefore = LIVE_VAULT.strategy().totalAssets();
        uint256 sharesHeld = IPatronMigrationShmon(SHMON).balanceOf(oldStrategy);
        uint256 totalPrincipal = LIVE_VAULT.totalPrincipal();

        ShmonStrategy replacement = new ShmonStrategy(SHMON);
        replacement.setVault(address(LIVE_VAULT));

        vm.deal(address(this), 1 wei);
        new ForceNativeToLiveStrategy{value: 1 wei}(payable(oldStrategy));

        vm.prank(owner);
        LIVE_VAULT.queueStrategyChange(address(replacement));
        vm.warp(block.timestamp + LIVE_VAULT.STRATEGY_CHANGE_DELAY());
        vm.prank(owner);
        LIVE_VAULT.commitStrategyChange();

        assertEq(address(LIVE_VAULT.strategy()), address(replacement));
        assertGe(replacement.totalAssets(), assetsBefore - 1);
        assertEq(IPatronMigrationShmon(SHMON).balanceOf(oldStrategy), 0);
        assertEq(replacement.sharesHeld(), sharesHeld);
        assertEq(address(oldStrategy).balance, 0);
        assertEq(address(replacement).balance, 1 wei);
        assertEq(LIVE_VAULT.totalPrincipal(), totalPrincipal);

        uint256 sharesBefore = IPatronMigrationShmon(SHMON).balanceOf(LIVE_HOLDER);
        vm.prank(LIVE_HOLDER);
        LIVE_VAULT.withdrawShmon(principal);

        assertEq(LIVE_VAULT.principalOf(LIVE_HOLDER), 0);
        assertEq(LIVE_VAULT.totalPrincipal(), 0);
        assertGt(IPatronMigrationShmon(SHMON).balanceOf(LIVE_HOLDER), sharesBefore);
    }
}
