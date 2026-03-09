// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

interface IShmonadStaker {
    /// @notice Stake MON, receive SHMON credited to msg.sender
    function stake() external payable returns (uint256 shmonAmount);

    /// @notice Request unstaking - MON arrives after delay
    function requestUnstake(uint256 shmonAmount) external returns (uint256 requestId);

    /// @notice Claim MON from completed unstake request
    function claimUnstake(uint256 requestId, address to) external returns (uint256 monAmount);

    /// @notice Check if unstake request is claimable
    function isUnstakeReady(uint256 requestId) external view returns (bool);
}

/// @title TicketPrizePoolShmon - Minimal SHMON v1
/// @notice Overlapping rounds with delayed settlement.
/// @dev Round N can start selling immediately after Round N-1 commits; settlement happens async.
contract TicketPrizePoolShmon {
    enum RoundState {
        Open,       // selling tickets
        Committed,  // waiting for target blockhash
        Finalizing, // winner picked, unstake requested
        Settled     // MON claimed, prize + refunds available
    }

    struct Range {
        uint32 start; // inclusive
        uint32 end;   // exclusive
        address buyer;
    }

    struct RoundData {
        RoundState state;
        uint64 salesEndTime;

        uint32 totalTickets;
        uint256 targetBlockNumber;

        // accounting
        uint256 totalPrincipalMON;
        uint256 totalShmonStaked;

        // settlement
        uint256 unstakeRequestId;
        uint256 monReceived;
        uint256 yieldMON;
        uint256 lossRatio; // 1e18 = no loss, <1e18 means proportional principal loss

        // winner
        address winner;
        uint32 winningTicket;

        // flags
        bool prizeClaimed;
        bool settled;

        // ownership ranges (merged by consecutive buys)
        Range[] ranges;
    }

    // ---- Config ----
    uint96 public immutable ticketPriceMON;      // in wei
    uint32 public immutable commitDelayBlocks;   // blocks after commitDraw to pick blockhash
    uint32 public immutable roundDurationSec;    // seconds
    IShmonadStaker public immutable staker;

    // ---- Rounds ----
    uint256 public currentRoundId;
    mapping(uint256 => RoundData) internal rounds;

    // user principal per round (in MON)
    mapping(uint256 => mapping(address => uint256)) public principalMON;

    // ---- Events ----
    event RoundStarted(uint256 indexed roundId, uint64 salesEndTime);
    event TicketsBought(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 monPaid);
    event DrawCommitted(uint256 indexed roundId, uint256 targetBlockNumber);
    event WinnerDrawn(uint256 indexed roundId, address indexed winner, uint32 winningTicket);
    event UnstakeRequested(uint256 indexed roundId, uint256 requestId, uint256 shmonAmount);
    event RoundSettled(uint256 indexed roundId, uint256 monReceived, uint256 yieldMON, uint256 lossRatio);
    event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 amount);
    event PrincipalWithdrawn(uint256 indexed roundId, address indexed user, uint256 amount);

    constructor(
        uint96 _ticketPriceMON,
        uint32 _commitDelayBlocks,
        uint32 _roundDurationSec,
        address _staker
    ) {
        require(_ticketPriceMON > 0, "bad price");
        require(_commitDelayBlocks >= 1 && _commitDelayBlocks <= 5000, "bad delay");
        require(_roundDurationSec >= 60 && _roundDurationSec <= 30 days, "bad duration");
        require(_staker != address(0), "bad staker");

        ticketPriceMON = _ticketPriceMON;
        commitDelayBlocks = _commitDelayBlocks;
        roundDurationSec = _roundDurationSec;
        staker = IShmonadStaker(_staker);

        // start round 1
        currentRoundId = 1;
        RoundData storage r = rounds[1];
        r.state = RoundState.Open;
        r.salesEndTime = uint64(block.timestamp + _roundDurationSec);
        r.prizeClaimed = false;
        r.settled = false;

        emit RoundStarted(1, r.salesEndTime);
    }

    // -------------------------
    // Buying (only current round)
    // -------------------------

    function buyTickets(uint32 ticketCount) external payable {
        uint256 rid = currentRoundId;
        RoundData storage r = rounds[rid];

        require(r.state == RoundState.Open, "round not open");
        require(block.timestamp < r.salesEndTime, "sales ended");
        require(ticketCount > 0, "zero tickets");

        uint256 cost = uint256(ticketCount) * uint256(ticketPriceMON);
        require(msg.value == cost, "wrong value");

        // account principal
        principalMON[rid][msg.sender] += cost;
        r.totalPrincipalMON += cost;

        // stake MON -> mint SHMON to this contract
        uint256 shmonMinted = staker.stake{value: cost}();
        require(shmonMinted > 0, "stake failed");
        r.totalShmonStaked += shmonMinted;

        // allocate tickets
        uint32 start = r.totalTickets;
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
    // Round progression (async)
    // -------------------------

    /// @notice Phase 1: commit a future blockhash for randomness and immediately start the next round.
    function commitDraw(uint256 rid) external {
        RoundData storage r = rounds[rid];
        require(r.state == RoundState.Open, "bad state");
        require(block.timestamp >= r.salesEndTime, "sales not ended");
        require(r.totalTickets > 0, "no tickets");

        r.targetBlockNumber = block.number + commitDelayBlocks;
        r.state = RoundState.Committed;

        emit DrawCommitted(rid, r.targetBlockNumber);

        // Start next round immediately (overlapping rounds)
        if (rid == currentRoundId) {
            _startNextRound();
        }
    }

    /// @notice Phase 2: after target block, draw 1 winner and request unstake (delayed).
    function drawWinner(uint256 rid) external {
        RoundData storage r = rounds[rid];
        require(r.state == RoundState.Committed, "bad state");
        require(block.number > r.targetBlockNumber, "too early");
        require(block.number <= r.targetBlockNumber + 255, "blockhash expired");

        bytes32 bh = blockhash(r.targetBlockNumber);
        require(bh != bytes32(0), "no blockhash");

        // deterministic randomness (minimal v1)
        bytes32 rnd = keccak256(abi.encodePacked(bh, rid));
        uint32 winTicket = uint32(uint256(rnd) % uint256(r.totalTickets));
        address w = _ownerOfTicket(r, winTicket);

        r.winner = w;
        r.winningTicket = winTicket;

        emit WinnerDrawn(rid, w, winTicket);

        // request unstake for ALL shmon belonging to this round
        uint256 reqId = staker.requestUnstake(r.totalShmonStaked);
        r.unstakeRequestId = reqId;
        r.state = RoundState.Finalizing;

        emit UnstakeRequested(rid, reqId, r.totalShmonStaked);
    }

    /// @notice Phase 3: after unstake is ready, claim MON, compute yield/loss, enable claims.
    function settleRound(uint256 rid) external {
        RoundData storage r = rounds[rid];
        require(r.state == RoundState.Finalizing, "bad state");
        require(staker.isUnstakeReady(r.unstakeRequestId), "unstake not ready");

        uint256 monReceived = staker.claimUnstake(r.unstakeRequestId, address(this));
        r.monReceived = monReceived;

        uint256 principal = r.totalPrincipalMON;

        uint256 yieldMON;
        uint256 lossRatio = 1e18;

        if (monReceived >= principal) {
            yieldMON = monReceived - principal;
        } else {
            // proportional loss on principal
            yieldMON = 0;
            lossRatio = (principal == 0) ? 1e18 : (monReceived * 1e18) / principal;
        }

        r.yieldMON = yieldMON;
        r.lossRatio = lossRatio;

        r.state = RoundState.Settled;
        r.settled = true;

        emit RoundSettled(rid, monReceived, yieldMON, lossRatio);
    }

    // -------------------------
    // Claims (after settle)
    // -------------------------

    function claimPrize(uint256 rid) external {
        RoundData storage r = rounds[rid];
        require(r.state == RoundState.Settled, "not settled");
        require(r.settled, "not settled");
        require(!r.prizeClaimed, "prize claimed");
        require(msg.sender == r.winner, "not winner");

        r.prizeClaimed = true;
        uint256 amt = r.yieldMON;
        r.yieldMON = 0;

        if (amt > 0) {
            (bool ok,) = msg.sender.call{value: amt}("");
            require(ok, "transfer failed");
        }

        emit PrizeClaimed(rid, msg.sender, amt);
    }

    function withdrawPrincipal(uint256 rid) external {
        RoundData storage r = rounds[rid];
        require(r.state == RoundState.Settled, "not settled");
        require(r.settled, "not settled");

        uint256 amt = principalMON[rid][msg.sender];
        require(amt > 0, "nothing");

        principalMON[rid][msg.sender] = 0;

        // apply loss ratio if any
        if (r.lossRatio < 1e18) {
            amt = (amt * r.lossRatio) / 1e18;
        }

        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok, "transfer failed");

        emit PrincipalWithdrawn(rid, msg.sender, amt);
    }

    // -------------------------
    // Views
    // -------------------------

    function getRoundState(uint256 rid) external view returns (RoundState) {
        return rounds[rid].state;
    }

    // NOTE: This returns BOTH flags at the end: prizeClaimed, settled.
    function getRoundInfo(uint256 rid) external view returns (
        RoundState state,
        uint64 salesEndTime,
        uint32 totalTickets,
        uint256 totalPrincipalMON,
        uint256 totalShmonStaked,
        uint256 targetBlockNumber,
        address winner,
        uint32 winningTicket,
        uint256 monReceived,
        uint256 yieldMON,
        uint256 lossRatio,
        bool prizeClaimed,
        bool settled
    ) {
        RoundData storage r = rounds[rid];
        return (
            r.state,
            r.salesEndTime,
            r.totalTickets,
            r.totalPrincipalMON,
            r.totalShmonStaked,
            r.targetBlockNumber,
            r.winner,
            r.winningTicket,
            r.monReceived,
            r.yieldMON,
            r.lossRatio,
            r.prizeClaimed,
            r.settled
        );
    }

    function rangesLength(uint256 rid) external view returns (uint256) {
        return rounds[rid].ranges.length;
    }

    function rangeAt(uint256 rid, uint256 idx) external view returns (uint32 start, uint32 end, address buyer) {
        Range memory rr = rounds[rid].ranges[idx];
        return (rr.start, rr.end, rr.buyer);
    }

    function ownerOfTicket(uint256 rid, uint32 ticketId) external view returns (address) {
        RoundData storage r = rounds[rid];
        return _ownerOfTicket(r, ticketId);
    }

    // -------------------------
    // Internals
    // -------------------------

    function _startNextRound() internal {
        currentRoundId += 1;
        RoundData storage r = rounds[currentRoundId];
        r.state = RoundState.Open;
        r.salesEndTime = uint64(block.timestamp + roundDurationSec);
        r.prizeClaimed = false;
        r.settled = false;

        emit RoundStarted(currentRoundId, r.salesEndTime);
    }

    function _ownerOfTicket(RoundData storage r, uint32 ticketId) internal view returns (address) {
        require(ticketId < r.totalTickets, "ticket OOB");

        uint256 n = r.ranges.length;
        require(n > 0, "no ranges");

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

        revert("owner not found");
    }

    receive() external payable {}
}
