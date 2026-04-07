// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "../src/TicketPrizePoolShmon.sol";

/// @dev Simple instant staker mock for claim-focused tests.
/// - stake(): 1:1 mint
/// - requestUnstake(): records amount
/// - isUnstakeReady(): always true
/// - claimUnstake(): pays back principal + configurable bonus (yield)
contract ClaimsStaker is IShmonadStaker {
    uint256 public nextRequestId = 1;
    uint256 public bonusWei; // fixed yield paid per claim

    mapping(uint256 => uint256) public reqAmount;

    constructor(uint256 _bonusWei) {
        bonusWei = _bonusWei;
    }

    function stake() external payable returns (uint256 shmonAmount) {
        return msg.value; // 1:1
    }

    function requestUnstake(uint256 shmonAmount) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        reqAmount[requestId] = shmonAmount;
    }

    function isUnstakeReady(uint256) external pure returns (bool) {
        return true;
    }

    function claimUnstake(uint256 requestId, address to) external returns (uint256 monAmount) {
        uint256 amt = reqAmount[requestId];
        require(amt > 0, "bad req");
        reqAmount[requestId] = 0;

        monAmount = amt + bonusWei;

        (bool ok,) = to.call{value: monAmount}("");
        require(ok, "mock transfer failed");
    }

    receive() external payable {}
}

contract TicketPrizePoolShmonClaimsBTest is Test {
    TicketPrizePoolShmon pool;
    ClaimsStaker staker;

    address alice = address(0xA11cE);
    address bob   = address(0xB0b);

    uint96  constant TICKET_PRICE = 0.01 ether;
    uint32  constant COMMIT_DELAY = 5;
    uint32  constant ROUND_DUR    = 10 minutes;

    function _deploy(uint256 bonusWei) internal {
        staker = new ClaimsStaker(bonusWei);
        pool = new TicketPrizePoolShmon(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(staker));

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        // fund staker to cover bonus yield payout
        if (bonusWei > 0) {
            vm.deal(address(staker), bonusWei);
        }
    }

    function _buy(address user, uint32 n) internal {
        vm.prank(user);
        pool.buyTickets{value: uint256(TICKET_PRICE) * n}(n);
    }

    function _warpPastSalesEnd() internal {
        vm.warp(block.timestamp + ROUND_DUR + 1);
    }

    function _targetBlock(uint256 rid) internal view returns (uint256) {
        (, , , , , uint256 targetBlockNumber, , , , , , , ) = pool.getRoundInfo(rid);
        return targetBlockNumber;
    }

    function _runToSettled(uint256 rid) internal {
        _warpPastSalesEnd();
        pool.commitDraw(rid);

        uint256 target = _targetBlock(rid);
        vm.roll(target + 1);

        pool.drawWinner(rid);
        pool.settleRound(rid);

        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmon.RoundState.Settled), "not settled");
    }

    // =========================================================
    // B9. Only winner can claim
    // =========================================================
    function test_B9_onlyWinnerCanClaim() public {
        _deploy(0.5 ether);

        uint256 rid = 1;
        _buy(alice, 2);
        _buy(bob, 1);

        _runToSettled(rid);

        (, , , , , , address winner, , , uint256 yieldMON, , , ) = pool.getRoundInfo(rid);
        assertTrue(yieldMON > 0, "expected positive yield");

        address loser = (winner == alice) ? bob : alice;

        vm.prank(loser);
        vm.expectRevert(bytes("not winner"));
        pool.claimPrize(rid);

        uint256 w0 = winner.balance;
        vm.prank(winner);
        pool.claimPrize(rid);
        uint256 w1 = winner.balance;

        assertEq(w1 - w0, yieldMON, "winner did not receive yield");
    }

    // =========================================================
    // B11. Double claim reverts
    // =========================================================
    function test_B11_doubleClaim_reverts() public {
        _deploy(0.25 ether);

        uint256 rid = 1;
        _buy(alice, 2);
        _buy(bob, 1);

        _runToSettled(rid);

        (, , , , , , address winner, , , , , bool prizeClaimedBefore, ) = pool.getRoundInfo(rid);
        assertTrue(!prizeClaimedBefore, "expected not claimed");

        vm.prank(winner);
        pool.claimPrize(rid);

        vm.prank(winner);
        vm.expectRevert(bytes("prize claimed"));
        pool.claimPrize(rid);
    }

    // =========================================================
    // B12. Zero yield: claim succeeds, marks claimed, no transfer
    // =========================================================
    function test_B12_zeroYield_claimSucceeds_marksClaimed_noTransfer() public {
        _deploy(0); // no yield

        uint256 rid = 1;
        _buy(alice, 2);
        _buy(bob, 1);

        _runToSettled(rid);

        (, , , , , , address winner, , , uint256 yieldMON, , bool prizeClaimed, ) = pool.getRoundInfo(rid);
        assertEq(yieldMON, 0, "expected zero yield");
        assertTrue(!prizeClaimed, "expected not claimed");

        uint256 w0 = winner.balance;
        vm.prank(winner);
        pool.claimPrize(rid);
        uint256 w1 = winner.balance;

        assertEq(w1, w0, "winner balance should not change when yield is zero");

        (, , , , , , , , , , , bool prizeClaimedAfter, ) = pool.getRoundInfo(rid);
        assertTrue(prizeClaimedAfter, "expected claimed=true");
    }

    // =========================================================
    // B14. winningTicket maps to winner via ownerOfTicket
    // =========================================================
    function test_B14_winningTicket_mapsToWinner() public {
        _deploy(0.1 ether);

        uint256 rid = 1;
        _buy(alice, 3);
        _buy(bob, 2);

        _runToSettled(rid);

        (, , uint32 totalTickets, , , , address winner, uint32 winningTicket, , , , , ) = pool.getRoundInfo(rid);
        assertTrue(totalTickets > 0, "expected tickets");
        assertTrue(winner != address(0), "expected winner");

        address owner = pool.ownerOfTicket(rid, winningTicket);
        assertEq(owner, winner, "ownerOfTicket mismatch");
    }
}
