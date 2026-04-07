// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/// @notice Minimal interface we actually use on ShMonad proxy.
/// Observed working on-chain:
/// - deposit(uint256,address) payable returns (uint256 shares)
/// - requestUnstake(uint256) returns (uint64 completionEpoch)
/// - completeUnstake() reverts until ready
interface IShMonad {
    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares);
    function requestUnstake(uint256 shares) external returns (uint64 completionEpoch);
    function completeUnstake() external;
}

/// @title TicketPrizePoolShmonShMonad
/// @notice PoolTogether-style prize pool using MON -> shMON yield.
///         Strategy 1: only one active finalizing round at a time (shMON unstake is per-account).
///         Automation-first: call executeNext() repeatedly. Permissionless fallback: anyone can call the same function.
contract TicketPrizePoolShmonShMonad {
    // ---------------------------------------------------------------------
    // Legacy revert encoding (tests expect selector 0xf28dceb3 + raw string bytes)
    // IMPORTANT: must be abi.encodePacked(selector, bytes(reason)), NOT abi.encodeWithSelector.
    // ---------------------------------------------------------------------
    bytes4 internal constant LEGACY_ERR_SELECTOR = 0xf28dceb3;

    function _legacyRevert(string memory reason) internal pure {
        // EXACT bytes layout expected by your tests:
        // 4-byte selector + raw bytes of the string (no ABI string encoding)
        revertBytes(abi.encodePacked(LEGACY_ERR_SELECTOR, bytes(reason)));
    }

    function revertBytes(bytes memory data) private pure {
        assembly {
            revert(add(data, 32), mload(data))
        }
    }

    // -------------------------
    // Ownership / pause / lock
    // -------------------------

    address public owner;
    address public pendingOwner;
    bool public paused;

    uint256 private _locked = 1;
    uint256 public constant FINALIZATION_TIMEOUT = 14 days;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
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
        pendingOwner = newOwner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(owner);
    }

    // ---------------------------------------------------------------------
    // Backwards-compatible wrappers for older tests/scripts (legacy behavior)
    // These DO NOT auto-select actions. They run the named step or revert
    // with the legacy selector + raw string bytes.
    // ---------------------------------------------------------------------

    function commitDraw(uint256 rid) external whenNotPaused {
        RoundData storage r = rounds[rid];

        if (r.salesEndTime == 0) _legacyRevert("bad round");
        if (r.state != RoundState.Open) _legacyRevert("bad state");
        if (block.timestamp < r.salesEndTime) _legacyRevert("sales not ended");
        if (r.totalTickets == 0) _legacyRevert("no tickets");

        _commitDraw(rid);
    }

    function skipRound(uint256 rid) external whenNotPaused {
        RoundData storage r = rounds[rid];

        if (r.salesEndTime == 0) _legacyRevert("bad round");
        if (r.state != RoundState.Open) _legacyRevert("bad state");
        if (block.timestamp < r.salesEndTime) _legacyRevert("sales not ended");

        // tests expect this exact reason string (note: no leading spaces)
        if (r.totalTickets != 0) _legacyRevert("has tickets");

        // defensive: empty means truly empty
        if (r.totalPrincipalMON != 0 || r.totalShmonShares != 0) _legacyRevert("bad state");

        _skipRound(rid);
    }

    function drawWinner(uint256 rid) external whenNotPaused {
        RoundData storage r = rounds[rid];

        if (r.salesEndTime == 0) _legacyRevert("bad round");
        if (activeFinalizingRoundId != 0) _legacyRevert("finalization busy");
        if (r.state != RoundState.Committed) _legacyRevert("bad state");
        if (block.number <= r.targetBlockNumber) _legacyRevert("too early");
        if (block.number > r.targetBlockNumber + 255) _legacyRevert("blockhash expired");
        if (r.totalTickets == 0) _legacyRevert("no tickets");

        _drawWinner(rid);
    }

    function settleRound(uint256 rid) external {
        RoundData storage r = rounds[rid];

        if (r.salesEndTime == 0) _legacyRevert("bad round");
        if (r.state != RoundState.Finalizing) _legacyRevert("bad state");
        if (activeFinalizingRoundId != rid) _legacyRevert("bad state");

        _settleRound(rid);
    }

    function recommit(uint256 rid) external whenNotPaused {
        _recommit(rid);
    }

    function emergencyForceSettle(uint256 rid) external onlyOwner {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Finalizing) revert BadState();
        if (activeFinalizingRoundId != rid) revert BadState();
        require(block.timestamp >= uint256(r.finalizationStartTime) + FINALIZATION_TIMEOUT, "timeout not reached");

        r.monReceived = 0;
        r.yieldMON = 0;
        r.lossRatio = 0;
        r.state = RoundState.Settled;

        activeFinalizingRoundId = 0;

        emit RoundSettled(rid, 0, 0, 0);

        _bumpCursor();
    }

    // Optional helper for tests
    function getActiveFinalizer() external view returns (uint256) {
        return activeFinalizingRoundId;
    }

    // -------------------------
    // Types
    // -------------------------

    enum RoundState {
        Open,        // tickets can be bought
        Committed,   // targetBlockNumber set
        Finalizing,  // winner drawn + unstake requested; waiting for completeUnstake()
        Settled      // monReceived/yield/lossRatio finalized; users can withdraw/claim
    }

    enum NextAction {
        None,
        Skip,     // empty round ended -> finalize with no-op
        Commit,   // sales ended & has tickets -> commit randomness + start next round
        Draw,     // target block passed & still within 255 blocks -> pick winner + request unstake
        Settle,   // try completeUnstake(); if reverts, not ready yet
        Recommit  // blockhash expired -> pick a new target block
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
        uint256 targetBlockNumber;

        // tickets
        uint32 totalTickets;
        Range[] ranges;

        // accounting
        uint256 totalPrincipalMON;
        uint256 totalShmonShares;

        // settlement outcome
        uint64 unstakeCompletionEpoch; // returned by requestUnstake (informational only)
        uint64 finalizationStartTime;  // when round enters Finalizing
        uint256 monReceived;           // from completeUnstake()
        uint256 yieldMON;              // max(0, monReceived - principal)
        uint256 lossRatio;             // 1e18 = no loss; <1e18 scales principal down

        // winner
        address winner;
        uint32 winningTicket;
        bool prizeClaimed;
    }

    // -------------------------
    // Errors (internal / automation path)
    // -------------------------

    error BadConfig();
    error BadState();
    error SalesNotEnded();
    error SalesEnded();
    error ZeroTickets();
    error WrongValue();
    error FinalizationBusy();
    error TooEarly();
    error BlockhashExpired();
    error NoBlockhash();
    error TicketOOB();
    error NothingToWithdraw();
    error NotWinner();
    error PrizeAlreadyClaimed();
    error ZeroSharesMinted();

    // -------------------------
    // Config
    // -------------------------

    uint96 public immutable ticketPriceMON;
    uint32 public immutable commitDelayBlocks;
    uint32 public immutable roundDurationSec;
    IShMonad public immutable shmon;

    // -------------------------
    // Storage
    // -------------------------

    uint256 public currentRoundId;
    mapping(uint256 => RoundData) internal rounds;

    // principal per user per round (MON)
    mapping(uint256 => mapping(address => uint256)) public principalMON;

    // Strategy 1 guard: only one active unstake/finalization at a time
    uint256 public activeFinalizingRoundId; // 0 if none

    // For executeNext() scanning:
    // The earliest round that might still need action (commit/draw/settle/skip).
    uint256 public cursorRoundId;

    // -------------------------
    // Events
    // -------------------------

    event RoundStarted(uint256 indexed roundId, uint64 salesEndTime);
    event TicketsBought(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 monPaid);

    event RoundSkipped(uint256 indexed roundId);
    event DrawCommitted(uint256 indexed roundId, uint256 targetBlockNumber);
    event WinnerDrawn(uint256 indexed roundId, address indexed winner, uint32 winningTicket);
    event UnstakeRequested(uint256 indexed roundId, uint64 completionEpoch, uint256 shmonShares);
    event RoundSettled(uint256 indexed roundId, uint256 monReceived, uint256 yieldMON, uint256 lossRatio);

    event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 amount);
    event PrincipalWithdrawn(uint256 indexed roundId, address indexed user, uint256 amount);

    event ExecuteNext(uint256 indexed roundId, NextAction action);

    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnershipTransferred(address indexed newOwner);

    // -------------------------
    // Constructor
    // -------------------------

    constructor(
        uint96 _ticketPriceMON,
        uint32 _commitDelayBlocks,
        uint32 _roundDurationSec,
        address _shmon
    ) {
        if (
            _ticketPriceMON == 0 ||
            _shmon == address(0) ||
            _commitDelayBlocks == 0 ||
            _commitDelayBlocks > 5000 ||
            _roundDurationSec < 60 ||
            _roundDurationSec > 30 days
        ) revert BadConfig();

        owner = msg.sender;

        ticketPriceMON = _ticketPriceMON;
        commitDelayBlocks = _commitDelayBlocks;
        roundDurationSec = _roundDurationSec;
        shmon = IShMonad(_shmon);

        // start round 1
        currentRoundId = 1;
        cursorRoundId = 1;

        RoundData storage r = rounds[1];
        r.state = RoundState.Open;
        r.salesEndTime = uint64(block.timestamp + _roundDurationSec);

        emit RoundStarted(1, r.salesEndTime);
    }

    // -------------------------
    // Buying (only current round)
    // -------------------------

    function buyTickets(uint32 ticketCount) external payable whenNotPaused nonReentrant {
        uint256 rid = currentRoundId;
        RoundData storage r = rounds[rid];

        if (r.state != RoundState.Open) revert BadState();
        if (block.timestamp >= r.salesEndTime) revert SalesEnded();
        if (ticketCount == 0) revert ZeroTickets();

        uint256 cost = uint256(ticketCount) * uint256(ticketPriceMON);
        if (msg.value != cost) revert WrongValue();

        // principal accounting
        principalMON[rid][msg.sender] += cost;
        r.totalPrincipalMON += cost;

        // IMPORTANT FIX:
        // ShMonad deposit is payable; MUST forward value = assets.
        uint256 shares = shmon.deposit{value: cost}(cost, address(this));
        if (shares == 0) revert ZeroSharesMinted();
        r.totalShmonShares += shares;

        // allocate tickets
        uint32 start = r.totalTickets;
        require(uint256(start) + uint256(ticketCount) <= type(uint32).max, "ticket overflow");
        uint32 end = start + ticketCount;
        r.totalTickets = end;

        // merge into last range if contiguous and same buyer
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

    /// @notice The ONE function an automation bot can call repeatedly.
    ///         Anyone can call it too (permissionless fallback).
    /// @dev Picks a round and runs exactly one step.
    function executeNext() external whenNotPaused returns (uint256 rid, NextAction action) {
        (rid, action) = nextExecutable();
        if (action == NextAction.None) {
            return (rid, action);
        }

        _execute(rid, action);
        emit ExecuteNext(rid, action);
    }

    /// @notice Manual/targeted: do the next step for a specific round.
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
        } else if (action == NextAction.Draw) {
            _drawWinner(rid);
        } else if (action == NextAction.Settle) {
            _settleRound(rid);
        } else if (action == NextAction.Recommit) {
            _recommit(rid);
        }
    }

    function _recommit(uint256 rid) internal {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Committed) revert BadState();
        if (r.totalTickets == 0) revert ZeroTickets();
        if (block.number <= r.targetBlockNumber + 255) revert TooEarly();

        r.targetBlockNumber = block.number + commitDelayBlocks;
        emit DrawCommitted(rid, r.targetBlockNumber);
    }

    // -------------------------
    // Planner views
    // -------------------------

    function nextAction(uint256 rid) public view returns (NextAction) {
        RoundData storage r = rounds[rid];

        // Non-existent rounds: return None.
        if (r.salesEndTime == 0) return NextAction.None;

        // 1) Skip: empty round ended
        if (
            r.state == RoundState.Open &&
            block.timestamp >= r.salesEndTime &&
            r.totalTickets == 0 &&
            r.totalPrincipalMON == 0 &&
            r.totalShmonShares == 0
        ) return NextAction.Skip;

        // 2) Commit
        if (
            r.state == RoundState.Open &&
            block.timestamp >= r.salesEndTime &&
            r.totalTickets > 0
        ) return NextAction.Commit;

        // 3) Recommit if draw window expired
        if (
            r.state == RoundState.Committed &&
            block.number > r.targetBlockNumber + 255 &&
            r.totalTickets > 0
        ) return NextAction.Recommit;

        // 4) Draw
        if (
            r.state == RoundState.Committed &&
            block.number > r.targetBlockNumber &&
            block.number <= r.targetBlockNumber + 255 &&
            r.totalTickets > 0 &&
            activeFinalizingRoundId == 0
        ) return NextAction.Draw;

        // 5) Settle
        if (
            r.state == RoundState.Finalizing &&
            activeFinalizingRoundId == rid
        ) return NextAction.Settle;

        return NextAction.None;
    }

    /// @notice What round + action would executeNext() run right now?
    /// @dev Priority:
    ///  - if there's an active finalizer, we only try to settle that one
    ///  - otherwise scan forward from cursorRoundId up to currentRoundId (bounded loop).
    function nextExecutable() public view returns (uint256 rid, NextAction action) {
        if (activeFinalizingRoundId != 0) {
            rid = activeFinalizingRoundId;
            action = nextAction(rid);
            return (rid, action);
        }

        uint256 start = cursorRoundId;
        if (start == 0) start = 1;

        uint256 maxScan = 25;
        uint256 end = currentRoundId;
        rid = start;

        for (uint256 i = 0; i < maxScan && rid <= end; i++) {
            action = nextAction(rid);
            if (action != NextAction.None) {
                return (rid, action);
            }
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
        if (r.totalTickets == 0) revert ZeroTickets();

        r.targetBlockNumber = block.number + commitDelayBlocks;
        r.state = RoundState.Committed;

        emit DrawCommitted(rid, r.targetBlockNumber);

        if (rid == currentRoundId) {
            _startNextRound();
        }

        _bumpCursor();
    }

    function _skipRound(uint256 rid) internal {
        RoundData storage r = rounds[rid];

        if (r.state != RoundState.Open) revert BadState();
        if (block.timestamp < r.salesEndTime) revert SalesNotEnded();
        if (r.totalTickets != 0 || r.totalPrincipalMON != 0 || r.totalShmonShares != 0) revert BadState();

        // finalize as settled (no-op)
        r.state = RoundState.Settled;
        r.lossRatio = 1e18;
        r.yieldMON = 0;
        r.monReceived = 0;
        r.prizeClaimed = true;

        emit RoundSkipped(rid);

        if (rid == currentRoundId) {
            _startNextRound();
        }

        _bumpCursor();
    }

    function _drawWinner(uint256 rid) internal nonReentrant {
        RoundData storage r = rounds[rid];

        if (r.state != RoundState.Committed) revert BadState();
        if (block.number <= r.targetBlockNumber) revert TooEarly();
        if (block.number > r.targetBlockNumber + 255) revert BlockhashExpired();
        if (activeFinalizingRoundId != 0) revert FinalizationBusy();
        if (r.totalTickets == 0) revert ZeroTickets();

        bytes32 bh = blockhash(r.targetBlockNumber);
        if (bh == bytes32(0)) revert NoBlockhash();

        bytes32 rnd = keccak256(abi.encodePacked(bh, rid));
        uint32 winTicket = uint32(uint256(rnd) % uint256(r.totalTickets));
        address w = _ownerOfTicket(r, winTicket);

        r.winner = w;
        r.winningTicket = winTicket;

        emit WinnerDrawn(rid, w, winTicket);

        uint64 completionEpoch = shmon.requestUnstake(r.totalShmonShares);
        r.unstakeCompletionEpoch = completionEpoch;

        r.state = RoundState.Finalizing;
        r.finalizationStartTime = uint64(block.timestamp);
        activeFinalizingRoundId = rid;

        emit UnstakeRequested(rid, completionEpoch, r.totalShmonShares);
    }

    function _settleRound(uint256 rid) internal nonReentrant {
        RoundData storage r = rounds[rid];

        if (r.state != RoundState.Finalizing) revert BadState();
        if (activeFinalizingRoundId != rid) revert BadState();

        uint256 balBefore = address(this).balance;

        shmon.completeUnstake();

        uint256 balAfter = address(this).balance;
        uint256 received = balAfter - balBefore;

        r.monReceived = received;

        uint256 principal = r.totalPrincipalMON;
        uint256 yieldMON;
        uint256 lossRatio = 1e18;

        if (received >= principal) {
            yieldMON = received - principal;
        } else {
            yieldMON = 0;
            lossRatio = (principal == 0) ? 1e18 : (received * 1e18) / principal;
        }

        r.yieldMON = yieldMON;
        r.lossRatio = lossRatio;
        r.state = RoundState.Settled;

        activeFinalizingRoundId = 0;

        emit RoundSettled(rid, received, yieldMON, lossRatio);

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
        emit RoundStarted(currentRoundId, r.salesEndTime);
    }

    // -------------------------
    // Claims
    // -------------------------

    function claimPrize(uint256 rid) external nonReentrant {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Settled) revert BadState();
        if (r.prizeClaimed) revert PrizeAlreadyClaimed();
        if (msg.sender != r.winner) revert NotWinner();

        r.prizeClaimed = true;
        uint256 amt = r.yieldMON;
        r.yieldMON = 0;

        if (amt > 0) {
            (bool ok,) = msg.sender.call{value: amt}("");
            require(ok, "transfer failed");
        }

        emit PrizeClaimed(rid, msg.sender, amt);
    }

    function withdrawPrincipal(uint256 rid) external nonReentrant {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Settled) revert BadState();

        uint256 amt = principalMON[rid][msg.sender];
        if (amt == 0) revert NothingToWithdraw();

        principalMON[rid][msg.sender] = 0;

        if (r.lossRatio < 1e18) {
            amt = (amt * r.lossRatio) / 1e18;
        }

        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok, "transfer failed");

        emit PrincipalWithdrawn(rid, msg.sender, amt);
    }

    // -------------------------
    // Convenience views
    // -------------------------

    function getRoundTimes(uint256 rid) external view returns (uint64 salesEndTime, uint64 unstakeCompletionEpoch) {
        RoundData storage r = rounds[rid];
        return (r.salesEndTime, r.unstakeCompletionEpoch);
    }

    function getRoundState(uint256 rid) external view returns (RoundState) {
        return rounds[rid].state;
    }

    function getRoundInfo(uint256 rid) external view returns (
        RoundState state,
        uint64 salesEndTime,
        uint32 totalTickets,
        uint256 totalPrincipalMON,
        uint256 totalShmonShares,
        uint256 targetBlockNumber,
        address winner,
        uint32 winningTicket,
        uint64 unstakeCompletionEpoch,
        uint256 monReceived,
        uint256 yieldMON,
        uint256 lossRatio,
        bool prizeClaimed
    ) {
        RoundData storage r = rounds[rid];
        return (
            r.state,
            r.salesEndTime,
            r.totalTickets,
            r.totalPrincipalMON,
            r.totalShmonShares,
            r.targetBlockNumber,
            r.winner,
            r.winningTicket,
            r.unstakeCompletionEpoch,
            r.monReceived,
            r.yieldMON,
            r.lossRatio,
            r.prizeClaimed
        );
    }

    function rangesLength(uint256 rid) external view returns (uint256) {
        return rounds[rid].ranges.length;
    }

    function ownerOfTicket(uint256 rid, uint32 ticketId) external view returns (address) {
        RoundData storage r = rounds[rid];
        return _ownerOfTicket(r, ticketId);
    }

    // -------------------------
    // Ticket ownership lookup
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

    receive() external payable {}

    // --- legacy revert bytes helper (for tests) ---
    function legacyBytes(string memory reason) external pure returns (bytes memory) {
        // Must match how the contract reverts for legacy string errors:
        // 4-byte selector + raw bytes(reason)
        return abi.encodePacked(LEGACY_ERR_SELECTOR, bytes(reason));
    }
}
