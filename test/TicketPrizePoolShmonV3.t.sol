// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {TicketPrizePoolShmonV3} from "../src/TicketPrizePoolShmonV3.sol";

// ============================================================
// Mocks
// ============================================================

/// @dev ShMonad mock — exchange-rate model matching production shMON (ERC-4626, non-rebasing).
///      Share count is constant; each share is worth more MON as yield accrues (rate increases).
///      No requestUnstake / completeUnstake (matching the production no-unstake design).
contract MockShMonad {
    mapping(address => uint256) private _balances;

    /// @notice Exchange rate: how many MON (in 1e18 units) per 1e18 share.
    ///         Starts at 1e18 (1:1). Increases as yield accrues.
    ///         e.g. 2e18 means 1 share = 2 MON.
    uint256 public rate = 1e18;

    /// @notice Deposit MON → shMON shares at current exchange rate.
    function deposit(uint256 assets, address receiver)
        external payable returns (uint256 shares)
    {
        require(msg.value == assets, "bad value");
        shares = (assets * 1e18) / rate;
        _balances[receiver] += shares;
        return shares;
    }

    /// @notice ERC-20 transfer of shMON shares.
    function transfer(address to, uint256 amount) external returns (bool) {
        require(_balances[msg.sender] >= amount, "insufficient shMON");
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        return true;
    }

    /// @notice ERC-20 balance.
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /// @notice ERC-4626 view: how many shares does `assets` MON buy at current rate.
    function previewDeposit(uint256 assets) external view returns (uint256) {
        return (assets * 1e18) / rate;
    }

    /// @notice Test helper: simulate yield by increasing the exchange rate.
    ///         newRate must be >= current rate (rates only go up).
    ///         e.g. simulateYield(2e18) means each share is now worth 2 MON.
    function simulateYield(uint256 newRate) external {
        require(newRate >= rate, "rate cannot decrease");
        rate = newRate;
    }

    receive() external payable {}
}

/// @dev Minimal Pyth Entropy mock.
contract MockEntropy {
    uint64 private _nextSeq = 1;
    uint128 public fee = 0.0001 ether;

    struct Request {
        address consumer;
        address provider;
    }
    mapping(uint64 => Request) public requests;

    function getFee(address /*provider*/) external view returns (uint128) {
        return fee;
    }

    function requestWithCallback(
        address provider,
        bytes32 /*userRandomNumber*/
    ) external payable returns (uint64 seq) {
        require(msg.value >= fee, "insufficient fee");
        seq = _nextSeq++;
        requests[seq] = Request({consumer: msg.sender, provider: provider});
    }

    /// @notice Simulate Pyth fulfilling a request.
    function simulateCallback(uint64 seq, bytes32 randomNumber) external {
        Request memory req = requests[seq];
        require(req.consumer != address(0), "unknown seq");
        TicketPrizePoolShmonV3(payable(req.consumer))._entropyCallback(
            seq,
            req.provider,
            randomNumber
        );
    }

    function setFee(uint128 newFee) external { fee = newFee; }

    receive() external payable {}
}

// ============================================================
// Base test setup
// ============================================================

contract V3Base is Test {
    TicketPrizePoolShmonV3 pool;
    MockShMonad shmon;
    MockEntropy entropy;

    address constant PYTH_PROVIDER = address(0xDEAD);
    uint96  constant PRICE         = 0.01 ether;
    uint32  constant ROUND_SEC     = 120;
    uint32  constant YIELD_SEC     = 300;

    address alice = makeAddr("alice");
    address bob   = makeAddr("bob");
    address carol = makeAddr("carol");

    receive() external payable {}

    uint256 constant VRF_RESERVE = 1 ether;

    function setUp() public virtual {
        shmon   = new MockShMonad();
        entropy = new MockEntropy();

        pool = new TicketPrizePoolShmonV3(
            PRICE,
            ROUND_SEC,
            YIELD_SEC,
            address(shmon),
            address(entropy),
            PYTH_PROVIDER
        );

        vm.deal(address(this), 10 ether);
        pool.depositVRFReserve{value: VRF_RESERVE}();

        vm.deal(alice, 100 ether);
        vm.deal(bob,   100 ether);
        vm.deal(carol, 100 ether);
    }

    // ---- helpers ----

    function _salesEnd(uint256 rid) internal view returns (uint64) {
        (,uint64 t,,,,,,,,,,) = pool.getRoundInfo(rid);
        return t;
    }

    function _warpPastSales(uint256 rid) internal {
        vm.warp(uint256(_salesEnd(rid)) + 1);
    }

    function _warpPastYield(uint256 rid) internal {
        vm.warp(uint256(_salesEnd(rid)) + uint256(YIELD_SEC) + 1);
    }

    function _buyTickets(address user, uint32 n) internal {
        uint256 cost = uint256(n) * uint256(PRICE);
        vm.prank(user);
        pool.buyTickets{value: cost}(n);
    }

    function _commit(uint256 rid) internal returns (uint64 seq) {
        _warpPastYield(rid);
        pool.commitDraw(rid);
        (,, uint64 s,,,,,,,,,) = pool.getRoundInfo(rid);
        return s;
    }

    function _fulfill(uint64 seq, bytes32 rnd) internal {
        entropy.simulateCallback(seq, rnd);
    }

    /// @dev Full no-unstake round: buy → commit → fulfill → finalize → Settled.
    function _fullRound(
        uint256 rid,
        address buyer,
        uint32 tickets,
        bytes32 randomNumber
    ) internal returns (address winner) {
        _buyTickets(buyer, tickets);
        uint64 seq = _commit(rid);
        _fulfill(seq, randomNumber);
        pool.finalizeDraw(rid);

        (,,,,,,,,,address w,,) = pool.getRoundInfo(rid);
        return w;
    }
}

// ============================================================
// 1. Happy-path tests
// ============================================================

contract V3_HappyPath_Test is V3Base {

    function test_happyPath_fullRound_noYield() public {
        uint256 rid = 1;

        _buyTickets(alice, 5);
        _buyTickets(bob, 5);

        uint64 seq = _commit(rid);

        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmonV3.RoundState.AwaitingVRF));

        bytes32 rnd = keccak256("test-random");
        _fulfill(seq, rnd);

        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmonV3.RoundState.Drawn));

        // finalizeDraw → directly Settled (no Finalizing, no settleRound)
        pool.finalizeDraw(rid);
        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmonV3.RoundState.Settled));

        (,,,,,,,,,address winner,,) = pool.getRoundInfo(rid);
        assertTrue(winner == alice || winner == bob, "winner must be alice or bob");

        // Winner claims prize (0 yield in this test — mock doesn't rebase)
        vm.prank(winner);
        pool.claimPrize(rid);

        // Both users withdraw principal as shMON shares
        uint256 aliceShares = shmon.balanceOf(alice);
        uint256 bobShares   = shmon.balanceOf(bob);
        assertEq(aliceShares, 0); assertEq(bobShares, 0); // nothing yet

        vm.prank(alice);
        pool.withdrawPrincipal(rid);
        vm.prank(bob);
        pool.withdrawPrincipal(rid);

        // Each deposited 5 * PRICE shares
        assertEq(shmon.balanceOf(alice), 5 * uint256(PRICE));
        assertEq(shmon.balanceOf(bob),   5 * uint256(PRICE));
    }

    function test_happyPath_fullRound_withYield() public {
        uint256 rid = 1;

        // Each user deposits 5 * PRICE MON → 5 * PRICE shares at rate 1e18 (1:1).
        _buyTickets(alice, 5);
        _buyTickets(bob, 5);
        // totalPrincipalMON = 10 * PRICE, totalPrincipalShmonShares = 10 * PRICE

        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));

        // Simulate yield: rate doubles — each share is now worth 2 MON.
        // Fair-value shares at settlement = previewDeposit(10*PRICE) = 10*PRICE / 2 = 5*PRICE
        // prizeShares = 10*PRICE − 5*PRICE = 5*PRICE
        shmon.simulateYield(2e18);

        pool.finalizeDraw(rid);

        uint256 totalDepositedShares = 10 * uint256(PRICE);
        uint256 principalAtSettle    =  5 * uint256(PRICE); // previewDeposit(10*PRICE) at rate 2e18
        uint256 expectedPrize        =  5 * uint256(PRICE); // surplus shares

        (,,,,,,,uint256 prize,,,, ) = pool.getRoundInfo(rid);
        assertEq(prize, expectedPrize, "prize = surplus shares after rate doubled");

        (,,,,,,,,,address winner,,) = pool.getRoundInfo(rid);

        uint256 winnerBefore = shmon.balanceOf(winner);
        vm.prank(winner);
        pool.claimPrize(rid);
        assertEq(shmon.balanceOf(winner) - winnerBefore, expectedPrize, "winner gets yield shares");

        // Non-winner gets proportional fair-value shares (fewer than deposited, same MON value).
        // Each user deposited 5*PRICE out of 10*PRICE total → half of principalAtSettle.
        address nonWinner = (winner == alice) ? bob : alice;
        uint256 userMON   = 5 * uint256(PRICE);
        uint256 totalMON  = 10 * uint256(PRICE);
        uint256 expectedReturn = (userMON * principalAtSettle) / totalMON; // = 5*PRICE/2 = 2.5*PRICE

        uint256 nonWinnerBefore = shmon.balanceOf(nonWinner);
        vm.prank(nonWinner);
        pool.withdrawPrincipal(rid);
        assertEq(shmon.balanceOf(nonWinner) - nonWinnerBefore, expectedReturn,
                 "non-winner gets fair-value shares (same MON, fewer shares)");

        // Sanity: totalDepositedShares = principalAtSettle + prizeShares (accounting identity)
        assertEq(principalAtSettle + expectedPrize, totalDepositedShares);
    }

    function test_winner_deterministic_from_randomNumber() public {
        uint256 rid = 1;
        _buyTickets(alice, 1); // ticket 0
        _buyTickets(bob, 1);   // ticket 1

        uint64 seq = _commit(rid);

        bytes32 rnd = bytes32(uint256(0)); // 0 % 2 = 0 → alice
        _fulfill(seq, rnd);
        pool.finalizeDraw(rid);

        (,,,,,,,,,address winner,,) = pool.getRoundInfo(rid);
        assertEq(winner, alice, "ticket 0 should be alice");
    }

    function test_second_round_opens_after_commit() public {
        uint256 rid = 1;
        _buyTickets(alice, 1);
        _commit(rid);

        assertEq(pool.currentRoundId(), 2);
        assertEq(uint8(pool.getRoundState(2)), uint8(TicketPrizePoolShmonV3.RoundState.Open));
    }

    function test_executeNext_drives_full_lifecycle() public {
        uint256 rid = 1;
        _buyTickets(alice, 3);
        _buyTickets(bob, 3);

        _warpPastYield(rid);

        // executeNext → Commit
        (uint256 r, TicketPrizePoolShmonV3.NextAction a) = pool.executeNext();
        assertEq(r, rid);
        assertEq(uint8(a), uint8(TicketPrizePoolShmonV3.NextAction.Commit));
        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmonV3.RoundState.AwaitingVRF));

        // executeNext → None (waiting for callback)
        (, TicketPrizePoolShmonV3.NextAction a2) = pool.executeNext();
        assertEq(uint8(a2), uint8(TicketPrizePoolShmonV3.NextAction.None));

        // Simulate Pyth callback
        (,, uint64 seq,,,,,,,,,) = pool.getRoundInfo(rid);
        _fulfill(seq, keccak256("rnd"));

        // executeNext → Finalize (directly → Settled, no Settle step)
        (uint256 r3, TicketPrizePoolShmonV3.NextAction a3) = pool.executeNext();
        assertEq(r3, rid);
        assertEq(uint8(a3), uint8(TicketPrizePoolShmonV3.NextAction.Finalize));
        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmonV3.RoundState.Settled));

        // No further action needed
        (, TicketPrizePoolShmonV3.NextAction a4) = pool.executeNext();
        // Round 2 is Open, cursor may return None or Skip/Commit depending on time
        // Either way, round 1 is fully settled
        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmonV3.RoundState.Settled));
    }

    function test_vrf_fee_deducted_from_reserve() public {
        uint128 fee = entropy.getFee(PYTH_PROVIDER);
        uint256 balBefore = address(pool).balance;

        uint256 rid = 1;
        _buyTickets(alice, 1);
        _commit(rid);

        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmonV3.RoundState.AwaitingVRF));
        assertTrue(balBefore - address(pool).balance >= fee, "fee must have been paid");
    }
}

// ============================================================
// 2. VRF callback edge-case tests
// ============================================================

contract V3_VRFCallback_Test is V3Base {

    function test_callback_wrong_provider_reverts() public {
        uint256 rid = 1;
        _buyTickets(alice, 1);
        uint64 seq = _commit(rid);

        vm.prank(address(entropy));
        vm.expectRevert(TicketPrizePoolShmonV3.WrongProvider.selector);
        pool._entropyCallback(seq, address(0xBAD), keccak256("rnd"));
    }

    function test_callback_unknown_sequence_is_ignored() public {
        vm.prank(address(entropy));
        pool._entropyCallback(999, PYTH_PROVIDER, keccak256("rnd"));
    }

    function test_callback_not_from_entropy_reverts() public {
        uint256 rid = 1;
        _buyTickets(alice, 1);
        uint64 seq = _commit(rid);

        vm.prank(address(0xBAD));
        vm.expectRevert("Only Entropy can call this function");
        pool._entropyCallback(seq, PYTH_PROVIDER, keccak256("rnd"));
    }

    function test_double_callback_is_ignored() public {
        uint256 rid = 1;
        _buyTickets(alice, 1);
        uint64 seq = _commit(rid);

        bytes32 rnd = keccak256("first");
        _fulfill(seq, rnd);

        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmonV3.RoundState.Drawn));

        // Second callback ignored
        vm.prank(address(entropy));
        pool._entropyCallback(seq, PYTH_PROVIDER, keccak256("second"));

        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmonV3.RoundState.Drawn));
        pool.finalizeDraw(rid);
        (,,,,,,,,,address w,,) = pool.getRoundInfo(rid);
        assertEq(w, alice); // only 1 ticket
    }

    function test_finalizeDraw_before_callback_reverts() public {
        uint256 rid = 1;
        _buyTickets(alice, 1);
        _commit(rid);

        vm.expectRevert(TicketPrizePoolShmonV3.BadState.selector);
        pool.finalizeDraw(rid);
    }

    function test_finalizeDraw_is_permissionless() public {
        uint256 rid = 1;
        _buyTickets(alice, 1);
        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));

        vm.prank(address(0x1234));
        pool.finalizeDraw(rid);

        // Directly Settled
        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmonV3.RoundState.Settled));
    }
}

// ============================================================
// 3. Fee handling tests
// ============================================================

contract V3_FeeHandling_Test is V3Base {
    event VRFReserveDeposited(address indexed by, uint256 amount);
    event VRFReserveWithdrawn(address indexed to, uint256 amount);

    function test_commit_insufficient_vrf_fee_reverts() public {
        entropy.setFee(10 ether);

        uint256 rid = 1;
        _buyTickets(alice, 1);
        _warpPastYield(rid);

        vm.expectRevert(TicketPrizePoolShmonV3.InsufficientVRFFee.selector);
        pool.commitDraw(rid);
    }

    function test_depositVRFReserve_increases_balance() public {
        uint256 balBefore = address(pool).balance;
        vm.expectEmit(true, false, false, true);
        emit VRFReserveDeposited(address(this), 1 ether);
        pool.depositVRFReserve{value: 1 ether}();
        assertEq(address(pool).balance - balBefore, 1 ether);
    }

    function test_withdrawVRFReserve_decreases_balance() public {
        uint256 balBefore = address(pool).balance;
        vm.expectEmit(true, false, false, true);
        emit VRFReserveWithdrawn(address(this), 0.5 ether);
        pool.withdrawVRFReserve(0.5 ether);
        assertEq(balBefore - address(pool).balance, 0.5 ether);
    }

    function test_withdrawVRFReserve_only_owner() public {
        vm.prank(alice);
        vm.expectRevert("not owner");
        pool.withdrawVRFReserve(0.1 ether);
    }
}

// ============================================================
// 4. Emergency escape tests (AwaitingVRF timeout only)
// ============================================================

contract V3_EmergencyEscape_Test is V3Base {

    function test_emergency_awaitingVRF_before_timeout_reverts() public {
        uint256 rid = 1;
        _buyTickets(alice, 1);
        _commit(rid);

        vm.warp(block.timestamp + 30 minutes);
        vm.expectRevert("vrf timeout not reached");
        pool.emergencyForceSettle(rid);
    }

    function test_emergency_awaitingVRF_after_timeout_settles_with_refund() public {
        uint256 rid = 1;
        _buyTickets(alice, 2);
        _buyTickets(bob, 2);

        uint256 alicePrincipalShares = 2 * uint256(PRICE);
        uint256 bobPrincipalShares   = 2 * uint256(PRICE);

        _commit(rid);

        vm.warp(block.timestamp + 1 hours + 1);
        pool.emergencyForceSettle(rid);

        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmonV3.RoundState.Settled));

        // Users recover principal shMON shares directly via withdrawPrincipal
        uint256 aliceBefore = shmon.balanceOf(alice);
        vm.prank(alice);
        pool.withdrawPrincipal(rid);
        assertEq(shmon.balanceOf(alice) - aliceBefore, alicePrincipalShares, "alice recovers shares");

        uint256 bobBefore = shmon.balanceOf(bob);
        vm.prank(bob);
        pool.withdrawPrincipal(rid);
        assertEq(shmon.balanceOf(bob) - bobBefore, bobPrincipalShares, "bob recovers shares");
    }

    function test_emergency_awaitingVRF_no_winner() public {
        uint256 rid = 1;
        _buyTickets(alice, 1);
        _commit(rid);
        vm.warp(block.timestamp + 1 hours + 1);
        pool.emergencyForceSettle(rid);

        (,,,,,,,,,address winner,,) = pool.getRoundInfo(rid);
        assertEq(winner, address(0), "no winner");
    }

    function test_emergency_wrong_state_reverts() public {
        // Open round — should revert (not AwaitingVRF)
        vm.expectRevert(TicketPrizePoolShmonV3.BadState.selector);
        pool.emergencyForceSettle(1);
    }

    function test_emergency_drawn_state_reverts() public {
        uint256 rid = 1;
        _buyTickets(alice, 1);
        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd")); // state = Drawn, not AwaitingVRF

        vm.expectRevert(TicketPrizePoolShmonV3.BadState.selector);
        pool.emergencyForceSettle(rid);
    }
}

// ============================================================
// 5. Empty-round / skip tests
// ============================================================

contract V3_EmptyRound_Test is V3Base {

    function test_skipRound_empty() public {
        uint256 rid = 1;
        _warpPastSales(rid);

        pool.skipRound(rid);

        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmonV3.RoundState.Settled));
        assertEq(pool.currentRoundId(), 2);
    }

    function test_commitDraw_empty_reverts() public {
        uint256 rid = 1;
        _warpPastYield(rid);

        vm.expectRevert(pool.legacyBytes("no tickets"));
        pool.commitDraw(rid);
    }

    function test_executeNext_skips_empty_round() public {
        uint256 rid = 1;
        _warpPastSales(rid);

        (uint256 r, TicketPrizePoolShmonV3.NextAction a) = pool.executeNext();
        assertEq(r, rid);
        assertEq(uint8(a), uint8(TicketPrizePoolShmonV3.NextAction.Skip));
    }
}

// ============================================================
// 6. Accounting / yield tests
// ============================================================

contract V3_Accounting_Test is V3Base {

    function test_yield_distributed_as_shares_to_winner() public {
        uint256 rid = 1;
        uint32 tickets = 10;

        // Alice deposits 10 * PRICE MON → 10 * PRICE shares at rate 1e18.
        _buyTickets(alice, tickets);
        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));

        // Rate doubles: each share now worth 2 MON.
        // principalSharesAtSettle = previewDeposit(10*PRICE) = 5*PRICE
        // prizeShares = 10*PRICE − 5*PRICE = 5*PRICE
        shmon.simulateYield(2e18);

        pool.finalizeDraw(rid);

        uint256 depositedMON    = tickets * uint256(PRICE);
        uint256 depositedShares = depositedMON;                     // 1:1 at initial rate
        uint256 principalAtSettle = (depositedMON * 1e18) / 2e18;  // = depositedMON / 2
        uint256 expectedPrize   = depositedShares - principalAtSettle;

        (,,,,,,,,,address winner,,) = pool.getRoundInfo(rid);
        assertEq(winner, alice, "only depositor wins");

        uint256 balBefore = shmon.balanceOf(winner);
        vm.prank(winner);
        pool.claimPrize(rid);
        assertEq(shmon.balanceOf(winner) - balBefore, expectedPrize, "winner receives yield shares");
    }

    function test_principal_returned_as_full_shares() public {
        uint256 rid = 1;
        uint32 tickets = 5;
        uint256 expectedShares = tickets * uint256(PRICE);

        _buyTickets(alice, tickets);
        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));
        pool.finalizeDraw(rid);

        uint256 balBefore = shmon.balanceOf(alice);
        vm.prank(alice);
        pool.withdrawPrincipal(rid);
        assertEq(shmon.balanceOf(alice) - balBefore, expectedShares, "full shares returned");
    }

    function test_multiple_depositors_all_get_shares_back() public {
        uint256 rid = 1;

        _buyTickets(alice, 3);
        _buyTickets(bob, 4);
        _buyTickets(carol, 5);

        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));
        pool.finalizeDraw(rid);

        // All depositors withdraw principal
        vm.prank(alice);
        pool.withdrawPrincipal(rid);
        vm.prank(bob);
        pool.withdrawPrincipal(rid);
        vm.prank(carol);
        pool.withdrawPrincipal(rid);

        assertEq(shmon.balanceOf(alice), 3 * uint256(PRICE));
        assertEq(shmon.balanceOf(bob),   4 * uint256(PRICE));
        assertEq(shmon.balanceOf(carol), 5 * uint256(PRICE));
    }

    function test_no_yield_prize_is_zero() public {
        uint256 rid = 1;
        _buyTickets(alice, 5);
        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));
        // No simulateYield call → rate unchanged (1:1) → previewDeposit returns deposited count
        pool.finalizeDraw(rid);

        (,,,,,,,uint256 prize,,,, ) = pool.getRoundInfo(rid);
        assertEq(prize, 0, "prize = 0 when exchange rate unchanged");
    }

    function test_totalUnclaimedShares_tracks_correctly() public {
        uint256 rid = 1;
        uint256 totalDeposited = 3 * uint256(PRICE);

        _buyTickets(alice, 3);

        assertEq(pool.totalUnclaimedShares(), totalDeposited, "tracks deposited shares");

        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));
        pool.finalizeDraw(rid);

        // No yield → principalSharesAtSettle = depositedShares → prizeShares = 0
        // finalizeDraw does NOT change totalUnclaimedShares in the exchange-rate model
        assertEq(pool.totalUnclaimedShares(), totalDeposited, "finalizeDraw leaves totalUnclaimedShares unchanged");

        vm.prank(alice);
        pool.withdrawPrincipal(rid);

        assertEq(pool.totalUnclaimedShares(), 0, "cleared after withdrawal");
    }

    function test_totalUnclaimedShares_with_yield() public {
        uint256 rid = 1;
        // Alice is the sole depositor — she is also the winner.
        uint256 totalDeposited = 2 * uint256(PRICE); // in shares, at initial 1:1 rate

        _buyTickets(alice, 2);
        assertEq(pool.totalUnclaimedShares(), totalDeposited, "set at deposit time");

        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));

        // Rate doubles: each share now worth 2 MON.
        // principalSharesAtSettle = totalDeposited / 2, prizeShares = totalDeposited / 2
        shmon.simulateYield(2e18);
        pool.finalizeDraw(rid);

        // Exchange-rate model: finalizeDraw does NOT add prizeShares to totalUnclaimedShares.
        // Prize is a redistribution within the already-tracked depositedShares, not new shares.
        assertEq(pool.totalUnclaimedShares(), totalDeposited, "unchanged by finalizeDraw (prize is not new shares)");

        uint256 principalAtSettle = totalDeposited / 2;
        uint256 prizeShares       = totalDeposited / 2;

        // After winner (alice) claims prize:
        vm.prank(alice); // alice is sole depositor → sole winner
        pool.claimPrize(rid);
        assertEq(pool.totalUnclaimedShares(), totalDeposited - prizeShares,
                 "decremented by prizeShares after claim");

        // After alice withdraws principal:
        vm.prank(alice);
        pool.withdrawPrincipal(rid);
        assertEq(pool.totalUnclaimedShares(), 0, "zeroed after all claims");
    }
}

// ============================================================
// 7. Protocol fee tests
// ============================================================

contract V3_ProtocolFee_Test is V3Base {
    address treasury = makeAddr("treasury");
    address treasury2 = makeAddr("treasury2");

    event ProtocolFeeAccrued(uint256 indexed roundId, uint256 feeShares, address indexed feeRecipient);

    function _skipToNextRound() internal returns (uint256) {
        uint256 rid = pool.currentRoundId();
        _warpPastSales(rid);
        pool.executeNext();
        return pool.currentRoundId();
    }

    function _openRoundWithFee(uint16 bps, address recipient) internal returns (uint256) {
        pool.setFee(bps, recipient);
        return _skipToNextRound();
    }

    function _settleRoundWithYield(uint256 rid, address buyer, uint32 tickets, uint256 newRate)
        internal
        returns (address winner, uint256 grossPrizeShares, uint256 principalAtSettle)
    {
        _buyTickets(buyer, tickets);
        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256(abi.encodePacked("fee-round", rid)));
        shmon.simulateYield(newRate);
        pool.finalizeDraw(rid);

        uint256 depositedMON = uint256(tickets) * uint256(PRICE);
        uint256 depositedShares = (depositedMON * 1e18) / 1e18;
        principalAtSettle = (depositedMON * 1e18) / newRate;
        grossPrizeShares = depositedShares - principalAtSettle;

        (,,,,,,,,,winner,,) = pool.getRoundInfo(rid);
    }

    function _countProtocolFeeEvents(Vm.Log[] memory logs) internal pure returns (uint256 count) {
        bytes32 sig = keccak256("ProtocolFeeAccrued(uint256,uint256,address)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == sig) count++;
        }
    }

    function test_fee_zero_behaves_identically() public {
        uint256 rid = 1;
        uint32 tickets = 10;
        uint256 depositedShares = uint256(tickets) * uint256(PRICE);

        _buyTickets(alice, tickets);
        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));
        shmon.simulateYield(2e18);

        vm.recordLogs();
        pool.finalizeDraw(rid);
        assertEq(_countProtocolFeeEvents(vm.getRecordedLogs()), 0, "no fee event");

        (,,,,,,,uint256 prize,,,,) = pool.getRoundInfo(rid);
        assertEq(prize, depositedShares / 2, "winner gets full gross yield");
        assertEq(shmon.balanceOf(treasury), 0, "no treasury transfer");
    }

    function test_fee_500bps_split_correct() public {
        uint256 rid = _openRoundWithFee(500, treasury);
        (, uint256 grossPrizeShares,) = _settleRoundWithYield(rid, alice, 10, 2e18);
        uint256 expectedFee = (grossPrizeShares * 500) / 10_000;

        (,,,,,,,uint256 netPrizeShares,,,,) = pool.getRoundInfo(rid);
        assertEq(shmon.balanceOf(treasury), expectedFee, "treasury receives 5% of yield");
        assertEq(netPrizeShares, grossPrizeShares - expectedFee, "winner prize is net of fee");
    }

    function test_fee_2000bps_max() public {
        uint256 rid = _openRoundWithFee(2000, treasury);
        (, uint256 grossPrizeShares,) = _settleRoundWithYield(rid, alice, 10, 2e18);
        uint256 expectedFee = (grossPrizeShares * 2000) / 10_000;

        (,,,,,,,uint256 netPrizeShares,,,,) = pool.getRoundInfo(rid);
        assertEq(shmon.balanceOf(treasury), expectedFee, "treasury receives 20% of yield");
        assertEq(netPrizeShares, grossPrizeShares - expectedFee, "winner receives 80% of yield");
    }

    function test_setFee_above_max_reverts() public {
        vm.expectRevert(TicketPrizePoolShmonV3.FeeTooHigh.selector);
        pool.setFee(2001, treasury);
    }

    function test_setFee_zero_recipient_reverts() public {
        vm.expectRevert(TicketPrizePoolShmonV3.ZeroAddress.selector);
        pool.setFee(100, address(0));
    }

    function test_setFee_only_owner() public {
        vm.prank(alice);
        vm.expectRevert("not owner");
        pool.setFee(100, treasury);
    }

    function test_fee_snapshotted_at_round_open() public {
        uint256 rid = _openRoundWithFee(100, treasury);
        _buyTickets(alice, 10);

        pool.setFee(2000, treasury2);

        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));
        shmon.simulateYield(2e18);
        pool.finalizeDraw(rid);

        uint256 grossPrizeShares = 5 * uint256(PRICE);
        assertEq(shmon.balanceOf(treasury), (grossPrizeShares * 100) / 10_000, "old bps used");
        assertEq(shmon.balanceOf(treasury2), 0, "new recipient not used for open round");
    }

    function test_fee_applies_to_next_round() public {
        uint256 rid = _openRoundWithFee(100, treasury);
        _buyTickets(alice, 10);
        pool.setFee(2000, treasury2);

        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd1"));
        shmon.simulateYield(2e18);
        pool.finalizeDraw(rid);

        uint256 nextRid = pool.currentRoundId();
        assertEq(nextRid, rid + 1, "commit opens next round");
        _buyTickets(bob, 4);
        uint64 seq2 = _commit(nextRid);
        _fulfill(seq2, keccak256("rnd2"));
        shmon.simulateYield(4e18);
        pool.finalizeDraw(nextRid);

        uint256 bobDepositedShares = (4 * uint256(PRICE) * 1e18) / 2e18;
        uint256 bobPrincipalAtSettle = (4 * uint256(PRICE) * 1e18) / 4e18;
        uint256 grossPrizeShares = bobDepositedShares - bobPrincipalAtSettle;

        assertEq(shmon.balanceOf(treasury2), (grossPrizeShares * 2000) / 10_000, "next round uses new bps");
    }

    function test_fee_zero_yield_no_fee() public {
        uint256 rid = _openRoundWithFee(1000, treasury);
        _buyTickets(alice, 10);
        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));

        vm.recordLogs();
        pool.finalizeDraw(rid);
        assertEq(_countProtocolFeeEvents(vm.getRecordedLogs()), 0, "no fee event");
        assertEq(shmon.balanceOf(treasury), 0, "no fee on zero yield");
    }

    function test_fee_skipped_round_no_fee() public {
        pool.setFee(1000, treasury);

        vm.recordLogs();
        _skipToNextRound();

        assertEq(_countProtocolFeeEvents(vm.getRecordedLogs()), 0, "skip emits no fee");
        assertEq(shmon.balanceOf(treasury), 0, "skip transfers no fee");
    }

    function test_fee_emergency_force_settle_no_fee() public {
        uint256 rid = _openRoundWithFee(1000, treasury);
        _buyTickets(alice, 10);
        _commit(rid);

        vm.warp(block.timestamp + uint256(pool.VRF_CALLBACK_TIMEOUT()) + 1);
        vm.recordLogs();
        pool.emergencyForceSettle(rid);

        assertEq(_countProtocolFeeEvents(vm.getRecordedLogs()), 0, "emergency emits no fee");
        assertEq(shmon.balanceOf(treasury), 0, "emergency transfers no fee");
    }

    function test_fee_recipient_change_takes_effect_next_round() public {
        uint256 rid = _openRoundWithFee(1000, treasury);
        _buyTickets(alice, 10);
        pool.setFee(1000, treasury2);

        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd1"));
        shmon.simulateYield(2e18);
        pool.finalizeDraw(rid);

        assertGt(shmon.balanceOf(treasury), 0, "old recipient receives current round fee");
        assertEq(shmon.balanceOf(treasury2), 0, "new recipient waits until next round");

        uint256 nextRid = pool.currentRoundId();
        _buyTickets(bob, 4);
        uint64 seq2 = _commit(nextRid);
        _fulfill(seq2, keccak256("rnd2"));
        shmon.simulateYield(4e18);
        pool.finalizeDraw(nextRid);

        assertGt(shmon.balanceOf(treasury2), 0, "new recipient receives next round fee");
    }

    function test_fee_event_emitted_with_correct_args() public {
        uint256 rid = _openRoundWithFee(500, treasury);
        _buyTickets(alice, 10);
        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));
        shmon.simulateYield(2e18);

        uint256 grossPrizeShares = 5 * uint256(PRICE);
        uint256 expectedFee = (grossPrizeShares * 500) / 10_000;

        vm.expectEmit(true, false, true, true);
        emit ProtocolFeeAccrued(rid, expectedFee, treasury);
        pool.finalizeDraw(rid);
    }

    function test_totalUnclaimedShares_decrements_correctly_with_fee() public {
        uint256 rid = _openRoundWithFee(500, treasury);
        _buyTickets(alice, 10);
        uint256 totalDeposited = 10 * uint256(PRICE);

        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));
        shmon.simulateYield(2e18);
        pool.finalizeDraw(rid);

        uint256 principalAtSettle = 5 * uint256(PRICE);
        uint256 grossPrizeShares = 5 * uint256(PRICE);
        uint256 netPrizeShares = grossPrizeShares - ((grossPrizeShares * 500) / 10_000);

        assertEq(pool.totalUnclaimedShares(), totalDeposited - ((grossPrizeShares * 500) / 10_000), "fee removed");
        assertEq(pool.totalUnclaimedShares(), principalAtSettle + netPrizeShares, "principal plus net prize owed");
    }

    function test_winner_claim_uses_net_prize() public {
        uint256 rid = _openRoundWithFee(500, treasury);
        (address winner, uint256 grossPrizeShares,) = _settleRoundWithYield(rid, alice, 10, 2e18);
        uint256 expectedNetPrize = grossPrizeShares - ((grossPrizeShares * 500) / 10_000);

        uint256 beforeBal = shmon.balanceOf(winner);
        vm.prank(winner);
        pool.claimPrize(rid);
        assertEq(shmon.balanceOf(winner) - beforeBal, expectedNetPrize, "claim transfers net prize");
    }

    function test_principal_unaffected_by_fee() public {
        uint256 rid = _openRoundWithFee(2000, treasury);
        (, , uint256 principalAtSettle) = _settleRoundWithYield(rid, alice, 10, 2e18);

        uint256 beforeBal = shmon.balanceOf(alice);
        vm.prank(alice);
        pool.withdrawPrincipal(rid);
        assertEq(shmon.balanceOf(alice) - beforeBal, principalAtSettle, "principal return ignores fee");
    }
}

// ============================================================
// 8. Entropy timelock hardening (ADR-0021)
// ============================================================

contract V3_EntropyTimelock_Test is V3Base {
    event EntropyChangeQueued(address newEntropy, address newProvider, uint64 effectiveAt);
    event EntropyChanged(address entropy, address entropyProvider);
    event EntropyChangeCancelled();
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    function test_queueEntropyChange_emits_event_with_effectiveAt() public {
        MockEntropy nextEntropy = new MockEntropy();
        address nextProvider = address(0xBEEF);
        uint64 effectiveAt = uint64(block.timestamp) + pool.ENTROPY_CHANGE_DELAY();

        vm.expectEmit(false, false, false, true);
        emit EntropyChangeQueued(address(nextEntropy), nextProvider, effectiveAt);
        pool.queueEntropyChange(address(nextEntropy), nextProvider);

        assertEq(pool.pendingEntropy(), address(nextEntropy));
        assertEq(pool.pendingEntropyProvider(), nextProvider);
        assertEq(pool.pendingEntropyEffectiveAt(), effectiveAt);
    }

    function test_queueEntropyChange_zero_entropy_reverts() public {
        vm.expectRevert(TicketPrizePoolShmonV3.ZeroAddress.selector);
        pool.queueEntropyChange(address(0), address(0xBEEF));
    }

    function test_queueEntropyChange_zero_provider_reverts() public {
        MockEntropy nextEntropy = new MockEntropy();
        vm.expectRevert(TicketPrizePoolShmonV3.ZeroAddress.selector);
        pool.queueEntropyChange(address(nextEntropy), address(0));
    }

    function test_queueEntropyChange_only_owner() public {
        MockEntropy nextEntropy = new MockEntropy();
        vm.prank(alice);
        vm.expectRevert("not owner");
        pool.queueEntropyChange(address(nextEntropy), address(0xBEEF));
    }

    function test_commitEntropyChange_before_delay_reverts() public {
        MockEntropy nextEntropy = new MockEntropy();
        pool.queueEntropyChange(address(nextEntropy), address(0xBEEF));
        vm.warp(uint256(pool.pendingEntropyEffectiveAt()) - 1);

        vm.expectRevert(TicketPrizePoolShmonV3.TimelockNotElapsed.selector);
        pool.commitEntropyChange();
    }

    function test_commitEntropyChange_at_exactly_delay_succeeds() public {
        MockEntropy nextEntropy = new MockEntropy();
        address nextProvider = address(0xBEEF);
        pool.queueEntropyChange(address(nextEntropy), nextProvider);
        vm.warp(pool.pendingEntropyEffectiveAt());

        vm.expectEmit(false, false, false, true);
        emit EntropyChanged(address(nextEntropy), nextProvider);
        pool.commitEntropyChange();

        assertEq(address(pool.entropy()), address(nextEntropy));
        assertEq(pool.entropyProvider(), nextProvider);
        assertEq(pool.pendingEntropy(), address(0));
        assertEq(pool.pendingEntropyProvider(), address(0));
        assertEq(pool.pendingEntropyEffectiveAt(), 0);
    }

    function test_commitEntropyChange_no_pending_reverts() public {
        vm.expectRevert(TicketPrizePoolShmonV3.NoPendingEntropyChange.selector);
        pool.commitEntropyChange();
    }

    function test_cancelEntropyChange_clears_pending() public {
        MockEntropy nextEntropy = new MockEntropy();
        pool.queueEntropyChange(address(nextEntropy), address(0xBEEF));

        vm.expectEmit(false, false, false, true);
        emit EntropyChangeCancelled();
        pool.cancelEntropyChange();

        assertEq(pool.pendingEntropy(), address(0));
        assertEq(pool.pendingEntropyProvider(), address(0));
        assertEq(pool.pendingEntropyEffectiveAt(), 0);
    }

    function test_queue_then_requeue_resets_timer() public {
        MockEntropy firstEntropy = new MockEntropy();
        MockEntropy secondEntropy = new MockEntropy();
        address firstProvider = address(0xBEEF);
        address secondProvider = address(0xCAFE);

        pool.queueEntropyChange(address(firstEntropy), firstProvider);
        uint64 firstEffectiveAt = pool.pendingEntropyEffectiveAt();
        vm.warp(block.timestamp + 6 hours);

        pool.queueEntropyChange(address(secondEntropy), secondProvider);

        assertEq(pool.pendingEntropy(), address(secondEntropy));
        assertEq(pool.pendingEntropyProvider(), secondProvider);
        assertEq(pool.pendingEntropyEffectiveAt(), uint64(block.timestamp) + pool.ENTROPY_CHANGE_DELAY());
        assertGt(pool.pendingEntropyEffectiveAt(), firstEffectiveAt);
    }

    function test_commitEntropyChange_actually_routes_next_request_to_new_address() public {
        MockEntropy nextEntropy = new MockEntropy();
        address nextProvider = address(0xBEEF);
        _buyTickets(alice, 1);

        pool.queueEntropyChange(address(nextEntropy), nextProvider);
        vm.warp(pool.pendingEntropyEffectiveAt());
        pool.commitEntropyChange();

        _warpPastYield(1);
        pool.commitDraw(1);

        (,, uint64 seq,,,,,,,,,) = pool.getRoundInfo(1);
        (address consumer, address provider) = nextEntropy.requests(seq);
        assertEq(consumer, address(pool));
        assertEq(provider, nextProvider);
    }

    function test_acceptOwnership_emits_previous_and_new_owner() public {
        address nextOwner = makeAddr("nextOwner");
        pool.transferOwnership(nextOwner);

        vm.expectEmit(true, true, false, true);
        emit OwnershipTransferred(address(this), nextOwner);
        vm.prank(nextOwner);
        pool.acceptOwnership();
    }
}

// ============================================================
// 9. Round metadata snapshots (ADR-0021)
// ============================================================

contract V3_RoundMetadata_Test is V3Base {
    event NextRoundMetadataSet(address campaign, bytes32 metadata);

    address campaign = makeAddr("campaign");
    address campaign2 = makeAddr("campaign2");
    bytes32 metadata = keccak256("campaign-round");
    bytes32 metadata2 = keccak256("follow-up-round");

    function _skipToNextRound() internal returns (uint256) {
        uint256 rid = pool.currentRoundId();
        _warpPastSales(rid);
        pool.executeNext();
        return pool.currentRoundId();
    }

    function test_default_round_has_zero_metadata() public {
        (address roundCampaign, bytes32 roundMetadata) = pool.getRoundMetadata(1);
        assertEq(roundCampaign, address(0));
        assertEq(roundMetadata, bytes32(0));
    }

    function test_setNextRoundMetadata_updates_storage_and_emits() public {
        vm.expectEmit(false, false, false, true);
        emit NextRoundMetadataSet(campaign, metadata);
        pool.setNextRoundMetadata(campaign, metadata);

        assertEq(pool.nextRoundCampaign(), campaign);
        assertEq(pool.nextRoundMetadata(), metadata);
    }

    function test_setNextRoundMetadata_only_owner() public {
        vm.prank(alice);
        vm.expectRevert("not owner");
        pool.setNextRoundMetadata(campaign, metadata);
    }

    function test_metadata_snapshotted_at_round_open() public {
        pool.setNextRoundMetadata(campaign, metadata);
        uint256 rid = _skipToNextRound();

        pool.setNextRoundMetadata(campaign2, metadata2);
        _buyTickets(alice, 1);
        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("metadata-snapshot"));
        pool.finalizeDraw(rid);

        (address roundCampaign, bytes32 roundMetadata) = pool.getRoundMetadata(rid);
        assertEq(roundCampaign, campaign);
        assertEq(roundMetadata, metadata);
    }

    function test_metadata_applies_to_next_round() public {
        pool.setNextRoundMetadata(campaign, metadata);
        (address currentCampaign, bytes32 currentMetadata) = pool.getRoundMetadata(1);
        assertEq(currentCampaign, address(0));
        assertEq(currentMetadata, bytes32(0));

        uint256 rid = _skipToNextRound();

        (address roundCampaign, bytes32 roundMetadata) = pool.getRoundMetadata(rid);
        assertEq(roundCampaign, campaign);
        assertEq(roundMetadata, metadata);
    }

    function test_setNextRoundMetadata_zero_clears_campaign() public {
        pool.setNextRoundMetadata(campaign, metadata);
        pool.setNextRoundMetadata(address(0), bytes32(0));

        assertEq(pool.nextRoundCampaign(), address(0));
        assertEq(pool.nextRoundMetadata(), bytes32(0));
    }

    function test_getRoundMetadata_returns_snapshot() public {
        pool.setNextRoundMetadata(campaign, metadata);
        uint256 rid = _skipToNextRound();

        (address roundCampaign, bytes32 roundMetadata) = pool.getRoundMetadata(rid);
        assertEq(roundCampaign, campaign);
        assertEq(roundMetadata, metadata);
    }

    function test_metadata_change_does_not_affect_in_flight_round() public {
        pool.setNextRoundMetadata(campaign, metadata);
        uint256 rid = _skipToNextRound();

        _buyTickets(alice, 1);
        pool.setNextRoundMetadata(campaign2, metadata2);

        (address inFlightCampaign, bytes32 inFlightMetadata) = pool.getRoundMetadata(rid);
        assertEq(inFlightCampaign, campaign);
        assertEq(inFlightMetadata, metadata);

        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("in-flight"));
        pool.finalizeDraw(rid);

        (address settledCampaign, bytes32 settledMetadata) = pool.getRoundMetadata(rid);
        assertEq(settledCampaign, campaign);
        assertEq(settledMetadata, metadata);
    }
}

// ============================================================
// 10. State machine invariant tests
// ============================================================

contract V3_StateMachine_Test is V3Base {

    function test_cannot_buy_after_sales_end() public {
        uint256 rid = 1;
        _warpPastSales(rid);

        vm.prank(alice);
        vm.expectRevert(TicketPrizePoolShmonV3.SalesEnded.selector);
        pool.buyTickets{value: PRICE}(1);
    }

    function test_cannot_commitDraw_twice() public {
        uint256 rid = 1;
        _buyTickets(alice, 1);
        _commit(rid);

        vm.expectRevert(pool.legacyBytes("bad state"));
        pool.commitDraw(rid);
    }

    function test_finalizeDraw_only_in_drawn_state() public {
        uint256 rid = 1;
        _buyTickets(alice, 1);
        _commit(rid); // AwaitingVRF

        vm.expectRevert(TicketPrizePoolShmonV3.BadState.selector);
        pool.finalizeDraw(rid);
    }

    function test_withdrawPrincipal_requires_settled() public {
        uint256 rid = 1;
        _buyTickets(alice, 1);
        _commit(rid); // AwaitingVRF

        vm.prank(alice);
        vm.expectRevert(TicketPrizePoolShmonV3.BadState.selector);
        pool.withdrawPrincipal(rid);
    }

    function test_claimPrize_only_winner() public {
        uint256 rid = 1;
        _buyTickets(alice, 1);
        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));
        pool.finalizeDraw(rid);

        vm.prank(bob);
        vm.expectRevert(TicketPrizePoolShmonV3.NotWinner.selector);
        pool.claimPrize(rid);
    }

    function test_withdrawPrincipal_double_withdraw_reverts() public {
        uint256 rid = 1;
        _buyTickets(alice, 1);
        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));
        pool.finalizeDraw(rid);

        vm.prank(alice);
        pool.withdrawPrincipal(rid);

        vm.prank(alice);
        vm.expectRevert(TicketPrizePoolShmonV3.NothingToWithdraw.selector);
        pool.withdrawPrincipal(rid);
    }

    function test_claimPrize_double_claim_reverts() public {
        uint256 rid = 1;
        _buyTickets(alice, 1);
        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));
        shmon.simulateYield(2e18); // ensure prize > 0 so claimPrize does something
        pool.finalizeDraw(rid);

        vm.prank(alice);
        pool.claimPrize(rid);

        vm.prank(alice);
        vm.expectRevert(TicketPrizePoolShmonV3.PrizeAlreadyClaimed.selector);
        pool.claimPrize(rid);
    }

    function test_no_recommit_function_exists() public {
        bytes4 recommitSel = bytes4(keccak256("recommit(uint256)"));
        (bool ok,) = address(pool).call(abi.encodeWithSelector(recommitSel, 1));
        assertFalse(ok, "recommit should not exist on V3");
    }

    function test_no_settleRound_function_exists() public {
        bytes4 settleSel = bytes4(keccak256("settleRound(uint256)"));
        (bool ok,) = address(pool).call(abi.encodeWithSelector(settleSel, 1));
        assertFalse(ok, "settleRound should not exist on no-unstake V3");
    }

    function test_no_finalizing_state() public {
        // Verify that state 3 maps to Settled (not Finalizing as in old design)
        // After finalizeDraw, round goes directly to Settled (state 3)
        uint256 rid = 1;
        _buyTickets(alice, 1);
        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));
        pool.finalizeDraw(rid);

        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmonV3.RoundState.Settled));
        assertEq(uint8(TicketPrizePoolShmonV3.RoundState.Settled), 3);
    }
}

// ============================================================
// 11. Gas budget on _entropyCallback
// ============================================================

contract V3_GasCallback_Test is V3Base {

    function test_entropyCallback_under_200k_gas() public {
        uint256 rid = 1;
        _buyTickets(alice, 1);
        uint64 seq = _commit(rid);

        uint256 gasBefore = gasleft();
        entropy.simulateCallback(seq, keccak256("rnd"));
        uint256 gasUsed = gasBefore - gasleft();

        assertLt(gasUsed, 200_000, "entropyCallback must stay under 200k gas");
    }
}

// ============================================================
// 12. getUserPosition tests
// ============================================================

contract V3_UserPosition_Test is V3Base {

    function test_getUserPosition_returns_shares() public {
        uint256 rid = 1;
        _buyTickets(alice, 3);

        (uint128 monOut, uint128 sharesOut) = pool.getUserPosition(rid, alice);
        assertEq(monOut,    uint128(3 * uint256(PRICE)), "MON principal");
        assertEq(sharesOut, uint128(3 * uint256(PRICE)), "shMON shares (1:1 mock)");
    }

    function test_getUserPosition_zeroed_after_withdrawal() public {
        uint256 rid = 1;
        _buyTickets(alice, 2);
        uint64 seq = _commit(rid);
        _fulfill(seq, keccak256("rnd"));
        pool.finalizeDraw(rid);

        vm.prank(alice);
        pool.withdrawPrincipal(rid);

        (uint128 monOut, uint128 sharesOut) = pool.getUserPosition(rid, alice);
        assertEq(monOut,    0, "MON zeroed");
        assertEq(sharesOut, 0, "shares zeroed");
    }
}

// ============================================================
// 13. Multi-round accounting (unclaimed shares don't bleed yield)
// ============================================================

contract V3_MultiRound_Test is V3Base {

    /// @dev Verify that each round's prize is computed independently from that round's own
    ///      deposit data and the exchange rate at finalizeDraw time.  Unclaimed shares from
    ///      a prior round do not affect the next round's prize (no cross-round contamination).
    function test_multiround_prizes_are_independent() public {
        // ── Round 1 ───────────────────────────────────────────────────────────────────────
        // Alice deposits 5 tickets at rate 1e18 → 5*PRICE shares.
        uint256 rid1 = 1;
        _buyTickets(alice, 5);

        uint64 seq1 = _commit(rid1);
        _fulfill(seq1, keccak256("rnd1"));

        // Rate doubles before round-1 finalizes.
        // r1.principalSharesAtSettle = previewDeposit(5*PRICE) at 2e18 = 5*PRICE/2
        // r1.prizeShares             = 5*PRICE − 5*PRICE/2 = 5*PRICE/2
        shmon.simulateYield(2e18);
        pool.finalizeDraw(rid1);

        uint256 r1PrincipalAtSettle = (5 * uint256(PRICE)) / 2;
        uint256 r1Prize             = (5 * uint256(PRICE)) / 2;

        (,,,,,,,uint256 p1,,,, ) = pool.getRoundInfo(rid1);
        assertEq(p1, r1Prize, "round 1 prize correct");

        // Alice does NOT withdraw yet — her round-1 shares sit unclaimed in the pool.

        // ── Round 2 ───────────────────────────────────────────────────────────────────────
        // Bob deposits 4 tickets at rate 2e18 → 4*PRICE * 1e18/2e18 = 2*PRICE shares.
        uint256 rid2 = pool.currentRoundId();
        assertEq(rid2, 2);
        _buyTickets(bob, 4);

        uint256 r2DepositedShares = (4 * uint256(PRICE) * 1e18) / 2e18; // 2*PRICE

        uint64 seq2 = _commit(rid2);
        _fulfill(seq2, keccak256("rnd2"));

        // Rate doubles again (2e18 → 4e18) before round-2 finalizes.
        // r2.principalSharesAtSettle = previewDeposit(4*PRICE) at 4e18 = 4*PRICE/4 = PRICE
        // r2.prizeShares             = r2DepositedShares − PRICE = 2*PRICE − PRICE = PRICE
        shmon.simulateYield(4e18);
        pool.finalizeDraw(rid2);

        uint256 r2PrincipalAtSettle = (4 * uint256(PRICE)) / 4;  // = PRICE
        uint256 r2Prize             = r2DepositedShares - r2PrincipalAtSettle; // = PRICE

        (,,,,,,,uint256 p2,,,, ) = pool.getRoundInfo(rid2);
        assertEq(p2, r2Prize, "round 2 prize is independent of unclaimed round-1 shares");

        // ── Claims ────────────────────────────────────────────────────────────────────────
        // Alice claims round-1 principal (she is also round-1 winner → claim prize too).
        vm.prank(alice);
        pool.claimPrize(rid1);
        vm.prank(alice);
        pool.withdrawPrincipal(rid1);
        // Alice gets: r1PrincipalAtSettle (proportional of total, but she's sole depositor)
        assertEq(shmon.balanceOf(alice), r1PrincipalAtSettle + r1Prize,
                 "alice gets round-1 principal + prize");

        // Bob claims round-2 principal (he is sole round-2 depositor → winner).
        vm.prank(bob);
        pool.claimPrize(rid2);
        vm.prank(bob);
        pool.withdrawPrincipal(rid2);
        assertEq(shmon.balanceOf(bob), r2PrincipalAtSettle + r2Prize,
                 "bob gets round-2 principal + prize");

        // Accounting identity: totalUnclaimedShares zeroed after all claims.
        assertEq(pool.totalUnclaimedShares(), 0, "all shares accounted for");
    }
}
