// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "../src/TicketPrizePoolShmonShMonad.sol";

contract MockShMonad is IShMonad {
    uint64 public internalEpoch;

    mapping(address => uint256) public shareBal;         // shares held by each account
    mapping(address => uint256) public pendingAssets;    // assets to return on completeUnstake
    mapping(address => uint64)  public completionEpoch;  // when caller can complete

    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares) {
        require(msg.value == assets, "bad value");
        shares = assets; // 1:1 mock shares
        shareBal[receiver] += shares;
    }

    function requestUnstake(uint256 shares) external returns (uint64 ce) {
        require(shareBal[msg.sender] >= shares, "insufficient shares");
        shareBal[msg.sender] -= shares;

        pendingAssets[msg.sender] += shares; // 1:1 assets
        ce = internalEpoch + 2;              // require 2 epochs delay
        completionEpoch[msg.sender] = ce;
    }

    function completeUnstake() external {
        uint64 ce = completionEpoch[msg.sender];
        require(ce != 0, "no request");
        require(internalEpoch >= ce, "too early");

        uint256 amt = pendingAssets[msg.sender];
        pendingAssets[msg.sender] = 0;
        completionEpoch[msg.sender] = 0;

        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok, "xfer fail");
    }

    function bumpEpoch(uint64 n) external {
        internalEpoch += n;
    }

    receive() external payable {}
}

contract TicketPrizePoolShmonShMonad_FinalizationBusy_Test is Test {
    TicketPrizePoolShmonShMonad pool;
    MockShMonad shmon;

    address alice = address(0xA11CE);
    address bob   = address(0xB0B);

    uint96 constant PRICE = 1e16; // 0.01 MON
    uint32 constant DELAY = 5;
    uint32 constant DUR   = 90;

    function setUp() public {
        shmon = new MockShMonad();
        pool = new TicketPrizePoolShmonShMonad(PRICE, DELAY, DUR, address(shmon));

        vm.deal(alice, 10 ether);
        vm.deal(bob,   10 ether);
    }

    function _commit(uint256 rid) internal returns (uint256 targetBlock) {
        // move past sales end
        (, uint64 salesEndTime, , , , , , , , , , , ) = pool.getRoundInfo(rid);
        vm.warp(uint256(salesEndTime) + 1);

        pool.commitDraw(rid);

        // read target (6th return = targetBlock)
        (, , , , , targetBlock, , , , , , , ) = pool.getRoundInfo(rid);
    }

    function _rollToAfter(uint256 targetBlock) internal {
        vm.roll(targetBlock + 1);
    }

    function test_finalizationBusy_blocks_second_draw_until_settled() public {
        // ---- Round 1: buy + commit
        vm.prank(alice);
        pool.buyTickets{value: PRICE}(1);

        uint256 target1 = _commit(1);
        // commitDraw(1) started round 2 automatically
        assertEq(pool.currentRoundId(), 2, "round 2 should be open");

        // ---- Round 2: buy + commit as well
        vm.prank(bob);
        pool.buyTickets{value: PRICE}(1);

        uint256 target2 = _commit(2);
        // commitDraw(2) started round 3 automatically
        assertEq(pool.currentRoundId(), 3, "round 3 should be open");

        // ---- Draw winner for round 1 (locks finalization)
        _rollToAfter(target1);
        pool.drawWinner(1);

        assertEq(pool.getActiveFinalizer(), 1, "active finalizer should be round 1");

        // ---- Draw winner for round 2 should revert while finalization busy
        _rollToAfter(target2);
        vm.expectRevert(pool.legacyBytes("finalization busy"));
        pool.drawWinner(2);

        // ---- Settle round 1 after epoch matures, unlock
        shmon.bumpEpoch(2);
        pool.settleRound(1);
        assertEq(pool.getActiveFinalizer(), 0, "finalizer should be cleared after settle");

        // ---- Now draw winner for round 2 succeeds
        pool.drawWinner(2);
        assertEq(pool.getActiveFinalizer(), 2, "active finalizer should now be round 2");
    }

    function test_commitDraw_not_blocked_by_finalizationBusy() public {
        // Round 1 buy + commit + draw -> finalization busy
        vm.prank(alice);
        pool.buyTickets{value: PRICE}(1);

        uint256 target1 = _commit(1);
        _rollToAfter(target1);
        pool.drawWinner(1);
        assertEq(pool.getActiveFinalizer(), 1);

        // Round 2 can still be bought + committed (busy only blocks drawWinner)
        vm.prank(bob);
        pool.buyTickets{value: PRICE}(1);

        // move past round 2 sales end and commit
        (, uint64 salesEndTime2, , , , , , , , , , , ) = pool.getRoundInfo(2);
        vm.warp(uint256(salesEndTime2) + 1);

        pool.commitDraw(2);

        // state should be Committed
        assertEq(uint8(pool.getRoundState(2)), uint8(TicketPrizePoolShmonShMonad.RoundState.Committed));
    }
}
