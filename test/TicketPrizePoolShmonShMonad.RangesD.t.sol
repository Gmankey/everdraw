// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {TicketPrizePoolShmonShMonad, IShMonad} from "../src/TicketPrizePoolShmonShMonad.sol";

contract RangeShMonad is IShMonad {
    function deposit(uint256 assets, address) external payable returns (uint256 shares) {
        require(msg.value == assets, "bad value");
        return assets;
    }

    function requestUnstake(uint256) external pure returns (uint64 completionEpoch) {
        return 0;
    }

    function completeUnstake() external pure {}
}

contract TicketPrizePoolShmonShMonad_RangesD_Test is Test {
    TicketPrizePoolShmonShMonad pool;
    RangeShMonad shmon;

    uint96 constant TICKET_PRICE = 0.01 ether;
    uint32 constant COMMIT_DELAY = 5;
    uint32 constant ROUND_DUR = 90;

    uint256 constant RID = 1;

    address[] internal expectedOwners;

    function setUp() public {
        shmon = new RangeShMonad();
        pool = new TicketPrizePoolShmonShMonad(TICKET_PRICE, COMMIT_DELAY, ROUND_DUR, address(shmon));
    }

    function _fund(address a, uint256 amt) internal {
        vm.deal(a, amt);
    }

    function _buy(address user, uint32 n) internal {
        vm.prank(user);
        pool.buyTickets{value: uint256(TICKET_PRICE) * n}(n);
    }

    function test_D21_merge_consecutive_sameBuyer_merges() public {
        address alice = address(0xA11cE);
        _fund(alice, 10 ether);

        _buy(alice, 1);
        _buy(alice, 3);

        assertEq(pool.rangesLength(RID), 1);
        assertEq(pool.ownerOfTicket(RID, 0), alice);
        assertEq(pool.ownerOfTicket(RID, 3), alice);
    }

    function test_D21_merge_nonConsecutive_doesNotMerge() public {
        address alice = address(0xA11cE);
        address bob = address(0xB0b);
        _fund(alice, 10 ether);
        _fund(bob, 10 ether);

        _buy(alice, 1);
        _buy(bob, 1);
        _buy(alice, 1);

        assertEq(pool.rangesLength(RID), 3);
        assertEq(pool.ownerOfTicket(RID, 0), alice);
        assertEq(pool.ownerOfTicket(RID, 1), bob);
        assertEq(pool.ownerOfTicket(RID, 2), alice);
    }

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

        assertEq(pool.rangesLength(RID), numBuys);

        assertEq(pool.ownerOfTicket(RID, 0), expectedOwners[0]);
        assertEq(pool.ownerOfTicket(RID, uint32(numBuys - 1)), expectedOwners[numBuys - 1]);

        uint32 mid = uint32(numBuys / 2);
        assertEq(pool.ownerOfTicket(RID, mid), expectedOwners[mid]);

        for (uint32 i = 0; i < uint32(numBuys); i++) {
            assertEq(pool.ownerOfTicket(RID, i), expectedOwners[i]);
        }

        vm.expectRevert(TicketPrizePoolShmonShMonad.TicketOOB.selector);
        pool.ownerOfTicket(RID, uint32(numBuys));
    }

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
        assertEq(pool.ownerOfTicket(RID, bounded), expectedOwners[bounded]);
    }

    function test_D20_mixedRangeSizes_correctness() public {
        address alice = address(0xA11cE);
        address bob = address(0xB0b);
        address carol = address(0xCA001);

        _fund(alice, 10 ether);
        _fund(bob, 10 ether);
        _fund(carol, 10 ether);

        _buy(alice, 2);
        _buy(alice, 3);

        _buy(bob, 2);
        _buy(carol, 4);
        _buy(alice, 1);

        assertEq(pool.rangesLength(RID), 4);

        assertEq(pool.ownerOfTicket(RID, 0), alice);
        assertEq(pool.ownerOfTicket(RID, 4), alice);
        assertEq(pool.ownerOfTicket(RID, 5), bob);
        assertEq(pool.ownerOfTicket(RID, 6), bob);
        assertEq(pool.ownerOfTicket(RID, 7), carol);
        assertEq(pool.ownerOfTicket(RID, 10), carol);
        assertEq(pool.ownerOfTicket(RID, 11), alice);
    }
}
