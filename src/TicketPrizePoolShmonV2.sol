// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

interface IShMonadV2 {
    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares);
    function previewDeposit(uint256 assets) external view returns (uint256 shares);
    function previewWithdraw(uint256 assets) external view returns (uint256 shares);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 shares) external returns (bool);
    function transferFrom(address from, address to, uint256 shares) external returns (bool);
    function approve(address spender, uint256 shares) external returns (bool);
}

contract TicketPrizePoolShmonV2 {
    enum RoundState { Open, Committed, Settled, Skipped, Failed }
    enum NextAction { None, Commit, Settle, MarkFailed }

    struct TicketRange {
        address buyer;
        uint32 startInclusive;
        uint32 endExclusive;
    }

    struct RoundData {
        RoundState state;
        uint64 salesEndTime;
        uint64 targetBlockNumber;
        uint32 totalTickets;
        uint256 totalPrincipalMON;
        uint256 totalShmonShares;
        uint256 principalSharesAtSettle;
        uint256 prizeShares;
        uint256 shareRateAtSettle;
        address winner;
        uint32 winningTicket;
        bool prizeClaimed;
        TicketRange[] ranges;
    }

    struct UserPosition {
        uint128 principalMON;
        uint128 principalShmonShares;
    }

    error BadState();
    error BadConfig();
    error SalesEnded();
    error SalesNotEnded();
    error ZeroTickets();
    error ZeroShares();
    error WrongValue();
    error ZeroSharesMinted();
    error TransferFailed();
    error NotWinner();
    error AlreadyClaimed();
    error NoPrize();
    error NothingToWithdraw();
    error TooEarly();
    error NoBlockhash();
    error BlockhashExpired();
    error NotOwner();
    error EnforcedPause();
    error Reentrant();

    // ERC-20-readable position accounting for Merkl indexing.
    // NOT a transferable token. No transfer/approve methods exist by design.
    string public constant name = "EverDraw shMON Position";
    string public constant symbol = "EVRDRAW-SHMON";
    uint8 public constant decimals = 18;

    event RoundStarted(uint256 indexed roundId, uint64 salesEndTime);
    event Deposit(address indexed recipient, uint256 amount);
    event Withdraw(address indexed recipient, uint256 amount);
    event TicketsPurchased(
        uint256 indexed roundId,
        address indexed buyer,
        uint32 ticketCount,
        uint256 costMON,
        uint256 sharesDeposited,
        uint256 shareRateAtDeposit,
        uint8 depositAsset
    );
    event RoundCommitted(uint256 indexed roundId, uint64 targetBlockNumber);
    event RoundSettled(
        uint256 indexed roundId,
        address indexed winner,
        uint32 winningTicket,
        uint256 totalPrincipalMON,
        uint256 totalShmonShares,
        uint256 principalShares,
        uint256 prizeShares,
        uint256 shareRateAtSettle
    );
    event RoundSkipped(uint256 indexed roundId);
    event RoundFailed(uint256 indexed roundId);
    event PrincipalWithdrawn(
        uint256 indexed roundId,
        address indexed user,
        uint256 sharesReturned,
        uint256 shareRateAtWithdraw
    );
    event PrizeClaimed(
        uint256 indexed roundId,
        address indexed winner,
        uint256 prizeShares,
        uint256 shareRateAtClaim
    );
    event OwnerTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused();
    event Unpaused();
    event TicketPriceUpdated(uint96 oldPrice, uint96 newPrice);

    mapping(uint256 => RoundData) public rounds;
    mapping(uint256 => mapping(address => UserPosition)) public positions;
    mapping(uint256 => mapping(address => uint256)) public principalMON;
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    uint256 public currentRoundId;
    IShMonadV2 public immutable shmon;
    uint96 public ticketPriceMON;
    uint32 public immutable roundDurationSec;
    uint32 public immutable yieldPeriodSec;
    uint32 public constant TARGET_BLOCK_DELAY = 3;

    address public owner;
    address public pendingOwner;
    bool public paused;
    uint8 private _locked;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert EnforcedPause();
        _;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrant();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(address _shmon, uint96 _ticketPriceMON, uint32 _roundDurationSec, uint32 _yieldPeriodSec, address _owner) {
        if (_shmon == address(0) || _owner == address(0) || _ticketPriceMON == 0 || _roundDurationSec < 60 || _roundDurationSec > 30 days) {
            revert BadConfig();
        }
        if (_yieldPeriodSec < 3600 || _yieldPeriodSec > 30 days) revert BadConfig();
        shmon = IShMonadV2(_shmon);
        ticketPriceMON = _ticketPriceMON;
        roundDurationSec = _roundDurationSec;
        yieldPeriodSec = _yieldPeriodSec;
        owner = _owner;
        _locked = 1;

        currentRoundId = 1;
        RoundData storage r = rounds[1];
        r.state = RoundState.Open;
        r.salesEndTime = uint64(block.timestamp + _roundDurationSec);
        emit RoundStarted(1, r.salesEndTime);
    }

    function buyTicketsMON(uint32 ticketCount) external payable whenNotPaused nonReentrant {
        uint256 rid = currentRoundId;
        RoundData storage r = rounds[rid];

        if (r.state != RoundState.Open) revert BadState();
        if (block.timestamp >= r.salesEndTime) revert SalesEnded();
        if (ticketCount == 0) revert ZeroTickets();

        uint256 cost = uint256(ticketCount) * uint256(ticketPriceMON);
        if (msg.value != cost) revert WrongValue();

        uint256 shares = shmon.deposit{value: cost}(cost, address(this));
        if (shares == 0) revert ZeroSharesMinted();

        _recordPosition(rid, msg.sender, ticketCount, cost, shares, 0);
    }

    function buyTicketsShmon(uint32 ticketCount) external whenNotPaused nonReentrant {
        uint256 rid = currentRoundId;
        RoundData storage r = rounds[rid];

        if (r.state != RoundState.Open) revert BadState();
        if (block.timestamp >= r.salesEndTime) revert SalesEnded();
        if (ticketCount == 0) revert ZeroTickets();

        uint256 cost = uint256(ticketCount) * uint256(ticketPriceMON);
        uint256 sharesOwed = shmon.previewWithdraw(cost) + 1;
        if (sharesOwed == 0) revert ZeroShares();

        bool ok = shmon.transferFrom(msg.sender, address(this), sharesOwed);
        if (!ok) revert TransferFailed();

        _recordPosition(rid, msg.sender, ticketCount, cost, sharesOwed, 1);
    }

    function _recordPosition(
        uint256 rid,
        address user,
        uint32 ticketCount,
        uint256 costMON,
        uint256 shares,
        uint8 depositAsset
    ) internal {
        RoundData storage r = rounds[rid];
        UserPosition storage p = positions[rid][user];

        p.principalMON += uint128(costMON);
        p.principalShmonShares += uint128(shares);
        principalMON[rid][user] = p.principalMON;
        balanceOf[user] += costMON;
        totalSupply += costMON;

        r.totalPrincipalMON += costMON;
        r.totalShmonShares += shares;

        uint32 start = r.totalTickets;
        require(uint256(start) + uint256(ticketCount) <= type(uint32).max, 'overflow');
        uint32 end = start + ticketCount;
        r.totalTickets = end;

        _mergeOrAppendRange(r, user, start, end);

        emit Deposit(user, costMON);
        emit TicketsPurchased(
            rid,
            user,
            ticketCount,
            costMON,
            shares,
            shmon.convertToAssets(1e18),
            depositAsset
        );
    }

    function _mergeOrAppendRange(RoundData storage r, address user, uint32 start, uint32 end) internal {
        uint256 n = r.ranges.length;
        if (n > 0) {
            TicketRange storage last = r.ranges[n - 1];
            if (last.buyer == user && last.endExclusive == start) {
                last.endExclusive = end;
                return;
            }
        }
        r.ranges.push(TicketRange({ buyer: user, startInclusive: start, endExclusive: end }));
    }

    function commit(uint256 rid) external nonReentrant {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Open) revert BadState();
        if (block.timestamp < uint256(r.salesEndTime) + uint256(yieldPeriodSec)) revert SalesNotEnded();

        if (r.totalTickets == 0) {
            r.state = RoundState.Skipped;
            emit RoundSkipped(rid);
            if (rid == currentRoundId) _startNextRound();
            return;
        }

        r.state = RoundState.Committed;
        r.targetBlockNumber = uint64(block.number + TARGET_BLOCK_DELAY);
        emit RoundCommitted(rid, r.targetBlockNumber);
        if (rid == currentRoundId) _startNextRound();
    }

    function settle(uint256 rid) external nonReentrant {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Committed) revert BadState();
        if (block.number <= r.targetBlockNumber) revert TooEarly();

        if (block.number > uint256(r.targetBlockNumber) + 255) {
            r.state = RoundState.Failed;
            emit RoundFailed(rid);
            if (rid == currentRoundId) _startNextRound();
            return;
        }

        bytes32 bh = blockhash(r.targetBlockNumber);
        if (bh == bytes32(0)) revert NoBlockhash();

        uint32 winningTicket = uint32(uint256(bh) % r.totalTickets);
        address winner = _resolveTicketOwner(r, winningTicket);

        uint256 principalShares = shmon.previewDeposit(r.totalPrincipalMON);
        uint256 prizeShares = r.totalShmonShares > principalShares ? r.totalShmonShares - principalShares : 0;
        uint256 rateAtSettle = shmon.convertToAssets(1e18);

        r.winningTicket = winningTicket;
        r.winner = winner;
        r.principalSharesAtSettle = principalShares;
        r.prizeShares = prizeShares;
        r.shareRateAtSettle = rateAtSettle;
        r.state = RoundState.Settled;

        emit RoundSettled(
            rid,
            winner,
            winningTicket,
            r.totalPrincipalMON,
            r.totalShmonShares,
            principalShares,
            prizeShares,
            rateAtSettle
        );

        if (rid == currentRoundId) _startNextRound();
    }

    function _resolveTicketOwner(RoundData storage r, uint32 ticket) internal view returns (address) {
        uint256 n = r.ranges.length;
        for (uint256 i = 0; i < n; i++) {
            TicketRange storage rg = r.ranges[i];
            if (ticket >= rg.startInclusive && ticket < rg.endExclusive) {
                return rg.buyer;
            }
        }
        revert('ticket not found');
    }

    function _startNextRound() internal {
        uint256 nextId = currentRoundId + 1;
        currentRoundId = nextId;
        RoundData storage r = rounds[nextId];
        r.state = RoundState.Open;
        r.salesEndTime = uint64(block.timestamp + roundDurationSec);
        emit RoundStarted(nextId, r.salesEndTime);
    }

    function withdrawPrincipal(uint256 rid) external nonReentrant {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Settled && r.state != RoundState.Skipped && r.state != RoundState.Failed) {
            revert BadState();
        }

        UserPosition storage p = positions[rid][msg.sender];
        uint256 originalShares = p.principalShmonShares;
        if (originalShares == 0) revert NothingToWithdraw();

        uint256 shares;
        if (r.state == RoundState.Settled && r.prizeShares > 0) {
            shares = r.principalSharesAtSettle * uint256(p.principalMON) / r.totalPrincipalMON;
        } else {
            shares = originalShares;
        }

        uint256 principalMONAmount = p.principalMON;
        p.principalMON = 0;
        p.principalShmonShares = 0;
        principalMON[rid][msg.sender] = 0;
        balanceOf[msg.sender] -= principalMONAmount;
        totalSupply -= principalMONAmount;

        bool ok = shmon.transfer(msg.sender, shares);
        if (!ok) revert TransferFailed();

        emit Withdraw(msg.sender, principalMONAmount);
        emit PrincipalWithdrawn(rid, msg.sender, shares, shmon.convertToAssets(1e18));
    }

    function claimPrize(uint256 rid) external nonReentrant {
        RoundData storage r = rounds[rid];
        if (r.state != RoundState.Settled) revert BadState();
        if (msg.sender != r.winner) revert NotWinner();
        if (r.prizeClaimed) revert AlreadyClaimed();
        if (r.prizeShares == 0) revert NoPrize();

        r.prizeClaimed = true;
        bool ok = shmon.transfer(msg.sender, r.prizeShares);
        if (!ok) revert TransferFailed();

        emit PrizeClaimed(rid, msg.sender, r.prizeShares, shmon.convertToAssets(1e18));
    }

    function nextExecutable() external view returns (uint256 rid, NextAction action) {
        for (uint256 i = 1; i <= currentRoundId; i++) {
            RoundData storage r = rounds[i];
            if (r.state == RoundState.Open && block.timestamp >= uint256(r.salesEndTime) + uint256(yieldPeriodSec)) {
                return (i, NextAction.Commit);
            }
            if (r.state == RoundState.Committed) {
                if (block.number > uint256(r.targetBlockNumber) + 255) return (i, NextAction.MarkFailed);
                if (block.number > r.targetBlockNumber) return (i, NextAction.Settle);
            }
        }
        return (currentRoundId, NextAction.None);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused();
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnerTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnerTransferred(oldOwner, owner);
    }

    function setTicketPrice(uint96 newPrice) external onlyOwner {
        if (newPrice == 0) revert BadConfig();
        RoundData storage r = rounds[currentRoundId];
        if (r.state == RoundState.Open) {
            if (block.timestamp < r.salesEndTime) revert BadState();
            if (r.totalTickets > 0) revert BadState();
        }
        uint96 oldPrice = ticketPriceMON;
        ticketPriceMON = newPrice;
        emit TicketPriceUpdated(oldPrice, newPrice);
    }

    function getCommitAfterTime(uint256 rid) external view returns (uint64) {
        return rounds[rid].salesEndTime + uint64(yieldPeriodSec);
    }

    function getWithdrawableShares(uint256 rid, address user) external view returns (uint256) {
        RoundData storage r = rounds[rid];
        UserPosition storage p = positions[rid][user];
        if (p.principalShmonShares == 0) return 0;

        if (r.state == RoundState.Settled && r.prizeShares > 0) {
            return r.principalSharesAtSettle * uint256(p.principalMON) / r.totalPrincipalMON;
        }
        return p.principalShmonShares;
    }

    function getRoundInfo(uint256 rid) external view returns (
        uint8 state,
        uint64 salesEndTime,
        uint64 targetBlockNumber,
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
            uint8(r.state),
            r.salesEndTime,
            r.targetBlockNumber,
            r.totalTickets,
            r.totalPrincipalMON,
            r.totalShmonShares,
            r.principalSharesAtSettle,
            r.prizeShares,
            r.shareRateAtSettle,
            r.winner,
            r.winningTicket,
            r.prizeClaimed
        );
    }

    function getUserPosition(uint256 rid, address user) external view returns (uint128 principalMONOut, uint128 principalShmonSharesOut) {
        UserPosition storage p = positions[rid][user];
        return (p.principalMON, p.principalShmonShares);
    }
}
