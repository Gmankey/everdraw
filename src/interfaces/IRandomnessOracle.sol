// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

interface IRandomnessOracle {
    function requestRandomness(bytes calldata userSeed) external payable returns (uint64 requestId);
    function getFee() external view returns (uint128);
}
