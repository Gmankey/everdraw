// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {DrawManagerV5} from "../../src/v5/DrawManagerV5.sol";
import {PrizeVaultV5} from "../../src/v5/PrizeVaultV5.sol";
import {ShmonStrategy} from "../../src/v5/strategies/ShmonStrategy.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";
import {MockERC4626YieldVault} from "../mocks/MockERC4626YieldVault.sol";
import {MockRandomnessOracle} from "../mocks/MockRandomnessOracle.sol";

contract MockClaimManagerV5 {
    receive() external payable {}
}

contract DrawManagerV5Test is Test {
    uint64 constant START = 1_000_000;
    uint64 constant PERIOD = 1 weeks;
    uint64 constant GRACE = 12 hours;
    uint64 constant CHALLENGE = 8 hours;

    EverdrawTwabController twab;
    MockERC4626YieldVault shmon;
    ShmonStrategy strategy;
    PrizeVaultV5 vault;
    MockRandomnessOracle oracle;
    MockClaimManagerV5 claimManager;
    DrawManagerV5 manager;

    address alice = makeAddr("alice");
    address keeper = makeAddr("keeper");
    address guardian = makeAddr("guardian");
    address fallbackProposer = makeAddr("fallbackProposer");

    function setUp() public {
        vm.warp(START);
        twab = new EverdrawTwabController(1 hours, uint32(START));
        shmon = new MockERC4626YieldVault(address(0));
        strategy = new ShmonStrategy(address(shmon));
        vault = new PrizeVaultV5(address(twab), address(strategy), 1_000_000 ether, "EVRDRAW-V5-MON");
        strategy.setVault(address(vault));
        twab.registerVault(address(vault));

        oracle = new MockRandomnessOracle();
        claimManager = new MockClaimManagerV5();
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
        vault.setDrawManager(address(manager));
    }

    function test_driftSimulationEmptyPeriodsAdvanceExactlyNPeriods() public {
        uint256 n = 9;
        vm.warp(START + PERIOD);

        for (uint256 i = 1; i <= n; i++) {
            manager.startDraw();
            assertEq(manager.nextPeriodStart(), START + uint64(i) * PERIOD);
            vm.warp(START + uint64(i + 1) * PERIOD);
        }
    }

    function test_zeroPrizeSkipsWithoutVrfSpend() public {
        _depositAcrossFullPeriod(10 ether);

        uint256 drawId = manager.startDraw();

        assertEq(drawId, 1);
        assertEq(oracle.nextRequestId(), 1);
        assertEq(uint8(_status(1)), uint8(DrawManagerV5.DrawStatus.Skipped));
    }

    function test_startDrawEscrowsYieldBeforeSeedAndProposal() public {
        _depositAcrossFullPeriod(10 ether);
        shmon.setRate(2 ether);

        manager.startDraw();

        assertEq(address(claimManager).balance, 10 ether);
        assertEq(vault.availableYield(), 0);
        assertEq(oracle.nextRequestId(), 2);
        assertEq(uint8(_status(1)), uint8(DrawManagerV5.DrawStatus.AwaitingSeed));

        vm.expectRevert(DrawManagerV5.DrawNotSeeded.selector);
        vm.prank(keeper);
        manager.proposeRoot(1, bytes32(uint256(1)), 1, 10 ether);
    }

    function test_seedProposeVetoReproposeFinalize() public {
        _startSeededDraw();

        vm.prank(keeper);
        manager.proposeRoot(1, bytes32(uint256(0xabc)), 3, 10 ether);
        assertEq(uint8(_status(1)), uint8(DrawManagerV5.DrawStatus.Proposed));

        vm.prank(guardian);
        manager.vetoRoot(1);
        assertEq(uint8(_status(1)), uint8(DrawManagerV5.DrawStatus.Seeded));

        vm.expectRevert(abi.encodeWithSelector(DrawManagerV5.VetoCooldownActive.selector, uint64(block.timestamp + 1 hours)));
        vm.prank(keeper);
        manager.proposeRoot(1, bytes32(uint256(0xdef)), 3, 10 ether);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(keeper);
        manager.proposeRoot(1, bytes32(uint256(0xdef)), 3, 10 ether);

        vm.expectRevert(DrawManagerV5.ChallengeWindowActive.selector);
        manager.finalizeRoot(1);

        vm.warp(block.timestamp + CHALLENGE);
        manager.finalizeRoot(1);
        assertEq(uint8(_status(1)), uint8(DrawManagerV5.DrawStatus.Finalized));

        vm.prank(guardian);
        vm.expectRevert(DrawManagerV5.DrawAlreadyFinalized.selector);
        manager.vetoRoot(1);
    }

    function test_permissionlessFallbackAfterGraceButNotBefore() public {
        _startSeededDraw();

        vm.prank(fallbackProposer);
        vm.expectRevert(DrawManagerV5.ProposerGraceActive.selector);
        manager.proposeRoot(1, bytes32(uint256(0x123)), 1, 10 ether);

        vm.warp(START + PERIOD + GRACE);
        vm.prank(fallbackProposer);
        manager.proposeRoot(1, bytes32(uint256(0x123)), 1, 10 ether);

        (, , , , , , , , , address proposer,) = manager.draws(1);
        assertEq(proposer, fallbackProposer);
    }

    function test_totalPayoutMustEqualEscrowedSnapshot() public {
        _startSeededDraw();

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(DrawManagerV5.BadPayout.selector, 10 ether, 9 ether));
        manager.proposeRoot(1, bytes32(uint256(0xabc)), 1, 9 ether);
    }

    function _depositAcrossFullPeriod(uint256 amount) internal {
        vm.deal(alice, amount);
        vm.prank(alice);
        vault.deposit{value: amount}();
        vm.warp(START + PERIOD);
    }

    function _startSeededDraw() internal {
        _depositAcrossFullPeriod(10 ether);
        shmon.setRate(2 ether);
        manager.startDraw();
        oracle.fulfill(1, bytes32(uint256(0xbeef)));
    }

    function _status(uint256 drawId) internal view returns (DrawManagerV5.DrawStatus status) {
        (, , , , , , , , , , status) = manager.draws(drawId);
    }
}
