// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {ClaimManagerV5} from "../../src/v5/ClaimManagerV5.sol";
import {PrizeVaultV5} from "../../src/v5/PrizeVaultV5.sol";
import {ShmonStrategy} from "../../src/v5/strategies/ShmonStrategy.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";
import {MockERC4626YieldVault} from "../mocks/MockERC4626YieldVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice ADR-0043: prize auto-compound. Covers the ClaimManagerV5 <-> PrizeVaultV5 integration
/// that unit tests on either contract alone can't exercise: does a native-token claim actually
/// land in the winner's vault principal (default), respect opt-out (pay wallet instead), and
/// safely fall back to a direct wallet payout (not a bricked claim) when the vault can't accept
/// deposits (e.g. paused)?
contract ClaimManagerV5CompoundTest is Test {
    ClaimManagerV5 claims;
    EverdrawTwabController twab;
    MockERC4626YieldVault shmon;
    ShmonStrategy strategy;
    PrizeVaultV5 vault;

    address source = makeAddr("source"); // stand-in for DrawManagerV5
    address winner = makeAddr("winner");
    bytes32 sourceKey = bytes32(uint256(1));

    function setUp() public {
        vm.warp(1_000_000);
        twab = new EverdrawTwabController(1 hours, uint32(block.timestamp));
        shmon = new MockERC4626YieldVault(address(0));
        strategy = new ShmonStrategy(address(shmon));
        vault = new PrizeVaultV5(address(twab), address(strategy), 0, "EVRDRAW-V5-MON");
        strategy.setVault(address(vault));
        twab.registerVault(address(vault));

        claims = new ClaimManagerV5();
        claims.setAuthorizedSource(source, true);
        claims.setCompoundVault(source, address(vault));
    }

    function test_defaultClaimCompoundsIntoVaultPrincipal() public {
        ClaimManagerV5.ClaimLeaf memory leaf = _leaf(0, winner, 2 ether);
        _fundNativeAndRegister(leaf, 2 ether);

        vm.expectEmit(true, true, true, true);
        emit ClaimManagerV5.PrizeCompounded(leaf.distributionId, leaf.leafIndex, winner, 2 ether);
        claims.claim(leaf, new bytes32[](0));

        assertEq(vault.principalOf(winner), 2 ether, "prize should land in vault principal");
        assertEq(winner.balance, 0, "winner should not receive MON to wallet by default");
        assertTrue(claims.isClaimed(leaf.distributionId, leaf.leafIndex));
        assertEq(claims.reservedByToken(address(0)), 0);
    }

    function test_optOutPaysWalletInsteadOfCompounding() public {
        vm.prank(winner);
        claims.setCompoundOptOut(true);

        ClaimManagerV5.ClaimLeaf memory leaf = _leaf(0, winner, 2 ether);
        _fundNativeAndRegister(leaf, 2 ether);

        claims.claim(leaf, new bytes32[](0));

        assertEq(vault.principalOf(winner), 0, "opted-out winner should not be auto-compounded");
        assertEq(winner.balance, 2 ether, "opted-out winner should receive MON to wallet");
    }

    function test_noCompoundVaultConfiguredPaysWalletAsToday() public {
        ClaimManagerV5 plainClaims = new ClaimManagerV5();
        plainClaims.setAuthorizedSource(source, true);
        // No setCompoundVault call -- source has no compound target configured.

        ClaimManagerV5.ClaimLeaf memory leaf = ClaimManagerV5.ClaimLeaf({
            distributionId: plainClaims.distributionIdFor(source, sourceKey),
            leafIndex: 0,
            account: winner,
            token: address(0),
            amount: 1 ether,
            kind: ClaimManagerV5.ClaimKind.Winner
        });
        vm.deal(source, 1 ether);
        vm.prank(source);
        (bool ok,) = address(plainClaims).call{value: 1 ether}("");
        require(ok, "fund failed");
        ClaimManagerV5.TokenTotal[] memory totals = new ClaimManagerV5.TokenTotal[](1);
        totals[0] = ClaimManagerV5.TokenTotal({token: address(0), amount: 1 ether});
        bytes32 root = plainClaims.hashLeaf(leaf);
        vm.prank(source);
        plainClaims.registerDistribution(sourceKey, root, 1, totals, bytes32("meta"));

        plainClaims.claim(leaf, new bytes32[](0));
        assertEq(winner.balance, 1 ether);
    }

    function test_pausedVaultFallsBackToWalletPayoutNotBrickedClaim() public {
        vault.pause();

        ClaimManagerV5.ClaimLeaf memory leaf = _leaf(0, winner, 2 ether);
        _fundNativeAndRegister(leaf, 2 ether);

        claims.claim(leaf, new bytes32[](0));

        assertEq(vault.principalOf(winner), 0, "paused vault must not silently eat the deposit");
        assertEq(winner.balance, 2 ether, "claim must still pay the winner even if compounding fails");
        assertTrue(claims.isClaimed(leaf.distributionId, leaf.leafIndex));
    }

    function test_erc20ClaimIsNeverCompoundedEvenWithVaultConfigured() public {
        // Compounding only ever applies to the native token; an ERC20 reward leg must behave
        // exactly as before ADR-0043 regardless of whether a compound vault is configured.
        MockERC20 dummyToken = new MockERC20("Reward", "RWD", 18);
        dummyToken.mint(address(claims), 5 ether);

        ClaimManagerV5.ClaimLeaf memory leaf = ClaimManagerV5.ClaimLeaf({
            distributionId: claims.distributionIdFor(source, sourceKey),
            leafIndex: 0,
            account: winner,
            token: address(dummyToken),
            amount: 5 ether,
            kind: ClaimManagerV5.ClaimKind.Winner
        });
        ClaimManagerV5.TokenTotal[] memory totals = new ClaimManagerV5.TokenTotal[](1);
        totals[0] = ClaimManagerV5.TokenTotal({token: address(dummyToken), amount: 5 ether});
        bytes32 root = claims.hashLeaf(leaf);
        vm.prank(source);
        claims.registerDistribution(sourceKey, root, 1, totals, bytes32("meta"));

        claims.claim(leaf, new bytes32[](0));
        assertEq(dummyToken.balanceOf(winner), 5 ether);
        assertEq(vault.principalOf(winner), 0);
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
            amount: amount,
            kind: ClaimManagerV5.ClaimKind.Winner
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
