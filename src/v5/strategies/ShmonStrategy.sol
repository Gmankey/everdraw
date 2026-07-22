// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IYieldStrategyV5} from "../interfaces/IYieldStrategyV5.sol";

interface IShmonVault {
    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares);
    function previewDeposit(uint256 assets) external view returns (uint256 shares);
    function previewWithdraw(uint256 assets) external view returns (uint256 shares);
    function previewRedeem(uint256 shares) external view returns (uint256 assets);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title ShmonStrategy
/// @notice V5 strategy adapter for shMON-style ERC4626/native staking vaults.
contract ShmonStrategy is IYieldStrategyV5 {
    IShmonVault public immutable shmonVault;
    address public immutable owner;
    address public vault;

    error NotVault();
    error NotOwner();
    error ZeroAddress();
    error VaultAlreadySet();
    error ZeroShares();
    error ShareTransferFailed();
    error NativeTransferFailed();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _shmonVault) {
        if (_shmonVault == address(0)) revert ZeroAddress();
        shmonVault = IShmonVault(_shmonVault);
        owner = msg.sender;
    }

    receive() external payable {}

    function setVault(address _vault) external onlyOwner {
        if (_vault == address(0)) revert ZeroAddress();
        if (vault != address(0)) revert VaultAlreadySet();
        vault = _vault;
    }

    function deposit(uint256 assets) external payable onlyVault returns (uint256 shares) {
        shares = shmonVault.deposit{value: msg.value}(assets, address(this));
        if (shares == 0) revert ZeroShares();
    }

    function depositSharesFrom(address from, uint256 shares) external onlyVault returns (uint256 assets) {
        if (shares == 0) revert ZeroShares();
        _safeTransferFrom(address(shmonVault), from, address(this), shares);
        assets = shmonVault.previewRedeem(shares);
        if (assets == 0) revert ZeroShares();
    }

    function withdrawShares(uint256 assets, address to) external onlyVault returns (uint256 shares) {
        shares = shmonVault.previewWithdraw(assets);
        uint256 held = shmonVault.balanceOf(address(this));
        if (shares > held) shares = held;
        if (shares == 0) revert ZeroShares();
        _safeTransfer(address(shmonVault), to, shares);
    }

    function shareToken() external view returns (address) {
        return address(shmonVault);
    }

    function totalAssets() external view returns (uint256) {
        return address(this).balance + shmonVault.convertToAssets(shmonVault.balanceOf(address(this)));
    }

    function sharesHeld() external view returns (uint256) {
        return shmonVault.balanceOf(address(this));
    }

    function claimAndCompound() external onlyVault {}

    function transferShares(address to, uint256 shares) external onlyVault returns (bool) {
        _safeTransfer(address(shmonVault), to, shares);
        return true;
    }

    function migrateTo(address newStrategy) external onlyVault returns (uint256 shares, uint256 nativeAssets) {
        if (newStrategy == address(0)) revert ZeroAddress();
        shares = shmonVault.balanceOf(address(this));
        if (shares != 0) {
            _safeTransfer(address(shmonVault), newStrategy, shares);
        }

        nativeAssets = address(this).balance;
        if (nativeAssets != 0) {
            (bool ok,) = newStrategy.call{value: nativeAssets}("");
            if (!ok) revert NativeTransferFailed();
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(bytes4(0xa9059cbb), to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert ShareTransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(bytes4(0x23b872dd), from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert ShareTransferFailed();
    }
}
