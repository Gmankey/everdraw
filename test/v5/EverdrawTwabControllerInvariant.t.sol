// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";

contract InvariantTwabVaultHarness {
    EverdrawTwabController public immutable controller;

    constructor(EverdrawTwabController _controller) {
        controller = _controller;
    }

    function deposit(address account, uint256 amount) external {
        controller.increaseBalance(account, amount);
    }

    function withdraw(address account, uint256 amount) external {
        controller.decreaseBalance(account, amount);
    }

    function sponsorDeposit(address account, uint256 amount) external {
        controller.increaseSponsorBalance(account, amount);
    }

    function sponsorWithdraw(address account, uint256 amount) external {
        controller.decreaseSponsorBalance(account, amount);
    }
}

contract EverdrawTwabInvariantHandler is Test {
    EverdrawTwabController public immutable controller;
    InvariantTwabVaultHarness public immutable vault;

    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant SPONSOR = address(0x5A0);

    mapping(address => uint256) public participantBalance;
    mapping(address => uint256) public sponsorBalance;
    uint256 public participantTotal;
    uint256 public sponsorTotal;

    constructor(EverdrawTwabController _controller, InvariantTwabVaultHarness _vault) {
        controller = _controller;
        vault = _vault;
    }

    function deposit(uint8 userSeed, uint96 amount) external {
        address account = _participant(userSeed);
        amount = uint96(bound(amount, 0, 1000 ether));
        if (amount == 0) return;

        participantBalance[account] += amount;
        participantTotal += amount;
        vault.deposit(account, amount);
    }

    function withdraw(uint8 userSeed, uint96 amount) external {
        address account = _participant(userSeed);
        uint256 balance = participantBalance[account];
        if (balance == 0) return;

        uint256 bounded = bound(amount, 1, balance);
        participantBalance[account] -= bounded;
        participantTotal -= bounded;
        vault.withdraw(account, bounded);
    }

    function sponsorDeposit(uint96 amount) external {
        amount = uint96(bound(amount, 0, 1000 ether));
        if (amount == 0) return;

        sponsorBalance[SPONSOR] += amount;
        sponsorTotal += amount;
        vault.sponsorDeposit(SPONSOR, amount);
    }

    function sponsorWithdraw(uint96 amount) external {
        uint256 balance = sponsorBalance[SPONSOR];
        if (balance == 0) return;

        uint256 bounded = bound(amount, 1, balance);
        sponsorBalance[SPONSOR] -= bounded;
        sponsorTotal -= bounded;
        vault.sponsorWithdraw(SPONSOR, bounded);
    }

    function alice() external pure returns (address) {
        return ALICE;
    }

    function bob() external pure returns (address) {
        return BOB;
    }

    function sponsor() external pure returns (address) {
        return SPONSOR;
    }

    function principalTotal() external view returns (uint256) {
        return participantTotal + sponsorTotal;
    }

    function _participant(uint8 seed) internal pure returns (address) {
        return seed % 2 == 0 ? ALICE : BOB;
    }
}

contract EverdrawTwabControllerInvariantTest is StdInvariant, Test {
    EverdrawTwabController controller;
    InvariantTwabVaultHarness vault;
    EverdrawTwabInvariantHandler handler;

    uint32 constant PERIOD = 1 hours;
    uint32 constant OFFSET = 100 hours;

    function setUp() public {
        vm.warp(OFFSET);
        controller = new EverdrawTwabController(PERIOD, OFFSET);
        vault = new InvariantTwabVaultHarness(controller);
        controller.registerVault(address(vault));
        handler = new EverdrawTwabInvariantHandler(controller, vault);
        targetContract(address(handler));
    }

    function invariant_currentSuppliesMatchModel() public view {
        assertEq(controller.totalParticipantSupply(address(vault)), handler.participantTotal());
        assertEq(controller.totalPrincipalSupply(address(vault)), handler.principalTotal());
    }

    function invariant_accountBalancesMatchModel() public view {
        address alice = handler.alice();
        address bob = handler.bob();
        address sponsor = handler.sponsor();

        assertEq(controller.balanceOf(address(vault), alice), handler.participantBalance(alice));
        assertEq(controller.delegateBalanceOf(address(vault), alice), handler.participantBalance(alice));
        assertEq(controller.balanceOf(address(vault), bob), handler.participantBalance(bob));
        assertEq(controller.delegateBalanceOf(address(vault), bob), handler.participantBalance(bob));
        assertEq(controller.balanceOf(address(vault), sponsor), handler.sponsorBalance(sponsor));
        assertEq(controller.delegateBalanceOf(address(vault), sponsor), 0);
    }

    function invariant_sponsorDelegateMatchesSponsorTotal() public view {
        assertEq(controller.delegateBalanceOf(address(vault), controller.SPONSOR_DELEGATE()), handler.sponsorTotal());
    }
}
