// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {MockERC4626YieldVault} from "./MockERC4626YieldVault.sol";

/// @notice shMON test double whose native redemption is asynchronous and therefore unusable
/// by contracts that assume assets are delivered in the same transaction.
contract MockShmonDelayedRedeem is MockERC4626YieldVault {
    error RedeemQueued();

    constructor() MockERC4626YieldVault(address(0)) {}

    function redeem(uint256, address, address) external pure override returns (uint256) {
        revert RedeemQueued();
    }
}
