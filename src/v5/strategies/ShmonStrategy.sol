// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IYieldStrategyV5} from "../interfaces/IYieldStrategyV5.sol";

interface IShmonVault {
    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title ShmonStrategy
/// @notice V5 strategy adapter for shMON-style ERC4626/native staking vaults.
contract ShmonStrategy is IYieldStrategyV5 {
    IShmonVault public immutable shmonVault;
    address public owner;
    address public vault;

    error NotVault();
    error NotOwner();
    error ZeroAddress();
    error VaultAlreadySet();
    error ZeroShares();
    error InsufficientAssets(uint256 required, uint256 held);
    error ShareTransferFailed();
    error NativeTransferFailed();

    event NativeDustReceived(address indexed sender, uint256 amount);

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

    /// @dev Native currency can be forced into any contract. It is deliberately excluded
    /// from totalAssets() and is forwarded only when the vault migrates this adapter.
    receive() external payable {
        emit NativeDustReceived(msg.sender, msg.value);
    }

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
        uint256 heldBefore = shmonVault.balanceOf(address(this));
        uint256 assetsBefore = shmonVault.convertToAssets(heldBefore);
        _safeTransferFrom(address(shmonVault), from, address(this), shares);
        uint256 assetsAfter = shmonVault.convertToAssets(shmonVault.balanceOf(address(this)));
        if (assetsAfter <= assetsBefore) revert ZeroShares();
        assets = assetsAfter - assetsBefore;
        if (assets == 0) revert ZeroShares();
    }

    function withdrawShares(uint256 assets, address to) external onlyVault returns (uint256 shares) {
        uint256 held = shmonVault.balanceOf(address(this));
        uint256 backingAssets = shmonVault.convertToAssets(held);
        if (assets > backingAssets) revert InsufficientAssets(assets, backingAssets);

        // Share payouts must use the same fee-free accounting basis as totalAssets().
        // previewWithdraw/previewRedeem quote an underlying redemption and may include
        // an exit fee even though EverDraw only transfers shMON shares.
        shares = assets == backingAssets ? held : (held * assets) / backingAssets;
        if (shares == 0) revert ZeroShares();
        _safeTransfer(address(shmonVault), to, shares);
    }

    function shareToken() external view returns (address) {
        return address(shmonVault);
    }

    function totalAssets() external view returns (uint256) {
        // ADR-0045 payouts transfer shMON shares, so raw MON cannot be liquid backing.
        return shmonVault.convertToAssets(shmonVault.balanceOf(address(this)));
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
