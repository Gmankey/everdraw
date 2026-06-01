// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {TicketPrizePoolV4} from "../src/TicketPrizePoolV4.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockERC4626YieldVault} from "./mocks/MockERC4626YieldVault.sol";
import {MockRandomnessOracle} from "./mocks/MockRandomnessOracle.sol";

contract V4TestBase is Test {
    TicketPrizePoolV4 pool;
    MockERC4626YieldVault yieldVault;
    MockRandomnessOracle oracle;
    MockERC20 asset;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address treasury = makeAddr("treasury");

    uint256 constant PRICE = 1 ether;
    uint32 constant ROUND_SEC = 120;
    uint32 constant YIELD_SEC = 300;

    receive() external payable {}

    function _deployNative(uint8 winners, uint16[] memory allocations) internal {
        yieldVault = new MockERC4626YieldVault(address(0));
        oracle = new MockRandomnessOracle();
        pool = new TicketPrizePoolV4(_cfg(TicketPrizePoolV4.DepositMode.Native, address(0), address(yieldVault), winners, allocations));
        vm.deal(address(pool), 10 ether);
    }

    function _deployERC20(uint8 winners, uint16[] memory allocations) internal {
        asset = new MockERC20("USD Coin", "USDC", 6);
        yieldVault = new MockERC4626YieldVault(address(asset));
        oracle = new MockRandomnessOracle();
        pool = new TicketPrizePoolV4(_cfg(TicketPrizePoolV4.DepositMode.ERC20, address(asset), address(yieldVault), winners, allocations));
        vm.deal(address(pool), 10 ether);
    }

    function _oneWinnerAlloc() internal pure returns (uint16[] memory a) {
        a = new uint16[](1);
        a[0] = 10_000;
    }

    function _twoWinnerAlloc() internal pure returns (uint16[] memory a) {
        a = new uint16[](2);
        a[0] = 7000;
        a[1] = 3000;
    }

    function _cfg(
        TicketPrizePoolV4.DepositMode mode,
        address assetAddr,
        address yieldVaultAddr,
        uint8 winners,
        uint16[] memory allocations
    ) internal view returns (TicketPrizePoolV4.V4Config memory) {
        return TicketPrizePoolV4.V4Config({
            depositMode: mode,
            asset: assetAddr,
            yieldVault: yieldVaultAddr,
            ticketPriceAsset: mode == TicketPrizePoolV4.DepositMode.Native ? PRICE : 1_000_000,
            roundDurationSec: ROUND_SEC,
            yieldPeriodSec: YIELD_SEC,
            numWinners: winners,
            winnerAllocationBps: allocations,
            randomnessOracle: address(oracle),
            randomnessOracleInitData: "",
            vaultSymbol: mode == TicketPrizePoolV4.DepositMode.Native ? "EVRDRAW-MON" : "EVRDRAW-USDC"
        });
    }

    function _buyNative(address user, uint32 tickets) internal {
        vm.deal(user, 100 ether);
        vm.prank(user);
        pool.buyTickets{value: uint256(tickets) * PRICE}(tickets);
    }

    function _buyERC20(address user, uint32 tickets) internal {
        uint256 amount = uint256(tickets) * 1_000_000;
        asset.mint(user, amount);
        vm.startPrank(user);
        asset.approve(address(pool), amount);
        pool.buyTickets(tickets);
        vm.stopPrank();
    }

    function _settleWithRandom(bytes32 randomNumber) internal returns (uint256 rid) {
        rid = pool.currentRoundId();
        vm.warp(block.timestamp + ROUND_SEC + YIELD_SEC + 1);
        pool.executeNext(rid);
        oracle.fulfill(1, randomNumber);
        pool.executeNext(rid);
    }
}
