// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

interface IRandomnessOracleConsumer {
    function onRandomnessReceived(uint64 requestId, bytes32 randomNumber) external;
}
