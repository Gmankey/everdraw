// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract PrizeVault {
    IERC20 public immutable asset;

    mapping(address => uint256) public balances;
    uint256 public totalDeposits;

    constructor(address _asset) {
        asset = IERC20(_asset);
    }

    function deposit(uint256 amount) external {
        require(amount > 0, "zero amount");

        asset.transferFrom(msg.sender, address(this), amount);

        balances[msg.sender] += amount;
        totalDeposits += amount;
    }

    function withdraw(uint256 amount) external {
        require(amount > 0, "zero amount");
        require(balances[msg.sender] >= amount, "insufficient");

        balances[msg.sender] -= amount;
        totalDeposits -= amount;

        asset.transfer(msg.sender, amount);
    }
}

