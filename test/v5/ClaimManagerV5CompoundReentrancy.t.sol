// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {ClaimManagerV5} from "../../src/v5/ClaimManagerV5.sol";
import {PrizeVaultV5} from "../../src/v5/PrizeVaultV5.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";
import {ReentrantCompoundStrategy} from "../mocks/ReentrantCompoundStrategy.sol";

/// @notice ADR-0043 / builder-ticket requirement: "Guard against reentrancy on the
/// ClaimManager->Vault call path explicitly (test it)." The compound path is the first place
/// PrizeVaultV5 and ClaimManagerV5 make an external call into each other mid-flight (CM calls
/// `vault.depositFor`, which in turn calls into the yield strategy before returning), so this
/// is the new reentrancy surface ADR-0043 introduces. These tests use a malicious strategy that
/// tries to exploit that hop and prove both contracts' own `nonReentrant` guards hold.
contract ClaimManagerV5CompoundReentrancyTest is Test {
    ClaimManagerV5 claims;
    EverdrawTwabController twab;
    ReentrantCompoundStrategy strategy;
    PrizeVaultV5 vault;

    address source = makeAddr("source");
    address winner = makeAddr("winner");
    address attacker = makeAddr("attacker");
    bytes32 sourceKey = bytes32(uint256(1));

    function setUp() public {
        vm.warp(1_000_000);
        twab = new EverdrawTwabController(1 hours, uint32(block.timestamp));
        strategy = new ReentrantCompoundStrategy();
        vault = new PrizeVaultV5(address(twab), address(strategy), 0, "EVRDRAW-V5-MON");
        strategy.setVault(address(vault));
        twab.registerVault(address(vault));

        claims = new ClaimManagerV5();
        claims.setAuthorizedSource(source, true);
        claims.setCompoundVault(source, address(vault));
        strategy.setClaimManager(address(claims));
        strategy.setAttacker(attacker);
    }

    /// @notice Direct vault-level check: a reentrant call back into `depositFor` while the vault
    /// is already mid-`depositFor` (via the strategy hop) must revert on `nonReentrant`, and must
    /// not corrupt the legitimate deposit that triggered it.
    function test_reentrantDepositForDuringDepositForIsBlocked() public {
        strategy.armVaultReentry();

        vm.deal(address(this), 1 ether);
        vault.depositFor{value: 1 ether}(winner);

        assertTrue(strategy.vaultReentrancyAttempted(), "sanity: reentrancy attempt must have fired");
        assertTrue(strategy.vaultReentrancyReverted(), "reentrant depositFor call must revert (nonReentrant)");
        assertEq(vault.principalOf(attacker), 0, "attacker must not be credited via the reentrant call");
        assertEq(vault.principalOf(winner), 1 ether, "legitimate deposit must still complete once, in full");
    }

    /// @notice Full CM->Vault->(malicious strategy)->CM path: while a claim is compounding, the
    /// strategy tries to replay the exact same claim (same leaf/proof) to double-pay. Both
    /// `ClaimManagerV5.claim` and `PrizeVaultV5.depositFor` carry their own `nonReentrant`
    /// guards, so the replay must revert and the original claim must still settle exactly once.
    function test_reentrantClaimReplayDuringCompoundIsBlocked() public {
        ClaimManagerV5.ClaimLeaf memory leaf = _leaf(0, winner, 2 ether);
        _fundNativeAndRegister(leaf, 2 ether);

        bytes32[] memory emptyProof = new bytes32[](0);
        strategy.armClaimReentry(leaf, emptyProof);

        claims.claim(leaf, emptyProof);

        assertTrue(strategy.claimReentrancyAttempted(), "sanity: replay attempt must have fired");
        assertTrue(strategy.claimReentrancyReverted(), "reentrant claim() replay must revert (nonReentrant)");
        assertTrue(claims.isClaimed(leaf.distributionId, leaf.leafIndex), "original claim must still settle");
        assertEq(vault.principalOf(winner), 2 ether, "winner credited exactly once, for exactly the leaf amount");
        assertEq(claims.reservedByToken(address(0)), 0, "no residual reservation left behind");
    }

    function _leaf(uint256 leafIndex, address account, uint256 amount)
        internal
        view
        returns (ClaimManagerV5.ClaimLeaf memory)
    {
        return ClaimManagerV5.ClaimLeaf({
            distributionId: claims.distributionIdFor(source, sourceKey),
            leafIndex: leafIndex,
            account: account,
            token: address(0),
            amount: amount
        });
    }

    function _fundNativeAndRegister(ClaimManagerV5.ClaimLeaf memory leaf, uint256 amount) internal {
        vm.deal(source, amount);
        vm.prank(source);
        (bool ok,) = address(claims).call{value: amount}("");
        require(ok, "fund failed");
        ClaimManagerV5.TokenTotal[] memory totals = new ClaimManagerV5.TokenTotal[](1);
        totals[0] = ClaimManagerV5.TokenTotal({token: address(0), amount: amount});
        bytes32 root = claims.hashLeaf(leaf);
        vm.prank(source);
        claims.registerDistribution(sourceKey, root, 1, totals, bytes32("meta"));
    }
}
