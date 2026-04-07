// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Script.sol";
import "../src/TicketPrizePoolShmon.sol";

contract DeployTicketPrizePoolShmon is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address staker = vm.envAddress("SHMON_STAKER");

        vm.startBroadcast(deployerKey);

        TicketPrizePoolShmon pool = new TicketPrizePoolShmon(
            0.01 ether, // ticket price in MON
            5,          // commit delay blocks (fast for testnet)
            10 minutes,     // round duration
            staker
        );

        vm.stopBroadcast();

        console2.log("TicketPrizePoolShmon deployed at:", address(pool));
    }
}
