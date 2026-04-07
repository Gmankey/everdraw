// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Script.sol";
import "../test/TicketPrizePoolShmon.t.sol"; // reuses MockShmonStaker

contract DeployMockShmonStaker is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        MockShmonStaker staker = new MockShmonStaker(18 hours);
        vm.stopBroadcast();

        console2.log("MockShmonStaker deployed at:", address(staker));
    }
}
