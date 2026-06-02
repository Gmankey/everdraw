// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {V4TestBase} from "./V4TestBase.t.sol";
import {TicketPrizePoolV4} from "../src/TicketPrizePoolV4.sol";
import {MockRandomnessOracle} from "./mocks/MockRandomnessOracle.sol";

contract ReentrantExecuteNextYieldVault {
    address public pool;
    uint256 public attackRid;
    uint256 public rate = 1e18;
    bool public attackEnabled;
    bool public attempted;
    bool public reentryReverted;
    mapping(address => uint256) public balanceOf;

    function setRate(uint256 newRate) external {
        require(newRate > 0, "rate");
        rate = newRate;
    }

    function setPool(address newPool) external {
        pool = newPool;
    }

    function setAttack(uint256 rid, bool enabled) external {
        attackRid = rid;
        attackEnabled = enabled;
    }

    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares) {
        require(msg.value == assets, "value");
        shares = (assets * 1e18) / rate;
        balanceOf[receiver] += shares;
    }

    function previewDeposit(uint256 assets) external view returns (uint256 shares) {
        return (assets * 1e18) / rate;
    }

    function previewRedeem(uint256 shares) external view returns (uint256 assets) {
        return (shares * rate) / 1e18;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (attackEnabled && !attempted) {
            attempted = true;
            (bool ok, bytes memory data) = pool.call(abi.encodeWithSignature("executeNext(uint256)", attackRid));
            reentryReverted = !ok && data.length >= 100 && bytes4(data) == bytes4(keccak256("Error(string)"));
        }

        require(balanceOf[msg.sender] >= amount, "shares");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    receive() external payable {}
}

contract V4_TransferResilience_Test is V4TestBase {
    function setUp() public {
        _deployNative(1, _oneWinnerAlloc());
    }

    function test_withdraw_defers_when_yield_vault_transfer_fails() public {
        _buyNative(alice, 1);
        _settleWithRandom(bytes32(uint256(1)));
        yieldVault.setTransfersPaused(true);
        vm.prank(alice);
        pool.withdrawPrincipal(1);
        assertGt(pool.pendingClaims(1, alice, 0xff), 0);
        assertEq(pool.pendingClaimSlotCount(alice), 1);
        assertTrue(pool.hasPendingClaims(alice));
    }

    function test_deferred_retry_succeeds_after_unpause() public {
        _buyNative(alice, 1);
        _settleWithRandom(bytes32(uint256(1)));
        yieldVault.setTransfersPaused(true);
        vm.prank(alice);
        pool.withdrawPrincipal(1);
        assertEq(pool.pendingClaimSlotCount(alice), 1);
        assertTrue(pool.hasPendingClaims(alice));
        yieldVault.setTransfersPaused(false);
        vm.prank(alice);
        pool.claimDeferred(1, 0xff);
        assertEq(pool.pendingClaims(1, alice, 0xff), 0);
        assertEq(pool.pendingClaimSlotCount(alice), 0);
        assertFalse(pool.hasPendingClaims(alice));
    }

    function test_hasPendingClaims_tracks_multiple_slots_o1() public {
        _buyNative(alice, 1);
        _settleWithRandom(bytes32(uint256(1)));

        yieldVault.setTransfersPaused(true);
        vm.prank(alice);
        pool.withdrawPrincipal(1);

        vm.deal(alice, 2 ether);
        vm.prank(alice);
        pool.sponsor{value: 2 ether}(2, "promo");
        vm.warp(block.timestamp + ROUND_SEC + 1);
        pool.executeNext(2);
        vm.prank(alice);
        pool.claimSponsorRefund(2);

        assertEq(pool.pendingClaimSlotCount(alice), 2);
        assertTrue(pool.hasPendingClaims(alice));

        yieldVault.setTransfersPaused(false);
        vm.prank(alice);
        pool.claimDeferred(1, 0xff);

        assertEq(pool.pendingClaimSlotCount(alice), 1);
        assertTrue(pool.hasPendingClaims(alice));

        vm.prank(alice);
        pool.claimDeferred(2, 0xfe);

        assertEq(pool.pendingClaimSlotCount(alice), 0);
        assertFalse(pool.hasPendingClaims(alice));
    }

    function test_executeNext_reentry_from_yield_vault_transfer_hits_guard() public {
        ReentrantExecuteNextYieldVault maliciousVault = new ReentrantExecuteNextYieldVault();
        oracle = new MockRandomnessOracle();
        pool = new TicketPrizePoolV4(
            _cfg(
                TicketPrizePoolV4.DepositMode.Native,
                address(0),
                address(maliciousVault),
                1,
                _oneWinnerAlloc()
            )
        );
        vm.deal(address(pool), 10 ether);
        maliciousVault.setPool(address(pool));

        TicketPrizePoolV4.FeeAllocation[] memory allocs = new TicketPrizePoolV4.FeeAllocation[](1);
        allocs[0] = TicketPrizePoolV4.FeeAllocation({recipient: treasury, bps: 1000});
        pool.setFeeAllocations(allocs);

        vm.warp(block.timestamp + ROUND_SEC + 1);
        pool.executeNext(1);

        _buyNative(alice, 1);
        maliciousVault.setAttack(2, true);
        maliciousVault.setRate(2e18);
        vm.warp(block.timestamp + ROUND_SEC + YIELD_SEC + 1);
        pool.executeNext(2);
        oracle.fulfill(1, bytes32(uint256(1)));
        pool.executeNext(2);

        assertTrue(maliciousVault.attempted(), "reentry was not attempted");
        assertTrue(maliciousVault.reentryReverted(), "reentry did not hit guard");
        assertEq(uint8(pool.getRoundState(2)), uint8(TicketPrizePoolV4.RoundState.Settled));
    }
}
