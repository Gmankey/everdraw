// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "../src/TicketPrizePoolShmon.sol";

/// @dev Staker mock:
/// - stake(): returns msg.value (1:1)
/// - requestUnstake(): records amount
/// - isUnstakeReady(): always true
/// - claimUnstake(): pays principal* payoutBps + bonusWei to the pool
contract SecurityStaker is IShmonadStaker {
    uint256 public nextRequestId = 1;

    uint16 public payoutBps;   // 10000 = 100%
    uint256 public bonusWei;   // extra yield on top

    mapping(uint256 => uint256) public reqAmount;

    constructor(uint16 _payoutBps, uint256 _bonusWei) {
        payoutBps = _payoutBps;
        bonusWei = _bonusWei;
    }

    function stake() external payable returns (uint256 shmonAmount) {
        return msg.value;
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
        reqAmount[requestId] = 0;

        uint256 paidPrincipal = (amt * uint256(payoutBps)) / 10000;
        monAmount = paidPrincipal + bonusWei;

        (bool ok,) = to.call{value: monAmount}("");
        require(ok, "mock transfer failed");
    }

    receive() external payable {}
}

/// @dev Malicious winner contract: tries to re-enter claimPrize and withdrawPrincipal during receive().
contract ReenterWinner {
    TicketPrizePoolShmon public pool;
    uint256 public rid;

    bool public tryReenterClaim;
    bool public tryReenterWithdraw;

    bool public reenterClaimAttempted;
    bool public reenterWithdrawAttempted;

    bool public reenterClaimOk;
    bool public reenterWithdrawOk;

    constructor(address payable _pool, uint256 _rid) {
        pool = TicketPrizePoolShmon(_pool);
        rid = _rid;
    }

    function buy(uint32 n) external payable {
        pool.buyTickets{value: msg.value}(n);
    }

    function setAttack(bool _claim, bool _withdraw) external {
        tryReenterClaim = _claim;
        tryReenterWithdraw = _withdraw;
    }

    function attackClaim() external {
        pool.claimPrize(rid);
    }

    function attackWithdraw() external {
        pool.withdrawPrincipal(rid);
    }

    receive() external payable {
        // Attempt re-entrancy only once per type to avoid loops
        if (tryReenterClaim && !reenterClaimAttempted) {
            reenterClaimAttempted = true;
            (bool ok,) = address(pool).call(abi.encodeWithSignature("claimPrize(uint256)", rid));
            reenterClaimOk = ok; // should be false
        }

        if (tryReenterWithdraw && !reenterWithdrawAttempted) {
            reenterWithdrawAttempted = true;
            (bool ok,) = address(pool).call(abi.encodeWithSignature("withdrawPrincipal(uint256)", rid));
            reenterWithdrawOk = ok; // should be false
        }
    }
}

contract TicketPrizePoolShmonSecurityETest is Test {
    TicketPrizePoolShmon pool;
    SecurityStaker staker;

    uint96  constant TICKET_PRICE = 0.01 ether;
    uint32  constant COMMIT_DELAY = 5;
    uint32  constant ROUND_DUR    = 10 minutes;

    uint256 constant RID = 1;

    function _deploy(uint16 payoutBps, uint256 bonusWei) internal {
        staker = new SecurityStaker(payoutBps, bonusWei);
        pool = new TicketPrizePoolShmon(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(staker));

        // fund staker so it can actually pay bonus yield
        if (bonusWei > 0) vm.deal(address(staker), bonusWei);
    }

    function _warpPastSalesEnd() internal {
        vm.warp(block.timestamp + ROUND_DUR + 1);
    }

    function _targetBlock(uint256 rid) internal view returns (uint256) {
        // getRoundInfo returns 13 values in your branch
        (, , , , , uint256 targetBlockNumber, , , , , , , ) = pool.getRoundInfo(rid);
        return targetBlockNumber;
    }

    function _fullRoundToSettled() internal {
        _warpPastSalesEnd();
        pool.commitDraw(RID);

        uint256 target = _targetBlock(RID);
        vm.roll(target + 1); // contract requires block.number > target

        pool.drawWinner(RID);
        pool.settleRound(RID);

        assertEq(uint8(pool.getRoundState(RID)), uint8(TicketPrizePoolShmon.RoundState.Settled), "not settled");
    }

    // =========================================================
    // E23. Reentrancy attempt on claimPrize: cannot double-claim
    // =========================================================
    function test_E23_reentrancy_claimPrize_cannotDoubleClaim() public {
        uint256 bonus = 0.5 ether;
        _deploy(10000, bonus); // principal 100% + yield bonus

        // Deploy attacker and make it the ONLY buyer => guaranteed winner
        ReenterWinner attacker = new ReenterWinner(payable(address(pool)), RID);

        vm.deal(address(attacker), 10 ether);

        attacker.setAttack(true, false);

        // attacker buys all tickets (only participant)
        vm.prank(address(attacker));
        attacker.buy{value: uint256(TICKET_PRICE) * 3}(3);

        _fullRoundToSettled();

        // Confirm winner is attacker and yield is positive
        (, , , , , , address winner, , , uint256 yieldMON, , , ) = pool.getRoundInfo(RID);
        assertEq(winner, address(attacker), "attacker not winner");
        assertTrue(yieldMON > 0, "expected yield > 0");

        uint256 w0 = address(attacker).balance;

        // First claim should succeed, and reentrant claim should fail internally (ok=false)
        vm.prank(address(attacker));
        attacker.attackClaim();

        uint256 w1 = address(attacker).balance;
        assertEq(w1, w0 + yieldMON, "attacker did not receive exactly 1x yield");
        assertEq(attacker.reenterClaimAttempted(), true, "reenter claim not attempted");
        assertEq(attacker.reenterClaimOk(), false, "reenter claim unexpectedly succeeded");

        // Second explicit claim should revert "prize claimed"
        vm.prank(address(attacker));
        vm.expectRevert(bytes("prize claimed"));
        pool.claimPrize(RID);
    }

    // =========================================================
    // E23. Reentrancy attempt on withdrawPrincipal: cannot withdraw twice
    // =========================================================
    function test_E23_reentrancy_withdrawPrincipal_cannotWithdrawTwice() public {
        _deploy(10000, 0); // no yield; just principal return

        // attacker is only buyer => also winner, but here we focus on withdrawPrincipal reentrancy
        ReenterWinner attacker = new ReenterWinner(payable(address(pool)), RID);

        vm.deal(address(attacker), 10 ether);

        attacker.setAttack(false, true);

        vm.prank(address(attacker));
        attacker.buy{value: uint256(TICKET_PRICE) * 4}(4);

        _fullRoundToSettled();

        uint256 principal = pool.principalMON(RID, address(attacker));
        assertEq(principal, uint256(TICKET_PRICE) * 4, "principal wrong");

        uint256 b0 = address(attacker).balance;

        // First withdraw should succeed, reentrant withdraw should fail internally
        vm.prank(address(attacker));
        attacker.attackWithdraw();

        uint256 b1 = address(attacker).balance;
        assertEq(b1, b0 + principal, "attacker did not receive exact principal");
        assertEq(attacker.reenterWithdrawAttempted(), true, "reenter withdraw not attempted");
        assertEq(attacker.reenterWithdrawOk(), false, "reenter withdraw unexpectedly succeeded");

        // Second explicit withdraw should revert "nothing"
        vm.prank(address(attacker));
        vm.expectRevert(bytes("nothing"));
        pool.withdrawPrincipal(RID);
    }

    // =========================================================
    // E24. Grief attempt: spam tiny buys should not brick draw/settle
    // =========================================================
    function test_E24_grief_spamTinyBuys_stillSettles() public {
        _deploy(10000, 0);

        uint256 numBuys = 200;

        // Many tiny buys by many distinct users to maximize ranges and spam
        for (uint256 i = 0; i < numBuys; i++) {
            address u = address(uint160(0x3000 + i));
            vm.deal(u, 1 ether);
            vm.prank(u);
            pool.buyTickets{value: TICKET_PRICE}(1);
        }

        assertEq(pool.rangesLength(RID), numBuys, "unexpected merging; check buyer rotation");

        _fullRoundToSettled();

        // After settle, any random user should be able to withdraw principal once
        address sample = address(uint160(0x3000 + 42));
        uint256 p = pool.principalMON(RID, sample);
        assertEq(p, uint256(TICKET_PRICE), "sample principal wrong");

        uint256 s0 = sample.balance;
        vm.prank(sample);
        pool.withdrawPrincipal(RID);
        uint256 s1 = sample.balance;

        assertEq(s1, s0 + p, "sample withdraw failed after spam scenario");
    }

    // =========================================================
    // E25. DoS-ish check: large number of ranges still allows drawWinner (binary search)
    // =========================================================
    function test_E25_largeRanges_drawAndSettle_succeeds() public {
        _deploy(10000, 0);

        uint256 numBuys = 600; // large but should remain practical in unit tests

        for (uint256 i = 0; i < numBuys; i++) {
            address u = address(uint160(0x5000 + i));
            vm.deal(u, 1 ether);
            vm.prank(u);
            pool.buyTickets{value: TICKET_PRICE}(1);
        }

        assertEq(pool.rangesLength(RID), numBuys, "ranges not as expected");

        _fullRoundToSettled();

        // winner must be a real buyer and winningTicket must be within totalTickets
        (, , uint32 totalTickets, , , , address winner, uint32 winningTicket, , , , , ) = pool.getRoundInfo(RID);
        assertEq(totalTickets, uint32(numBuys), "totalTickets mismatch");
        assertTrue(winner != address(0), "winner is zero");
        assertTrue(winningTicket < totalTickets, "winningTicket OOB");

        // ownership check should succeed quickly (binary search)
        address owner = pool.ownerOfTicket(RID, winningTicket);
        assertEq(owner, winner, "winner/owner mismatch under large ranges");
    }
}
