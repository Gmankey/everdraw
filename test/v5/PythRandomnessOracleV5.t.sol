// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {PythRandomnessOracle} from "../../src/PythRandomnessOracle.sol";

contract OracleConsumerProbe {
    bool public shouldRevert;
    uint64 public sequence;
    bytes32 public randomNumber;

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function onRandomnessReceived(uint64 newSequence, bytes32 newRandomNumber) external {
        if (shouldRevert) revert("stale request");
        sequence = newSequence;
        randomNumber = newRandomNumber;
    }
}

contract PythRandomnessOracleV5Test is Test {
    address entropy = makeAddr("entropy");
    address provider = makeAddr("provider");
    OracleConsumerProbe consumer;
    PythRandomnessOracle oracle;

    event RandomnessCallbackIgnored(uint64 indexed sequence, bytes32 randomNumber, bytes reason);

    function setUp() public {
        consumer = new OracleConsumerProbe();
        oracle = new PythRandomnessOracle(entropy, provider, address(consumer));
    }

    function test_currentCallbackForwardsToConsumer() public {
        bytes32 randomNumber = keccak256("current");
        vm.prank(entropy);
        oracle._entropyCallback(7, provider, randomNumber);

        assertEq(consumer.sequence(), 7);
        assertEq(consumer.randomNumber(), randomNumber);
    }

    function test_staleRejectedCallbackIsIgnoredWithinGasBudget() public {
        consumer.setShouldRevert(true);
        bytes32 randomNumber = keccak256("stale");
        bytes memory reason = abi.encodeWithSignature("Error(string)", "stale request");

        vm.expectEmit(true, false, false, true, address(oracle));
        emit RandomnessCallbackIgnored(8, randomNumber, reason);
        uint256 gasBefore = gasleft();
        vm.prank(entropy);
        oracle._entropyCallback(8, provider, randomNumber);

        assertLt(gasBefore - gasleft(), 200_000);
    }

    function test_wrongProviderStillReverts() public {
        vm.prank(entropy);
        vm.expectRevert(PythRandomnessOracle.WrongProvider.selector);
        oracle._entropyCallback(9, makeAddr("wrong-provider"), keccak256("wrong"));
    }
}
