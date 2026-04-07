// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

interface IStaker {
    function stake() external payable;
    function unstake(uint256 amount, address to) external;
    function totalUnderlying() external view returns (uint256);
}

/// @notice Multi-round ticket pool with staking + commit–reveal randomness.
/// Hybrid gas/storage approach:
/// - Stores ticket ownership as a global array of ranges for O(log N) owner lookup.
/// - Merges consecutive buys by the same buyer into the last range to reduce storage bloat.
///
/// Mechanics:
/// - Users buy tickets with native token.
/// - Principal is staked immediately via staker.
/// - Commit–reveal seeds can be submitted during the round.
/// - Final randomness = keccak256(blockhash(targetBlock), entropyMix, roundId).
/// - At finalize: unstakes ALL principal + yield back into itself.
/// - Yield is prize for that round; users can withdraw principal later anytime.
/// - Next round can start immediately after finalize.
contract TicketPrizePool {
    enum State { Open, Committed, Finalized }

    struct Range {
        uint32 start; // inclusive
        uint32 end;   // exclusive
        address buyer;
    }

    // ---- Config ----
    uint96 public immutable ticketPriceWei;
    uint32 public immutable commitDelayBlocks;
    IStaker public immutable staker;

    // ---- Current round ----
    uint256 public roundId;
    State public state;
    uint64 public salesEndTime;

    uint32 public totalTickets;
    uint256 public targetBlockNumber;

    // Global ownership ranges for current round
    Range[] public ranges;

    // ---- Per-round results & balances ----
    mapping(uint256 => bool) public roundFinalized;
    mapping(uint256 => address) public roundWinner;
    mapping(uint256 => uint32) public roundWinningTicket;
    mapping(uint256 => uint256) public roundPrize;             // yield for that round (in native)
    mapping(uint256 => bool) public roundPrizeClaimed;

    // principal contributed by each user in a given round
    mapping(uint256 => mapping(address => uint256)) public principalOf;

    // total principal for each round
    mapping(uint256 => uint256) public roundPrincipal;

    // ---- Commit–reveal randomness ----
    // commit = keccak256(seed, msg.sender, roundId)
    mapping(uint256 => mapping(address => bytes32)) public seedCommit;
    mapping(uint256 => mapping(address => bool)) public seedRevealed;

    // XOR accumulator of keccak256(seed, revealer, roundId) for revealed seeds in current round
    bytes32 public currentEntropyMix;

    // snapshot entropy per round
    mapping(uint256 => bytes32) public roundEntropyMix;

    // ---- Events ----
    event RoundStarted(uint256 indexed roundId, uint64 salesEndTime);

    event TicketsBought(
        uint256 indexed roundId,
        address indexed buyer,
        uint32 ticketCount,
        uint32 startTicket,
        uint32 endTicket,
        uint256 paid
    );

    event SeedCommitted(uint256 indexed roundId, address indexed user, bytes32 commitHash);
    event SeedRevealed(uint256 indexed roundId, address indexed user, bytes32 seed, bytes32 contribution);

    event DrawCommitted(uint256 indexed roundId, uint256 targetBlockNumber);

    event DrawFinalized(
        uint256 indexed roundId,
        uint32 winningTicket,
        address indexed winner,
        bytes32 blockHash,
        bytes32 entropyMix,
        bytes32 finalRandomness,
        uint256 principal,
        uint256 yield
    );

    event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 amount);
    event PrincipalWithdrawn(uint256 indexed roundId, address indexed user, uint256 amount);

    constructor(
        uint64 _salesEndTime,
        uint96 _ticketPriceWei,
        uint32 _commitDelayBlocks,
        address _staker
    ) {
        require(_ticketPriceWei > 0, "bad price");
        require(_commitDelayBlocks >= 1 && _commitDelayBlocks <= 200, "bad delay");
        require(_staker != address(0), "bad staker");
        require(_salesEndTime > block.timestamp, "end in past");

        ticketPriceWei = _ticketPriceWei;
        commitDelayBlocks = _commitDelayBlocks;
        staker = IStaker(_staker);

        roundId = 1;
        salesEndTime = _salesEndTime;
        state = State.Open;

        emit RoundStarted(roundId, salesEndTime);
    }

    // -------------------------
    // Round control
    // -------------------------

    function startNewRound(uint64 newSalesEndTime) external {
        require(state == State.Finalized, "current not finalized");
        require(newSalesEndTime > block.timestamp, "end in past");

        roundId += 1;
        salesEndTime = newSalesEndTime;
        state = State.Open;

        totalTickets = 0;
        targetBlockNumber = 0;

        currentEntropyMix = bytes32(0);
        delete ranges;

        emit RoundStarted(roundId, salesEndTime);
    }

    // -------------------------
    // Commit–reveal
    // -------------------------

    /// commitHash must be keccak256(abi.encodePacked(seed, msg.sender, roundId))
    function commitSeed(bytes32 commitHash) external {
        require(state == State.Open, "not open");
        require(block.timestamp < salesEndTime, "sales ended");
        require(commitHash != bytes32(0), "zero commit");
        require(seedCommit[roundId][msg.sender] == bytes32(0), "already committed");

        seedCommit[roundId][msg.sender] = commitHash;
        emit SeedCommitted(roundId, msg.sender, commitHash);
    }

    function revealSeed(bytes32 seed) external {
        require(state == State.Open || state == State.Committed, "reveal closed");
        bytes32 commitHash = seedCommit[roundId][msg.sender];
        require(commitHash != bytes32(0), "no commit");
        require(!seedRevealed[roundId][msg.sender], "already revealed");

        bytes32 expected = keccak256(abi.encodePacked(seed, msg.sender, roundId));
        require(expected == commitHash, "bad seed");

        seedRevealed[roundId][msg.sender] = true;

        bytes32 contribution = keccak256(abi.encodePacked(seed, msg.sender, roundId));
        currentEntropyMix = currentEntropyMix ^ contribution;

        emit SeedRevealed(roundId, msg.sender, seed, contribution);
    }

    // -------------------------
    // Buy tickets (hybrid storage)
    // -------------------------

    function buyTickets(uint32 ticketCount) external payable {
        require(state == State.Open, "not open");
        require(block.timestamp < salesEndTime, "sales ended");
        require(ticketCount > 0, "zero tickets");

        uint256 cost = uint256(ticketCount) * uint256(ticketPriceWei);
        require(msg.value == cost, "wrong value");

        // accounting
        principalOf[roundId][msg.sender] += cost;
        roundPrincipal[roundId] += cost;

        // stake immediately
        staker.stake{value: cost}();

        // ticket range for this purchase
        uint32 start = totalTickets;
        uint32 end = start + ticketCount;
        totalTickets = end;

        // merge into last global range if contiguous and same buyer
        uint256 n = ranges.length;
        if (n > 0) {
            Range storage last = ranges[n - 1];
            if (last.buyer == msg.sender && last.end == start) {
                last.end = end;
                emit TicketsBought(roundId, msg.sender, ticketCount, start, end, cost);
                return;
            }
        }

        ranges.push(Range({ start: start, end: end, buyer: msg.sender }));
        emit TicketsBought(roundId, msg.sender, ticketCount, start, end, cost);
    }

    // -------------------------
    // Commit / finalize draw
    // -------------------------

    function commitDraw() external {
        require(state == State.Open, "bad state");
        require(block.timestamp >= salesEndTime, "sales not ended");
        require(totalTickets > 0, "no tickets");

        targetBlockNumber = block.number + commitDelayBlocks;
        state = State.Committed;

        emit DrawCommitted(roundId, targetBlockNumber);
    }

    function finalizeDraw() external {
        require(state == State.Committed, "bad state");
        require(block.number > targetBlockNumber, "too early");
        require(block.number <= targetBlockNumber + 255, "blockhash expired");

        bytes32 bh = blockhash(targetBlockNumber);
        require(bh != bytes32(0), "no blockhash");

        bytes32 mix = currentEntropyMix;
        roundEntropyMix[roundId] = mix;

        bytes32 rnd = keccak256(abi.encodePacked(bh, mix, roundId));

        uint32 win = uint32(uint256(rnd) % uint256(totalTickets));
        address w = ownerOfTicket(win);

        uint256 principal = roundPrincipal[roundId];
        uint256 underlyingNow = staker.totalUnderlying();
        require(underlyingNow >= principal, "staker insolvent");

        uint256 yield = underlyingNow - principal;

        // Unstake ALL (principal + yield) back into this contract so refunds are always payable
        staker.unstake(principal + yield, address(this));

        // record results
        roundFinalized[roundId] = true;
        roundWinner[roundId] = w;
        roundWinningTicket[roundId] = win;
        roundPrize[roundId] = yield;

        state = State.Finalized;

        emit DrawFinalized(roundId, win, w, bh, mix, rnd, principal, yield);
    }

    // -------------------------
    // Claims
    // -------------------------

    function claimPrize(uint256 rid) external {
        require(roundFinalized[rid], "round not finalized");
        require(!roundPrizeClaimed[rid], "prize claimed");
        require(msg.sender == roundWinner[rid], "not winner");

        roundPrizeClaimed[rid] = true;
        uint256 amt = roundPrize[rid];
        roundPrize[rid] = 0;

        if (amt > 0) {
            (bool ok, ) = msg.sender.call{value: amt}("");
            require(ok, "transfer failed");
        }

        emit PrizeClaimed(rid, msg.sender, amt);
    }

    function withdrawPrincipal(uint256 rid) external {
        require(roundFinalized[rid], "round not finalized");
        uint256 amt = principalOf[rid][msg.sender];
        require(amt > 0, "nothing");

        principalOf[rid][msg.sender] = 0;

        (bool ok, ) = msg.sender.call{value: amt}("");
        require(ok, "transfer failed");

        emit PrincipalWithdrawn(rid, msg.sender, amt);
    }

    // -------------------------
    // Ownership lookup (O(log ranges))
    // -------------------------

    function rangesLength() external view returns (uint256) {
        return ranges.length;
    }

    function ownerOfTicket(uint32 ticketId) public view returns (address) {
        require(ticketId < totalTickets, "ticket OOB");
        uint256 n = ranges.length;
        require(n > 0, "no ranges");

        uint256 lo = 0;
        uint256 hi = n - 1;

        while (lo <= hi) {
            uint256 mid = (lo + hi) / 2;
            Range memory r = ranges[mid];

            if (ticketId < r.start) {
                if (mid == 0) break;
                hi = mid - 1;
            } else if (ticketId >= r.end) {
                lo = mid + 1;
            } else {
                return r.buyer;
            }
        }
        revert("owner not found");
    }

    receive() external payable {}
}
