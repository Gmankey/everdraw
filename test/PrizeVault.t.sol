// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PrizeVault.sol";

contract MockToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "no balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "no balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract PrizeVaultTest is Test {
    MockToken token;
    PrizeVault vault;

    address alice = address(0xA11CE);

    function setUp() public {
        token = new MockToken();
        vault = new PrizeVault(address(token));

        token.mint(alice, 1_000 ether);
    }

    function testDepositAndWithdraw() public {
        vm.startPrank(alice);

        vault.deposit(500 ether);
        assertEq(vault.balances(alice), 500 ether);
        assertEq(vault.totalDeposits(), 500 ether);

        vault.withdraw(200 ether);
        assertEq(vault.balances(alice), 300 ether);
        assertEq(vault.totalDeposits(), 300 ether);

        vm.stopPrank();
    }
}
