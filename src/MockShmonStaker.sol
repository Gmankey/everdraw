// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

contract MockShmonStaker {
    uint256 public immutable unstakeDelay;

    constructor(uint256 _unstakeDelay) {
        unstakeDelay = _unstakeDelay;
    }
}
