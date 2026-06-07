// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {MockERC20} from "./MockERC20.sol";

contract MockERC4626YieldVault {
    address public immutable asset;
    uint256 public rate = 1e18;
    bool public transfersPaused;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(address _asset) {
        asset = _asset;
    }

    function setRate(uint256 newRate) external {
        require(newRate > 0, "rate");
        rate = newRate;
    }

    function setTransfersPaused(bool paused) external {
        transfersPaused = paused;
    }

    function mintShares(address to, uint256 shares) external {
        balanceOf[to] += shares;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares) {
        if (asset == address(0)) {
            require(msg.value == assets, "value");
        } else {
            require(msg.value == 0, "unexpected value");
            require(MockERC20(asset).transferFrom(msg.sender, address(this), assets), "transferFrom");
        }
        shares = previewDeposit(assets);
        require(shares > 0, "zero shares");
        balanceOf[receiver] += shares;
    }

    function previewDeposit(uint256 assets) public view returns (uint256 shares) {
        shares = (assets * 1e18) / rate;
    }

    function previewRedeem(uint256 shares) external view returns (uint256 assets) {
        assets = (shares * rate) / 1e18;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(!transfersPaused, "paused");
        require(balanceOf[msg.sender] >= amount, "shares");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(!transfersPaused, "paused");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        require(balanceOf[from] >= amount, "shares");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    receive() external payable {}
}
