// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

// Pyth Entropy SDK — vendored from pyth-network/pyth-crosschain
// target_chains/ethereum/entropy_sdk/solidity/.
// Use relative imports so both Hardhat and Foundry compile from a clean checkout.
import {IEntropy} from "../lib/entropy-sdk-solidity/IEntropy.sol";
import {IEntropyConsumer} from "../lib/entropy-sdk-solidity/IEntropyConsumer.sol";

// ============================================================
// ShMonad interface — ERC-4626 vault + ERC-20 transfer
// No requestUnstake / completeUnstake.  Users who want MON go
// to shmonad.xyz to unstake their own shares.
// ============================================================

interface IShMonad {
    /// @notice Deposit MON, receive shMON shares in return.
    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares);
    /// @notice ERC-20 transfer of shMON shares (used to return shares to users at settlement).
    function transfer(address to, uint256 amount) external returns (bool);
    /// @notice ERC-4626 view: how many shares would be received for depositing `assets` MON right now.
    ///         Used to compute the prize: prizeShares = depositedShares − previewDeposit(depositedMON).
    ///         As yield accrues the rate increases (shares worth more MON), so previewDeposit returns
    ///         fewer shares for the same MON — the surplus shares are the winner's prize (ADR-0004).
    function previewDeposit(uint256 assets) external view returns (uint256 shares);
}

// ============================================================
// TicketPrizePoolShmonV3
// ============================================================

/// @title TicketPrizePoolShmonV3
/// @notice EverDraw no-loss lottery — V3 with Pyth Entropy VRF randomness.
///
///         Implements ADR-0014 (updated no-unstake design). Supersedes V2Compat.
///
///         Key design points:
///         - Blockhash randomness replaced by Pyth Entropy VRF (ADR-0014)
///         - NO requestUnstake / completeUnstake — users get shMON shares back directly
///         - At settlement: winner gets yield shMON shares; every depositor gets principal shares back
///         - withdrawPrincipal does shmon.transfer(user, shares) — ERC-20 transfer, no unstake
///         - Users who want MON go to shmonad.xyz to unstake their own shares
///         - Prize = totalPrincipalShmonShares − shmon.previewDeposit(totalPrincipalMON) (ADR-0004).
///           As yield accrues each share is worth more MON; previewDeposit returns fewer shares for
///           the same MON — the surplus is the winner's prize. When prizeShares == 0, users get back
///           their exact deposited share count. When prizeShares > 0, users get fair-value shares
///           (same MON value); winner gets the surplus on top of their own fair-value principal.
///         - VRF fee funded from owner-managed reserve (depositVRFReserve)
///         - emergencyForceSettle handles AwaitingVRF timeout only
///
/// @dev Round lifecycle:
///      Open -> AwaitingVRF -> Drawn -> Settled
///      Open -> Settled (skip, empty round)
contract TicketPrizePoolShmonV3 is IEntropyConsumer {

    // -------------------------
    // Legacy revert encoding
    // (tests expect selector 0xf28dceb3 + raw string bytes)
    // -------------------------

    bytes4 internal constant LEGACY_ERR_SELECTOR = 0xf28dceb3;

    function _legacyRevert(string memory reason) internal pure {
        revertBytes(abi.encodePacked(LEGACY_ERR_SELECTOR, bytes(reason)));
    }

    function revertBytes(bytes memory data) private pure {
        assembly {
            revert(add(data, 32), mload(data))
        }
    }

    // -------------------------
    // Ownership / pause / reentrancy
    // -------------------------

    address public owner;
    address public pendingOwner;
    bool public paused;
    uint256 private _locked = 1;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
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

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        pendingOwner = newOwner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        address previousOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, owner);
    }

    // -------------------------
    // Constants
    // -------------------------

    /// @notice Max time to wait for Pyth callback before the emergency escape hatch opens.
    uint64 public constant VRF_CALLBACK_TIMEOUT = 1 hours;

    /// @notice Maximum protocol fee on prize yield, in basis points.
    uint16 public constant MAX_FEE_BPS = 2000;

    /// @notice Contract version. Bumped on any future migration.
    string public constant VERSION = "3.0.0";

    /// @notice Minimum delay between queuing and committing an entropy/provider change.
    uint64 public constant ENTROPY_CHANGE_DELAY = 24 hours;

    // -------------------------
    // Types
    // -------------------------

    enum RoundState {
        Open,        // tickets can be bought
        AwaitingVRF, // VRF request submitted; waiting for Pyth callback
        Drawn,       // VRF callback received; randomNumber stored; ready for finalizeDraw
        Settled      // prizeShares computed; users can withdraw shMON shares / claim prize
    }

    enum NextAction {
        None,
        Skip,     // empty round ended -> settle with no-op
        Commit,   // yield period elapsed & has tickets -> request VRF
        Finalize  // VRF fulfilled (state == Drawn) -> select winner + compute prize shares
    }

    struct Range {
        uint32 start; // inclusive
        uint32 end;   // exclusive
        address buyer;
    }

    struct RoundData {
        // lifecycle
        RoundState state;
        uint64 salesEndTime;

        // VRF
        uint64 vrfSequenceNumber;  // Pyth sequence ID, set in _commitDraw
        bytes32 randomNumber;      // VRF result, written in _entropyCallback
        uint64 vrfRequestTime;     // timestamp when VRF was requested (for timeout)

        // tickets
        uint32 totalTickets;
        Range[] ranges;

        // accounting
        uint256 totalPrincipalMON;
        uint256 totalPrincipalShmonShares; // sum of shMON shares minted at deposit time

        // settlement outcome (exchange-rate model, ADR-0004)
        // principalSharesAtSettle = shmon.previewDeposit(totalPrincipalMON) at finalizeDraw time.
        // 0 until Settled. When prizeShares == 0, withdrawPrincipal returns exact deposited shares.
        uint256 principalSharesAtSettle;
        uint256 prizeShares;        // = totalPrincipalShmonShares − principalSharesAtSettle (0 if no yield)

        // protocol fee snapshot (set when round opens)
        uint16 roundFeeBps;
        address roundFeeRecipient;

        // Round metadata snapshot (ADR-0021). Defaults to (address(0), 0x0) for plain rounds.
        address roundCampaign;
        bytes32 roundMetadata;

        // winner
        address winner;
        uint32 winningTicket;
        bool prizeClaimed;
    }

    // -------------------------
    // Errors
    // -------------------------

    error BadConfig();
    error BadState();
    error NotKeeper();
    error SalesNotEnded();
    error YieldNotComplete();
    error SalesEnded();
    error ZeroTickets();
    error WrongValue();
    error TicketOOB();
    error NothingToWithdraw();
    error NotWinner();
    error PrizeAlreadyClaimed();
    error ZeroSharesMinted();
    error InsufficientVRFFee();
    error WrongProvider();
    error FeeTooHigh();
    error ZeroAddress();
    error NoPendingEntropyChange();
    error TimelockNotElapsed();

    // -------------------------
    // Immutable config
    // -------------------------

    uint96 public immutable ticketPriceMON;
    uint32 public immutable roundDurationSec;
    uint32 public immutable yieldPeriodSec;
    IShMonad public immutable shmon;
    IEntropy public entropy;
    address public entropyProvider;

    // -------------------------
    // Storage
    // -------------------------

    uint256 public currentRoundId;
    mapping(uint256 => RoundData) internal rounds;

    /// @notice MON deposited per user per round (informational).
    mapping(uint256 => mapping(address => uint256)) public principalMON;

    /// @notice shMON shares deposited per user per round — primary claim for withdrawPrincipal.
    mapping(uint256 => mapping(address => uint256)) public principalShmonShares;

    mapping(address => bool) public isKeeper;

    /// @notice Total shMON shares currently owed to users across all rounds
    ///         (unclaimed principal + unclaimed prizes).
    ///         Prize for a settling round = shmon.balanceOf(this) - totalUnclaimedShares.
    uint256 public totalUnclaimedShares;

    /// @notice Cursor for executeNext() scanning — earliest round that may still need action.
    uint256 public cursorRoundId;

    /// @notice Maps a Pyth sequence number back to the round that requested it.
    mapping(uint64 => uint256) public vrfSequenceToRound;

    /// @notice Live protocol fee config, snapshotted into each newly-opened round.
    uint16 public feeBps;
    address public feeRecipient;

    /// @notice Pending entropy contract address; 0 means no change queued.
    address public pendingEntropy;

    /// @notice Pending entropy provider address.
    address public pendingEntropyProvider;

    /// @notice Unix timestamp after which a queued entropy change can be committed.
    uint64 public pendingEntropyEffectiveAt;

    /// @notice Campaign/sponsor address applied to the next opened round. 0 = no campaign.
    address public nextRoundCampaign;

    /// @notice Opaque metadata payload applied to the next opened round.
    bytes32 public nextRoundMetadata;

    // -------------------------
    // Events
    // -------------------------

    event RoundStarted(uint256 indexed roundId, uint64 salesEndTime);
    event TicketsBought(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 monPaid);

    event RoundSkipped(uint256 indexed roundId);
    event VRFRequested(uint256 indexed roundId, uint64 indexed sequence, uint128 fee);
    event VRFFulfilled(uint256 indexed roundId, uint64 indexed sequence, bytes32 randomNumber);
    event WinnerDrawn(uint256 indexed roundId, address indexed winner, uint32 winningTicket);
    /// @notice Emitted when a round settles. `principalShares` = total deposited shares.
    ///         `prizeShares` = yield shares for winner (0 if shMON did not rebase or no yield).
    event RoundSettled(uint256 indexed roundId, uint256 principalShares, uint256 prizeShares);

    event KeeperSet(address indexed keeper, bool allowed);
    event EmergencyForceSettled(uint256 indexed roundId);

    /// @notice Winner claimed prize. `amount` is shMON shares.
    event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 amount);
    /// @notice Depositor withdrew principal. `amount` is shMON shares.
    event PrincipalWithdrawn(uint256 indexed roundId, address indexed user, uint256 amount);

    event ExecuteNext(uint256 indexed roundId, NextAction action);

    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    event VRFReserveDeposited(address indexed by, uint256 amount);
    event VRFReserveWithdrawn(address indexed to, uint256 amount);

    event FeeUpdated(uint16 feeBps, address feeRecipient);
    /// @notice Emitted at settlement when a protocol fee is taken from prize yield.
    event ProtocolFeeAccrued(uint256 indexed roundId, uint256 feeShares, address indexed feeRecipient);
    event EntropyChangeQueued(address newEntropy, address newProvider, uint64 effectiveAt);
    event EntropyChanged(address entropy, address entropyProvider);
    event EntropyChangeCancelled();
    event NextRoundMetadataSet(address campaign, bytes32 metadata);

    // -------------------------
    // Constructor
    // -------------------------

    constructor(
        uint96 _ticketPriceMON,
        uint32 _roundDurationSec,
        uint32 _yieldPeriodSec,
        address _shmon,
        address _entropy,
        address _entropyProvider
    ) {
        if (
            _ticketPriceMON == 0 ||
            _shmon == address(0) ||
            _entropy == address(0) ||
            _entropyProvider == address(0) ||
            _roundDurationSec < 60 ||
            _roundDurationSec > 30 days ||
            _yieldPeriodSec > 30 days
        ) revert BadConfig();

        owner = msg.sender;
        isKeeper[msg.sender] = true;
        feeRecipient = msg.sender;

        ticketPriceMON = _ticketPriceMON;
        roundDurationSec = _roundDurationSec;
        yieldPeriodSec = _yieldPeriodSec;
        shmon = IShMonad(_shmon);
        entropy = IEntropy(_entropy);
        entropyProvider = _entropyProvider;

        currentRoundId = 1;
        cursorRoundId = 1;

        RoundData storage r = rounds[1];
        r.state = RoundState.Open;
        r.salesEndTime = uint64(block.timestamp + _roundDurationSec);
        r.roundFeeBps = feeBps;
        r.roundFeeRecipient = feeRecipient;
        r.roundCampaign = nextRoundCampaign;
        r.roundMetadata = nextRoundMetadata;

        emit RoundStarted(1, r.salesEndTime);
    }

    // -------------------------
    // Keeper management
    // -------------------------

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        isKeeper[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    function setFee(uint16 newFeeBps, address newFeeRecipient) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        if (newFeeRecipient == address(0)) revert ZeroAddress();

        feeBps = newFeeBps;
        feeRecipient = newFeeRecipient;

        emit FeeUpdated(newFeeBps, newFeeRecipient);
    }

    function queueEntropyChange(address newEntropy, address newProvider) external onlyOwner {
        if (newEntropy == address(0) || newProvider == address(0)) revert ZeroAddress();

        pendingEntropy = newEntropy;
        pendingEntropyProvider = newProvider;
        pendingEntropyEffectiveAt = uint64(block.timestamp) + ENTROPY_CHANGE_DELAY;

        emit EntropyChangeQueued(newEntropy, newProvider, pendingEntropyEffectiveAt);
    }

    function commitEntropyChange() external onlyOwner {
        if (pendingEntropyEffectiveAt == 0) revert NoPendingEntropyChange();
        if (block.timestamp < pendingEntropyEffectiveAt) revert TimelockNotElapsed();

        entropy = IEntropy(pendingEntropy);
        entropyProvider = pendingEntropyProvider;

        pendingEntropy = address(0);
        pendingEntropyProvider = address(0);
        pendingEntropyEffectiveAt = 0;

        emit EntropyChanged(address(entropy), entropyProvider);
    }

    function cancelEntropyChange() external onlyOwner {
        if (pendingEntropyEffectiveAt == 0) revert NoPendingEntropyChange();

        pendingEntropy = address(0);
        pendingEntropyProvider = address(0);
        pendingEntropyEffectiveAt = 0;

        emit EntropyChangeCancelled();
    }

    function setNextRoundMetadata(address campaign, bytes32 metadata) external onlyOwner {
        nextRoundCampaign = campaign;
        nextRoundMetadata = metadata;

        emit NextRoundMetadataSet(campaign, metadata);
    }

    // -------------------------
    // VRF reserve management
    // -------------------------

    /// @notice Fund the VRF fee reserve (native MON). Plain transfers also work.
    function depositVRFReserve() external payable onlyOwner {
        emit VRFReserveDeposited(msg.sender, msg.value);
    }

    /// @notice Withdraw MON from the contract balance (VRF reserve). Owner-only.
    function withdrawVRFReserve(uint256 amount) external onlyOwner nonReentrant {
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        emit VRFReserveWithdrawn(msg.sender, amount);
    }

    // -------------------------
    // IEntropyConsumer overrides
    // -------------------------

    function getEntropy() internal view override returns (address) {
        return address(entropy);
    }

    /// @dev Called by Pyth after a randomness request is fulfilled.
    ///      MUST stay lean — only store random number and update state.
    ///      Heavy work (winner selection, prize computation) happens in finalizeDraw().
    function entropyCallback(
        uint64 sequence,
        address provider,
        bytes32 randomNumber
    ) internal override {
        uint256 rid = vrfSequenceToRound[sequence];
        if (rid == 0) return; // unknown sequence — ignore silently

        RoundData storage r = rounds[rid];
        if (r.state != RoundState.AwaitingVRF) return; // already processed or wrong state
        if (provider != entropyProvider) revert WrongProvider();

        r.randomNumber = randomNumber;
        r.state = RoundState.Drawn;

        emit VRFFulfilled(rid, sequence, randomNumber);
    }

    // -------------------------
    // Ticket purchasing
    // -------------------------

    function buyTickets(uint32 ticketCount) external payable {
        _buyTicketsMON(ticketCount);
    }

    function buyTicketsMON(uint32 ticketCount) external payable {
        _buyTicketsMON(ticketCount);
    }

    function buyTicketsShmon(uint32) external pure {
        revert("shMON entry disabled");
    }

    function _buyTicketsMON(uint32 ticketCount) internal whenNotPaused nonReentrant {
        uint256 rid = currentRoundId;
        RoundData storage r = rounds[rid];

        if (r.state != RoundState.Open) revert BadState();
        if (block.timestamp >= r.salesEndTime) revert SalesEnded();
        if (ticketCount == 0) revert ZeroTickets();

        uint256 cost = uint256(ticketCount) * uint256(ticketPriceMON);
        if (msg.value != cost) revert WrongValue();

        // CEI: update state before external call
        principalMON[rid][msg.sender] += cost;
        r.totalPrincipalMON += cost;

        // Deposit into shMON — trusted external call; nonReentrant guards re-entry.
        uint256 shares = shmon.deposit{value: cost}(cost, address(this));
        if (shares == 0) revert ZeroSharesMinted();

        // Track shares per user and globally.
        r.totalPrincipalShmonShares += shares;
        principalShmonShares[rid][msg.sender] += shares;
        totalUnclaimedShares += shares;

        // Allocate tickets
        uint32 start = r.totalTickets;
        require(uint256(start) + uint256(ticketCount) <= type(uint32).max, "ticket overflow");
        uint32 end = start + ticketCount;
        r.totalTickets = end;

        // Merge into last range if contiguous + same buyer
        uint256 n = r.ranges.length;
        if (n > 0) {
            Range storage last = r.ranges[n - 1];
            if (last.buyer == msg.sender && last.end == start) {
                last.end = end;
                emit TicketsBought(rid, msg.sender, ticketCount, cost);
                return;
            }
        }
        r.ranges.push(Range({start: start, end: end, buyer: msg.sender}));
        emit TicketsBought(rid, msg.sender, ticketCount, cost);
    }

    // -------------------------
    // Automation-first progression
    // -------------------------

    function executeNext() external whenNotPaused returns (uint256 rid, NextAction action) {
        (rid, action) = nextExecutable();
        if (action == NextAction.None) return (rid, action);

        _execute(rid, action);
        emit ExecuteNext(rid, action);
    }

    function executeNext(uint256 rid) external whenNotPaused returns (NextAction action) {
        action = nextAction(rid);
        if (action == NextAction.None) return action;

        _execute(rid, action);
        emit ExecuteNext(rid, action);
    }

    function _execute(uint256 rid, NextAction action) internal {
        if (action == NextAction.Skip) {
            _skipRound(rid);
        } else if (action == NextAction.Commit) {
            _commitDraw(rid);
        } else if (action == NextAction.Finalize) {
            _finalizeDraw(rid);
        }
    }

    // -------------------------
    // Planner views
    // -------------------------

    function nextAction(uint256 rid) public view returns (NextAction) {
        RoundData storage r = rounds[rid];

        if (r.salesEndTime == 0) return NextAction.None;

        // 1) Skip: empty round, sales closed
        if (
            r.state == RoundState.Open &&
            block.timestamp >= r.salesEndTime &&
            r.totalTickets == 0 &&
            r.totalPrincipalMON == 0 &&
            r.totalPrincipalShmonShares == 0
        ) return NextAction.Skip;

        // 2) Commit: yield period elapsed, has tickets
        if (
            r.state == RoundState.Open &&
            block.timestamp >= uint256(r.salesEndTime) + uint256(yieldPeriodSec) &&
            r.totalTickets > 0
        ) return NextAction.Commit;

        // 3) AwaitingVRF: nothing to do; waiting for Pyth callback

        // 4) Finalize: VRF fulfilled
        if (
            r.state == RoundState.Drawn &&
            r.totalTickets > 0
        ) return NextAction.Finalize;

        return NextAction.None;
    }

    function nextExecutable() public view returns (uint256 rid, NextAction action) {
        uint256 start = cursorRoundId;
        if (start == 0) start = 1;

        uint256 maxScan = 25;
        uint256 end = currentRoundId;
        rid = start;

        for (uint256 i = 0; i < maxScan && rid <= end; i++) {
            action = nextAction(rid);
            if (action != NextAction.None) return (rid, action);
            rid++;
        }

        return (start, NextAction.None);
    }

    // -------------------------
    // Internal step implementations
    // -------------------------

    function _commitDraw(uint256 rid) internal {
        RoundData storage r = rounds[rid];

        if (r.state != RoundState.Open) revert BadState();
        if (block.timestamp < r.salesEndTime) revert SalesNotEnded();
        if (block.timestamp < uint256(r.salesEndTime) + uint256(yieldPeriodSec)) revert YieldNotComplete();
        if (r.totalTickets == 0) revert ZeroTickets();

        uint128 fee = entropy.getFee(entropyProvider);
        if (address(this).balance < fee) revert InsufficientVRFFee();

        bytes32 userRandom = keccak256(abi.encode(
            rid,
            r.totalTickets,
            r.totalPrincipalMON,
            block.prevrandao,
            block.timestamp
        ));

        // CEI: update state before external call
        r.state = RoundState.AwaitingVRF;
        r.vrfRequestTime = uint64(block.timestamp);

        uint64 seq = entropy.requestWithCallback{value: fee}(entropyProvider, userRandom);

        vrfSequenceToRound[seq] = rid;
        r.vrfSequenceNumber = seq;

        emit VRFRequested(rid, seq, fee);

        if (rid == currentRoundId) {
            _startNextRound();
        }

        _bumpCursor();
    }

    /// @notice Select the winner and compute prize shares. Permissionless — anyone can call
    ///         once the VRF callback has landed (state == Drawn).
    ///         Round moves directly to Settled — no unstake step required.
    function finalizeDraw(uint256 rid) external nonReentrant {
        _finalizeDraw(rid);
    }

    function _finalizeDraw(uint256 rid) internal {
        RoundData storage r = rounds[rid];

        if (r.state != RoundState.Drawn) revert BadState();
        if (r.totalTickets == 0) revert ZeroTickets();

        uint32 winTicket = uint32(uint256(r.randomNumber) % uint256(r.totalTickets));
        address w = _ownerOfTicket(r, winTicket);

        r.winner = w;
        r.winningTicket = winTicket;

        emit WinnerDrawn(rid, w, winTicket);

        // Prize computation — exchange-rate model (ADR-0004):
        //
        // shMON is a non-rebasing ERC-4626 vault: share *count* stays constant but each
        // share is worth progressively more MON as staking yield accrues.
        //
        // At deposit:   user gets  S  shares for  M  MON  (at rate R₀: S = M / R₀)
        // At settlement:  1 share is worth R₁ > R₀ MON  (yield accrued over lock period)
        // Fair-value return: P = previewDeposit(M) at rate R₁ = M / R₁  < S  shares
        //
        // Prize = S − P  (the "extra" shares whose value = the yield the user generated)
        // Users receive P shares back — worth exactly M MON at current rate.
        // Winner receives the prize shares on top of their own P-share principal return.
        //
        // If rate did not change (e.g. no yield):  previewDeposit(M) == S  →  prizeShares = 0.
        //
        // totalUnclaimedShares is NOT incremented here.  The prize shares are already counted
        // within the deposit-time increment; they are a redistribution, not new shares. If a
        // protocol fee is due, it is transferred out and removed from totalUnclaimedShares.
        // Accounting per round:
        //   +deposit:           totalUnclaimedShares += depositedShares
        //   +finalize:          totalUnclaimedShares -= feeShares
        //   −withdrawPrincipal: totalUnclaimedShares -= principalSharesAtSettle × userProportion
        //   −claimPrize:        totalUnclaimedShares -= netPrizeShares
        //   net:                0

        uint256 principalSharesAtSettle = shmon.previewDeposit(r.totalPrincipalMON);
        uint256 grossPrizeShares = r.totalPrincipalShmonShares > principalSharesAtSettle
            ? r.totalPrincipalShmonShares - principalSharesAtSettle
            : 0;
        uint256 feeShares = (grossPrizeShares * uint256(r.roundFeeBps)) / 10_000;
        uint256 netPrizeShares = grossPrizeShares - feeShares;

        if (feeShares > 0) {
            totalUnclaimedShares -= feeShares;
            bool ok = shmon.transfer(r.roundFeeRecipient, feeShares);
            require(ok, "fee transfer failed");
            emit ProtocolFeeAccrued(rid, feeShares, r.roundFeeRecipient);
        }

        r.principalSharesAtSettle = principalSharesAtSettle;
        r.prizeShares = netPrizeShares;

        r.state = RoundState.Settled;

        emit RoundSettled(rid, principalSharesAtSettle, netPrizeShares);

        _bumpCursor();
    }

    function _skipRound(uint256 rid) internal {
        RoundData storage r = rounds[rid];

        if (r.state != RoundState.Open) revert BadState();
        if (block.timestamp < r.salesEndTime) revert SalesNotEnded();
        if (r.totalTickets != 0 || r.totalPrincipalMON != 0 || r.totalPrincipalShmonShares != 0) revert BadState();

        r.state = RoundState.Settled;
        r.prizeClaimed = true; // nothing to claim

        emit RoundSkipped(rid);

        if (rid == currentRoundId) {
            _startNextRound();
        }

        _bumpCursor();
    }

    function _bumpCursor() internal {
        while (cursorRoundId <= currentRoundId) {
            RoundData storage r = rounds[cursorRoundId];
            if (r.salesEndTime == 0) break;
            if (r.state != RoundState.Settled) break;
            cursorRoundId++;
        }
    }

    function _startNextRound() internal {
        currentRoundId += 1;
        RoundData storage r = rounds[currentRoundId];
        r.state = RoundState.Open;
        r.salesEndTime = uint64(block.timestamp + roundDurationSec);
        r.roundFeeBps = feeBps;
        r.roundFeeRecipient = feeRecipient;
        r.roundCampaign = nextRoundCampaign;
        r.roundMetadata = nextRoundMetadata;
        emit RoundStarted(currentRoundId, r.salesEndTime);
    }

    // -------------------------
    // Owner: emergency escape hatch
    // -------------------------

    /// @notice Emergency settle for a round stuck in AwaitingVRF (Pyth callback never arrived).
    ///         After VRF_CALLBACK_TIMEOUT the owner can force-settle with no winner.
    ///         All depositors recover their full shMON shares via withdrawPrincipal.
    function emergencyForceSettle(uint256 rid) external onlyOwner nonReentrant {
        RoundData storage r = rounds[rid];

        if (r.state != RoundState.AwaitingVRF) revert BadState();
        require(
            block.timestamp >= uint256(r.vrfRequestTime) + uint256(VRF_CALLBACK_TIMEOUT),
            "vrf timeout not reached"
        );

        // No winner, no prize.  prizeShares stays 0 so withdrawPrincipal returns each depositor's
        // exact deposited share count (the prizeShares == 0 branch).
        // principalShmonShares are already reserved in totalUnclaimedShares from deposit time,
        // so users can call withdrawPrincipal immediately.
        r.state = RoundState.Settled;
        r.prizeClaimed = true; // nothing to claim — blocks claimPrize

        emit EmergencyForceSettled(rid);
        _bumpCursor();
    }

    // -------------------------
    // Legacy-compatible wrappers
    // -------------------------

    function commitDraw(uint256 rid) external whenNotPaused {
        RoundData storage r = rounds[rid];

        if (r.salesEndTime == 0) _legacyRevert("bad round");
        if (r.state != RoundState.Open) _legacyRevert("bad state");
        if (block.timestamp < r.salesEndTime) _legacyRevert("sales not ended");
        if (block.timestamp < uint256(r.salesEndTime) + uint256(yieldPeriodSec)) _legacyRevert("yield not complete");
        if (r.totalTickets == 0) _legacyRevert("no tickets");

        _commitDraw(rid);
    }

    function skipRound(uint256 rid) external whenNotPaused {
        RoundData storage r = rounds[rid];

        if (r.salesEndTime == 0) _legacyRevert("bad round");
        if (r.state != RoundState.Open) _legacyRevert("bad state");
        if (block.timestamp < r.salesEndTime) _legacyRevert("sales not ended");
        if (r.totalTickets != 0) _legacyRevert("has tickets");
        if (r.totalPrincipalMON != 0 || r.totalPrincipalShmonShares != 0) _legacyRevert("bad state");

        _skipRound(rid);
    }

    // -------------------------
    // Claims — shMON shares returned to users
    // -------------------------

    /// @notice Winner claims yield shMON shares as prize.
    ///         Winner must also call withdrawPrincipal to recover their deposit.
    function claimPrize(uint256 rid) external nonReentrant {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Settled) revert BadState();
        if (r.prizeClaimed) revert PrizeAlreadyClaimed();
        if (msg.sender != r.winner) revert NotWinner();

        r.prizeClaimed = true;
        // Do NOT zero r.prizeShares — withdrawPrincipal reads it after claiming to decide
        // the accounting branch (prizeShares > 0 → fair-value return for all depositors).
        uint256 shares = r.prizeShares;

        if (shares > 0) {
            totalUnclaimedShares -= shares;
            bool ok = shmon.transfer(msg.sender, shares);
            require(ok, "transfer failed");
        }

        emit PrizeClaimed(rid, msg.sender, shares);
    }

    /// @notice Every depositor recovers their principal as shMON shares.
    ///
    ///         When prizeShares == 0 (no yield, or emergency/skipped round):
    ///           Returns the user's exact deposited share count.
    ///
    ///         When prizeShares > 0 (yield accrued):
    ///           Returns fair-value shares — slightly fewer than deposited but same MON value.
    ///           Amount = (userDepositedMON × principalSharesAtSettle) / totalPrincipalMON
    ///
    ///         This matches the production V2 withdrawPrincipal behaviour exactly (ADR-0016).
    ///         Users who want MON can go to shmonad.xyz to unstake their returned shares.
    function withdrawPrincipal(uint256 rid) external nonReentrant {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Settled) revert BadState();

        uint256 userMON = principalMON[rid][msg.sender];
        if (userMON == 0) revert NothingToWithdraw();

        // Compute return amount before clearing state (mirrors production V2 logic).
        uint256 sharesToReturn;
        if (r.prizeShares == 0) {
            // No yield (or emergency settle): return exact deposited share count.
            sharesToReturn = principalShmonShares[rid][msg.sender];
        } else {
            // Yield present: return fair-value shares proportional to MON deposited.
            sharesToReturn = (userMON * r.principalSharesAtSettle) / r.totalPrincipalMON;
        }

        principalMON[rid][msg.sender] = 0;
        principalShmonShares[rid][msg.sender] = 0;

        totalUnclaimedShares -= sharesToReturn;
        bool ok = shmon.transfer(msg.sender, sharesToReturn);
        require(ok, "transfer failed");

        emit PrincipalWithdrawn(rid, msg.sender, sharesToReturn);
    }

    // -------------------------
    // Views
    // -------------------------

    function getRoundTimes(uint256 rid) external view returns (uint64 salesEndTime, uint64 vrfRequestTime) {
        RoundData storage r = rounds[rid];
        return (r.salesEndTime, r.vrfRequestTime);
    }

    function getCommitAfterTime(uint256 rid) external view returns (uint64) {
        RoundData storage r = rounds[rid];
        if (r.salesEndTime == 0) return 0;
        return uint64(uint256(r.salesEndTime) + uint256(yieldPeriodSec));
    }

    function getRoundState(uint256 rid) external view returns (RoundState) {
        return rounds[rid].state;
    }

    /// @notice Returns core round info.
    ///         totalShmonShares     = totalPrincipalShmonShares (shares deposited).
    ///         principalSharesAtSettle = previewDeposit(totalPrincipalMON) at finalizeDraw time (0 before Settled).
    ///         prizeShares          = yield shares for winner (0 until Settled, or 0 if no yield).
    function getRoundInfo(uint256 rid) external view returns (
        RoundState state,
        uint64 salesEndTime,
        uint64 vrfSequenceNumber,
        uint32 totalTickets,
        uint256 totalPrincipalMON,
        uint256 totalShmonShares,
        uint256 principalSharesAtSettle,
        uint256 prizeShares,
        uint256 shareRateAtSettle,
        address winner,
        uint32 winningTicket,
        bool prizeClaimed
    ) {
        RoundData storage r = rounds[rid];
        return (
            r.state,
            r.salesEndTime,
            r.vrfSequenceNumber,
            r.totalTickets,
            r.totalPrincipalMON,
            r.totalPrincipalShmonShares,
            r.principalSharesAtSettle,
            r.prizeShares,
            0,                           // shareRateAtSettle: reserved for future
            r.winner,
            r.winningTicket,
            r.prizeClaimed
        );
    }

    function getUserPosition(uint256 rid, address user) external view returns (
        uint128 principalMONOut,
        uint128 principalShmonSharesOut
    ) {
        return (
            uint128(principalMON[rid][user]),
            uint128(principalShmonShares[rid][user])
        );
    }

    function rangesLength(uint256 rid) external view returns (uint256) {
        return rounds[rid].ranges.length;
    }

    function getRoundFee(uint256 rid) external view returns (uint16 bps, address recipient) {
        RoundData storage r = rounds[rid];
        return (r.roundFeeBps, r.roundFeeRecipient);
    }

    function getRoundMetadata(uint256 rid) external view returns (address campaign, bytes32 metadata) {
        RoundData storage r = rounds[rid];
        return (r.roundCampaign, r.roundMetadata);
    }

    function ownerOfTicket(uint256 rid, uint32 ticketId) external view returns (address) {
        RoundData storage r = rounds[rid];
        return _ownerOfTicket(r, ticketId);
    }

    // -------------------------
    // Internal helpers
    // -------------------------

    function _ownerOfTicket(RoundData storage r, uint32 ticketId) internal view returns (address) {
        if (ticketId >= r.totalTickets) revert TicketOOB();

        uint256 n = r.ranges.length;
        uint256 lo = 0;
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

    // -------------------------
    // Misc
    // -------------------------

    receive() external payable {}

    function legacyBytes(string memory reason) external pure returns (bytes memory) {
        return abi.encodePacked(LEGACY_ERR_SELECTOR, bytes(reason));
    }
}
