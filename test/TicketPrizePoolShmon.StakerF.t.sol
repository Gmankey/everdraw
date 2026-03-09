// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "../src/TicketPrizePoolShmon.sol";

/*//////////////////////////////////////////////////////////////
                        STAKER MOCKS
//////////////////////////////////////////////////////////////*/

/// @dev Spy staker: counts stake/request/claim calls.
contract SpyStaker is IShmonadStaker {
    uint256 public stakeCalls;
    uint256 public requestCalls;
    uint256 public claimCalls;

    uint256 public nextRequestId = 1;
    mapping(uint256 => uint256) public reqAmount;

    function stake() external payable returns (uint256 shmonAmount) {
        stakeCalls++;
        return msg.value; // 1:1
    }

    function requestUnstake(uint256 shmonAmount) external returns (uint256 requestId) {
        requestCalls++;
        requestId = nextRequestId++;
        reqAmount[requestId] = shmonAmount;
    }

    function claimUnstake(uint256 requestId, address to) external returns (uint256 monAmount) {
        claimCalls++;
        uint256 amt = reqAmount[requestId];
        reqAmount[requestId] = 0;
        monAmount = amt;
        (bool ok,) = to.call{value: monAmount}("");
        require(ok, "spy transfer failed");
    }

    function isUnstakeReady(uint256) external pure returns (bool) {
        return true;
    }

    receive() external payable {}
}

/// @dev Weird stake staker: stake() returns 0 no matter what.
contract ZeroStakeStaker is IShmonadStaker {
    function stake() external payable returns (uint256 shmonAmount) {
        // accepts MON but returns 0 => pool should revert "stake failed"
        return 0;
    }

    function requestUnstake(uint256) external pure returns (uint256) {
        return 1;
    }
    function claimUnstake(uint256, address) external pure returns (uint256) {
        return 0;
    }
    function isUnstakeReady(uint256) external pure returns (bool) {
        return true;
    }
    receive() external payable {}
}

/// @dev Claim returns 0 even when ready (simulates extreme slashing or misbehaving staker).
contract ZeroClaimStaker is IShmonadStaker {
    uint256 public nextRequestId = 1;
    mapping(uint256 => uint256) public reqAmount;

    function stake() external payable returns (uint256 shmonAmount) {
        return msg.value;
    }

    function requestUnstake(uint256 shmonAmount) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        reqAmount[requestId] = shmonAmount;
    }

    function claimUnstake(uint256 requestId, address to) external returns (uint256 monAmount) {
        // Return 0 regardless, but still "send" 0
        reqAmount[requestId] = 0;
        monAmount = 0;
        (bool ok,) = to.call{value: 0}("");
        require(ok, "zero claim noop");
    }

    function isUnstakeReady(uint256) external pure returns (bool) {
        return true;
    }
    receive() external payable {}
}

/// @dev Delay staker: isUnstakeReady becomes true only after readyAt timestamp.
contract DelayStaker is IShmonadStaker {
    uint256 public delaySec;
    uint256 public nextRequestId = 1;

    struct Req {
        uint256 amount;
        uint256 readyAt;
    }
    mapping(uint256 => Req) public reqs;

    constructor(uint256 _delaySec) {
        delaySec = _delaySec;
    }

    function stake() external payable returns (uint256 shmonAmount) {
        return msg.value;
    }

    function requestUnstake(uint256 shmonAmount) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        reqs[requestId] = Req({amount: shmonAmount, readyAt: block.timestamp + delaySec});
    }

    function isUnstakeReady(uint256 requestId) external view returns (bool) {
        return block.timestamp >= reqs[requestId].readyAt;
    }

    function claimUnstake(uint256 requestId, address to) external returns (uint256 monAmount) {
        Req memory r = reqs[requestId];
        reqs[requestId].amount = 0;
        monAmount = r.amount;
        (bool ok,) = to.call{value: monAmount}("");
        require(ok, "delay transfer failed");
    }

    receive() external payable {}
}

/// @dev Yield timing staker: bonus can be changed any time; claim pays (principal + current bonus).
contract YieldTimingStaker is IShmonadStaker {
    uint256 public bonusWei;
    uint256 public nextRequestId = 1;
    mapping(uint256 => uint256) public reqAmount;

    function setBonus(uint256 b) external {
        bonusWei = b;
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
        monAmount = amt + bonusWei;
        (bool ok,) = to.call{value: monAmount}("");
        require(ok, "yield transfer failed");
    }

    receive() external payable {}
}

/*//////////////////////////////////////////////////////////////
                            TESTS
//////////////////////////////////////////////////////////////*/

contract TicketPrizePoolShmonStakerFTest is Test {
    uint96  constant TICKET_PRICE = 0.01 ether;
    uint32  constant COMMIT_DELAY = 5;
    uint32  constant ROUND_DUR    = 10 minutes;
    uint256 constant RID          = 1;

    address alice = address(0xA11cE);

    function _warpPastSalesEnd() internal {
        vm.warp(block.timestamp + ROUND_DUR + 1);
    }

    function _targetBlock(TicketPrizePoolShmon pool) internal view returns (uint256) {
        (, , , , , uint256 targetBlockNumber, , , , , , , ) = pool.getRoundInfo(RID);
        return targetBlockNumber;
    }

    // -------------------------
    // F27: stake() returns 0 -> revert "stake failed"
    // -------------------------
    function test_F27_stakeReturnsZero_reverts() public {
        ZeroStakeStaker staker = new ZeroStakeStaker();
        TicketPrizePoolShmon pool = new TicketPrizePoolShmon(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(staker));

        vm.deal(alice, 1 ether);

        vm.prank(alice);
        vm.expectRevert(bytes("stake failed"));
        pool.buyTickets{value: TICKET_PRICE}(1);
    }

    // -------------------------
    // F26: pool cannot request unstake twice for same round
    // -------------------------
    function test_F26_unstakeRequestOnlyOnce() public {
        SpyStaker staker = new SpyStaker();
        TicketPrizePoolShmon pool = new TicketPrizePoolShmon(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(staker));

        vm.deal(alice, 10 ether);

        // buy
        vm.prank(alice);
        pool.buyTickets{value: TICKET_PRICE * 3}(3);

        // commit
        _warpPastSalesEnd();
        pool.commitDraw(RID);

        // draw
        uint256 target = _targetBlock(pool);
        vm.roll(target + 1);
        pool.drawWinner(RID);

        assertEq(staker.requestCalls(), 1, "requestUnstake should be called exactly once");

        // settle (should not request again)
        pool.settleRound(RID);
        assertEq(staker.requestCalls(), 1, "settleRound must not call requestUnstake");

        // second draw attempt must revert "bad state" and not request again
        vm.expectRevert(bytes("bad state"));
        pool.drawWinner(RID);
        assertEq(staker.requestCalls(), 1, "still should be exactly once");
    }

    // -------------------------
    // F27: claimUnstake returns 0 even when ready
    // -------------------------
    function test_F27_claimReturnsZero_setsLossRatioZero_refundsZero() public {
        ZeroClaimStaker staker = new ZeroClaimStaker();
        TicketPrizePoolShmon pool = new TicketPrizePoolShmon(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(staker));

        vm.deal(alice, 10 ether);

        // buy
        vm.prank(alice);
        pool.buyTickets{value: TICKET_PRICE * 2}(2);

        // progress to settle
        _warpPastSalesEnd();
        pool.commitDraw(RID);

        uint256 target = _targetBlock(pool);
        vm.roll(target + 1);
        pool.drawWinner(RID);

        pool.settleRound(RID);

        (, , , uint256 totalPrincipal, , , , , uint256 monReceived, uint256 yieldMON, uint256 lossRatio, , ) =
            pool.getRoundInfo(RID);

        assertEq(totalPrincipal, TICKET_PRICE * 2, "principal mismatch");
        assertEq(monReceived, 0, "monReceived should be 0");
        assertEq(yieldMON, 0, "yield should be 0");
        assertEq(lossRatio, 0, "lossRatio should be 0 when monReceived=0 and principal>0");

        // withdraw should transfer 0 but still zero principal mapping
        uint256 bal0 = alice.balance;

        vm.prank(alice);
        pool.withdrawPrincipal(RID);

        uint256 bal1 = alice.balance;
        assertEq(bal1, bal0, "balance should not change on zero refund");
        assertEq(pool.principalMON(RID, alice), 0, "principal should be zeroed");
    }

    // -------------------------
    // F28: delay logic boundary: not ready at readyAt-1, ready at readyAt
    // -------------------------
    function test_F28_delayBoundary_settleRevertsUntilReady() public {
        uint256 delay = 6 hours;
        DelayStaker staker = new DelayStaker(delay);
        TicketPrizePoolShmon pool = new TicketPrizePoolShmon(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(staker));

        vm.deal(alice, 10 ether);

        // buy
        vm.prank(alice);
        pool.buyTickets{value: TICKET_PRICE}(1);

        // commit + draw
        _warpPastSalesEnd();
        pool.commitDraw(RID);

        uint256 target = _targetBlock(pool);
        vm.roll(target + 1);
        pool.drawWinner(RID);

        // First request is id=1
        uint256 reqId = 1;

        (, uint256 readyAt) = staker.reqs(reqId);

        // warp to readyAt - 1 => not ready
        vm.warp(readyAt - 1);
        vm.expectRevert(bytes("unstake not ready"));
        pool.settleRound(RID);

        // warp to readyAt => ready
        vm.warp(readyAt);
        pool.settleRound(RID);

        assertEq(uint8(pool.getRoundState(RID)), uint8(TicketPrizePoolShmon.RoundState.Settled), "should be settled");
    }

    // -------------------------
    // F29: yield injection timing
    // -------------------------
    function test_F29_yieldSet_beforeCommit() public {
        YieldTimingStaker staker = new YieldTimingStaker();
        TicketPrizePoolShmon pool = new TicketPrizePoolShmon(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(staker));

        vm.deal(alice, 10 ether);
        vm.deal(address(staker), 1 ether);

        vm.prank(alice);
        pool.buyTickets{value: TICKET_PRICE * 2}(2);

        // set yield before commit
        staker.setBonus(0.3 ether);

        _warpPastSalesEnd();
        pool.commitDraw(RID);

        uint256 target = _targetBlock(pool);
        vm.roll(target + 1);
        pool.drawWinner(RID);

        pool.settleRound(RID);

        (, , , uint256 principal, , , , , uint256 monReceived, uint256 yieldMON, uint256 lossRatio, , ) =
            pool.getRoundInfo(RID);

        assertEq(lossRatio, 1e18, "should be no loss");
        assertEq(monReceived, principal + 0.3 ether, "monReceived mismatch");
        assertEq(yieldMON, 0.3 ether, "yield mismatch");
    }

    function test_F29_yieldSet_afterCommit_beforeDraw() public {
        YieldTimingStaker staker = new YieldTimingStaker();
        TicketPrizePoolShmon pool = new TicketPrizePoolShmon(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(staker));

        vm.deal(alice, 10 ether);
        vm.deal(address(staker), 1 ether);

        vm.prank(alice);
        pool.buyTickets{value: TICKET_PRICE}(1);

        _warpPastSalesEnd();
        pool.commitDraw(RID);

        // set yield after commit, before draw
        staker.setBonus(0.2 ether);

        uint256 target = _targetBlock(pool);
        vm.roll(target + 1);
        pool.drawWinner(RID);

        pool.settleRound(RID);

        (, , , uint256 principal, , , , , uint256 monReceived, uint256 yieldMON, , , ) = pool.getRoundInfo(RID);
        assertEq(monReceived, principal + 0.2 ether, "monReceived mismatch");
        assertEq(yieldMON, 0.2 ether, "yield mismatch");
    }

    function test_F29_yieldSet_afterDraw_beforeSettle() public {
        YieldTimingStaker staker = new YieldTimingStaker();
        TicketPrizePoolShmon pool = new TicketPrizePoolShmon(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(staker));

        vm.deal(alice, 10 ether);
        vm.deal(address(staker), 1 ether);

        vm.prank(alice);
        pool.buyTickets{value: TICKET_PRICE * 3}(3);

        _warpPastSalesEnd();
        pool.commitDraw(RID);

        uint256 target = _targetBlock(pool);
        vm.roll(target + 1);
        pool.drawWinner(RID);

        // set yield after draw, before settle
        staker.setBonus(0.4 ether);

        pool.settleRound(RID);

        (, , , uint256 principal, , , , , uint256 monReceived, uint256 yieldMON, , , ) = pool.getRoundInfo(RID);
        assertEq(monReceived, principal + 0.4 ether, "monReceived mismatch");
        assertEq(yieldMON, 0.4 ether, "yield mismatch");
    }
}
