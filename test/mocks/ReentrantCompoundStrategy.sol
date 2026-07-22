// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IYieldStrategyV5} from "../../src/v5/interfaces/IYieldStrategyV5.sol";
import {ClaimManagerV5} from "../../src/v5/ClaimManagerV5.sol";

interface IPrizeVaultV5ForReentrancy {
    function depositFor(address recipient) external payable returns (uint256 shares);
}

/// @notice ADR-0043 reentrancy harness. Stands in as a PrizeVaultV5 strategy so that, while the
/// vault is mid-`depositFor` (itself mid-`ClaimManagerV5._claim`), the yield-strategy call hop
/// attempts to reenter both (a) `PrizeVaultV5.depositFor` directly, and (b) `ClaimManagerV5.claim`
/// for the same leaf -- the two reentrancy surfaces the ADR-0043 CM<->Vault path introduces.
/// Both attempts are expected to revert on the target's own `nonReentrant` guard; this contract
/// swallows those reverts (like a real attacker would try to) so the test can assert the legit
/// call still completes exactly once and the attacker gets nothing.
contract ReentrantCompoundStrategy is IYieldStrategyV5 {
    address public vault;
    address public claimManager;
    address public attacker;

    bool public reenterVault;
    bool public reenterClaim;
    ClaimManagerV5.ClaimLeaf internal _replayLeaf;
    bytes32[] internal _replayProof;

    bool public vaultReentrancyAttempted;
    bool public vaultReentrancyReverted;
    bool public claimReentrancyAttempted;
    bool public claimReentrancyReverted;

    receive() external payable {}

    function setVault(address _vault) external {
        vault = _vault;
    }

    function setClaimManager(address _claimManager) external {
        claimManager = _claimManager;
    }

    function setAttacker(address _attacker) external {
        attacker = _attacker;
    }

    function armVaultReentry() external {
        reenterVault = true;
    }

    function armClaimReentry(ClaimManagerV5.ClaimLeaf calldata leaf, bytes32[] calldata proof) external {
        reenterClaim = true;
        _replayLeaf = leaf;
        _replayProof = proof;
    }

    function deposit(
        uint256 /* assets */
    )
        external
        payable
        returns (uint256 shares)
    {
        if (reenterVault) {
            vaultReentrancyAttempted = true;
            try IPrizeVaultV5ForReentrancy(vault).depositFor{value: 0}(attacker) returns (uint256) {
                vaultReentrancyReverted = false;
            } catch {
                vaultReentrancyReverted = true;
            }
        }
        if (reenterClaim) {
            claimReentrancyAttempted = true;
            try ClaimManagerV5(payable(claimManager)).claim(_replayLeaf, _replayProof) {
                claimReentrancyReverted = false;
            } catch {
                claimReentrancyReverted = true;
            }
        }
        shares = msg.value == 0 ? 1 : msg.value;
    }

    function depositSharesFrom(address, uint256) external pure returns (uint256) {
        return 0;
    }

    function withdraw(uint256 assets, address to) external returns (uint256) {
        (bool ok,) = to.call{value: assets}("");
        require(ok, "reentrant-strategy: withdraw xfer failed");
        return assets;
    }

    function withdrawShares(uint256, address) external pure returns (uint256) {
        return 0;
    }

    function shareToken() external view returns (address) {
        return address(this);
    }

    function totalAssets() external view returns (uint256) {
        return address(this).balance;
    }

    function sharesHeld() external view returns (uint256) {
        return address(this).balance;
    }

    function claimAndCompound() external {}

    function transferShares(address, uint256) external pure returns (bool) {
        return true;
    }

    function migrateTo(address) external pure returns (uint256, uint256) {
        return (0, 0);
    }
}
