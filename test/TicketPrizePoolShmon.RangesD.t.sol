// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import "../src/TicketPrizePoolShmon.sol";

/// @dev Minimal staker used only for buyTickets() tests.
/// stake() returns msg.value (1:1), request/claim exist to satisfy interface but unused here.
contract RangeStaker is IShmonadStaker {
    uint256 public nextRequestId = 1;

    function stake() external payable returns (uint256 shmonAmount) {
        return msg.value; // must be > 0
    }

    function requestUnstake(uint256) external returns (uint256 requestId) {
        requestId = nextRequestId++;
    }

    function claimUnstake(uint256, address to) external returns (uint256 monAmount) {
        (bool ok,) = to.call{value: 0}("");
        require(ok, "noop");
        return 0;
    }

    function isUnstakeReady(uint256) external pure returns (bool) {
        return false;
    }

    receive() external payable {}
}

contract TicketPrizePoolShmonRangesDTest is Test {
    TicketPrizePoolShmon pool;
    RangeStaker staker;

    uint96  constant TICKET_PRICE = 0.01 ether;
    uint32  constant COMMIT_DELAY = 5;
    uint32  constant ROUND_DUR    = 10 minutes;

    uint256 constant RID = 1;

    address[] internal expectedOwners;

    function setUp() public {
        staker = new RangeStaker();
        pool = new TicketPrizePoolShmon(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(staker));
    }

    function _fund(address a, uint256 amt) internal {
        vm.deal(a, amt);
    }

    function _buy(address user, uint32 n) internal {
        vm.prank(user);
        pool.buyTickets{value: uint256(TICKET_PRICE) * n}(n);
    }

    // =========================================================
    // D21. Range merging correctness
    // =========================================================

    function test_D21_merge_consecutive_sameBuyer_merges() public {
        address alice = address(0xA11cE);
        _fund(alice, 10 ether);

        // consecutive buys by same user: should merge into a single range
        _buy(alice, 1); // tickets [0,1)
        _buy(alice, 3); // tickets [1,4) => merges with previous

        assertEq(pool.rangesLength(RID), 1, "should have merged into 1 range");

        (uint32 start, uint32 end, address buyer) = pool.rangeAt(RID, 0);
        assertEq(start, 0, "range start wrong");
        assertEq(end, 4, "range end wrong");
        assertEq(buyer, alice, "buyer wrong");

        // spot-check ownership
        assertEq(pool.ownerOfTicket(RID, 0), alice, "ticket0 wrong owner");
        assertEq(pool.ownerOfTicket(RID, 3), alice, "ticket3 wrong owner");
    }

    function test_D21_merge_nonConsecutive_doesNotMerge() public {
        address alice = address(0xA11cE);
        address bob   = address(0xB0b);
        _fund(alice, 10 ether);
        _fund(bob, 10 ether);

        _buy(alice, 1); // [0,1) alice
        _buy(bob, 1);   // [1,2) bob
        _buy(alice, 1); // [2,3) alice (should NOT merge with first)

        assertEq(pool.rangesLength(RID), 3, "ranges length should be 3 (no merge across bob)");

        // ownership check
        assertEq(pool.ownerOfTicket(RID, 0), alice);
        assertEq(pool.ownerOfTicket(RID, 1), bob);
        assertEq(pool.ownerOfTicket(RID, 2), alice);
    }

    // =========================================================
    // D20. Many buys from many users (100+ ranges)
    // Verify ownerOfTicket for first/last/middle/boundaries
    // =========================================================

    function test_D20_manyRanges_ownerOfTicket_boundaries() public {
        uint256 numBuys = 120;
        uint256 numUsers = 10;

        address[] memory users = new address[](numUsers);
        for (uint256 i = 0; i < numUsers; i++) {
            users[i] = address(uint160(0x1000 + i));
            _fund(users[i], 10 ether);
        }

        delete expectedOwners;

        for (uint256 i = 0; i < numBuys; i++) {
            address buyer = users[i % numUsers];
            _buy(buyer, 1);
            expectedOwners.push(buyer);
        }

        assertEq(pool.rangesLength(RID), numBuys, "unexpected merge or missing ranges");

        assertEq(pool.ownerOfTicket(RID, 0), expectedOwners[0], "first ticket owner wrong");
        assertEq(pool.ownerOfTicket(RID, uint32(numBuys - 1)), expectedOwners[numBuys - 1], "last ticket owner wrong");

        uint32 mid = uint32(numBuys / 2);
        assertEq(pool.ownerOfTicket(RID, mid), expectedOwners[mid], "middle ticket owner wrong");

        for (uint32 i = 0; i < uint32(numBuys); i++) {
            assertEq(pool.ownerOfTicket(RID, i), expectedOwners[i], "ticket owner mismatch");
        }

        vm.expectRevert(bytes("ticket OOB"));
        pool.ownerOfTicket(RID, uint32(numBuys));
    }

    // =========================================================
    // D22. Fuzz ticket owner: random ticketId should match expectedOwners[ticketId]
    // =========================================================

    function test_D22_fuzz_owner_randomTicket(uint32 ticketId) public {
        uint256 numBuys = 120;
        uint256 numUsers = 10;

        address[] memory users = new address[](numUsers);
        for (uint256 i = 0; i < numUsers; i++) {
            users[i] = address(uint160(0x2000 + i));
            _fund(users[i], 10 ether);
        }

        delete expectedOwners;

        for (uint256 i = 0; i < numBuys; i++) {
            address buyer = users[i % numUsers];
            _buy(buyer, 1);
            expectedOwners.push(buyer);
        }

        uint32 bounded = uint32(bound(ticketId, 0, numBuys - 1));
        assertEq(pool.ownerOfTicket(RID, bounded), expectedOwners[bounded], "fuzz owner mismatch");
    }

    // =========================================================
    // Mixed range sizes sanity
    // =========================================================

    function test_D20_mixedRangeSizes_correctness() public {
        address alice = address(0xA11cE);
        address bob   = address(0xB0b);
        address carol = address(0xCA001);

        _fund(alice, 10 ether);
        _fund(bob, 10 ether);
        _fund(carol, 10 ether);

        _buy(alice, 2);
        _buy(alice, 3); // merged => [0,5)

        _buy(bob, 2);   // [5,7)
        _buy(carol, 4); // [7,11)
        _buy(alice, 1); // [11,12)

        assertEq(pool.rangesLength(RID), 4, "unexpected rangesLength");

        assertEq(pool.ownerOfTicket(RID, 0), alice);
        assertEq(pool.ownerOfTicket(RID, 4), alice);
        assertEq(pool.ownerOfTicket(RID, 5), bob);
        assertEq(pool.ownerOfTicket(RID, 6), bob);
        assertEq(pool.ownerOfTicket(RID, 7), carol);
        assertEq(pool.ownerOfTicket(RID, 10), carol);
        assertEq(pool.ownerOfTicket(RID, 11), alice);
    }
}
