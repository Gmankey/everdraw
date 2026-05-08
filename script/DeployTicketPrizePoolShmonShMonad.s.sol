// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Script.sol";
import "../src/TicketPrizePoolShmonShMonad.sol";

contract DeployTicketPrizePoolShmonShMonad is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address shmon = vm.envAddress("SHMON"); // shMON contract address

        vm.startBroadcast(deployerKey);

        TicketPrizePoolShmonShMonad pool = new TicketPrizePoolShmonShMonad(
            1 ether,    // ticket price in MON
            10,         // commit delay blocks
            86400,      // deposit period (1 day)
            604800,     // yield period (7 days)
            shmon
        );

        vm.stopBroadcast();

        console2.log("TicketPrizePoolShmonShMonad deployed at:", address(pool));
        console2.log("Using shMON at:", shmon);
    }
}
