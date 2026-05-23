# Smart Contract

`TicketPrizePoolShmonV2` is the V2 prize vault contract. Two instances run in parallel on offset weekly anchors.

## Deployed contracts

| Vault | Network | Address | Anchor |
|---|---|---|---|
| Vault A | Monad Mainnet | `0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888` | Wed 13:00 UTC |
| Vault B | Monad Mainnet | `0x1B20BAa2D3992834E1E75cf75e3cD7b6AAA38096` | Sun 13:42 UTC |
| Vault B | Monad Mainnet | (deployed Sun 2026-05-10, address to be added post-deploy) | Sun 01:00 UTC |

Both verified on [MonadVision](https://monadexplorer.com). Source, ABI, and constructor arguments are public.

---

## Constructor

```solidity
constructor(
    address _shmon,
    uint96  _ticketPriceMON,
    uint32  _roundDurationSec,
    uint32  _yieldPeriodSec,
    address _owner
)
```

| Parameter | Description |
|---|---|
| `_shmon` | shMON contract address |
| `_ticketPriceMON` | Price per ticket, in wei (1e18 = 1 MON) |
| `_roundDurationSec` | Length of the deposit window in seconds (`86400` for 24 hours) |
| `_yieldPeriodSec` | Length of the lock period in seconds (`518100` for 6 days minus 5 minutes) |
| `_owner` | Contract owner. Can pause and set ticket price. Cannot move user funds. |

`TARGET_BLOCK_DELAY = 3` is a constant (number of blocks between commit and settle).

---

## Round states

| Value | State | Meaning |
|---|---|---|
| 0 | Open | Deposit window active |
| 1 | Committed | Deposit window closed, target block locked, awaiting settle |
| 2 | Settled | Winner drawn, claim and withdraw available |
| 3 | Skipped | Round closed with zero tickets sold |
| 4 | Failed | Target block hash unavailable (more than 255 blocks late). Principal returns to all depositors, no prize |

---

## Read functions

```solidity
function currentRoundId() external view returns (uint256);

function getRoundInfo(uint256 rid) external view returns (
    uint8   state,
    uint64  salesEndTime,
    uint64  targetBlockNumber,
    uint32  totalTickets,
    uint256 totalPrincipalMON,
    uint256 totalShmonShares,
    uint256 principalSharesAtSettle,
    uint256 prizeShares,
    uint256 shareRateAtSettle,
    address winner,
    uint32  winningTicket,
    bool    prizeClaimed
);

function getUserPosition(uint256 rid, address user)
    external view returns (uint128 principalMON, uint128 principalShmonShares);

function getWithdrawableShares(uint256 rid, address user)
    external view returns (uint256);

function getCommitAfterTime(uint256 rid)
    external view returns (uint64);

// Returns the next pending action. Action: 0 None, 1 Commit, 2 Settle, 3 MarkFailed.
function nextExecutable() external view returns (uint256 rid, uint8 action);
```

---

## Write functions

```solidity
// Pay with MON. msg.value must equal ticketPriceMON * ticketCount.
function buyTicketsMON(uint32 ticketCount) external payable;

// Pay with shMON. Caller must have approved sharesOwed = previewWithdraw(cost) + 1.
function buyTicketsShmon(uint32 ticketCount) external;

// Lifecycle. Both public, anyone can call.
function commit(uint256 rid) external;
function settle(uint256 rid) external;

// Post settle.
function withdrawPrincipal(uint256 rid) external;
function claimPrize(uint256 rid) external;
```

---

## Events

```solidity
event RoundStarted(uint256 indexed roundId, uint64 salesEndTime);

event TicketsPurchased(
    uint256 indexed roundId,
    address indexed buyer,
    uint32  ticketCount,
    uint256 costMON,
    uint256 sharesDeposited,
    uint256 shareRateAtDeposit,
    uint8   depositAsset       // 0 MON, 1 shMON
);

event RoundCommitted(uint256 indexed roundId, uint64 targetBlockNumber);

event RoundSettled(
    uint256 indexed roundId,
    address indexed winner,
    uint32  winningTicket,
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
```

---

## Merkl readable position surface

The contract exposes ERC20 style read views and events so Merkl's generic vault indexer can track active positions and award shMonad points. The position is **non transferable**. There is no `transfer`, `approve`, or `allowance`.

```solidity
function name()      external view returns (string memory);   // "EverDraw shMON Position"
function symbol()    external view returns (string memory);   // "EVRDRAW-SHMON"
function decimals()  external view returns (uint8);           // 18

function balanceOf(address user) external view returns (uint256);  // active MON principal across rounds
function totalSupply()           external view returns (uint256);  // sum across all users

event Deposit(address indexed recipient, uint256 amount);   // emitted on every ticket purchase
event Withdraw(address indexed recipient, uint256 amount);  // emitted on every withdrawPrincipal
```

`balanceOf` is denominated in MON wei (1 MON = 1e18). It reflects the user's currently active EverDraw principal summed across all open and locked rounds in this vault. It does not include settled rounds the user has not yet withdrawn from (those drop on `withdrawPrincipal`).

---

## Owner surface

```solidity
function pause()              external;  // owner only
function unpause()            external;  // owner only
function transferOwnership(address newOwner) external;  // two step
function acceptOwnership()    external;
function setTicketPrice(uint96 newPrice) external;      // owner only, only between rounds
```

The owner cannot access user funds, override draws, or modify per round parameters.
