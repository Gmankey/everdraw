// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {PrizeVaultV5} from "../../src/v5/PrizeVaultV5.sol";
import {ShmonStrategy} from "../../src/v5/strategies/ShmonStrategy.sol";
import {EverdrawTwabController} from "../../src/v5/twab/EverdrawTwabController.sol";
import {MockERC4626YieldVault} from "../mocks/MockERC4626YieldVault.sol";

contract PrizeVaultV5InvariantHandler is Test {
    PrizeVaultV5 public immutable vault;

    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant CAROL = address(0xCA901);
    address internal constant SPONSOR = address(0x5A0);
    address internal constant BOOSTER = address(0xB0057);

    address[3] internal participants = [ALICE, BOB, CAROL];

    constructor(PrizeVaultV5 _vault) {
        vault = _vault;
    }

    receive() external payable {}

    function deposit(uint8 userSeed, uint96 amount) external {
        address account = participants[userSeed % participants.length];
        uint256 assets = bound(amount, 0, 50 ether);
        if (assets == 0) return;

        vm.deal(account, account.balance + assets);
        vm.prank(account);
        vault.deposit{value: assets}();
    }

    function withdraw(uint8 userSeed, uint96 amount) external {
        address account = participants[userSeed % participants.length];
        uint256 balance = vault.principalOf(account);
        if (balance == 0) return;

        uint256 assets = bound(amount, 1, balance);
        vm.prank(account);
        vault.withdraw(assets);
    }

    function sponsorDeposit(uint96 amount) external {
        uint256 assets = bound(amount, 0, 50 ether);
        if (assets == 0) return;

        vm.deal(SPONSOR, SPONSOR.balance + assets);
        vm.prank(SPONSOR);
        vault.sponsorDeposit{value: assets}();
    }

    function sponsorWithdraw(uint96 amount) external {
        uint256 balance = vault.sponsorPrincipalOf(SPONSOR);
        if (balance == 0) return;

        uint256 assets = bound(amount, 1, balance);
        vm.prank(SPONSOR);
        vault.withdrawSponsor(assets);
    }

    function boostDeposit(uint96 amount) external {
        uint256 assets = bound(amount, 0, 50 ether);
        if (assets == 0) return;

        vm.deal(BOOSTER, BOOSTER.balance + assets);
        vm.prank(BOOSTER);
        vault.boostDeposit{value: assets}();
    }

    function boostWithdraw(uint96 amount) external {
        uint256 balance = vault.boosterPrincipalOf(BOOSTER);
        if (balance == 0) return;

        uint256 assets = bound(amount, 1, balance);
        vm.prank(BOOSTER);
        vault.boostWithdraw(assets);
    }

    function participant(uint256 index) external view returns (address) {
        return participants[index];
    }

    function sponsor() external pure returns (address) {
        return SPONSOR;
    }

    function booster() external pure returns (address) {
        return BOOSTER;
    }
}

contract PrizeVaultV5InvariantTest is StdInvariant, Test {
    EverdrawTwabController twab;
    MockERC4626YieldVault shmon;
    ShmonStrategy strategy;
    PrizeVaultV5 vault;
    PrizeVaultV5InvariantHandler handler;

    function setUp() public {
        vm.warp(1_000_000);
        twab = new EverdrawTwabController(1 hours, uint32(block.timestamp));
        shmon = new MockERC4626YieldVault(address(0));
        strategy = new ShmonStrategy(address(shmon));
        vault = new PrizeVaultV5(address(twab), address(strategy), 0, "EVRDRAW-V5-MON");
        strategy.setVault(address(vault));
        twab.registerVault(address(vault));

        handler = new PrizeVaultV5InvariantHandler(vault);
        targetContract(address(handler));
    }

    function invariant_principalLedgerMatchesAccounts() public view {
        uint256 participantTotal;
        for (uint256 i = 0; i < 3; i++) {
            participantTotal += vault.principalOf(handler.participant(i));
        }

        uint256 sponsorTotal = vault.sponsorPrincipalOf(handler.sponsor());
        uint256 boosterTotal = vault.boosterPrincipalOf(handler.booster());
        assertEq(vault.totalParticipantPrincipal(), participantTotal);
        assertEq(vault.totalSponsorPrincipal(), sponsorTotal);
        assertEq(vault.totalBoosterPrincipal(), boosterTotal);
        assertEq(vault.totalPrincipal(), participantTotal + sponsorTotal + boosterTotal);
    }

    function invariant_twabMatchesVaultLedger() public view {
        for (uint256 i = 0; i < 3; i++) {
            address account = handler.participant(i);
            assertEq(twab.balanceOf(address(vault), account), vault.principalOf(account));
            assertEq(twab.delegateBalanceOf(address(vault), account), vault.principalOf(account));
        }

        address sponsor = handler.sponsor();
        assertEq(twab.balanceOf(address(vault), sponsor), vault.sponsorPrincipalOf(sponsor));
        assertEq(twab.delegateBalanceOf(address(vault), sponsor), 0);
        assertEq(twab.delegateBalanceOf(address(vault), twab.SPONSOR_DELEGATE()), vault.totalSponsorPrincipal());
        address booster = handler.booster();
        assertEq(twab.balanceOf(address(vault), booster), vault.boosterPrincipalOf(booster));
        assertEq(twab.delegateBalanceOf(address(vault), booster), 0);
        assertEq(twab.delegateBalanceOf(address(vault), twab.BOOSTER_DELEGATE()), vault.totalBoosterPrincipal());
        assertEq(twab.totalParticipantSupply(address(vault)), vault.totalParticipantPrincipal());
        assertEq(twab.totalPrincipalSupply(address(vault)), vault.totalPrincipal());
    }

    function invariant_strategySharesMatchPrincipalAtStableRate() public view {
        assertEq(strategy.sharesHeld(), vault.totalPrincipal());
        assertEq(strategy.totalAssets(), vault.totalPrincipal());
    }
}
