// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {ClaimManagerV5} from "../../src/v5/ClaimManagerV5.sol";
import {DrawManagerV5} from "../../src/v5/DrawManagerV5.sol";
import {PrizeVaultV5} from "../../src/v5/PrizeVaultV5.sol";
import {ShmonStrategy} from "../../src/v5/strategies/ShmonStrategy.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";
import {MockERC4626YieldVault} from "../mocks/MockERC4626YieldVault.sol";
import {MockRandomnessOracle} from "../mocks/MockRandomnessOracle.sol";

contract V5M6IntegrationAuditTest is Test {
    uint64 constant START = 1_000_000;
    uint64 constant PERIOD = 1 weeks;
    uint64 constant GRACE = 12 hours;
    uint64 constant CHALLENGE = 8 hours;
    uint64 constant SEED_TIMEOUT = 1 hours;

    EverdrawTwabController twab;
    MockERC4626YieldVault shmon;
    ShmonStrategy strategy;
    PrizeVaultV5 vault;
    MockRandomnessOracle oracle;
    ClaimManagerV5 claimManager;
    DrawManagerV5 manager;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address keeper = makeAddr("keeper");
    address guardian = makeAddr("guardian");
    address permissionless = makeAddr("permissionless");

    function setUp() public {
        vm.warp(START);
        twab = new EverdrawTwabController(1 hours, uint32(START));
        shmon = new MockERC4626YieldVault(address(0));
        strategy = new ShmonStrategy(address(shmon));
        vault = new PrizeVaultV5(address(twab), address(strategy), 1_000_000 ether, "EVRDRAW-V5-MON");
        strategy.setVault(address(vault));
        twab.registerVault(address(vault));

        oracle = new MockRandomnessOracle();
        claimManager = new ClaimManagerV5();
        manager = new DrawManagerV5(
            address(vault),
            address(twab),
            address(claimManager),
            address(oracle),
            guardian,
            keeper,
            START,
            PERIOD,
            GRACE,
            CHALLENGE
        );
        claimManager.setAuthorizedSource(address(manager), true);
        _activateDrawManager(address(manager));
    }

    function test_m6_fullLifecycleMixedMonAndShmonAcrossTwoDrawsClaimManyAndWithdraw() public {
        _depositNative(alice, 10 ether);
        _depositShmon(bob, 5 ether);
        assertEq(vault.totalParticipantPrincipal(), 15 ether);
        assertEq(twab.balanceOf(address(vault), alice), 10 ether);
        assertEq(twab.balanceOf(address(vault), bob), 5 ether);

        vm.warp(START + PERIOD);
        shmon.setRate(2 ether);
        vm.deal(address(shmon), 100 ether);
        _startSeedFinalizeAndClaim(1, 1, 7.5 ether, alice);
        assertEq(uint8(_status(1)), uint8(DrawManagerV5.DrawStatus.Finalized));
        assertEq(claimManager.reservedByToken(address(shmon)), 0);

        vm.warp(START + 2 * PERIOD);
        shmon.setRate(3 ether);
        vm.deal(address(shmon), 100 ether);
        _startSeedFinalizeAndClaim(2, 2, 2.5 ether, alice);
        assertEq(uint8(_status(2)), uint8(DrawManagerV5.DrawStatus.Finalized));
        assertEq(claimManager.reservedByToken(address(shmon)), 0);

        uint256 aliceBefore = shmon.balanceOf(alice);
        vm.prank(alice);
        uint256 aliceShares = vault.withdrawShmon(10 ether);
        assertEq(shmon.balanceOf(alice) - aliceBefore, aliceShares);

        uint256 bobBefore = shmon.balanceOf(bob);
        vm.prank(bob);
        uint256 bobShares = vault.withdrawShmon(5 ether);
        assertEq(shmon.balanceOf(bob) - bobBefore, bobShares);
        assertEq(vault.totalPrincipal(), 0);
        assertEq(twab.balanceOf(address(vault), alice), 0);
        assertEq(twab.balanceOf(address(vault), bob), 0);
    }

    function test_m6_keeperDeathFallsBackToPermissionlessStartAndProposeAfterGrace() public {
        _depositNative(alice, 10 ether);
        vm.warp(START + PERIOD);
        shmon.setRate(2 ether);

        vm.prank(permissionless);
        uint256 drawId = manager.startDraw();
        assertEq(drawId, 1);
        oracle.fulfill(1, bytes32(uint256(0x51)));

        vm.prank(permissionless);
        vm.expectRevert(DrawManagerV5.ProposerGraceActive.selector);
        manager.proposeRoot(1, bytes32(uint256(0xabc)), 1, 5 ether);

        vm.warp(START + PERIOD + GRACE);
        vm.prank(permissionless);
        manager.proposeRoot(1, bytes32(uint256(0xabc)), 1, 5 ether);

        (,,,,,,,,,, address proposer,,,,) = manager.draws(1);
        assertEq(proposer, permissionless);
    }

    function test_m6_oracleDeathStallsThenSeedCanBeRerequestedWhileDepositsAndWithdrawalsStayLive() public {
        _depositNative(alice, 10 ether);
        vm.warp(START + PERIOD);
        shmon.setRate(2 ether);
        vm.deal(address(shmon), 100 ether);
        manager.startDraw();
        assertEq(uint8(_status(1)), uint8(DrawManagerV5.DrawStatus.AwaitingSeed));
        assertEq(manager.seedRequestedAt(1), block.timestamp);

        vm.expectRevert(
            abi.encodeWithSelector(
                DrawManagerV5.SeedRequestStillActive.selector, uint64(block.timestamp + SEED_TIMEOUT)
            )
        );
        manager.rerequestSeed(1);

        vm.prank(alice);
        vault.withdrawShmon(1 ether);
        assertEq(shmon.balanceOf(alice), 0.5 ether);

        _depositNative(bob, 1 ether);
        assertEq(vault.totalPrincipal(), 10 ether);

        vm.warp(block.timestamp + SEED_TIMEOUT);
        manager.rerequestSeed(1);
        assertEq(oracle.nextRequestId(), 3);

        vm.expectRevert(DrawManagerV5.UnknownRequest.selector);
        oracle.fulfill(1, bytes32(uint256(0xdead)));

        oracle.fulfill(2, bytes32(uint256(0xbeef)));
        assertEq(uint8(_status(1)), uint8(DrawManagerV5.DrawStatus.Seeded));
    }

    function test_m6_venueShortfallEntersShortfallModeAndEmergencyShareExitWorks() public {
        _depositNative(alice, 4 ether);
        _depositNative(bob, 6 ether);
        shmon.setRate(0.5 ether);

        vm.prank(bob);
        vault.withdrawShmon(2 ether);

        assertTrue(vault.shortfallMode());
        assertEq(shmon.convertToAssets(shmon.balanceOf(bob)), 1 ether);

        vm.prank(alice);
        vault.emergencyRedeemShares(4 ether);

        assertEq(vault.principalOf(alice), 0);
        assertEq(shmon.balanceOf(alice), 4 ether);
    }

    function test_m6_badRootVetoReproposeFinalizeAndClaim() public {
        _depositNative(alice, 10 ether);
        vm.warp(START + PERIOD);
        shmon.setRate(2 ether);
        manager.startDraw();
        oracle.fulfill(1, bytes32(uint256(0xbeef)));

        vm.prank(keeper);
        manager.proposeRoot(1, bytes32(uint256(0xbad)), 1, 5 ether);
        vm.prank(guardian);
        manager.vetoRoot(1);
        assertEq(uint8(_status(1)), uint8(DrawManagerV5.DrawStatus.Seeded));

        ClaimManagerV5.ClaimLeaf memory leaf = manager.plannedClaimLeafAt(1, 0, alice);
        bytes32 root = claimManager.hashLeaf(leaf);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(keeper);
        manager.proposeRoot(1, root, 1, 5 ether);
        vm.warp(block.timestamp + CHALLENGE);
        manager.finalizeRoot(1);

        ClaimManagerV5.ClaimLeaf[] memory leaves = new ClaimManagerV5.ClaimLeaf[](1);
        leaves[0] = leaf;
        bytes32[][] memory proofs = new bytes32[][](1);
        proofs[0] = new bytes32[](0);

        uint256 before = shmon.balanceOf(alice);
        claimManager.claimMany(leaves, proofs);
        assertEq(shmon.balanceOf(alice) - before, 5 ether);
    }

    function _depositNative(address account, uint256 amount) internal {
        vm.deal(account, account.balance + amount);
        vm.prank(account);
        vault.deposit{value: amount}();
    }

    function _depositShmon(address account, uint256 shares) internal {
        shmon.mintShares(account, shares);
        vm.startPrank(account);
        shmon.approve(address(strategy), shares);
        vault.depositShmon(shares);
        vm.stopPrank();
    }

    function _startSeedFinalizeAndClaim(uint256 drawId, uint64 requestId, uint256 payout, address winner) internal {
        manager.startDraw();
        oracle.fulfill(requestId, keccak256(abi.encode(drawId, "seed")));

        ClaimManagerV5.ClaimLeaf memory leaf = manager.plannedClaimLeafAt(drawId, 0, winner);
        bytes32 root = claimManager.hashLeaf(leaf);

        vm.prank(keeper);
        manager.proposeRoot(drawId, root, 1, payout);
        vm.warp(block.timestamp + CHALLENGE);
        manager.finalizeRoot(drawId);

        ClaimManagerV5.ClaimLeaf[] memory leaves = new ClaimManagerV5.ClaimLeaf[](1);
        leaves[0] = leaf;
        bytes32[][] memory proofs = new bytes32[][](1);
        proofs[0] = new bytes32[](0);
        claimManager.claimMany(leaves, proofs);
    }

    function _status(uint256 drawId) internal view returns (DrawManagerV5.DrawStatus status) {
        (,,,,,,,,,,, status,,,) = manager.draws(drawId);
    }

    function _activateDrawManager(address drawManager_) internal {
        vm.store(address(vault), bytes32(uint256(5)), bytes32(uint256(uint160(drawManager_))));
    }
}
