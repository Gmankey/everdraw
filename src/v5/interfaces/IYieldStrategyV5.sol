// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

interface IYieldStrategyV5 {
    function deposit(uint256 assets) external payable returns (uint256 shares);
    function depositSharesFrom(address from, uint256 shares) external returns (uint256 assets);
    function withdraw(uint256 assets, address to) external returns (uint256 shares);
    function withdrawShares(uint256 assets, address to) external returns (uint256 shares);
    function totalAssets() external view returns (uint256);
    function sharesHeld() external view returns (uint256);
    function claimAndCompound() external;
    function transferShares(address to, uint256 shares) external returns (bool);
    function migrateTo(address newStrategy) external returns (uint256 shares, uint256 nativeAssets);
}
