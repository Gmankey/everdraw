# Smart Contract

## Deployed contract

| Network | Address |
|---|---|
| Monad Mainnet | `0x[MAINNET ADDRESS]` |

The contract is fully verified on [MonadVision](https://monadexplorer.com). Source code, ABI, and constructor arguments are publicly readable.

---

## Constructor parameters

```solidity
constructor(
 uint96 _ticketPriceMON,
 uint32 _commitDelayBlocks,
 uint32 _roundDurationSec,
 address _shmon
)
```

| Parameter | Description |
|---|---|
| `_ticketPriceMON` | Price per ticket in MON (wei) |
| `_commitDelayBlocks` | Blocks between commitment and draw |
| `_roundDurationSec` | Duration of the sales window in seconds |
| `_shmon` | ShMON contract address |

---

## Key read functions

```solidity
// Current round ID
function currentRoundId() external view returns (uint256)

// Full round data
function getRoundInfo(uint256 rid) external view returns (
 uint8 state, // 0=Open 1=Committed 2=Finalizing 3=Settled
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
)

// What the keeper should do next — and what anyone can call
function nextExecutable() external view returns (uint256 rid, uint8 action)

// Advance the round lifecycle (public — anyone can call)
function executeNext() external

// User's principal in a given round
function principalMON(uint256 rid, address user) external view returns (uint256)
```

---

## Key write functions

```solidity
// Purchase tickets (payable — send MON equal to ticketPriceMON * ticketCount)
function buyTickets(uint32 ticketCount) external payable

// Claim prize (winner only)
function claimPrize(uint256 rid) external

// Withdraw principal (all participants after settlement)
function withdrawPrincipal(uint256 rid) external
```

---

## Events

```solidity
event TicketsBought(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 monPaid)
event DrawCommitted(uint256 indexed roundId, uint256 targetBlockNumber)
event ExecuteNext(uint256 indexed roundId, NextAction action)
event Paused(address indexed by)
event Unpaused(address indexed by)
event OwnershipTransferred(address indexed newOwner)
```

---

## Round states

| Value | State | Description |
|---|---|---|
| 0 | Open | Sales window active |
| 1 | Committed | Randomness source locked, waiting for target block |
| 2 | Finalizing | Winner drawn, ShMON unstaking in progress |
| 3 | Settled | Funds available for claim/withdraw |
