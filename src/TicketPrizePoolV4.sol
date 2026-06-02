// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IYieldVault} from "./interfaces/IYieldVault.sol";
import {IRandomnessOracle} from "./interfaces/IRandomnessOracle.sol";
import {IRandomnessOracleConsumer} from "./interfaces/IRandomnessOracleConsumer.sol";

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IERC20MetadataMinimal is IERC20Minimal {
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

/// @title TicketPrizePoolV4
/// @notice EverDraw V4 prize vault with Merkl-readable positions, generic assets,
///         multi-winner rounds, sponsor funding, fee routing and transfer deferral.
contract TicketPrizePoolV4 is IRandomnessOracleConsumer {
    // ---------------------------------------------------------------------
    // Merkl-readable, non-transferable position surface
    // ---------------------------------------------------------------------
    //
    // This is intentionally NOT an ERC-20. There are no transfer, approve,
    // allowance or transferFrom methods. Merkl reads balances and Deposit /
    // Withdraw events; positions remain non-transferable by design.

    string public constant name = "EverDraw Position";
    string public symbol;
    uint8 public immutable decimals;

    mapping(address => uint256) private _activePrincipal;
    uint256 private _totalSupply;

    function balanceOf(address user) public view returns (uint256) {
        return _activePrincipal[user];
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    event Deposit(address indexed recipient, uint256 amount);
    event Withdraw(address indexed recipient, uint256 amount);

    // ---------------------------------------------------------------------
    // Constants / types
    // ---------------------------------------------------------------------

    uint64 public constant VRF_CALLBACK_TIMEOUT = 1 hours;
    uint64 public constant ORACLE_CHANGE_DELAY = 24 hours;
    uint16 public constant MAX_TOTAL_FEE_BPS = 2000;
    uint8 public constant MAX_WINNERS = 32;
    uint8 public constant MAX_FEE_RECIPIENTS = 8;
    string public constant VERSION = "4.0.0";

    enum DepositMode {
        Native,
        ERC20
    }

    enum RoundState {
        Open,
        AwaitingVRF,
        Drawn,
        Settled
    }

    enum NextAction {
        None,
        Skip,
        Commit,
        Finalize
    }

    struct V4Config {
        DepositMode depositMode;
        address asset;
        address yieldVault;
        uint256 ticketPriceAsset;
        uint32 roundDurationSec;
        uint32 yieldPeriodSec;
        uint8 numWinners;
        uint16[] winnerAllocationBps;
        address randomnessOracle;
        bytes randomnessOracleInitData;
        string vaultSymbol;
    }

    struct FeeAllocation {
        address recipient;
        uint16 bps;
    }

    struct Range {
        uint32 start;
        uint32 end;
        address buyer;
    }

    struct RoundData {
        RoundState state;
        uint64 salesEndTime;
        uint64 vrfSequenceNumber;
        bytes32 randomNumber;
        uint64 vrfRequestTime;

        uint32 totalTickets;
        Range[] ranges;

        uint256 totalPrincipalAsset;
        uint256 totalPrincipalShares;
        uint256 principalSharesAtSettle;

        uint32[] winningTickets;
        address[] winners;
        uint256[] winnerPrizeShares;
        mapping(uint8 => bool) prizeClaimedAt;
        uint16 forfeitBps;
        uint256 forfeitPrizeShares;

        uint256 sponsoredPrize;
        bool wasSkipped;

        FeeAllocation[] roundFeeSnapshot;

        uint256 ticketPriceAtRoundOpen;
        address roundCampaign;
        bytes32 roundMetadata;
    }

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error BadConfig();
    error BadState();
    error NotKeeper();
    error SalesNotEnded();
    error YieldNotComplete();
    error SalesEnded();
    error ZeroTickets();
    error WrongValue();
    error UnexpectedValue();
    error TicketOOB();
    error NothingToWithdraw();
    error NothingToClaim();
    error ZeroSharesMinted();
    error InsufficientVRFFee();
    error FeeTooHigh();
    error ZeroAddress();
    error NoPendingOracleChange();
    error TimelockNotElapsed();
    error VaultIsStopped();
    error AlreadyStopped();
    error PriceOutOfBounds();
    error ZeroAmount();
    error NothingToRefund();
    error NothingPending();
    error TransferStillFailing();
    error NotOracle();
    error NotPauser();
    error TooManyRecipients();
    error TooManyWinners();
    error SelectionExhausted();
    error BadAssetTransfer();

    // ---------------------------------------------------------------------
    // Immutable config / admin state
    // ---------------------------------------------------------------------

    DepositMode public immutable depositMode;
    IERC20MetadataMinimal public immutable asset;
    IYieldVault public immutable yieldVault;
    uint32 public immutable roundDurationSec;
    uint32 public immutable yieldPeriodSec;
    uint8 public immutable numWinners;

    uint16[] private _winnerAllocationBps;
    string private _assetSymbol;

    address public owner;
    address public pendingOwner;
    address public pauser;
    bool public paused;
    uint256 private _locked = 1;

    uint256 public ticketPriceAsset;
    uint64 public stoppedAt;

    IRandomnessOracle public randomnessOracle;
    address public pendingOracle;
    uint64 public pendingOracleEffectiveAt;

    mapping(address => bool) public isKeeper;

    uint256 public currentRoundId;
    uint256 public cursorRoundId;
    mapping(uint256 => RoundData) internal rounds;
    mapping(uint64 => uint256) public requestToRound;

    mapping(uint256 => mapping(address => uint256)) public principalAsset;
    mapping(uint256 => mapping(address => uint256)) public principalShares;
    mapping(uint256 => mapping(address => uint256)) public sponsorContribution;
    mapping(uint256 => mapping(address => mapping(uint8 => uint256))) public pendingClaims;
    mapping(address => uint256) public pendingClaimSlotCount;

    uint256 public totalUnclaimedShares;

    FeeAllocation[] public feeAllocations;

    address public nextRoundCampaign;
    bytes32 public nextRoundMetadata;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event RoundStarted(uint256 indexed roundId, uint64 salesEndTime);
    event TicketsBought(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 assetPaid);
    event RoundSkipped(uint256 indexed roundId);
    event RandomnessRequested(uint256 indexed roundId, uint64 indexed requestId, uint128 fee);
    event RandomnessFulfilled(uint256 indexed roundId, uint64 indexed requestId, bytes32 randomNumber);
    event WinnersDrawn(uint256 indexed roundId, address[] winners, uint32[] winningTickets, uint256[] prizeShares);
    event RoundSettled(uint256 indexed roundId, uint256 principalShares, uint256 prizeShares);
    event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 amount);
    event PrincipalWithdrawn(uint256 indexed roundId, address indexed user, uint256 amount);
    event Sponsored(uint256 indexed roundId, address indexed sponsor, uint256 amount, string memo);
    event SponsorRefunded(uint256 indexed roundId, address indexed sponsor, uint256 amount);
    event ProtocolFeeAccrued(uint256 indexed roundId, uint256 feeShares, address indexed feeRecipient);
    event FeeAllocationsUpdated(FeeAllocation[] allocations);
    event TransferDeferred(uint256 indexed rid, address indexed recipient, uint8 slot, uint256 shares);
    event DeferredClaimSucceeded(uint256 indexed rid, address indexed recipient, uint8 slot, uint256 shares);
    event VaultStopped(uint64 stoppedAt);
    event TicketPriceUpdated(uint256 ticketPriceAsset);
    event KeeperSet(address indexed keeper, bool allowed);
    event EmergencyForceSettled(uint256 indexed roundId);
    event ExecuteNext(uint256 indexed roundId, NextAction action);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event PauserSet(address indexed pauser);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event VRFReserveDeposited(address indexed by, uint256 amount);
    event VRFReserveWithdrawn(address indexed to, uint256 amount);
    event OracleChangeQueued(address newOracle, uint64 effectiveAt);
    event OracleChanged(address randomnessOracle);
    event OracleChangeCancelled();
    event NextRoundMetadataSet(address campaign, bytes32 metadata);

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyPauser() {
        if (msg.sender != pauser) revert NotPauser();
        _;
    }

    modifier onlyKeeper() {
        if (!isKeeper[msg.sender]) revert NotKeeper();
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

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(V4Config memory cfg) {
        _validateConfig(cfg);

        owner = msg.sender;
        pauser = msg.sender;
        isKeeper[msg.sender] = true;

        depositMode = cfg.depositMode;
        asset = IERC20MetadataMinimal(cfg.asset);
        yieldVault = IYieldVault(cfg.yieldVault);
        randomnessOracle = IRandomnessOracle(cfg.randomnessOracle);
        ticketPriceAsset = cfg.ticketPriceAsset;
        roundDurationSec = cfg.roundDurationSec;
        yieldPeriodSec = cfg.yieldPeriodSec;
        numWinners = cfg.numWinners;
        symbol = cfg.vaultSymbol;
        decimals = cfg.depositMode == DepositMode.Native ? 18 : IERC20MetadataMinimal(cfg.asset).decimals();
        _assetSymbol = cfg.depositMode == DepositMode.Native ? "MON" : IERC20MetadataMinimal(cfg.asset).symbol();

        for (uint256 i = 0; i < cfg.winnerAllocationBps.length; i++) {
            _winnerAllocationBps.push(cfg.winnerAllocationBps[i]);
        }

        currentRoundId = 1;
        cursorRoundId = 1;
        _openRound(1);
    }

    function _validateConfig(V4Config memory cfg) internal view {
        if (cfg.depositMode == DepositMode.Native) {
            if (cfg.asset != address(0)) revert BadConfig();
        } else {
            if (cfg.asset == address(0) || cfg.asset.code.length == 0) revert BadConfig();
        }

        if (
            cfg.yieldVault == address(0) ||
            cfg.yieldVault.code.length == 0 ||
            cfg.randomnessOracle == address(0) ||
            cfg.randomnessOracle.code.length == 0 ||
            cfg.ticketPriceAsset == 0 ||
            cfg.roundDurationSec < 60 ||
            cfg.roundDurationSec > 30 days ||
            cfg.yieldPeriodSec > 30 days ||
            bytes(cfg.vaultSymbol).length == 0
        ) revert BadConfig();

        if (cfg.numWinners == 0 || cfg.numWinners > MAX_WINNERS) revert TooManyWinners();
        if (cfg.winnerAllocationBps.length != cfg.numWinners) revert BadConfig();

        uint256 sum;
        for (uint256 i = 0; i < cfg.winnerAllocationBps.length; i++) {
            if (cfg.winnerAllocationBps[i] == 0) revert BadConfig();
            sum += cfg.winnerAllocationBps[i];
        }
        if (sum != 10_000) revert BadConfig();

        if (IYieldVault(cfg.yieldVault).previewDeposit(cfg.ticketPriceAsset) == 0) {
            revert ZeroSharesMinted();
        }
    }

    // ---------------------------------------------------------------------
    // Self-description views
    // ---------------------------------------------------------------------

    function assetSymbol() external view returns (string memory) {
        return _assetSymbol;
    }

    function assetDecimals() external view returns (uint8) {
        return decimals;
    }

    function winnerAllocationBps(uint8 index) external view returns (uint16) {
        return _winnerAllocationBps[index];
    }

    function feeAllocationsLength() external view returns (uint256) {
        return feeAllocations.length;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

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

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        address previousOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, owner);
    }

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        isKeeper[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    function stop() external onlyOwner {
        if (stoppedAt != 0) revert AlreadyStopped();
        stoppedAt = uint64(block.timestamp);
        emit VaultStopped(stoppedAt);
    }

    function setTicketPrice(uint256 newPrice) external onlyOwner {
        if (newPrice == 0) revert BadConfig();
        uint256 old = ticketPriceAsset;
        if (newPrice < old / 10 || newPrice > old * 10) revert PriceOutOfBounds();
        ticketPriceAsset = newPrice;
        emit TicketPriceUpdated(newPrice);
    }

    function setFeeAllocations(FeeAllocation[] calldata newAllocations) external onlyOwner {
        if (newAllocations.length > MAX_FEE_RECIPIENTS) revert TooManyRecipients();
        uint256 sum;
        for (uint256 i = 0; i < newAllocations.length; i++) {
            if (newAllocations[i].recipient == address(0)) revert ZeroAddress();
            if (newAllocations[i].bps == 0) revert BadConfig();
            sum += newAllocations[i].bps;
        }
        if (sum > MAX_TOTAL_FEE_BPS) revert FeeTooHigh();

        delete feeAllocations;
        for (uint256 i = 0; i < newAllocations.length; i++) {
            feeAllocations.push(newAllocations[i]);
        }

        emit FeeAllocationsUpdated(newAllocations);
    }

    function setNextRoundMetadata(address campaign, bytes32 metadata) external onlyOwner {
        nextRoundCampaign = campaign;
        nextRoundMetadata = metadata;
        emit NextRoundMetadataSet(campaign, metadata);
    }

    function queueOracleChange(address newOracle) external onlyOwner {
        if (newOracle == address(0) || newOracle.code.length == 0) revert ZeroAddress();
        pendingOracle = newOracle;
        pendingOracleEffectiveAt = uint64(block.timestamp) + ORACLE_CHANGE_DELAY;
        emit OracleChangeQueued(newOracle, pendingOracleEffectiveAt);
    }

    function commitOracleChange() external onlyOwner {
        if (pendingOracleEffectiveAt == 0) revert NoPendingOracleChange();
        if (block.timestamp < pendingOracleEffectiveAt) revert TimelockNotElapsed();

        randomnessOracle = IRandomnessOracle(pendingOracle);
        pendingOracle = address(0);
        pendingOracleEffectiveAt = 0;
        emit OracleChanged(address(randomnessOracle));
    }

    function cancelOracleChange() external onlyOwner {
        if (pendingOracleEffectiveAt == 0) revert NoPendingOracleChange();
        pendingOracle = address(0);
        pendingOracleEffectiveAt = 0;
        emit OracleChangeCancelled();
    }

    function depositVRFReserve() external payable onlyOwner {
        emit VRFReserveDeposited(msg.sender, msg.value);
    }

    function withdrawVRFReserve(uint256 amount) external onlyOwner nonReentrant {
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        emit VRFReserveWithdrawn(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Deposits and sponsor funding
    // ---------------------------------------------------------------------

    function buyTickets(uint32 ticketCount) external payable {
        _buyTickets(ticketCount);
    }

    function _buyTickets(uint32 ticketCount) internal whenNotPaused nonReentrant {
        if (stoppedAt != 0) revert VaultIsStopped();

        uint256 rid = currentRoundId;
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Open) revert BadState();
        if (block.timestamp >= r.salesEndTime) revert SalesEnded();
        if (ticketCount == 0) revert ZeroTickets();

        uint256 cost = uint256(ticketCount) * r.ticketPriceAtRoundOpen;
        uint256 shares = _collectAndDeposit(cost);
        if (shares == 0) revert ZeroSharesMinted();

        principalAsset[rid][msg.sender] += cost;
        principalShares[rid][msg.sender] += shares;
        r.totalPrincipalAsset += cost;
        r.totalPrincipalShares += shares;
        totalUnclaimedShares += shares;

        _activePrincipal[msg.sender] += cost;
        _totalSupply += cost;

        uint32 start = r.totalTickets;
        require(uint256(start) + uint256(ticketCount) <= type(uint32).max, "ticket overflow");
        uint32 end = start + ticketCount;
        r.totalTickets = end;

        uint256 n = r.ranges.length;
        if (n > 0) {
            Range storage last = r.ranges[n - 1];
            if (last.buyer == msg.sender && last.end == start) {
                last.end = end;
                emit Deposit(msg.sender, cost);
                emit TicketsBought(rid, msg.sender, ticketCount, cost);
                return;
            }
        }

        r.ranges.push(Range({start: start, end: end, buyer: msg.sender}));
        emit Deposit(msg.sender, cost);
        emit TicketsBought(rid, msg.sender, ticketCount, cost);
    }

    function sponsor(uint256 rid, string calldata memo) external payable nonReentrant {
        if (depositMode != DepositMode.Native) revert BadConfig();
        _sponsor(rid, msg.value, memo);
    }

    function sponsorERC20(uint256 rid, uint256 amount, string calldata memo) external payable nonReentrant {
        if (depositMode != DepositMode.ERC20) revert BadConfig();
        if (msg.value != 0) revert UnexpectedValue();
        _sponsor(rid, amount, memo);
    }

    function _sponsor(uint256 rid, uint256 amount, string calldata memo) internal {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Open) revert BadState();
        if (block.timestamp >= r.salesEndTime) revert SalesEnded();
        if (amount == 0) revert ZeroAmount();

        uint256 shares = _collectAndDeposit(amount);
        if (shares == 0) revert ZeroSharesMinted();

        r.sponsoredPrize += shares;
        sponsorContribution[rid][msg.sender] += shares;
        totalUnclaimedShares += shares;

        emit Sponsored(rid, msg.sender, amount, memo);
    }

    function _collectAndDeposit(uint256 amount) internal returns (uint256 shares) {
        if (depositMode == DepositMode.Native) {
            if (msg.value != amount) revert WrongValue();
            shares = yieldVault.deposit{value: amount}(amount, address(this));
        } else {
            if (msg.value != 0) revert UnexpectedValue();
            uint256 beforeBal = asset.balanceOf(address(this));
            _safeTransferFrom(address(asset), msg.sender, address(this), amount);
            uint256 received = asset.balanceOf(address(this)) - beforeBal;
            if (received != amount) revert BadAssetTransfer();
            _forceApprove(address(asset), address(yieldVault), amount);
            shares = yieldVault.deposit(amount, address(this));
        }
    }

    // ---------------------------------------------------------------------
    // Progression
    // ---------------------------------------------------------------------

    function executeNext() external whenNotPaused nonReentrant returns (uint256 rid, NextAction action) {
        (rid, action) = nextExecutable();
        if (action == NextAction.None) return (rid, action);
        _execute(rid, action);
        emit ExecuteNext(rid, action);
    }

    function executeNext(uint256 rid) external whenNotPaused nonReentrant returns (NextAction action) {
        action = nextAction(rid);
        if (action == NextAction.None) return action;
        _execute(rid, action);
        emit ExecuteNext(rid, action);
    }

    function commitDraw(uint256 rid) external whenNotPaused {
        _commitDraw(rid);
    }

    function skipRound(uint256 rid) external whenNotPaused {
        _skipRound(rid);
    }

    function finalizeDraw(uint256 rid) external nonReentrant {
        _finalizeDraw(rid);
    }

    function nextAction(uint256 rid) public view returns (NextAction) {
        RoundData storage r = rounds[rid];
        if (r.salesEndTime == 0) return NextAction.None;

        if (r.state == RoundState.Open && block.timestamp >= r.salesEndTime && r.totalTickets == 0) {
            return NextAction.Skip;
        }

        if (
            r.state == RoundState.Open &&
            block.timestamp >= uint256(r.salesEndTime) + uint256(yieldPeriodSec) &&
            r.totalTickets > 0
        ) return NextAction.Commit;

        if (r.state == RoundState.Drawn && r.totalTickets > 0) return NextAction.Finalize;

        return NextAction.None;
    }

    function nextExecutable() public view returns (uint256 rid, NextAction action) {
        uint256 start = cursorRoundId == 0 ? 1 : cursorRoundId;
        uint256 end = currentRoundId;
        rid = start;
        for (uint256 i = 0; i < 25 && rid <= end; i++) {
            action = nextAction(rid);
            if (action != NextAction.None) return (rid, action);
            rid++;
        }
        return (start, NextAction.None);
    }

    function _execute(uint256 rid, NextAction action) internal {
        if (action == NextAction.Skip) _skipRound(rid);
        else if (action == NextAction.Commit) _commitDraw(rid);
        else if (action == NextAction.Finalize) _finalizeDraw(rid);
    }

    function _commitDraw(uint256 rid) internal {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Open) revert BadState();
        if (block.timestamp < r.salesEndTime) revert SalesNotEnded();
        if (block.timestamp < uint256(r.salesEndTime) + uint256(yieldPeriodSec)) revert YieldNotComplete();
        if (r.totalTickets == 0) revert ZeroTickets();

        uint128 fee = randomnessOracle.getFee();
        if (address(this).balance < fee) revert InsufficientVRFFee();

        bytes32 userSeed = keccak256(abi.encode(
            rid,
            r.totalTickets,
            r.totalPrincipalAsset,
            block.prevrandao,
            block.timestamp
        ));

        r.state = RoundState.AwaitingVRF;
        r.vrfRequestTime = uint64(block.timestamp);

        uint64 requestId = randomnessOracle.requestRandomness{value: fee}(abi.encodePacked(userSeed));
        requestToRound[requestId] = rid;
        r.vrfSequenceNumber = requestId;

        emit RandomnessRequested(rid, requestId, fee);

        if (rid == currentRoundId) _startNextRound();
        _bumpCursor();
    }

    function onRandomnessReceived(uint64 requestId, bytes32 randomNumber) external {
        if (msg.sender != address(randomnessOracle)) revert NotOracle();
        uint256 rid = requestToRound[requestId];
        if (rid == 0) return;
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.AwaitingVRF) return;

        r.randomNumber = randomNumber;
        r.state = RoundState.Drawn;
        emit RandomnessFulfilled(rid, requestId, randomNumber);
    }

    function _finalizeDraw(uint256 rid) internal {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Drawn) revert BadState();
        if (r.totalTickets == 0) revert ZeroTickets();

        uint32[] memory winningTickets = _selectWinners(r.randomNumber, r.totalTickets, numWinners);
        uint8 effectiveN = uint8(winningTickets.length);

        uint256 principalAtSettle = yieldVault.previewDeposit(r.totalPrincipalAsset);
        uint256 depositorYieldShares = r.totalPrincipalShares > principalAtSettle
            ? r.totalPrincipalShares - principalAtSettle
            : 0;
        uint256 totalPrizeShares = depositorYieldShares + r.sponsoredPrize;

        uint256 totalFeeShares;
        for (uint256 i = 0; i < r.roundFeeSnapshot.length; i++) {
            FeeAllocation memory alloc = r.roundFeeSnapshot[i];
            uint256 recipientShares = (totalPrizeShares * alloc.bps) / 10_000;
            totalFeeShares += recipientShares;
            if (recipientShares > 0) {
                _transferOrDefer(alloc.recipient, recipientShares, rid, uint8(0xf0 + i));
                emit ProtocolFeeAccrued(rid, recipientShares, alloc.recipient);
            }
        }

        uint256 netPrize = totalPrizeShares - totalFeeShares;
        uint256 allocated;
        uint16 forfeitBps;
        for (uint8 i = effectiveN; i < numWinners; i++) {
            forfeitBps += _winnerAllocationBps[i];
        }

        r.principalSharesAtSettle = principalAtSettle;
        r.forfeitBps = forfeitBps;
        r.forfeitPrizeShares = (netPrize * uint256(forfeitBps)) / 10_000;

        for (uint8 i = 0; i < effectiveN; i++) {
            address winner = _ownerOfTicket(r, winningTickets[i]);
            uint256 prize;
            if (i == 0) {
                uint256 later;
                for (uint8 j = 1; j < effectiveN; j++) {
                    later += (netPrize * uint256(_winnerAllocationBps[j])) / 10_000;
                }
                prize = netPrize - r.forfeitPrizeShares - later;
            } else {
                prize = (netPrize * uint256(_winnerAllocationBps[i])) / 10_000;
            }
            allocated += prize;
            r.winningTickets.push(winningTickets[i]);
            r.winners.push(winner);
            r.winnerPrizeShares.push(prize);
        }

        if (allocated + r.forfeitPrizeShares > netPrize) revert BadState();
        r.state = RoundState.Settled;

        emit WinnersDrawn(rid, r.winners, r.winningTickets, r.winnerPrizeShares);
        emit RoundSettled(rid, principalAtSettle, netPrize);
        _bumpCursor();
    }

    function _skipRound(uint256 rid) internal {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Open) revert BadState();
        if (block.timestamp < r.salesEndTime) revert SalesNotEnded();
        if (r.totalTickets != 0 || r.totalPrincipalAsset != 0 || r.totalPrincipalShares != 0) {
            revert BadState();
        }

        r.state = RoundState.Settled;
        r.wasSkipped = true;
        emit RoundSkipped(rid);

        if (rid == currentRoundId) _startNextRound();
        _bumpCursor();
    }

    function emergencyForceSettle(uint256 rid) external onlyOwner nonReentrant {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.AwaitingVRF) revert BadState();
        require(block.timestamp >= uint256(r.vrfRequestTime) + uint256(VRF_CALLBACK_TIMEOUT), "vrf timeout not reached");
        r.state = RoundState.Settled;
        // "Skipped" means settled without a completed draw, including VRF timeout force-settles.
        r.wasSkipped = true;
        emit EmergencyForceSettled(rid);
        _bumpCursor();
    }

    function _startNextRound() internal {
        if (stoppedAt != 0) return;
        currentRoundId += 1;
        _openRound(currentRoundId);
    }

    function _openRound(uint256 rid) internal {
        RoundData storage r = rounds[rid];
        r.state = RoundState.Open;
        r.salesEndTime = uint64(block.timestamp + roundDurationSec);
        r.ticketPriceAtRoundOpen = ticketPriceAsset;
        r.roundCampaign = nextRoundCampaign;
        r.roundMetadata = nextRoundMetadata;
        for (uint256 i = 0; i < feeAllocations.length; i++) {
            r.roundFeeSnapshot.push(feeAllocations[i]);
        }
        emit RoundStarted(rid, r.salesEndTime);
    }

    function _bumpCursor() internal {
        while (cursorRoundId <= currentRoundId) {
            RoundData storage r = rounds[cursorRoundId];
            if (r.salesEndTime == 0 || r.state != RoundState.Settled) break;
            cursorRoundId++;
        }
    }

    // ---------------------------------------------------------------------
    // Claims and exits
    // ---------------------------------------------------------------------

    function claimPrize(uint256 rid) external nonReentrant {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Settled) revert BadState();

        uint256 totalShares;
        for (uint8 i = 0; i < r.winners.length; i++) {
            if (r.winners[i] == msg.sender && !r.prizeClaimedAt[i]) {
                r.prizeClaimedAt[i] = true;
                uint256 shares = r.winnerPrizeShares[i];
                totalShares += shares;
                _transferOrDefer(msg.sender, shares, rid, i);
            }
        }
        if (totalShares == 0) revert NothingToClaim();
        emit PrizeClaimed(rid, msg.sender, totalShares);
    }

    function withdrawPrincipal(uint256 rid) external nonReentrant {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Settled) revert BadState();

        uint256 userAsset = principalAsset[rid][msg.sender];
        if (userAsset == 0) revert NothingToWithdraw();

        uint256 sharesToReturn;
        if (r.principalSharesAtSettle == 0 || r.principalSharesAtSettle >= r.totalPrincipalShares) {
            sharesToReturn = principalShares[rid][msg.sender];
        } else {
            sharesToReturn = (userAsset * r.principalSharesAtSettle) / r.totalPrincipalAsset;
        }

        if (r.forfeitPrizeShares > 0) {
            sharesToReturn += (r.forfeitPrizeShares * userAsset) / r.totalPrincipalAsset;
        }

        principalAsset[rid][msg.sender] = 0;
        principalShares[rid][msg.sender] = 0;

        _activePrincipal[msg.sender] -= userAsset;
        _totalSupply -= userAsset;

        _transferOrDefer(msg.sender, sharesToReturn, rid, 0xff);

        emit Withdraw(msg.sender, userAsset);
        emit PrincipalWithdrawn(rid, msg.sender, sharesToReturn);
    }

    function claimSponsorRefund(uint256 rid) external nonReentrant {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Settled) revert BadState();
        if (!r.wasSkipped) revert NothingToRefund();

        uint256 shares = sponsorContribution[rid][msg.sender];
        if (shares == 0) revert NothingToRefund();
        sponsorContribution[rid][msg.sender] = 0;
        _transferOrDefer(msg.sender, shares, rid, 0xfe);
        emit SponsorRefunded(rid, msg.sender, shares);
    }

    function claimDeferred(uint256 rid, uint8 slot) external nonReentrant {
        _claimDeferredSlot(rid, slot);
    }

    function claimAllDeferred(uint256 rid, uint8[] calldata slots) external nonReentrant {
        for (uint256 i = 0; i < slots.length; i++) {
            _claimDeferredSlot(rid, slots[i]);
        }
    }

    function _claimDeferredSlot(uint256 rid, uint8 slot) internal {
        uint256 shares = pendingClaims[rid][msg.sender][slot];
        if (shares == 0) revert NothingPending();

        pendingClaims[rid][msg.sender][slot] = 0;
        if (!_tryYieldVaultTransfer(msg.sender, shares)) {
            pendingClaims[rid][msg.sender][slot] = shares;
            revert TransferStillFailing();
        }

        totalUnclaimedShares -= shares;
        pendingClaimSlotCount[msg.sender] -= 1;
        emit DeferredClaimSucceeded(rid, msg.sender, slot, shares);
    }

    function _transferOrDefer(address recipient, uint256 shares, uint256 rid, uint8 slot) internal returns (bool) {
        if (shares == 0) return true;
        if (_tryYieldVaultTransfer(recipient, shares)) {
            totalUnclaimedShares -= shares;
            return true;
        }

        if (pendingClaims[rid][recipient][slot] == 0) {
            pendingClaimSlotCount[recipient] += 1;
        }
        pendingClaims[rid][recipient][slot] += shares;
        emit TransferDeferred(rid, recipient, slot, shares);
        return false;
    }

    function _tryYieldVaultTransfer(address recipient, uint256 shares) internal returns (bool) {
        (bool success, bytes memory data) = address(yieldVault).call(
            abi.encodeWithSelector(IYieldVault.transfer.selector, recipient, shares)
        );
        return success && (data.length == 0 || abi.decode(data, (bool)));
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getRoundState(uint256 rid) external view returns (RoundState) {
        return rounds[rid].state;
    }

    function getRoundTimes(uint256 rid) external view returns (uint64 salesEndTime, uint64 vrfRequestTime) {
        RoundData storage r = rounds[rid];
        return (r.salesEndTime, r.vrfRequestTime);
    }

    function getCommitAfterTime(uint256 rid) external view returns (uint64) {
        RoundData storage r = rounds[rid];
        if (r.salesEndTime == 0) return 0;
        return uint64(uint256(r.salesEndTime) + uint256(yieldPeriodSec));
    }

    function getRoundInfo(uint256 rid) external view returns (
        RoundState state,
        uint64 salesEndTime,
        uint64 requestId,
        uint32 totalTickets,
        uint256 totalPrincipalAsset,
        uint256 totalPrincipalShares,
        uint256 principalSharesAtSettle,
        uint256 totalPrizeShares,
        uint16 forfeitBps,
        bool wasSkipped
    ) {
        RoundData storage r = rounds[rid];
        uint256 prize;
        for (uint256 i = 0; i < r.winnerPrizeShares.length; i++) prize += r.winnerPrizeShares[i];
        return (
            r.state,
            r.salesEndTime,
            r.vrfSequenceNumber,
            r.totalTickets,
            r.totalPrincipalAsset,
            r.totalPrincipalShares,
            r.principalSharesAtSettle,
            prize,
            r.forfeitBps,
            r.wasSkipped
        );
    }

    function getRoundWinners(uint256 rid) external view returns (
        address[] memory winners,
        uint32[] memory winningTickets,
        uint256[] memory prizeShares
    ) {
        RoundData storage r = rounds[rid];
        return (r.winners, r.winningTickets, r.winnerPrizeShares);
    }

    function getUserPosition(uint256 rid, address user) external view returns (
        uint128 principalAssetOut,
        uint128 principalSharesOut
    ) {
        return (uint128(principalAsset[rid][user]), uint128(principalShares[rid][user]));
    }

    function rangesLength(uint256 rid) external view returns (uint256) {
        return rounds[rid].ranges.length;
    }

    function getRoundFeeAllocation(uint256 rid, uint256 index) external view returns (address recipient, uint16 bps) {
        FeeAllocation storage a = rounds[rid].roundFeeSnapshot[index];
        return (a.recipient, a.bps);
    }

    function getRoundFeeAllocationLength(uint256 rid) external view returns (uint256) {
        return rounds[rid].roundFeeSnapshot.length;
    }

    function getRoundMetadata(uint256 rid) external view returns (address campaign, bytes32 metadata) {
        RoundData storage r = rounds[rid];
        return (r.roundCampaign, r.roundMetadata);
    }

    function ownerOfTicket(uint256 rid, uint32 ticketId) external view returns (address) {
        return _ownerOfTicket(rounds[rid], ticketId);
    }

    function pendingClaimsTotal(uint256 rid, address user) external view returns (uint256 total) {
        for (uint256 i = 0; i < 256; i++) {
            total += pendingClaims[rid][user][uint8(i)];
        }
    }

    function hasPendingClaims(address user) external view returns (bool) {
        return pendingClaimSlotCount[user] != 0;
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _selectWinners(bytes32 randomNumber, uint32 totalTickets, uint8 desiredWinners)
        internal
        pure
        returns (uint32[] memory tickets)
    {
        if (totalTickets == 0) revert ZeroTickets();
        uint8 effectiveN = totalTickets < desiredWinners ? uint8(totalTickets) : desiredWinners;
        tickets = new uint32[](effectiveN);
        bytes32 seed = randomNumber;
        uint8 placed;
        uint16 attempts;
        while (placed < effectiveN) {
            if (attempts >= 1024) revert SelectionExhausted();
            seed = keccak256(abi.encodePacked(seed, attempts));
            uint32 candidate = uint32(uint256(seed) % uint256(totalTickets));
            bool dup;
            for (uint8 i = 0; i < placed; i++) {
                if (tickets[i] == candidate) {
                    dup = true;
                    break;
                }
            }
            if (!dup) {
                tickets[placed] = candidate;
                placed++;
            }
            attempts++;
        }
    }

    function _ownerOfTicket(RoundData storage r, uint32 ticketId) internal view returns (address) {
        if (ticketId >= r.totalTickets) revert TicketOOB();
        uint256 n = r.ranges.length;
        uint256 lo;
        uint256 hi = n - 1;
        while (lo <= hi) {
            uint256 mid = (lo + hi) / 2;
            Range storage rr = r.ranges[mid];
            if (ticketId < rr.start) {
                if (mid == 0) break;
                hi = mid - 1;
            } else if (ticketId >= rr.end) {
                lo = mid + 1;
            } else {
                return rr.buyer;
            }
        }
        revert BadState();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, to, amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert BadAssetTransfer();
    }

    function _forceApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, amount)
        );
        if (success && (data.length == 0 || abi.decode(data, (bool)))) return;

        (success, data) = token.call(abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, 0));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert BadAssetTransfer();

        (success, data) = token.call(abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, amount));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert BadAssetTransfer();
    }

    receive() external payable {}
}
