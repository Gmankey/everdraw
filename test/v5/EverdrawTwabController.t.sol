// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";

contract SmallCardinalityTwabController is EverdrawTwabController {
    constructor(uint32 periodLength, uint32 periodOffset) EverdrawTwabController(periodLength, periodOffset) {}

    function _maxCardinality() internal pure override returns (uint16) {
        return 8;
    }
}

contract EverdrawTwabVaultHarness {
    EverdrawTwabController public immutable controller;

    constructor(EverdrawTwabController _controller) {
        controller = _controller;
    }

    function deposit(address account, uint256 amount) external {
        controller.increaseBalance(account, amount);
    }

    function withdraw(address account, uint256 amount) external {
        controller.decreaseBalance(account, amount);
    }

    function sponsorDeposit(address account, uint256 amount) external {
        controller.increaseSponsorBalance(account, amount);
    }

    function sponsorWithdraw(address account, uint256 amount) external {
        controller.decreaseSponsorBalance(account, amount);
    }
}

contract EverdrawTwabControllerTest is Test {
    EverdrawTwabController controller;
    EverdrawTwabVaultHarness vault;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address sponsor = address(0x5A0);

    uint32 constant PERIOD = 1 hours;
    uint32 constant OFFSET = 100 hours;

    function setUp() public {
        vm.warp(OFFSET);
        controller = new EverdrawTwabController(PERIOD, OFFSET);
        vault = new EverdrawTwabVaultHarness(controller);
        controller.registerVault(address(vault));
    }

    function test_onlyRegisteredVaultCanWrite() public {
        vm.expectRevert(EverdrawTwabController.NotRegisteredVault.selector);
        controller.increaseBalance(alice, 1 ether);
    }

    function test_onlyOwnerCanRegisterVault() public {
        EverdrawTwabVaultHarness anotherVault = new EverdrawTwabVaultHarness(controller);

        vm.prank(alice);
        vm.expectRevert(EverdrawTwabController.NotOwner.selector);
        controller.registerVault(address(anotherVault));
    }

    function test_samePeriodUpdatesOverwriteOneObservation() public {
        vault.deposit(alice, 10 ether);
        vm.warp(OFFSET + 20 minutes);
        vault.deposit(alice, 5 ether);

        EverdrawTwabController.AccountDetails memory details = controller.getAccountDetails(address(vault), alice);
        assertEq(details.balance, 15 ether);
        assertEq(details.delegateBalance, 15 ether);
        assertEq(details.cardinality, 1);

        (, EverdrawTwabController.Observation memory newest) = controller.getNewestObservation(address(vault), alice);
        assertEq(newest.balance, 15 ether);
        assertEq(newest.timestamp, 20 minutes);
    }

    function test_twabWeightsBalanceByTime() public {
        vault.deposit(alice, 100 ether);
        vm.warp(OFFSET + 1 hours);
        vault.deposit(alice, 100 ether);
        vm.warp(OFFSET + 3 hours);

        assertEq(controller.getTwabBetween(address(vault), alice, OFFSET, OFFSET + 2 hours), 150 ether);
        assertEq(controller.getTwabBetween(address(vault), alice, OFFSET, OFFSET + 3 hours), 166666666666666666666);
    }

    function test_zeroLengthTwabReturnsBalanceAtTime() public {
        vault.deposit(alice, 100 ether);
        vm.warp(OFFSET + 1 hours);
        vault.deposit(alice, 50 ether);
        vm.warp(OFFSET + 2 hours);

        assertEq(controller.getTwabBetween(address(vault), alice, OFFSET + 1 hours, OFFSET + 1 hours), 150 ether);
    }

    function test_preOffsetQueryIsZeroUntilFirstObservation() public {
        vault.deposit(alice, 100 ether);
        vm.warp(OFFSET + 2 hours);

        assertEq(controller.getTwabBetween(address(vault), bob, OFFSET - 2 hours, OFFSET), 0);
        assertEq(controller.getBalanceAt(address(vault), bob, OFFSET - 1 hours), 0);
    }

    function test_exactPeriodBoundaryReadUsesPreviousBalance() public {
        vault.deposit(alice, 100 ether);
        vm.warp(OFFSET + 1 hours);
        vault.withdraw(alice, 40 ether);
        vm.warp(OFFSET + 2 hours);

        assertEq(controller.getBalanceAt(address(vault), alice, OFFSET + 1 hours), 60 ether);
        assertEq(controller.getTwabBetween(address(vault), alice, OFFSET, OFFSET + 2 hours), 80 ether);
    }

    function test_totalParticipantTwabMatchesSumOfEligibleAccounts() public {
        vault.deposit(alice, 100 ether);
        vm.warp(OFFSET + 1 hours);
        vault.deposit(bob, 300 ether);
        vm.warp(OFFSET + 3 hours);

        uint256 aliceTwab = controller.getTwabBetween(address(vault), alice, OFFSET, OFFSET + 3 hours);
        uint256 bobTwab = controller.getTwabBetween(address(vault), bob, OFFSET, OFFSET + 3 hours);
        uint256 totalTwab = controller.getTotalTwabBetween(address(vault), OFFSET, OFFSET + 3 hours);

        assertEq(aliceTwab, 100 ether);
        assertEq(bobTwab, 200 ether);
        assertEq(totalTwab, aliceTwab + bobTwab);
    }

    function test_emptyAlignedPeriodBeforeFirstObservationReturnsZeroForAccountAndTotal() public {
        vm.warp(OFFSET + PERIOD + 760);
        vault.deposit(alice, 100 ether);
        vm.warp(OFFSET + 3 * PERIOD);

        uint256 periodStart = OFFSET;
        uint256 periodEnd = OFFSET + PERIOD;

        assertEq(controller.getTwabBetween(address(vault), alice, periodStart, periodEnd), 0);
        assertEq(controller.getTotalTwabBetween(address(vault), periodStart, periodEnd), 0);
        assertEq(controller.getTotalPrincipalTwabBetween(address(vault), periodStart, periodEnd), 0);
    }

    function test_sponsorBalanceHasZeroParticipantOddsButReadableDelegateTwab() public {
        vault.deposit(alice, 100 ether);
        vault.sponsorDeposit(sponsor, 300 ether);
        vm.warp(OFFSET + 2 hours);

        assertEq(controller.balanceOf(address(vault), sponsor), 300 ether);
        assertEq(controller.delegateBalanceOf(address(vault), sponsor), 0);
        assertEq(controller.totalPrincipalSupply(address(vault)), 400 ether);
        assertEq(controller.totalParticipantSupply(address(vault)), 100 ether);

        assertEq(controller.getTwabBetween(address(vault), sponsor, OFFSET, OFFSET + 2 hours), 0);
        assertEq(controller.getTotalTwabBetween(address(vault), OFFSET, OFFSET + 2 hours), 100 ether);
        assertEq(controller.getTotalPrincipalTwabBetween(address(vault), OFFSET, OFFSET + 2 hours), 400 ether);
        assertEq(
            controller.getDelegateTwabBetween(address(vault), controller.SPONSOR_DELEGATE(), OFFSET, OFFSET + 2 hours),
            300 ether
        );
    }

    function test_sponsorWithdrawalUpdatesDelegateTwab() public {
        vault.sponsorDeposit(sponsor, 100 ether);
        vm.warp(OFFSET + 1 hours);
        vault.sponsorWithdraw(sponsor, 40 ether);
        vm.warp(OFFSET + 3 hours);

        assertEq(
            controller.getDelegateTwabBetween(address(vault), controller.SPONSOR_DELEGATE(), OFFSET, OFFSET + 3 hours),
            73_333_333_333_333_333_333
        );
        assertEq(
            controller.getTotalPrincipalTwabBetween(address(vault), OFFSET, OFFSET + 3 hours),
            73_333_333_333_333_333_333
        );
    }

    function test_multiAccountSponsorTimelineMatchesReferenceModel() public {
        vault.deposit(alice, 100 ether);
        vault.sponsorDeposit(sponsor, 300 ether);

        vm.warp(OFFSET + 1 hours);
        vault.deposit(bob, 200 ether);

        vm.warp(OFFSET + 2 hours);
        vault.withdraw(alice, 40 ether);
        vault.sponsorWithdraw(sponsor, 100 ether);

        vm.warp(OFFSET + 4 hours);

        // Alice: 100 for 2h, then 60 for 2h = 80 average.
        assertEq(controller.getTwabBetween(address(vault), alice, OFFSET, OFFSET + 4 hours), 80 ether);

        // Bob: 0 for 1h, then 200 for 3h = 150 average.
        assertEq(controller.getTwabBetween(address(vault), bob, OFFSET, OFFSET + 4 hours), 150 ether);

        // Participant total: 100 for 1h, 300 for 1h, 260 for 2h = 230 average.
        assertEq(controller.getTotalTwabBetween(address(vault), OFFSET, OFFSET + 4 hours), 230 ether);

        // Sponsor delegate: 300 for 2h, then 200 for 2h = 250 average.
        assertEq(
            controller.getDelegateTwabBetween(address(vault), controller.SPONSOR_DELEGATE(), OFFSET, OFFSET + 4 hours),
            250 ether
        );

        // Full principal: 400 for 1h, 600 for 1h, 460 for 2h = 480 average.
        assertEq(controller.getTotalPrincipalTwabBetween(address(vault), OFFSET, OFFSET + 4 hours), 480 ether);
    }

    function test_queryInsideCurrentOverwritePeriodReverts() public {
        vault.deposit(alice, 10 ether);
        vm.warp(OFFSET + 30 minutes);

        vm.expectRevert(
            abi.encodeWithSelector(EverdrawTwabController.TimestampNotFinalized.selector, OFFSET + 1 hours, OFFSET)
        );
        controller.getTwabBetween(address(vault), alice, OFFSET, OFFSET + 1 hours);
    }

    function test_balanceDecreaseCannotExceedBalance() public {
        vault.deposit(alice, 10 ether);
        vm.expectRevert(abi.encodeWithSelector(EverdrawTwabController.BalanceLTAmount.selector, 10 ether, 11 ether));
        vault.withdraw(alice, 11 ether);
    }

    function test_ringBufferWraparoundKeepsRecentHistoryAndRejectsTooOldHistory() public {
        SmallCardinalityTwabController smallController = new SmallCardinalityTwabController(PERIOD, OFFSET);
        EverdrawTwabVaultHarness smallVault = new EverdrawTwabVaultHarness(smallController);
        smallController.registerVault(address(smallVault));
        uint256 maxCardinality = 8;

        smallVault.deposit(alice, 1 ether);
        for (uint256 i = 1; i <= maxCardinality + 1; i++) {
            vm.warp(OFFSET + i * PERIOD);
            smallVault.deposit(alice, 1 ether);
        }

        EverdrawTwabController.AccountDetails memory details =
            smallController.getAccountDetails(address(smallVault), alice);
        assertEq(details.cardinality, maxCardinality);

        (, EverdrawTwabController.Observation memory oldest) =
            smallController.getOldestObservation(address(smallVault), alice);
        assertEq(oldest.timestamp, 2 hours);

        vm.warp(OFFSET + (maxCardinality + 2) * PERIOD);

        vm.expectRevert(
            abi.encodeWithSelector(
                EverdrawTwabController.InsufficientHistory.selector, uint32(1 hours), uint32(2 hours)
            )
        );
        smallController.getTwabBetween(address(smallVault), alice, OFFSET, OFFSET + PERIOD);

        assertEq(
            smallController.getTwabBetween(
                address(smallVault), alice, OFFSET + maxCardinality * PERIOD, OFFSET + (maxCardinality + 1) * PERIOD
            ),
            (maxCardinality + 1) * 1 ether
        );
    }

    function testFuzz_twoEpochTwabMatchesHandCalculation(
        uint96 first,
        uint96 second,
        uint8 firstHours,
        uint8 secondHours
    ) public {
        first = uint96(bound(first, 1, 1_000_000 ether));
        second = uint96(bound(second, 1, 1_000_000 ether));
        firstHours = uint8(bound(firstHours, 1, 12));
        secondHours = uint8(bound(secondHours, 1, 12));

        vault.deposit(alice, first);
        vm.warp(OFFSET + uint256(firstHours) * PERIOD);
        vault.deposit(alice, second);

        uint256 end = OFFSET + (uint256(firstHours) + uint256(secondHours)) * PERIOD;
        vm.warp(end + PERIOD);

        uint256 expected =
            (uint256(first) * uint256(firstHours) + (uint256(first) + uint256(second)) * uint256(secondHours))
                / (uint256(firstHours) + uint256(secondHours));

        assertEq(controller.getTwabBetween(address(vault), alice, OFFSET, end), expected);
    }
}
