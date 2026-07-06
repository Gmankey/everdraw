// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IYieldStrategyV5} from "./interfaces/IYieldStrategyV5.sol";
import {EverdrawTwabController} from "./twab/EverdrawTwabController.sol";

/// @title PrizeVaultV5
/// @notice Continuous V5 principal vault. Draw/claim logic lives outside this contract.
contract PrizeVaultV5 {
    string public constant name = "EverDraw V5 Position";
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public constant STRATEGY_CHANGE_DELAY = 24 hours;
    uint16 public constant SOLVENCY_TOLERANCE_BPS = 10;
    uint16 public constant STRATEGY_MIGRATION_TOLERANCE_BPS = 10;

    EverdrawTwabController public immutable twabController;
    IYieldStrategyV5 public strategy;

    address public owner;
    address public pendingOwner;
    address public pauser;
    address public drawManager;
    bool public paused;
    uint64 public stoppedAt;
    uint256 private _locked = 1;

    uint256 public minDeposit;
    uint256 public depositCap;
    uint256 public totalPrincipal;
    uint256 public totalParticipantPrincipal;
    uint256 public totalSponsorPrincipal;
    uint256 public totalBoosterPrincipal;
    bool public shortfallMode;

    address public pendingStrategy;
    uint64 public pendingStrategyEffectiveAt;

    mapping(address => uint256) public principalOf;
    mapping(address => uint256) public sponsorPrincipalOf;
    mapping(address => uint256) public boosterPrincipalOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Deposit(address indexed recipient, uint256 amount);
    event Withdraw(address indexed recipient, uint256 amount);
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event SponsorDeposit(address indexed sponsor, uint256 amount);
    event SponsorWithdraw(address indexed sponsor, uint256 amount);
    event BoostDeposit(address indexed booster, uint256 amount, uint256 balance, uint64 timestamp);
    event BoostWithdraw(address indexed booster, uint256 amount, uint256 balance, uint64 timestamp);
    event EmergencySharesRedeemed(address indexed account, uint256 principalAmount, uint256 shares);
    event DepositCapUpdated(uint256 depositCap);
    event MinDepositUpdated(uint256 minDeposit);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event PauserSet(address indexed pauser);
    event DrawManagerSet(address indexed drawManager);
    event YieldEscrowed(address indexed claimManager, uint256 amount);
    event VaultStopped(uint64 stoppedAt);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event StrategyChangeQueued(address indexed strategy, uint64 effectiveAt);
    event StrategyChanged(address indexed strategy);
    event StrategyChangeCancelled();
    event ShortfallEntered(uint256 assets, uint256 principal);
    event ShortfallExited(uint256 assets, uint256 principal);

    error NotOwner();
    error NotPauser();
    error ZeroAddress();
    error ZeroAmount();
    error DepositTooSmall();
    error DepositCapExceeded();
    error VaultIsStopped();
    error NothingToWithdraw();
    error InsufficientBalance();
    error InsufficientAllowance();
    error AlreadyStopped();
    error NoPendingStrategyChange();
    error TimelockNotElapsed();
    error StrategyMigrationShortfall(uint256 beforeAssets, uint256 afterAssets);
    error NotDrawManager();
    error InsufficientYield(uint256 requested, uint256 available);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyPauser() {
        if (msg.sender != pauser) revert NotPauser();
        _;
    }

    modifier onlyDrawManager() {
        if (msg.sender != drawManager) revert NotDrawManager();
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    modifier nonReentrant() {
        require(_locked == 1, "reentrant");
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(address _twabController, address _strategy, uint256 _depositCap, string memory _symbol) {
        if (_twabController == address(0) || _strategy == address(0)) revert ZeroAddress();
        owner = msg.sender;
        pauser = msg.sender;
        twabController = EverdrawTwabController(_twabController);
        strategy = IYieldStrategyV5(_strategy);
        depositCap = _depositCap;
        symbol = _symbol;

        emit OwnershipTransferred(address(0), msg.sender);
        emit DepositCapUpdated(_depositCap);
    }

    receive() external payable {}

    function balanceOf(address account) external view returns (uint256) {
        return principalOf[account];
    }

    function totalSupply() external view returns (uint256) {
        return totalParticipantPrincipal;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transferParticipant(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _spendAllowance(from, msg.sender, amount);
        _transferParticipant(from, to, amount);
        return true;
    }

    function setDepositCap(uint256 newCap) external onlyOwner {
        depositCap = newCap;
        emit DepositCapUpdated(newCap);
    }

    function setMinDeposit(uint256 newMinDeposit) external onlyOwner {
        minDeposit = newMinDeposit;
        emit MinDepositUpdated(newMinDeposit);
    }

    function pause() external onlyPauser {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyPauser {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setPauser(address newPauser) external onlyOwner {
        if (newPauser == address(0)) revert ZeroAddress();
        pauser = newPauser;
        emit PauserSet(newPauser);
    }

    function setDrawManager(address newDrawManager) external onlyOwner {
        if (newDrawManager == address(0)) revert ZeroAddress();
        drawManager = newDrawManager;
        emit DrawManagerSet(newDrawManager);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        address previousOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, owner);
    }

    function stop() external onlyOwner {
        if (stoppedAt != 0) revert AlreadyStopped();
        stoppedAt = uint64(block.timestamp);
        emit VaultStopped(stoppedAt);
    }

    function queueStrategyChange(address newStrategy) external onlyOwner {
        if (newStrategy == address(0) || newStrategy.code.length == 0) revert ZeroAddress();
        pendingStrategy = newStrategy;
        pendingStrategyEffectiveAt = uint64(block.timestamp + STRATEGY_CHANGE_DELAY);
        emit StrategyChangeQueued(newStrategy, pendingStrategyEffectiveAt);
    }

    function commitStrategyChange() external onlyOwner {
        if (pendingStrategyEffectiveAt == 0) revert NoPendingStrategyChange();
        if (block.timestamp < pendingStrategyEffectiveAt) revert TimelockNotElapsed();
        IYieldStrategyV5 oldStrategy = strategy;
        IYieldStrategyV5 newStrategy = IYieldStrategyV5(pendingStrategy);
        uint256 beforeAssets = oldStrategy.totalAssets();

        if (beforeAssets != 0) {
            oldStrategy.migrateTo(pendingStrategy);
            uint256 afterAssets = newStrategy.totalAssets();
            if (afterAssets * 10_000 < beforeAssets * (10_000 - STRATEGY_MIGRATION_TOLERANCE_BPS)) {
                revert StrategyMigrationShortfall(beforeAssets, afterAssets);
            }
        }

        strategy = newStrategy;
        pendingStrategy = address(0);
        pendingStrategyEffectiveAt = 0;
        emit StrategyChanged(address(strategy));
    }

    function cancelStrategyChange() external onlyOwner {
        if (pendingStrategyEffectiveAt == 0) revert NoPendingStrategyChange();
        pendingStrategy = address(0);
        pendingStrategyEffectiveAt = 0;
        emit StrategyChangeCancelled();
    }

    function deposit() external payable whenNotPaused nonReentrant returns (uint256 shares) {
        uint256 assets = msg.value;
        _requireDepositAllowed(assets);
        shares = strategy.deposit{value: assets}(assets);
        _creditParticipant(msg.sender, assets);
    }

    /// @notice Deposit on behalf of another account (e.g. ADR-0043 prize auto-compound).
    /// Permissionless like ERC4626's receiver-based deposit: crediting someone else's principal
    /// is inherently benign, so this needs no special access control.
    function depositFor(address recipient) external payable whenNotPaused nonReentrant returns (uint256 shares) {
        if (recipient == address(0)) revert ZeroAddress();
        uint256 assets = msg.value;
        _requireDepositAllowed(assets);
        shares = strategy.deposit{value: assets}(assets);
        _creditParticipant(recipient, assets);
    }

    function depositShmon(uint256 shares) external whenNotPaused nonReentrant returns (uint256 assets) {
        if (stoppedAt != 0) revert VaultIsStopped();
        assets = strategy.depositSharesFrom(msg.sender, shares);
        _requireDepositAllowed(assets);
        _creditParticipant(msg.sender, assets);
    }

    function sponsorDeposit() external payable whenNotPaused nonReentrant returns (uint256 shares) {
        uint256 assets = msg.value;
        _requireDepositAllowed(assets);
        shares = strategy.deposit{value: assets}(assets);
        _creditSponsor(msg.sender, assets);
    }

    function sponsorDepositShmon(uint256 shares) external whenNotPaused nonReentrant returns (uint256 assets) {
        if (stoppedAt != 0) revert VaultIsStopped();
        assets = strategy.depositSharesFrom(msg.sender, shares);
        _requireDepositAllowed(assets);
        _creditSponsor(msg.sender, assets);
    }

    function boostDeposit() external payable whenNotPaused nonReentrant returns (uint256 shares) {
        uint256 assets = msg.value;
        _requireDepositAllowed(assets);
        shares = strategy.deposit{value: assets}(assets);
        _creditBooster(msg.sender, assets);
    }

    function boostDepositShmon(uint256 shares) external whenNotPaused nonReentrant returns (uint256 assets) {
        if (stoppedAt != 0) revert VaultIsStopped();
        assets = strategy.depositSharesFrom(msg.sender, shares);
        _requireDepositAllowed(assets);
        _creditBooster(msg.sender, assets);
    }

    function availableYield() public view returns (uint256) {
        uint256 assets = strategy.totalAssets();
        if (assets <= totalPrincipal) return 0;
        return assets - totalPrincipal;
    }

    function escrowYield(address claimManager, uint256 amount) external onlyDrawManager nonReentrant {
        if (claimManager == address(0)) revert ZeroAddress();
        uint256 available = availableYield();
        if (amount > available) revert InsufficientYield(amount, available);
        if (amount != 0) {
            strategy.withdraw(amount, claimManager);
        }
        emit YieldEscrowed(claimManager, amount);
    }

    function withdraw(uint256 amount) external nonReentrant returns (uint256 assetsPaid) {
        if (amount == 0) revert ZeroAmount();
        if (principalOf[msg.sender] < amount) revert InsufficientBalance();
        _refreshShortfallMode();
        assetsPaid = _withdrawParticipant(msg.sender, amount);
        emit Withdraw(msg.sender, assetsPaid);
    }

    function withdrawSponsor(uint256 amount) external nonReentrant returns (uint256 assetsPaid) {
        if (amount == 0) revert ZeroAmount();
        if (sponsorPrincipalOf[msg.sender] < amount) revert InsufficientBalance();
        _refreshShortfallMode();
        assetsPaid = _withdrawSponsor(msg.sender, amount);
        emit SponsorWithdraw(msg.sender, assetsPaid);
    }

    function boostWithdraw(uint256 amount) external nonReentrant returns (uint256 assetsPaid) {
        if (amount == 0) revert ZeroAmount();
        if (boosterPrincipalOf[msg.sender] < amount) revert InsufficientBalance();
        _refreshShortfallMode();
        assetsPaid = _withdrawBooster(msg.sender, amount);
        emit BoostWithdraw(msg.sender, amount, boosterPrincipalOf[msg.sender], uint64(block.timestamp));
    }

    function emergencyRedeemShares(uint256 principalAmount) external nonReentrant returns (uint256 shares) {
        if (principalAmount == 0) revert ZeroAmount();
        if (principalOf[msg.sender] < principalAmount) revert InsufficientBalance();

        uint256 sharesBalance = _strategyShares();
        uint256 principalBefore = totalPrincipal;
        shares = (sharesBalance * principalAmount) / principalBefore;
        _debitParticipant(msg.sender, principalAmount);
        require(strategy.transferShares(msg.sender, shares), "share transfer failed");

        emit Withdraw(msg.sender, principalAmount);
        emit EmergencySharesRedeemed(msg.sender, principalAmount, shares);
    }

    function emergencyRedeemSponsorShares(uint256 principalAmount) external nonReentrant returns (uint256 shares) {
        if (principalAmount == 0) revert ZeroAmount();
        if (sponsorPrincipalOf[msg.sender] < principalAmount) revert InsufficientBalance();

        uint256 sharesBalance = _strategyShares();
        uint256 principalBefore = totalPrincipal;
        shares = (sharesBalance * principalAmount) / principalBefore;
        _debitSponsor(msg.sender, principalAmount);
        require(strategy.transferShares(msg.sender, shares), "share transfer failed");

        emit SponsorWithdraw(msg.sender, principalAmount);
        emit EmergencySharesRedeemed(msg.sender, principalAmount, shares);
    }

    function _requireDepositAllowed(uint256 assets) internal {
        _refreshShortfallMode();
        if (stoppedAt != 0) revert VaultIsStopped();
        if (assets == 0) revert ZeroAmount();
        if (assets < minDeposit) revert DepositTooSmall();
        if (depositCap != 0 && totalPrincipal + assets > depositCap) revert DepositCapExceeded();
        if (shortfallMode) revert VaultIsStopped();
    }

    function _creditParticipant(address account, uint256 assets) internal {
        principalOf[account] += assets;
        totalParticipantPrincipal += assets;
        totalPrincipal += assets;
        twabController.increaseBalance(account, assets);
        emit Deposit(account, assets);
        emit Transfer(address(0), account, assets);
    }

    function _creditSponsor(address sponsor, uint256 assets) internal {
        sponsorPrincipalOf[sponsor] += assets;
        totalSponsorPrincipal += assets;
        totalPrincipal += assets;
        twabController.increaseSponsorBalance(sponsor, assets);
        emit SponsorDeposit(sponsor, assets);
    }

    function _creditBooster(address booster, uint256 assets) internal {
        boosterPrincipalOf[booster] += assets;
        totalBoosterPrincipal += assets;
        totalPrincipal += assets;
        twabController.increaseBoosterBalance(booster, assets);
        emit BoostDeposit(booster, assets, boosterPrincipalOf[booster], uint64(block.timestamp));
    }

    function _withdrawParticipant(address account, uint256 principalAmount) internal returns (uint256 assetsPaid) {
        assetsPaid = _payoutAmount(principalAmount);
        _debitParticipant(account, principalAmount);
        strategy.withdraw(assetsPaid, account);
    }

    function _withdrawSponsor(address sponsor, uint256 principalAmount) internal returns (uint256 assetsPaid) {
        assetsPaid = _payoutAmount(principalAmount);
        _debitSponsor(sponsor, principalAmount);
        strategy.withdraw(assetsPaid, sponsor);
    }

    function _withdrawBooster(address booster, uint256 principalAmount) internal returns (uint256 assetsPaid) {
        assetsPaid = _payoutAmount(principalAmount);
        _debitBooster(booster, principalAmount);
        strategy.withdraw(assetsPaid, booster);
    }

    function _debitParticipant(address account, uint256 principalAmount) internal {
        principalOf[account] -= principalAmount;
        totalParticipantPrincipal -= principalAmount;
        totalPrincipal -= principalAmount;
        twabController.decreaseBalance(account, principalAmount);
        emit Transfer(account, address(0), principalAmount);
    }

    function _debitSponsor(address sponsor, uint256 principalAmount) internal {
        sponsorPrincipalOf[sponsor] -= principalAmount;
        totalSponsorPrincipal -= principalAmount;
        totalPrincipal -= principalAmount;
        twabController.decreaseSponsorBalance(sponsor, principalAmount);
    }

    function _debitBooster(address booster, uint256 principalAmount) internal {
        boosterPrincipalOf[booster] -= principalAmount;
        totalBoosterPrincipal -= principalAmount;
        totalPrincipal -= principalAmount;
        twabController.decreaseBoosterBalance(booster, principalAmount);
    }

    function _payoutAmount(uint256 principalAmount) internal view returns (uint256) {
        if (!shortfallMode) return principalAmount;
        uint256 principal = totalPrincipal;
        if (principal == 0) return 0;
        return (principalAmount * strategy.totalAssets()) / principal;
    }

    function _transferParticipant(address from, address to, uint256 amount) internal {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        if (principalOf[from] < amount) revert InsufficientBalance();
        if (from != to && amount != 0) {
            principalOf[from] -= amount;
            principalOf[to] += amount;
            twabController.transferBalance(from, to, amount);
        }
        emit Transfer(from, to, amount);
    }

    function _spendAllowance(address owner_, address spender, uint256 amount) internal {
        uint256 currentAllowance = allowance[owner_][spender];
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < amount) revert InsufficientAllowance();
            allowance[owner_][spender] = currentAllowance - amount;
            emit Approval(owner_, spender, currentAllowance - amount);
        }
    }

    function _refreshShortfallMode() internal {
        uint256 principal = totalPrincipal;
        if (principal == 0) {
            if (shortfallMode) {
                shortfallMode = false;
                emit ShortfallExited(0, 0);
            }
            return;
        }

        uint256 assets = strategy.totalAssets();
        bool insolvent = assets * 10_000 < principal * (10_000 - SOLVENCY_TOLERANCE_BPS);
        if (insolvent && !shortfallMode) {
            shortfallMode = true;
            emit ShortfallEntered(assets, principal);
        } else if (!insolvent && shortfallMode) {
            shortfallMode = false;
            emit ShortfallExited(assets, principal);
        }
    }

    function _strategyShares() internal view returns (uint256) {
        return strategy.sharesHeld();
    }
}
