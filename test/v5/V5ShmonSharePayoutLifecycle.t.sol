// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {ClaimManagerV5} from "../../src/v5/ClaimManagerV5.sol";
import {DrawManagerV5} from "../../src/v5/DrawManagerV5.sol";
import {PrizeVaultV5} from "../../src/v5/PrizeVaultV5.sol";
import {ShmonStrategy} from "../../src/v5/strategies/ShmonStrategy.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";
import {MockRandomnessOracle} from "../mocks/MockRandomnessOracle.sol";
import {MockShmonDelayedRedeem} from "../mocks/MockShmonDelayedRedeem.sol";

/// @notice ADR-0045 guardrail: the entire V5 lifecycle must succeed even when synchronous
/// shMON redemption is impossible. Any reintroduced redeem-to-MON assumption fails this test.
contract V5ShmonSharePayoutLifecycleTest is Test {
    uint64 internal constant START = 1_000_000;
    uint64 internal constant PERIOD = 1 weeks;
    uint64 internal constant CHALLENGE = 15 minutes;

    address internal winner = makeAddr("winner");
    address internal keeper = makeAddr("keeper");
    address internal guardian = makeAddr("guardian");

    EverdrawTwabController internal twab;
    MockShmonDelayedRedeem internal shmon;
    ShmonStrategy internal strategy;
    PrizeVaultV5 internal vault;
    ClaimManagerV5 internal claimManager;
    MockRandomnessOracle internal oracle;
    DrawManagerV5 internal manager;

    function setUp() public {
        vm.warp(START);
        twab = new EverdrawTwabController(1 hours, uint32(START));
        shmon = new MockShmonDelayedRedeem();
        strategy = new ShmonStrategy(address(shmon));
        vault = new PrizeVaultV5(address(twab), address(strategy), 1_000_000 ether, "EVRDRAW-V5-MON");
        strategy.setVault(address(vault));
        twab.registerVault(address(vault));

        claimManager = new ClaimManagerV5();
        oracle = new MockRandomnessOracle();
        manager = new DrawManagerV5(
            address(vault),
            address(twab),
            address(claimManager),
            address(oracle),
            guardian,
            keeper,
            START,
            PERIOD,
            5 minutes,
            CHALLENGE
        );

        claimManager.setAuthorizedSource(address(manager), true);
        claimManager.setCompoundVault(address(manager), address(vault));
        vault.queueDrawManagerChange(address(manager));
        vm.warp(START + vault.STRATEGY_CHANGE_DELAY());
        vault.commitDrawManagerChange();
    }

    function test_depositDrawEscrowClaimCompoundAndWithdrawNeverRedeems() public {
        vm.deal(winner, 10 ether);
        vm.prank(winner);
        vault.deposit{value: 10 ether}();

        vm.warp(START + PERIOD);
        shmon.setRate(2 ether);

        uint256 drawId = manager.startDraw();
        assertEq(drawId, 1);
        assertEq(shmon.balanceOf(address(claimManager)), 5 ether);
        assertEq(address(claimManager).balance, 0);
        assertEq(vault.availableYield(), 0);

        oracle.fulfill(1, bytes32(uint256(0x45)));
        ClaimManagerV5.ClaimLeaf memory leaf = manager.plannedClaimLeafAt(drawId, 0, winner);
        assertEq(leaf.token, address(shmon));
        assertEq(leaf.amount, 5 ether);

        bytes32 root = claimManager.hashLeaf(leaf);
        vm.prank(keeper);
        manager.proposeRoot(drawId, root, 1, 5 ether);
        vm.warp(block.timestamp + CHALLENGE);
        manager.finalizeRoot(drawId);

        vm.expectEmit(true, false, false, true, address(vault));
        emit PrizeVaultV5.Deposit(winner, 10 ether);
        claimManager.claim(leaf, new bytes32[](0));

        assertEq(vault.principalOf(winner), 20 ether);
        assertEq(shmon.balanceOf(address(strategy)), 10 ether);
        assertEq(shmon.balanceOf(address(claimManager)), 0);

        vm.prank(winner);
        uint256 withdrawnShares = vault.withdrawShmon(20 ether);
        assertEq(withdrawnShares, 10 ether);
        assertEq(vault.principalOf(winner), 0);
        assertEq(shmon.balanceOf(winner), 10 ether);
    }

    function test_delayedMockRejectsAnySynchronousRedeemAssumption() public {
        vm.expectRevert(MockShmonDelayedRedeem.RedeemQueued.selector);
        shmon.redeem(1 ether, address(this), address(this));
    }
}
