// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";
import {
    PoolTogetherV5TwabReference,
    SmallPoolTogetherV5TwabReference
} from "./upstream/PoolTogetherV5TwabReference.sol";

contract SmallDifferentialTwabController is EverdrawTwabController {
    constructor(uint32 periodLength, uint32 periodOffset) EverdrawTwabController(periodLength, periodOffset) {}

    function _maxCardinality() internal pure override returns (uint16) {
        return 8;
    }
}

contract DifferentialTwabVaultHarness {
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

    function transfer(address from, address to, uint256 amount) external {
        controller.transferBalance(from, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external {
        controller.transferBalance(from, to, amount);
    }

    function sponsorDeposit(address account, uint256 amount) external {
        controller.increaseSponsorBalance(account, amount);
    }
}

contract EverdrawTwabControllerDifferentialTest is Test {
    EverdrawTwabController everdraw;
    PoolTogetherV5TwabReference upstream;
    DifferentialTwabVaultHarness vault;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address sponsor = address(0x5A0);

    uint32 constant PERIOD = 1 hours;
    uint32 constant OFFSET = 100 hours;

    function setUp() public {
        vm.warp(OFFSET);
        everdraw = new EverdrawTwabController(PERIOD, OFFSET);
        upstream = new PoolTogetherV5TwabReference(PERIOD, OFFSET);
        vault = new DifferentialTwabVaultHarness(everdraw);
        everdraw.registerVault(address(vault));
    }

    function test_differential_samePeriodOverwriteMatchesUpstream() public {
        _deposit(alice, 10 ether);
        vm.warp(OFFSET + 20 minutes);
        _deposit(alice, 5 ether);

        _assertAccountDetailsMatch(alice);
        _assertNewestObservationMatch(alice);
        _assertOldestObservationMatch(alice);
        assertEq(
            everdraw.getBalanceAt(address(vault), alice, OFFSET), upstream.getBalanceAt(address(vault), alice, OFFSET)
        );
    }

    function test_differential_binarySearchTwabMatchesUpstreamAcrossSparseWrites() public {
        _deposit(alice, 100 ether);
        vm.warp(OFFSET + 2 hours);
        _deposit(alice, 25 ether);
        vm.warp(OFFSET + 5 hours);
        _withdraw(alice, 40 ether);
        vm.warp(OFFSET + 9 hours);
        _deposit(alice, 15 ether);

        vm.warp(OFFSET + 12 hours);

        uint256[4] memory starts =
            [uint256(OFFSET), uint256(OFFSET + 1 hours), uint256(OFFSET + 2 hours), uint256(OFFSET + 6 hours)];
        uint256[4] memory ends = [
            uint256(OFFSET + 4 hours), uint256(OFFSET + 8 hours), uint256(OFFSET + 10 hours), uint256(OFFSET + 11 hours)
        ];

        for (uint256 i = 0; i < starts.length; i++) {
            assertEq(
                everdraw.getTwabBetween(address(vault), alice, starts[i], ends[i]),
                upstream.getTwabBetween(address(vault), alice, starts[i], ends[i])
            );
        }

        _assertAccountDetailsMatch(alice);
        _assertNewestObservationMatch(alice);
        _assertOldestObservationMatch(alice);
    }

    function test_differential_participantTotalMatchesUpstreamTotalSupplyPath() public {
        _deposit(alice, 100 ether);
        vm.warp(OFFSET + 1 hours);
        _deposit(bob, 300 ether);
        vm.warp(OFFSET + 3 hours);
        _withdraw(alice, 40 ether);
        vm.warp(OFFSET + 5 hours);

        assertEq(
            everdraw.getTotalTwabBetween(address(vault), OFFSET, OFFSET + 5 hours),
            upstream.getTotalSupplyTwabBetween(address(vault), OFFSET, OFFSET + 5 hours)
        );
        assertEq(
            everdraw.totalParticipantSupply(address(vault)),
            upstream.getTotalSupplyDetails(address(vault)).delegateBalance
        );
    }

    function test_differential_transferMatchesUpstreamAccountPaths() public {
        _deposit(alice, 100 ether);
        vm.warp(OFFSET + 1 hours);
        _transfer(alice, bob, 40 ether);
        vm.warp(OFFSET + 3 hours);

        assertEq(
            everdraw.getTwabBetween(address(vault), alice, OFFSET, OFFSET + 3 hours),
            upstream.getTwabBetween(address(vault), alice, OFFSET, OFFSET + 3 hours)
        );
        assertEq(
            everdraw.getTwabBetween(address(vault), bob, OFFSET, OFFSET + 3 hours),
            upstream.getTwabBetween(address(vault), bob, OFFSET, OFFSET + 3 hours)
        );
        assertEq(
            everdraw.getTotalTwabBetween(address(vault), OFFSET, OFFSET + 3 hours),
            upstream.getTotalSupplyTwabBetween(address(vault), OFFSET, OFFSET + 3 hours)
        );
    }

    function test_differential_transferFromMatchesUpstreamAccountPaths() public {
        _deposit(alice, 100 ether);
        vm.warp(OFFSET + 2 hours);
        _transferFrom(alice, bob, 25 ether);
        vm.warp(OFFSET + 4 hours);

        assertEq(
            everdraw.getTwabBetween(address(vault), alice, OFFSET, OFFSET + 4 hours),
            upstream.getTwabBetween(address(vault), alice, OFFSET, OFFSET + 4 hours)
        );
        assertEq(
            everdraw.getTwabBetween(address(vault), bob, OFFSET, OFFSET + 4 hours),
            upstream.getTwabBetween(address(vault), bob, OFFSET, OFFSET + 4 hours)
        );
    }

    function test_differential_emptyAlignedPeriodBeforeFirstObservationMatchesUpstream() public {
        vm.warp(OFFSET + PERIOD + 760);
        _deposit(alice, 100 ether);
        vm.warp(OFFSET + 3 * PERIOD);

        uint256 periodStart = OFFSET;
        uint256 periodEnd = OFFSET + PERIOD;

        assertEq(
            everdraw.getTwabBetween(address(vault), alice, periodStart, periodEnd),
            upstream.getTwabBetween(address(vault), alice, periodStart, periodEnd)
        );
        assertEq(
            everdraw.getTotalTwabBetween(address(vault), periodStart, periodEnd),
            upstream.getTotalSupplyTwabBetween(address(vault), periodStart, periodEnd)
        );
        assertEq(everdraw.getTotalTwabBetween(address(vault), periodStart, periodEnd), 0);
    }

    function test_differential_sponsorZeroDelegateSkipsAccountObservationLikeUpstream() public {
        vault.sponsorDeposit(sponsor, 300 ether);
        upstream.increaseBalances(address(vault), sponsor, 300 ether, 0);

        EverdrawTwabController.AccountDetails memory everdrawDetails =
            everdraw.getAccountDetails(address(vault), sponsor);
        PoolTogetherV5TwabReference.AccountDetails memory upstreamDetails =
            upstream.getAccountDetails(address(vault), sponsor);

        assertEq(everdrawDetails.balance, upstreamDetails.balance);
        assertEq(everdrawDetails.delegateBalance, upstreamDetails.delegateBalance);
        assertEq(everdrawDetails.cardinality, upstreamDetails.cardinality);
        assertEq(everdrawDetails.nextObservationIndex, upstreamDetails.nextObservationIndex);
    }

    function test_differential_ringBufferWraparoundMatchesUpstream() public {
        SmallDifferentialTwabController smallEverdraw = new SmallDifferentialTwabController(PERIOD, OFFSET);
        SmallPoolTogetherV5TwabReference smallUpstream = new SmallPoolTogetherV5TwabReference(PERIOD, OFFSET);
        DifferentialTwabVaultHarness smallVault = new DifferentialTwabVaultHarness(smallEverdraw);
        smallEverdraw.registerVault(address(smallVault));

        smallVault.deposit(alice, 1 ether);
        smallUpstream.increaseBalances(address(smallVault), alice, 1 ether, 1 ether);

        uint256 maxCardinality = 8;
        for (uint256 i = 1; i <= maxCardinality + 1; i++) {
            vm.warp(OFFSET + i * PERIOD);
            smallVault.deposit(alice, 1 ether);
            smallUpstream.increaseBalances(address(smallVault), alice, 1 ether, 1 ether);
        }

        vm.warp(OFFSET + (maxCardinality + 2) * PERIOD);

        EverdrawTwabController.AccountDetails memory everdrawDetails =
            smallEverdraw.getAccountDetails(address(smallVault), alice);
        PoolTogetherV5TwabReference.AccountDetails memory upstreamDetails =
            smallUpstream.getAccountDetails(address(smallVault), alice);
        assertEq(everdrawDetails.balance, upstreamDetails.balance);
        assertEq(everdrawDetails.delegateBalance, upstreamDetails.delegateBalance);
        assertEq(everdrawDetails.nextObservationIndex, upstreamDetails.nextObservationIndex);
        assertEq(everdrawDetails.cardinality, upstreamDetails.cardinality);

        (uint16 everdrawOldestIndex, EverdrawTwabController.Observation memory everdrawOldest) =
            smallEverdraw.getOldestObservation(address(smallVault), alice);
        (uint16 upstreamOldestIndex, PoolTogetherV5TwabReference.Observation memory upstreamOldest) =
            smallUpstream.getOldestObservation(address(smallVault), alice);
        assertEq(everdrawOldestIndex, upstreamOldestIndex);
        assertEq(everdrawOldest.cumulativeBalance, upstreamOldest.cumulativeBalance);
        assertEq(everdrawOldest.balance, upstreamOldest.balance);
        assertEq(everdrawOldest.timestamp, upstreamOldest.timestamp);

        uint256 start = OFFSET + maxCardinality * PERIOD;
        uint256 end = OFFSET + (maxCardinality + 1) * PERIOD;
        assertEq(
            smallEverdraw.getTwabBetween(address(smallVault), alice, start, end),
            smallUpstream.getTwabBetween(address(smallVault), alice, start, end)
        );
    }

    function _deposit(address account, uint96 amount) internal {
        vault.deposit(account, amount);
        upstream.increaseBalances(address(vault), account, amount, amount);
        upstream.increaseTotalSupplyBalances(address(vault), amount, amount);
    }

    function _withdraw(address account, uint96 amount) internal {
        vault.withdraw(account, amount);
        upstream.decreaseBalances(address(vault), account, amount, amount);
        upstream.decreaseTotalSupplyBalances(address(vault), amount, amount);
    }

    function _transfer(address from, address to, uint96 amount) internal {
        vault.transfer(from, to, amount);
        _upstreamTransfer(from, to, amount);
    }

    function _transferFrom(address from, address to, uint96 amount) internal {
        vault.transferFrom(from, to, amount);
        _upstreamTransfer(from, to, amount);
    }

    function _upstreamTransfer(address from, address to, uint96 amount) internal {
        upstream.decreaseBalances(address(vault), from, amount, amount);
        upstream.increaseBalances(address(vault), to, amount, amount);
    }

    function _assertAccountDetailsMatch(address account) internal view {
        EverdrawTwabController.AccountDetails memory everdrawDetails =
            everdraw.getAccountDetails(address(vault), account);
        PoolTogetherV5TwabReference.AccountDetails memory upstreamDetails =
            upstream.getAccountDetails(address(vault), account);

        assertEq(everdrawDetails.balance, upstreamDetails.balance);
        assertEq(everdrawDetails.delegateBalance, upstreamDetails.delegateBalance);
        assertEq(everdrawDetails.nextObservationIndex, upstreamDetails.nextObservationIndex);
        assertEq(everdrawDetails.cardinality, upstreamDetails.cardinality);
    }

    function _assertNewestObservationMatch(address account) internal view {
        (uint16 everdrawIndex, EverdrawTwabController.Observation memory everdrawObservation) =
            everdraw.getNewestObservation(address(vault), account);
        (uint16 upstreamIndex, PoolTogetherV5TwabReference.Observation memory upstreamObservation) =
            upstream.getNewestObservation(address(vault), account);

        assertEq(everdrawIndex, upstreamIndex);
        _assertObservationMatch(everdrawObservation, upstreamObservation);
    }

    function _assertOldestObservationMatch(address account) internal view {
        (uint16 everdrawIndex, EverdrawTwabController.Observation memory everdrawObservation) =
            everdraw.getOldestObservation(address(vault), account);
        (uint16 upstreamIndex, PoolTogetherV5TwabReference.Observation memory upstreamObservation) =
            upstream.getOldestObservation(address(vault), account);

        assertEq(everdrawIndex, upstreamIndex);
        _assertObservationMatch(everdrawObservation, upstreamObservation);
    }

    function _assertObservationMatch(
        EverdrawTwabController.Observation memory everdrawObservation,
        PoolTogetherV5TwabReference.Observation memory upstreamObservation
    ) internal pure {
        assertEq(everdrawObservation.cumulativeBalance, upstreamObservation.cumulativeBalance);
        assertEq(everdrawObservation.balance, upstreamObservation.balance);
        assertEq(everdrawObservation.timestamp, upstreamObservation.timestamp);
    }
}
