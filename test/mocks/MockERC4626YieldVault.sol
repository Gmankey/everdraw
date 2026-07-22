// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {MockERC20} from "./MockERC20.sol";

contract MockERC4626YieldVault {
    address public immutable asset;
    uint256 public rate = 1e18;
    uint16 public withdrawFeeBps;
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

    function setWithdrawFeeBps(uint16 newFeeBps) external {
        require(newFeeBps < 10_000, "fee");
        withdrawFeeBps = newFeeBps;
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

    function previewWithdraw(uint256 assets) external view returns (uint256 shares) {
        uint256 grossAssets = withdrawFeeBps == 0
            ? assets
            : (assets * 10_000 + (10_000 - withdrawFeeBps) - 1) / (10_000 - withdrawFeeBps);
        shares = (grossAssets * 1e18 + rate - 1) / rate;
    }

    function previewRedeem(uint256 shares) external view returns (uint256 assets) {
        assets = (shares * rate) / 1e18;
        if (withdrawFeeBps != 0) {
            assets -= (assets * withdrawFeeBps) / 10_000;
        }
    }

    function convertToAssets(uint256 shares) external view returns (uint256 assets) {
        assets = (shares * rate) / 1e18;
    }

    function redeem(uint256 shares, address receiver, address owner) external virtual returns (uint256 assets) {
        require(!transfersPaused, "paused");
        if (owner != msg.sender) {
            uint256 allowed = allowance[owner][msg.sender];
            require(allowed >= shares, "allowance");
            if (allowed != type(uint256).max) allowance[owner][msg.sender] = allowed - shares;
        }
        require(balanceOf[owner] >= shares, "shares");
        balanceOf[owner] -= shares;
        assets = (shares * rate) / 1e18;
        if (withdrawFeeBps != 0) {
            assets -= (assets * withdrawFeeBps) / 10_000;
        }
        if (asset == address(0)) {
            (bool ok,) = receiver.call{value: assets}("");
            require(ok, "native transfer");
        } else {
            require(MockERC20(asset).transfer(receiver, assets), "asset transfer");
        }
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
