// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test, console2} from "forge-std/Test.sol";
import {PrizeVaultV5} from "../../src/v5/PrizeVaultV5.sol";
import {ShmonStrategy} from "../../src/v5/strategies/ShmonStrategy.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";

interface IShmonRead {
    function balanceOf(address account) external view returns (uint256);
    function previewRedeem(uint256 shares) external view returns (uint256);
    function previewDeposit(uint256 assets) external view returns (uint256);
    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface ILiveV4Pool {
    function buyTickets(uint32 ticketCount) external payable;
}

contract PrizeVaultV5ForkTest is Test {
    bytes4 constant SALES_ENDED = bytes4(keccak256("SalesEnded()"));
    address constant MAINNET_SHMON = 0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c;
    address constant MAINNET_SHMON_IMPL = 0x856A4019228c265DEE336DF705277607c4A18e1B;
    address constant LIVE_V4_1_A = 0x933FF608eaC2b3221088bd9AE19b05F266dBF7DA;
    address constant LIVE_LEDGER_OWNER = 0xd399d4e24021eA08f2Cd11Fbb78a633e8D9B84A2;

    EverdrawTwabController twab;
    ShmonStrategy strategy;
    PrizeVaultV5 vault;

    address alice = makeAddr("alice");

    function setUp() public {
        string memory rpcUrl = vm.envOr("MONAD_MAINNET_RPC_URL", string(""));
        vm.skip(bytes(rpcUrl).length == 0);

        uint256 forkBlock = vm.envOr("MONAD_MAINNET_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) {
            vm.createSelectFork(rpcUrl);
        } else {
            vm.createSelectFork(rpcUrl, forkBlock);
        }
        twab = new EverdrawTwabController(1 hours, uint32(block.timestamp));
        strategy = new ShmonStrategy(MAINNET_SHMON);
        vault = new PrizeVaultV5(address(twab), address(strategy), 10 ether, "EVRDRAW-V5-MON");
        strategy.setVault(address(vault));
        twab.registerVault(address(vault));
    }

    function test_fork_nativeDepositAndWithdrawAgainstRealShmon() public {
        vm.deal(alice, 2 ether);

        vm.prank(alice, alice);
        vault.deposit{value: 1 ether}();

        uint256 shares = IShmonRead(MAINNET_SHMON).balanceOf(address(strategy));
        assertGt(shares, 0);
        assertGt(IShmonRead(MAINNET_SHMON).previewRedeem(shares), 0);

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(0.25 ether);

        assertEq(alice.balance - before, 0.25 ether);
        assertEq(vault.principalOf(alice), 0.75 ether);
    }

    function test_fork_liveV4NativeBuyPathStillEmulates() public {
        vm.deal(alice, 2 ether);
        vm.prank(alice, alice);
        try ILiveV4Pool(LIVE_V4_1_A).buyTickets{value: 1 ether}(1) {}
        catch (bytes memory reason) {
            if (bytes4(reason) == SALES_ENDED) {
                return;
            }
            assembly {
                revert(add(reason, 0x20), mload(reason))
            }
        }
    }

    function test_fork_liveFundedEoaDirectShmonDepositStillEmulates() public {
        vm.prank(LIVE_LEDGER_OWNER, LIVE_LEDGER_OWNER);
        uint256 shares = IShmonRead(MAINNET_SHMON).deposit{value: 1 ether}(1 ether, LIVE_LEDGER_OWNER);
        assertGt(shares, 0);
    }

    function test_fork_diagnosticContext() public view {
        console2.log("chainid", block.chainid);
        console2.log("block", block.number);
        console2.log("timestamp", block.timestamp);
        console2.log("shmon code", MAINNET_SHMON.code.length);
        console2.log("impl code", MAINNET_SHMON_IMPL.code.length);
        console2.log("ledger balance", LIVE_LEDGER_OWNER.balance);
    }

    function test_fork_directShmonDepositAndWithdrawAgainstRealShmon() public {
        vm.deal(alice, 2 ether);

        uint256 shares;
        vm.startPrank(alice, alice);
        shares = IShmonRead(MAINNET_SHMON).deposit{value: 1 ether}(1 ether, alice);
        IShmonRead(MAINNET_SHMON).approve(address(strategy), shares);
        vault.depositShmon(shares);
        vm.stopPrank();

        assertEq(IShmonRead(MAINNET_SHMON).balanceOf(address(strategy)), shares);
        assertEq(vault.principalOf(alice), IShmonRead(MAINNET_SHMON).previewRedeem(shares));

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(0.25 ether);

        assertEq(alice.balance - before, 0.25 ether);
    }
}
