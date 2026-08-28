// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {ClaimManagerV5} from "../../src/v5/ClaimManagerV5.sol";
import {PrizeVaultV5} from "../../src/v5/PrizeVaultV5.sol";
import {ShmonStrategy} from "../../src/v5/strategies/ShmonStrategy.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";
import {MockERC4626YieldVault} from "../mocks/MockERC4626YieldVault.sol";

contract CompoundAcceptanceDrawManager {
    address public immutable claimManager;

    constructor(address _claimManager) {
        claimManager = _claimManager;
    }
}

/// @notice ADR-0043 acceptance criteria not covered elsewhere:
/// (1) gas must never be deducted from the merkle-leaf amount -- the compounded credit must
///     equal the leaf amount exactly, even when the keeper pays a nonzero gas price to submit;
/// (2) a compounded win opens a genuinely fresh tenure-0 credit -- it is additive on top of any
///     prior principal (never replaces, multiplies, or otherwise "extends" it), which is what
///     lets the indexer treat the emitted Deposit as a brand new tranche.
contract ClaimManagerV5CompoundAcceptanceTest is Test {
    ClaimManagerV5 claims;
    EverdrawTwabController twab;
    MockERC4626YieldVault shmon;
    ShmonStrategy strategy;
    PrizeVaultV5 vault;

    address source = makeAddr("source");
    address winner = makeAddr("winner");
    address keeper = makeAddr("keeper");
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

    /// @notice The keeper (submitting the claim tx) pays real, nonzero gas -- but the amount
    /// credited to the winner's principal must be exactly the merkle-leaf amount, never
    /// leaf.amount minus any gas/fee deduction. Contract-level, "gas is socialized to the
    /// keeper" means exactly one thing that's assertable here: the compound path takes no cut
    /// of `msg.value`/`leaf.amount` for gas -- there is no fee-deduction arithmetic anywhere on
    /// the CM->Vault leg. (Foundry's test EVM doesn't model real gas-cost balance deduction for
    /// `msg.sender` on a plain call, so keeper wallet balance isn't a meaningful assertion here;
    /// the exact-credit check below is the actual acceptance criterion.)
    function test_gasNeverDeductedFromCompoundedLeafAmount() public {
        uint256 leafAmount = 3.141592 ether;
        ClaimManagerV5.ClaimLeaf memory leaf = _leaf(0, winner, leafAmount);
        _fundNativeAndRegister(leaf, leafAmount);

        vm.deal(keeper, 10 ether);
        vm.txGasPrice(50 gwei);

        vm.prank(keeper);
        claims.claim(leaf, new bytes32[](0));

        // The winner's credited principal is exactly the leaf amount, independent of the gas
        // price the keeper paid to submit -- no gas/fee arithmetic ever touches the leaf amount.
        assertEq(vault.principalOf(winner), leafAmount, "credited principal must equal the leaf amount exactly");
        assertEq(claims.reservedByToken(address(0)), 0, "reservation released for the full leaf amount, unreduced");
    }

    function test_subMinimumNativePrizeCompoundsFromConfiguredClaimManager() public {
        vault.setMinDeposit(1 ether);
        _activateCompoundClaimManager();
        uint256 leafAmount = 0.558 ether;
        ClaimManagerV5.ClaimLeaf memory leaf = _leaf(0, winner, leafAmount);
        _fundNativeAndRegister(leaf, leafAmount);

        vm.expectEmit(true, true, true, true, address(claims));
        emit ClaimManagerV5.PrizeCompounded(leaf.distributionId, leaf.leafIndex, winner, leafAmount);
        claims.claim(leaf, new bytes32[](0));

        assertEq(vault.principalOf(winner), leafAmount);
        assertEq(vault.totalPrincipal(), leafAmount);
        assertEq(claims.reservedByToken(address(0)), 0);
    }

    /// @notice A compounded win must be additive on top of any existing principal, not a
    /// replacement or a scaled "extension" of it -- the contract has no notion of "inherit the
    /// old tranche's multiplier"; it just calls the same `_creditParticipant` path a plain
    /// deposit uses, crediting exactly `leaf.amount` on top of whatever was already there.
    function test_compoundIsAdditiveOnPriorPrincipalNotAMultiplier() public {
        // Winner already has an existing tenure from an earlier plain deposit.
        vm.deal(winner, 5 ether);
        vm.prank(winner);
        vault.deposit{value: 5 ether}();
        uint256 priorPrincipal = vault.principalOf(winner);
        assertEq(priorPrincipal, 5 ether);

        // Time passes (a real tenure would have accrued here) before the win compounds.
        vm.warp(block.timestamp + 30 days);

        uint256 leafAmount = 2 ether;
        ClaimManagerV5.ClaimLeaf memory leaf = _leaf(0, winner, leafAmount);
        _fundNativeAndRegister(leaf, leafAmount);

        vm.expectEmit(true, false, false, true, address(vault));
        emit PrizeVaultV5.Deposit(winner, leafAmount);
        claims.claim(leaf, new bytes32[](0));

        // Additive, not multiplied/replaced: exactly prior + leaf, never e.g. 2x prior or a
        // scaled continuation of the old tenure.
        assertEq(
            vault.principalOf(winner),
            priorPrincipal + leafAmount,
            "compounded credit must be additive on top of prior principal, not a multiplier/extension of it"
        );

        // The TWAB delegate-balance increase recorded for this credit is exactly leaf.amount --
        // the same increment a brand-new plain deposit of that size would record, not the whole
        // new total and not a value scaled by the account's prior tenure.
        EverdrawTwabController.AccountDetails memory details = twab.getAccountDetails(address(vault), winner);
        assertEq(details.balance, priorPrincipal + leafAmount);
        assertEq(details.delegateBalance, priorPrincipal + leafAmount);
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

    function _activateCompoundClaimManager() internal {
        CompoundAcceptanceDrawManager drawManager = new CompoundAcceptanceDrawManager(address(claims));
        vault.queueDrawManagerChange(address(drawManager));
        vm.warp(block.timestamp + vault.STRATEGY_CHANGE_DELAY());
        vault.commitDrawManagerChange();
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
