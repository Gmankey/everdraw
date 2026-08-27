// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IEntropy} from "../lib/entropy-sdk-solidity/IEntropy.sol";
import {IEntropyConsumer} from "../lib/entropy-sdk-solidity/IEntropyConsumer.sol";
import {IRandomnessOracle} from "./interfaces/IRandomnessOracle.sol";
import {IRandomnessOracleConsumer} from "./interfaces/IRandomnessOracleConsumer.sol";

/// @title PythRandomnessOracle
/// @notice Adapter that exposes Pyth Entropy through EverDraw's minimal V4 oracle interface.
contract PythRandomnessOracle is IRandomnessOracle, IEntropyConsumer {
    IEntropy public immutable entropy;
    address public immutable provider;
    address public immutable consumer;

    error ZeroAddress();
    error OnlyConsumer();
    error WrongProvider();
    error BadSeed();

    event RandomnessForwarded(uint64 indexed sequence, bytes32 randomNumber);
    event RandomnessCallbackIgnored(uint64 indexed sequence, bytes32 randomNumber, bytes reason);

    constructor(address _entropy, address _provider, address _consumer) {
        if (_entropy == address(0) || _provider == address(0) || _consumer == address(0)) {
            revert ZeroAddress();
        }
        entropy = IEntropy(_entropy);
        provider = _provider;
        consumer = _consumer;
    }

    function getFee() external view returns (uint128) {
        return entropy.getFee(provider);
    }

    function requestRandomness(bytes calldata userSeed) external payable returns (uint64 requestId) {
        if (msg.sender != consumer) revert OnlyConsumer();
        if (userSeed.length != 32) revert BadSeed();

        bytes32 seed;
        assembly {
            seed := calldataload(userSeed.offset)
        }

        return entropy.requestWithCallback{value: msg.value}(provider, seed);
    }

    function getEntropy() internal view override returns (address) {
        return address(entropy);
    }

    function entropyCallback(uint64 sequence, address callbackProvider, bytes32 randomNumber) internal override {
        if (callbackProvider != provider) revert WrongProvider();
        try IRandomnessOracleConsumer(consumer).onRandomnessReceived(sequence, randomNumber) {
            emit RandomnessForwarded(sequence, randomNumber);
        } catch (bytes memory reason) {
            emit RandomnessCallbackIgnored(sequence, randomNumber, reason);
        }
    }
}
