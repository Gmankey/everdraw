// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "../src/TicketPrizePoolShmon.sol";

/// @dev Configurable staker mock:
/// - stake(): mints shmon 1:1 with MON
/// - claimUnstake(): returns exactly `payoutBps` of the requested amount (simulates loss)
///   plus optional fixed `bonusWei` (simulates yield on top)
contract AccountingStaker is IShmonadStaker {
    uint256 public nextRequestId = 1;

    // payout basis points of principal (10000 = 100%, 9900 = 99%, 5000 = 50%, etc.)
    uint16 public payoutBps;

    // optional extra yield paid on top (in wei)
    uint256 public bonusWei;

    mapping(uint256 => uint256) public reqAmount;

    constructor(uint16 _payoutBps, uint256 _bonusWei) {
        payoutBps = _payoutBps;
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
        return true; // instant readiness for unit tests
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

contract TicketPrizePoolShmonAccountingCTest is Test {
    TicketPrizePoolShmon pool;
    AccountingStaker staker;

    address alice = address(0xA11cE);
    address bob   = address(0xB0b);

    uint96  constant TICKET_PRICE = 0.01 ether;
    uint32  constant COMMIT_DELAY = 5;
    uint32  constant ROUND_DUR    = 10 minutes;

    function _deploy(uint16 payoutBps, uint256 bonusWei) internal {
        staker = new AccountingStaker(payoutBps, bonusWei);
        pool = new TicketPrizePoolShmon(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(staker));

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        // Fund staker so it can pay bonus yield if needed
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
        // getRoundInfo now returns 13 values; we only need targetBlockNumber
        (, , , , , uint256 targetBlockNumber, , , , , , , ) = pool.getRoundInfo(rid);
        return targetBlockNumber;
    }

    function _settleRound1() internal returns (uint256 rid) {
        rid = 1;

        _warpPastSalesEnd();
        pool.commitDraw(rid);

        uint256 target = _targetBlock(rid);
        vm.roll(target + 1);

        pool.drawWinner(rid);
        pool.settleRound(rid);

        assertEq(uint8(pool.getRoundState(rid)), uint8(TicketPrizePoolShmon.RoundState.Settled), "not settled");
    }

    // =========================================================
    // C15. Refund before settled should revert
    // =========================================================
    function test_C15_withdrawBeforeSettled_reverts() public {
        _deploy(10000, 0);

        uint256 rid = 1;
        _buy(alice, 2);

        // still Open
        vm.prank(alice);
        vm.expectRevert(bytes("not settled"));
        pool.withdrawPrincipal(rid);

        // move to Committed
        _warpPastSalesEnd();
        pool.commitDraw(rid);

        vm.prank(alice);
        vm.expectRevert(bytes("not settled"));
        pool.withdrawPrincipal(rid);
    }

    // =========================================================
    // C16. Refund equals principal in no-loss case (lossRatio=1e18)
    // =========================================================
    function test_C16_refundExactPrincipal_noLoss() public {
        _deploy(10000, 0); // 100% payout, no bonus yield

        _buy(alice, 2); // 0.02
        _buy(bob, 1);   // 0.01

        uint256 rid = _settleRound1();

        // In no-loss case: lossRatio should be 1e18, yield could be 0
        (
            ,
            ,
            ,
            uint256 totalPrincipal,
            ,
            ,
            ,
            ,
            uint256 monReceived,
            uint256 yieldMON,
            uint256 lossRatio,
            ,
            /* bool settledFlag */ 
        ) = pool.getRoundInfo(rid);

        assertEq(monReceived, totalPrincipal, "monReceived should equal totalPrincipal");
        assertEq(yieldMON, 0, "yield should be 0");
        assertEq(lossRatio, 1e18, "lossRatio should be 1e18");

        // Alice refund exact
        uint256 alicePrincipal = pool.principalMON(rid, alice);
        assertEq(alicePrincipal, uint256(TICKET_PRICE) * 2, "alice principal wrong");

        uint256 a0 = alice.balance;
        vm.prank(alice);
        pool.withdrawPrincipal(rid);
        uint256 a1 = alice.balance;

        assertEq(a1, a0 + alicePrincipal, "alice refund not exact");
        assertEq(pool.principalMON(rid, alice), 0, "alice principal not zeroed");

        // Bob refund exact
        uint256 bobPrincipal = pool.principalMON(rid, bob);
        assertEq(bobPrincipal, uint256(TICKET_PRICE) * 1, "bob principal wrong");

        uint256 b0 = bob.balance;
        vm.prank(bob);
        pool.withdrawPrincipal(rid);
        uint256 b1 = bob.balance;

        assertEq(b1, b0 + bobPrincipal, "bob refund not exact");
        assertEq(pool.principalMON(rid, bob), 0, "bob principal not zeroed");
    }

    // =========================================================
    // C17. Refund after slashing uses lossRatio (1%, 50%, near-total)
    // =========================================================
    function test_C17_loss_1percent() public {
        _deploy(9900, 0); // 99% payout

        _buy(alice, 2); // 0.02
        _buy(bob, 1);   // 0.01
        uint256 rid = _settleRound1();

        (
            ,
            ,
            ,
            uint256 totalPrincipal,
            ,
            ,
            ,
            ,
            uint256 monReceived,
            uint256 yieldMON,
            uint256 lossRatio,
            ,
            /* bool settledFlag */ 
        ) = pool.getRoundInfo(rid);

        assertEq(yieldMON, 0, "yield must be 0 on loss");
        // expected received is 99% of principal
        uint256 expectedReceived = (totalPrincipal * 9900) / 10000;
        assertEq(monReceived, expectedReceived, "monReceived mismatch");

        // lossRatio approx 0.99e18
        uint256 expectedLossRatio = (expectedReceived * 1e18) / totalPrincipal;
        assertEq(lossRatio, expectedLossRatio, "lossRatio mismatch");

        // Alice expected payout: principal * lossRatio
        uint256 alicePrincipal = pool.principalMON(rid, alice);
        uint256 expectedAlice = (alicePrincipal * lossRatio) / 1e18;

        uint256 a0 = alice.balance;
        vm.prank(alice);
        pool.withdrawPrincipal(rid);
        uint256 a1 = alice.balance;

        assertEq(a1, a0 + expectedAlice, "alice slashed refund wrong");
    }

    function test_C17_loss_50percent() public {
        _deploy(5000, 0); // 50% payout

        _buy(alice, 2); // 0.02
        _buy(bob, 1);   // 0.01
        uint256 rid = _settleRound1();

        (
            ,
            ,
            ,
            uint256 totalPrincipal,
            ,
            ,
            ,
            ,
            uint256 monReceived,
            uint256 yieldMON,
            uint256 lossRatio,
            ,
            /* bool settledFlag */ 
        ) = pool.getRoundInfo(rid);

        assertEq(yieldMON, 0, "yield must be 0 on loss");
        uint256 expectedReceived = (totalPrincipal * 5000) / 10000;
        assertEq(monReceived, expectedReceived, "monReceived mismatch");

        uint256 expectedLossRatio = (expectedReceived * 1e18) / totalPrincipal;
        assertEq(lossRatio, expectedLossRatio, "lossRatio mismatch");

        uint256 bobPrincipal = pool.principalMON(rid, bob);
        uint256 expectedBob = (bobPrincipal * lossRatio) / 1e18;

        uint256 b0 = bob.balance;
        vm.prank(bob);
        pool.withdrawPrincipal(rid);
        uint256 b1 = bob.balance;

        assertEq(b1, b0 + expectedBob, "bob 50% refund wrong");
    }

    function test_C17_loss_nearTotal() public {
        _deploy(10, 0); // 0.10% payout

        _buy(alice, 2); // 0.02
        _buy(bob, 1);   // 0.01
        uint256 rid = _settleRound1();

        (
            ,
            ,
            ,
            uint256 totalPrincipal,
            ,
            ,
            ,
            ,
            uint256 monReceived,
            uint256 yieldMON,
            uint256 lossRatio,
            ,
            /* bool settledFlag */ 
        ) = pool.getRoundInfo(rid);

        assertEq(yieldMON, 0, "yield must be 0 on loss");
        uint256 expectedReceived = (totalPrincipal * 10) / 10000;
        assertEq(monReceived, expectedReceived, "monReceived mismatch");

        uint256 expectedLossRatio = (expectedReceived * 1e18) / totalPrincipal;
        assertEq(lossRatio, expectedLossRatio, "lossRatio mismatch");

        uint256 alicePrincipal = pool.principalMON(rid, alice);
        uint256 expectedAlice = (alicePrincipal * lossRatio) / 1e18;

        uint256 a0 = alice.balance;
        vm.prank(alice);
        pool.withdrawPrincipal(rid);
        uint256 a1 = alice.balance;

        assertEq(a1, a0 + expectedAlice, "alice near-total refund wrong");
    }

    // =========================================================
    // C19. User buys multiple times: principal accumulates, refund equals total
    // (merge behavior is more D, but refund correctness is C)
    // =========================================================
    function test_C19_multipleBuys_principalAccumulates_refundMatches() public {
        _deploy(10000, 0);

        uint256 rid = 1;

        // Alice buys twice
        _buy(alice, 1);
        _buy(alice, 3);

        uint256 expectedPrincipal = uint256(TICKET_PRICE) * 4;
        assertEq(pool.principalMON(rid, alice), expectedPrincipal, "principal did not accumulate");

        // Finish and settle
        _settleRound1();

        uint256 a0 = alice.balance;
        vm.prank(alice);
        pool.withdrawPrincipal(rid);
        uint256 a1 = alice.balance;

        assertEq(a1, a0 + expectedPrincipal, "refund not equal to total principal");
    }

    // Extra accounting sanity: winner claim uses yield only; principal refunds unaffected
    function test_claimPrize_doesNotReducePrincipalRefunds() public {
        // Pay principal 100% + add yield
        uint256 bonus = 0.5 ether;
        _deploy(10000, bonus);

        _buy(alice, 2); // 0.02
        _buy(bob, 1);   // 0.01

        uint256 rid = _settleRound1();

        (, , , , , , address winner, , , uint256 yieldMON, uint256 lossRatio, , ) = pool.getRoundInfo(rid);
        assertTrue(yieldMON > 0, "expected positive yield");
        assertEq(lossRatio, 1e18, "no loss expected");

        // Winner claims yield
        uint256 w0 = winner.balance;
        vm.prank(winner);
        pool.claimPrize(rid);
        uint256 w1 = winner.balance;
        assertEq(w1, w0 + yieldMON, "winner did not receive yield");

        // Both principals still withdrawable in full
        uint256 alicePrincipal = pool.principalMON(rid, alice);
        uint256 bobPrincipal = pool.principalMON(rid, bob);

        uint256 a0 = alice.balance;
        vm.prank(alice);
        pool.withdrawPrincipal(rid);
        uint256 a1 = alice.balance;
        assertEq(a1, a0 + alicePrincipal, "alice principal affected by prize claim");

        uint256 b0 = bob.balance;
        vm.prank(bob);
        pool.withdrawPrincipal(rid);
        uint256 b1 = bob.balance;
        assertEq(b1, b0 + bobPrincipal, "bob principal affected by prize claim");
    }
}
