// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {ClaimManagerV5} from "../../src/v5/ClaimManagerV5.sol";
import {DrawManagerV5} from "../../src/v5/DrawManagerV5.sol";
import {PrizeVaultV5} from "../../src/v5/PrizeVaultV5.sol";
import {ShmonStrategy} from "../../src/v5/strategies/ShmonStrategy.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC4626YieldVault} from "../mocks/MockERC4626YieldVault.sol";
import {MockRandomnessOracle} from "../mocks/MockRandomnessOracle.sol";

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
    ClaimManagerV5 claimManager;
    DrawManagerV5 manager;

    address alice = makeAddr("alice");
    address keeper = makeAddr("keeper");
    address guardian = makeAddr("guardian");
    address fallbackProposer = makeAddr("fallbackProposer");
    address feeRecipient = makeAddr("feeRecipient");
    address sponsor = makeAddr("sponsor");

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

        (, , , , , , , , , , address proposer,, , ,) = manager.draws(1);
        assertEq(proposer, fallbackProposer);
    }

    function test_totalPayoutMustEqualEscrowedSnapshot() public {
        _startSeededDraw();

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(DrawManagerV5.BadPayout.selector, 10 ether, 9 ether));
        manager.proposeRoot(1, bytes32(uint256(0xabc)), 1, 9 ether);
    }

    function test_feeConfigEnforcesRecipientCapAndTotalCap() public {
        address[] memory recipients = new address[](9);
        uint16[] memory bps = new uint16[](9);
        for (uint256 i = 0; i < 9; i++) {
            recipients[i] = address(uint160(i + 10));
            bps[i] = 100;
        }
        vm.expectRevert(DrawManagerV5.BadFeeConfig.selector);
        manager.setFeeConfig(DrawManagerV5.FeeBase.TOTAL_PRIZE, recipients, bps);

        recipients = new address[](2);
        bps = new uint16[](2);
        recipients[0] = feeRecipient;
        recipients[1] = makeAddr("fee2");
        bps[0] = 1_500;
        bps[1] = 600;
        vm.expectRevert(DrawManagerV5.BadFeeConfig.selector);
        manager.setFeeConfig(DrawManagerV5.FeeBase.TOTAL_PRIZE, recipients, bps);

        bps[1] = 500;
        manager.setFeeConfig(DrawManagerV5.FeeBase.PARTICIPANT_YIELD_ONLY, recipients, bps);
        assertEq(uint8(manager.feeBase()), uint8(DrawManagerV5.FeeBase.PARTICIPANT_YIELD_ONLY));
        assertEq(manager.totalFeeBps(), 2_000);
        assertEq(manager.feeRecipientCount(), 2);
    }

    function test_feeBaseParticipantYieldOnlyUsesTimeWeightedSponsorTwab() public {
        address[] memory recipients = new address[](1);
        uint16[] memory bps = new uint16[](1);
        recipients[0] = feeRecipient;
        bps[0] = 1_000;
        manager.setFeeConfig(DrawManagerV5.FeeBase.PARTICIPANT_YIELD_ONLY, recipients, bps);

        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 10 ether}();

        vm.warp(START + PERIOD / 2);
        vm.deal(sponsor, 10 ether);
        vm.prank(sponsor);
        vault.sponsorDeposit{value: 10 ether}();

        vm.warp(START + PERIOD);
        shmon.setRate(2 ether);

        manager.startDraw();

        (,,,,,,,,,,,, uint256 grossYield, uint256 sponsorYield, uint256 feeAmount) = manager.draws(1);
        uint256 halfPeriod = uint256(PERIOD) / 2;
        uint256 expectedSponsorYield =
            (grossYield * (10 ether * halfPeriod)) / (10 ether * uint256(PERIOD) + 10 ether * halfPeriod);
        uint256 expectedFee = ((grossYield - expectedSponsorYield) * 1_000) / 10_000;
        assertEq(grossYield, 20 ether);
        assertEq(sponsorYield, expectedSponsorYield);
        assertEq(feeAmount, expectedFee);
    }

    function test_fundPrizeCancelUnstartedRefundsUnreservedTokens() public {
        MockERC20 reward = new MockERC20("Reward", "RWD", 18);
        reward.mint(alice, 10 ether);
        manager.setRewardTokenAllowed(address(reward), true);

        vm.startPrank(alice);
        reward.approve(address(manager), 10 ether);
        uint256 scheduleId = manager.fundPrize(address(reward), 5 ether, 2);
        manager.cancelPrizeFunding(scheduleId);
        vm.stopPrank();

        assertEq(reward.balanceOf(alice), 10 ether);
        assertEq(reward.balanceOf(address(claimManager)), 0);
    }

    function test_rewardLegRegisteredWithClaimManagerOnFinalize() public {
        MockERC20 reward = new MockERC20("Reward", "RWD", 18);
        reward.mint(alice, 10 ether);
        manager.setRewardTokenAllowed(address(reward), true);
        vm.startPrank(alice);
        reward.approve(address(manager), 10 ether);
        manager.fundPrize(address(reward), 5 ether, 2);
        vm.stopPrank();

        _startSeededDraw();

        assertEq(manager.drawRewardLegCount(1), 1);
        (address token, uint256 amount) = manager.drawRewardLegAt(1, 0);
        assertEq(token, address(reward));
        assertEq(amount, 5 ether);

        vm.prank(keeper);
        manager.proposeRoot(1, bytes32(uint256(0xabc)), 2, 10 ether);
        vm.warp(block.timestamp + CHALLENGE);
        manager.finalizeRoot(1);

        bytes32 distributionId = claimManager.distributionIdFor(address(manager), bytes32(uint256(1)));
        assertEq(claimManager.distributionTokenTotal(distributionId, address(0)), 10 ether);
        assertEq(claimManager.distributionTokenTotal(distributionId, address(reward)), 5 ether);
    }

    function test_fundPrizeCancelAfterOneDrawRefundsOnlyRemainingDraws() public {
        MockERC20 reward = new MockERC20("Reward", "RWD", 18);
        reward.mint(alice, 15 ether);
        manager.setRewardTokenAllowed(address(reward), true);
        vm.startPrank(alice);
        reward.approve(address(manager), 15 ether);
        uint256 scheduleId = manager.fundPrize(address(reward), 5 ether, 3);
        vm.stopPrank();

        _startSeededDraw();
        assertEq(manager.drawRewardLegCount(1), 1);

        vm.prank(alice);
        manager.cancelPrizeFunding(scheduleId);

        assertEq(reward.balanceOf(alice), 10 ether);
        assertEq(reward.balanceOf(address(claimManager)), 5 ether);
        (,,,, uint32 remainingDraws, bool cancelled) = manager.rewardSchedules(scheduleId);
        assertEq(remainingDraws, 0);
        assertTrue(cancelled);
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
        (, , , , , , , , , , , status, , ,) = manager.draws(drawId);
    }
}
