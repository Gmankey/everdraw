// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IRandomnessOracle} from "../../src/interfaces/IRandomnessOracle.sol";
import {IRandomnessOracleConsumer} from "../../src/interfaces/IRandomnessOracleConsumer.sol";

contract MockRandomnessOracle is IRandomnessOracle {
    uint64 public nextRequestId = 1;
    uint128 public fee;
    mapping(uint64 => address) public consumerOf;

    function setFee(uint128 newFee) external {
        fee = newFee;
    }

    function getFee() external view returns (uint128) {
        return fee;
    }

    function requestRandomness(bytes calldata) external payable returns (uint64 requestId) {
        require(msg.value >= fee, "fee");
        requestId = nextRequestId++;
        consumerOf[requestId] = msg.sender;
    }

    function fulfill(uint64 requestId, bytes32 randomNumber) external {
        IRandomnessOracleConsumer(consumerOf[requestId]).onRandomnessReceived(requestId, randomNumber);
    }
}
