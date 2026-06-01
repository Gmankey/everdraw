// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

interface IYieldVault {
    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares);
    function previewDeposit(uint256 assets) external view returns (uint256 shares);
    function previewRedeem(uint256 shares) external view returns (uint256 assets);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
