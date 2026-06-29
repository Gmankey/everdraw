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

contract RejectNativeFeeRecipient {
    receive() external payable {
        revert("reject native");
    }
}

contract DrawManagerV5Test is Test {
    uint64 constant START = 1_000_000;
    uint64 constant PERIOD = 1 weeks;
    uint64 constant GRACE = 12 hours;
    uint64 constant CHALLENGE = 8 hours;

    event DrawSkipped(
        uint256 indexed drawId,
        uint64 periodStart,
        uint64 periodEnd,
        uint256 totalTwab,
        uint256 availablePrize,
        string reason
    );

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
    address booster = makeAddr("booster");

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
            uint64 expectedStart = START + uint64(i - 1) * PERIOD;
            uint64 expectedEnd = START + uint64(i) * PERIOD;

            vm.expectEmit(true, false, false, true, address(manager));
            emit DrawSkipped(i, expectedStart, expectedEnd, 0, 0, "ZERO_TWAB");
            manager.startDraw();
            assertEq(manager.nextPeriodStart(), expectedEnd);
            assertEq(oracle.nextRequestId(), 1);
            (
                uint64 periodStart,
                uint64 periodEnd,,,
                uint256 totalTwab,
                uint256 totalPayout,,,,,,
                DrawManagerV5.DrawStatus status,,,
            ) = manager.draws(i);
            assertEq(periodStart, expectedStart);
            assertEq(periodEnd, expectedEnd);
            assertEq(totalTwab, 0);
            assertEq(totalPayout, 0);
            assertEq(uint8(status), uint8(DrawManagerV5.DrawStatus.Skipped));
            vm.warp(START + uint64(i + 1) * PERIOD);
        }
    }

    function test_constructorRejectsDrawPeriodsNotAlignedToTwabGrid() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                DrawManagerV5.BadTwabPeriodAlignment.selector, uint64(START + 1), PERIOD, uint32(1 hours), uint32(START)
            )
        );
        new DrawManagerV5(
            address(vault),
            address(twab),
            address(claimManager),
            address(oracle),
            guardian,
            keeper,
            START + 1,
            PERIOD,
            GRACE,
            CHALLENGE
        );
    }

    function test_zeroParticipantTwabSkipInvariantHoldsWithSponsorYield() public {
        vm.deal(sponsor, 10 ether);
        vm.prank(sponsor);
        vault.sponsorDeposit{value: 10 ether}();

        vm.warp(START + PERIOD);
        shmon.setRate(2 ether);

        uint256 drawId = manager.startDraw();

        assertEq(drawId, 1);
        assertEq(oracle.nextRequestId(), 1);
        assertEq(uint8(_status(1)), uint8(DrawManagerV5.DrawStatus.Skipped));
        assertEq(manager.nextPeriodStart(), START + PERIOD);

        (,,,, uint256 totalTwab, uint256 totalPayout,,,,,,,,,) = manager.draws(1);
        assertEq(totalTwab, 0);
        assertEq(totalPayout, 0);
        assertEq(address(claimManager).balance, 0);
        assertEq(vault.availableYield(), 10 ether);
    }

    function test_boostOnlyTwabSkipsWithZeroOddsAndPreservesYieldInPot() public {
        vm.deal(booster, 10 ether);
        vm.prank(booster);
        vault.boostDeposit{value: 10 ether}();

        vm.warp(START + PERIOD);
        shmon.setRate(2 ether);

        uint256 drawId = manager.startDraw();

        assertEq(drawId, 1);
        assertEq(oracle.nextRequestId(), 1);
        assertEq(uint8(_status(1)), uint8(DrawManagerV5.DrawStatus.Skipped));
        assertEq(manager.nextPeriodStart(), START + PERIOD);

        (,,,, uint256 totalTwab, uint256 totalPayout,,,,,,,,,) = manager.draws(1);
        assertEq(totalTwab, 0);
        assertEq(totalPayout, 0);
        assertEq(vault.availableYield(), 10 ether);
        assertEq(twab.getTotalTwabBetween(address(vault), START, START + PERIOD), 0);
        assertEq(twab.getDelegateTwabBetween(address(vault), twab.BOOSTER_DELEGATE(), START, START + PERIOD), 10 ether);
    }

    function test_zeroPrizeSkipsWithoutVrfSpend() public {
        _depositAcrossFullPeriod(10 ether);

        uint256 drawId = manager.startDraw();

        assertEq(drawId, 1);
        assertEq(oracle.nextRequestId(), 1);
        assertEq(uint8(_status(1)), uint8(DrawManagerV5.DrawStatus.Skipped));
    }

    function test_previewStartDrawReportsNotDue() public view {
        (bool due, bool willSkip, uint256 requiredFee) = manager.previewStartDraw();

        assertFalse(due);
        assertFalse(willSkip);
        assertEq(requiredFee, 0);
    }

    function test_previewStartDrawReportsSkipWithoutOracleFee() public {
        oracle.setFee(0.01 ether);
        vm.warp(START + PERIOD);

        (bool due, bool willSkip, uint256 requiredFee) = manager.previewStartDraw();

        assertTrue(due);
        assertTrue(willSkip);
        assertEq(requiredFee, 0);
    }

    function test_previewStartDrawReportsRequiredFeeForRealDraw() public {
        _depositAcrossFullPeriod(10 ether);
        shmon.setRate(2 ether);
        oracle.setFee(0.01 ether);

        (bool due, bool willSkip, uint256 requiredFee) = manager.previewStartDraw();

        assertTrue(due);
        assertFalse(willSkip);
        assertEq(requiredFee, 0.01 ether);
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

        vm.expectRevert(
            abi.encodeWithSelector(DrawManagerV5.VetoCooldownActive.selector, uint64(block.timestamp + 1 hours))
        );
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

        (,,,,,,,,,, address proposer,,,,) = manager.draws(1);
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

    function test_feeBaseParticipantYieldOnlyExemptsBoosterYield() public {
        address[] memory recipients = new address[](1);
        uint16[] memory bps = new uint16[](1);
        recipients[0] = feeRecipient;
        bps[0] = 1_000;
        manager.setFeeConfig(DrawManagerV5.FeeBase.PARTICIPANT_YIELD_ONLY, recipients, bps);

        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 10 ether}();

        vm.deal(booster, 10 ether);
        vm.prank(booster);
        vault.boostDeposit{value: 10 ether}();

        vm.warp(START + PERIOD);
        shmon.setRate(2 ether);

        manager.startDraw();

        (,,,, uint256 totalTwab,,,,,,,, uint256 grossYield, uint256 sponsorYield, uint256 feeAmount) = manager.draws(1);
        assertEq(totalTwab, 10 ether);
        assertEq(grossYield, 20 ether);
        assertEq(sponsorYield, 0);
        assertEq(feeAmount, 1 ether);
    }

    function test_feeRecipientLeavesAreDeterministicAndDeferredIfNativeTransferReverts() public {
        RejectNativeFeeRecipient rejectingRecipient = new RejectNativeFeeRecipient();
        address[] memory recipients = new address[](1);
        uint16[] memory bps = new uint16[](1);
        recipients[0] = address(rejectingRecipient);
        bps[0] = 1_000;
        manager.setFeeConfig(DrawManagerV5.FeeBase.TOTAL_PRIZE, recipients, bps);

        _startSeededDraw();

        assertEq(manager.plannedClaimLeafCount(1), 2);
        ClaimManagerV5.ClaimLeaf[] memory leaves = new ClaimManagerV5.ClaimLeaf[](2);
        leaves[0] = manager.plannedClaimLeafAt(1, 0, alice);
        leaves[1] = manager.plannedClaimLeafAt(1, 1, alice);
        assertEq(leaves[0].account, alice);
        assertEq(leaves[0].token, address(0));
        assertEq(leaves[0].amount, 9 ether);
        assertEq(leaves[1].account, address(rejectingRecipient));
        assertEq(leaves[1].token, address(0));
        assertEq(leaves[1].amount, 1 ether);

        bytes32[] memory hashes = _hashLeaves(leaves);
        vm.prank(keeper);
        manager.proposeRoot(1, _root2(hashes[0], hashes[1]), 2, 10 ether);
        vm.warp(block.timestamp + CHALLENGE);
        manager.finalizeRoot(1);

        bytes32[][] memory proofs = new bytes32[][](2);
        proofs[0] = _proof1(hashes[1]);
        proofs[1] = _proof1(hashes[0]);
        claimManager.claimMany(leaves, proofs);

        assertEq(alice.balance, 9 ether);
        (address account, address token, uint256 amount) = claimManager.deferredClaims(leaves[1].distributionId, 1);
        assertEq(account, address(rejectingRecipient));
        assertEq(token, address(0));
        assertEq(amount, 1 ether);
    }

    function test_plannedFeeLeavesSnapshotConfigAtDrawStart() public {
        address[] memory recipients = new address[](1);
        uint16[] memory bps = new uint16[](1);
        recipients[0] = feeRecipient;
        bps[0] = 1_000;
        manager.setFeeConfig(DrawManagerV5.FeeBase.TOTAL_PRIZE, recipients, bps);

        _startSeededDraw();

        recipients[0] = makeAddr("newFeeRecipient");
        bps[0] = 2_000;
        manager.setFeeConfig(DrawManagerV5.FeeBase.TOTAL_PRIZE, recipients, bps);

        ClaimManagerV5.ClaimLeaf memory feeLeaf = manager.plannedClaimLeafAt(1, 1, alice);
        assertEq(manager.plannedClaimLeafCount(1), 2);
        assertEq(feeLeaf.account, feeRecipient);
        assertEq(feeLeaf.amount, 1 ether);
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

    function test_rewardFeeLeavesPayInKindAcrossNativeAndRewardLegs() public {
        MockERC20 reward = new MockERC20("Reward", "RWD", 18);
        reward.mint(alice, 10 ether);
        manager.setRewardTokenAllowed(address(reward), true);

        address[] memory recipients = new address[](1);
        uint16[] memory bps = new uint16[](1);
        recipients[0] = feeRecipient;
        bps[0] = 1_000;
        manager.setFeeConfig(DrawManagerV5.FeeBase.TOTAL_PRIZE, recipients, bps);

        vm.startPrank(alice);
        reward.approve(address(manager), 10 ether);
        manager.fundPrize(address(reward), 10 ether, 1);
        vm.stopPrank();

        _startSeededDraw();

        assertEq(manager.plannedClaimLeafCount(1), 4);
        ClaimManagerV5.ClaimLeaf[] memory leaves = new ClaimManagerV5.ClaimLeaf[](4);
        for (uint256 i = 0; i < leaves.length; i++) {
            leaves[i] = manager.plannedClaimLeafAt(1, i, alice);
        }
        assertEq(leaves[0].account, alice);
        assertEq(leaves[0].token, address(0));
        assertEq(leaves[0].amount, 9 ether);
        assertEq(leaves[1].account, feeRecipient);
        assertEq(leaves[1].token, address(0));
        assertEq(leaves[1].amount, 1 ether);
        assertEq(leaves[2].account, alice);
        assertEq(leaves[2].token, address(reward));
        assertEq(leaves[2].amount, 9 ether);
        assertEq(leaves[3].account, feeRecipient);
        assertEq(leaves[3].token, address(reward));
        assertEq(leaves[3].amount, 1 ether);

        bytes32[] memory hashes = _hashLeaves(leaves);
        vm.prank(keeper);
        manager.proposeRoot(1, _root4(hashes), 4, 10 ether);
        vm.warp(block.timestamp + CHALLENGE);
        manager.finalizeRoot(1);
        claimManager.claimMany(leaves, _proofs4(hashes));

        assertEq(alice.balance, 9 ether);
        assertEq(feeRecipient.balance, 1 ether);
        assertEq(reward.balanceOf(alice), 9 ether);
        assertEq(reward.balanceOf(feeRecipient), 1 ether);
    }

    function test_sponsor5a5b5c5dEndToEnd() public {
        MockERC20 reward = new MockERC20("Reward", "RWD", 18);
        reward.mint(alice, 3 ether);
        manager.setRewardTokenAllowed(address(reward), true);
        manager.setRewardTokenAllowed(address(0), true);

        vm.deal(alice, 12 ether);
        vm.startPrank(alice);
        reward.approve(address(manager), 3 ether);
        manager.fundPrize(address(reward), 3 ether, 1);
        manager.fundPrize{value: 2 ether}(address(0), 2 ether, 1);
        vm.stopPrank();

        vm.prank(alice);
        vault.deposit{value: 10 ether}();

        vm.deal(sponsor, 10 ether);
        vm.prank(sponsor);
        vault.sponsorDeposit{value: 10 ether}();
        assertEq(twab.delegateBalanceOf(address(vault), twab.SPONSOR_DELEGATE()), 10 ether);
        assertEq(vault.totalSupply(), 10 ether);

        vm.warp(START + PERIOD);
        shmon.setRate(2 ether);
        vm.deal(address(shmon), 40 ether);
        manager.startDraw();
        oracle.fulfill(1, bytes32(uint256(0xbeef)));

        assertEq(manager.drawRewardLegCount(1), 2);
        (address rewardToken, uint256 rewardAmount) = manager.drawRewardLegAt(1, 0);
        (address nativeToken, uint256 nativeAmount) = manager.drawRewardLegAt(1, 1);
        assertEq(rewardToken, address(reward));
        assertEq(rewardAmount, 3 ether);
        assertEq(nativeToken, address(0));
        assertEq(nativeAmount, 2 ether);

        (,,,, uint256 totalTwab,,,,,,,, uint256 grossYield, uint256 sponsorYield,) = manager.draws(1);
        assertEq(totalTwab, 10 ether);
        assertEq(grossYield, 20 ether);
        assertEq(sponsorYield, 10 ether);

        ClaimManagerV5.ClaimLeaf[] memory leaves = new ClaimManagerV5.ClaimLeaf[](3);
        for (uint256 i = 0; i < leaves.length; i++) {
            leaves[i] = manager.plannedClaimLeafAt(1, i, alice);
        }
        assertEq(leaves[0].token, address(0));
        assertEq(leaves[0].amount, 20 ether);
        assertEq(leaves[1].token, address(reward));
        assertEq(leaves[1].amount, 3 ether);
        assertEq(leaves[2].token, address(0));
        assertEq(leaves[2].amount, 2 ether);

        bytes32[] memory hashes = _hashLeaves(leaves);
        vm.prank(keeper);
        manager.proposeRoot(1, _root3(hashes), 3, 20 ether);
        vm.warp(block.timestamp + CHALLENGE);
        manager.finalizeRoot(1);
        claimManager.claimMany(leaves, _proofs3(hashes));

        assertEq(alice.balance, 22 ether);
        assertEq(reward.balanceOf(alice), 3 ether);

        uint256 sponsorBefore = sponsor.balance;
        vm.prank(sponsor);
        vault.withdrawSponsor(10 ether);
        assertEq(vault.sponsorPrincipalOf(sponsor), 0);
        assertEq(sponsor.balance, sponsorBefore + 10 ether);
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
        (,,,,,,,,,,, status,,,) = manager.draws(drawId);
    }

    function _hashLeaves(ClaimManagerV5.ClaimLeaf[] memory leaves) internal view returns (bytes32[] memory hashes) {
        hashes = new bytes32[](leaves.length);
        for (uint256 i = 0; i < leaves.length; i++) {
            hashes[i] = claimManager.hashLeaf(leaves[i]);
        }
    }

    function _proof1(bytes32 sibling) internal pure returns (bytes32[] memory proof) {
        proof = new bytes32[](1);
        proof[0] = sibling;
    }

    function _root2(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _root3(bytes32[] memory hashes) internal pure returns (bytes32) {
        return _root2(_root2(hashes[0], hashes[1]), hashes[2]);
    }

    function _root4(bytes32[] memory hashes) internal pure returns (bytes32) {
        return _root2(_root2(hashes[0], hashes[1]), _root2(hashes[2], hashes[3]));
    }

    function _proofs3(bytes32[] memory hashes) internal pure returns (bytes32[][] memory proofs) {
        proofs = new bytes32[][](3);
        proofs[0] = new bytes32[](2);
        proofs[0][0] = hashes[1];
        proofs[0][1] = hashes[2];
        proofs[1] = new bytes32[](2);
        proofs[1][0] = hashes[0];
        proofs[1][1] = hashes[2];
        proofs[2] = new bytes32[](1);
        proofs[2][0] = _root2(hashes[0], hashes[1]);
    }

    function _proofs4(bytes32[] memory hashes) internal pure returns (bytes32[][] memory proofs) {
        bytes32 left = _root2(hashes[0], hashes[1]);
        bytes32 right = _root2(hashes[2], hashes[3]);
        proofs = new bytes32[][](4);
        proofs[0] = new bytes32[](2);
        proofs[0][0] = hashes[1];
        proofs[0][1] = right;
        proofs[1] = new bytes32[](2);
        proofs[1][0] = hashes[0];
        proofs[1][1] = right;
        proofs[2] = new bytes32[](2);
        proofs[2][0] = hashes[3];
        proofs[2][1] = left;
        proofs[3] = new bytes32[](2);
        proofs[3][0] = hashes[2];
        proofs[3][1] = left;
    }
}
