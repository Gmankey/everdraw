# Smart Contract

EverDraw's current production contract is **`TicketPrizePoolV4`**. One instance is deployed per vault, and the protocol runs more than one vault on staggered schedules. V4 supports native or ERC-20 deposits, single or multi-winner rounds, sponsor-funded prizes, a multi-recipient protocol-fee router, and verifiable randomness via a pluggable oracle (Pyth Entropy in production).

The trust model is documented in the project's [ADRs](https://github.com/Gmankey/everdraw/tree/staging/decisions); the V4 design spec is ADR-0024 through ADR-0029, and the internal security review is in [`security_audit/`](https://github.com/Gmankey/everdraw/tree/staging/security_audit).

---

## Canonical mainnet deployments

**The authoritative, always-current list of deployed addresses** — with runtime bytecode hashes, constructor arguments, deploy txs, and verification status — lives in the deployment manifest:

→ [`deployments/monad-mainnet.json`](https://github.com/Gmankey/everdraw/blob/staging/deployments/monad-mainnet.json)

Always verify that any transaction signed at [everdraw.xyz](https://everdraw.xyz) targets a contract listed there. Addresses change across protocol generations, so the manifest — not this page — is the source of truth. Every active contract is verified on the [Monad explorer](https://monadexplorer.com) (Sourcify full match); confirm by matching `cast code <address>` against the manifest's bytecode hash.

---

## Constructor

V4 takes a single `V4Config` struct:

```solidity
struct V4Config {
    DepositMode depositMode;          // 0 = Native (MON), 1 = ERC20
    address     asset;                // address(0) for native; ERC-20 token otherwise
    address     yieldVault;           // ERC-4626 yield vault (shMON in production)
    uint256     ticketPriceAsset;     // price per ticket in asset units (1e18 = 1 MON)
    uint32      roundDurationSec;     // deposit window length
    uint32      yieldPeriodSec;       // lock / yield period length
    uint8       numWinners;           // 1..32
    uint16[]    winnerAllocationBps;  // length == numWinners, sums to 10000
    address     randomnessOracle;     // IRandomnessOracle (Pyth adapter in production)
    bytes       randomnessOracleInitData;
    string      vaultSymbol;          // e.g. "EVRDRAW-A"
}

constructor(V4Config memory cfg);
```

`depositMode`, `asset`, `yieldVault`, `decimals`, `numWinners`, and `winnerAllocationBps` are immutable. `owner` and `pauser` are set to `msg.sender` at construction; the deployer is added as an initial keeper. Round 1 opens in the constructor.

---

## Round states

| Value | State | Meaning |
|---|---|---|
| 0 | Open | Deposit window active |
| 1 | AwaitingVRF | Deposit window + lock closed, randomness requested, awaiting callback |
| 2 | Drawn | Randomness received, awaiting finalize |
| 3 | Settled | Winner(s) selected, prize and principal claimable |

A round with zero tickets at deposit-window close is **skipped** directly to Settled (`RoundSkipped`). If a randomness callback doesn't arrive within `VRF_CALLBACK_TIMEOUT` (1 hour), the owner can `emergencyForceSettle(rid)` — the round Settles with no winner, depositors recover full principal, and sponsors can refund.

---

## Read functions

```solidity
function VERSION() external view returns (string memory);        // "4.0.0"
function currentRoundId() external view returns (uint256);
function ticketPriceAsset() external view returns (uint256);     // mutable per-vault price
function numWinners() external view returns (uint8);
function winnerAllocationBps(uint8 index) external view returns (uint16);
function depositMode() external view returns (uint8);            // 0 Native, 1 ERC20
function asset() external view returns (address);
function yieldVault() external view returns (address);
function paused() external view returns (bool);
function stoppedAt() external view returns (uint64);             // 0 = live, nonzero = stopped

function getRoundState(uint256 rid) external view returns (uint8);
function getRoundInfo(uint256 rid) external view returns (
    uint8   state,
    uint64  salesEndTime,
    uint64  requestId,                // randomness request id; 0 until committed
    uint32  totalTickets,
    uint256 totalPrincipalAsset,
    uint256 totalPrincipalShares,
    uint256 principalSharesAtSettle,
    uint256 totalPrizeShares,
    uint16  forfeitBps,
    bool    wasSkipped                // true for empty-skip AND VRF-timeout force-settle
);
function getRoundWinners(uint256 rid) external view returns (
    address[] memory winners,
    uint32[]  memory winningTickets,
    uint256[] memory prizeShares
);
function getUserPosition(uint256 rid, address user)
    external view returns (uint128 principalAsset, uint128 principalShares);
function getRoundFeeAllocation(uint256 rid, uint256 index) external view returns (address recipient, uint16 bps);
function getRoundFeeAllocationLength(uint256 rid) external view returns (uint256);
function getRoundMetadata(uint256 rid) external view returns (address campaign, bytes32 metadata);

// Lifecycle planner (used by the keeper). action: 0 None, 1 Skip, 2 Commit, 3 Finalize
function nextAction(uint256 rid) external view returns (uint8 action);
function nextExecutable() external view returns (uint256 rid, uint8 action);

// Randomness oracle surface
function randomnessOracle() external view returns (address);
function pendingOracle() external view returns (address);
function pendingOracleEffectiveAt() external view returns (uint64);

// Deferred-claim surface (see Transfer resilience below)
function pendingClaims(uint256 rid, address user, uint8 slot) external view returns (uint256);
function hasPendingClaims(address user) external view returns (bool);   // O(1)
function pendingClaimsTotal(uint256 rid, address user) external view returns (uint256);
```

> Note: V4's `getRoundInfo` shape differs from V3's. Winners are an **array** (a vault may pay multiple positions) — read them via `getRoundWinners`, not `getRoundInfo`.

---

## Write functions

```solidity
// Deposit. Native: msg.value must equal ticketCount × ticketPriceAtRoundOpen.
function buyTickets(uint32 ticketCount) external payable;

// Sponsor a round's prize pool (funds earn yield; refundable if the round is skipped).
function sponsor(uint256 rid, string calldata memo) external payable;        // native vaults
function sponsorERC20(uint256 rid, uint256 amount, string calldata memo) external payable;  // erc-20 vaults
function claimSponsorRefund(uint256 rid) external;

// Lifecycle — all permissionless (keeper authorized but not required).
function executeNext() external returns (uint256 rid, uint8 action);
function executeNext(uint256 rid) external returns (uint8 action);
function commitDraw(uint256 rid) external;
function skipRound(uint256 rid) external;
function finalizeDraw(uint256 rid) external;
function onRandomnessReceived(uint64 requestId, bytes32 randomNumber) external;  // oracle callback only

// Post-settle.
function claimPrize(uint256 rid) external;          // winner(s); drains all caller positions in one call
function withdrawPrincipal(uint256 rid) external;   // any depositor

// Deferred-claim retry (see Transfer resilience).
function claimDeferred(uint256 rid, uint8 slot) external;
function claimAllDeferred(uint256 rid, uint8[] calldata slots) external;
```

There is no `buyTicketsMON` / `buyTicketsShmon` in V4 — `buyTickets` is the single entry, with the deposit asset fixed by the vault's `depositMode`.

---

## Events

```solidity
event RoundStarted(uint256 indexed roundId, uint64 salesEndTime);
event TicketsBought(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 assetPaid);
event RoundSkipped(uint256 indexed roundId);

event RandomnessRequested(uint256 indexed roundId, uint64 indexed requestId, uint128 fee);
event RandomnessFulfilled(uint256 indexed roundId, uint64 indexed requestId, bytes32 randomNumber);
event WinnersDrawn(uint256 indexed roundId, address[] winners, uint32[] winningTickets, uint256[] prizeShares);
event RoundSettled(uint256 indexed roundId, uint256 principalShares, uint256 prizeShares);
event EmergencyForceSettled(uint256 indexed roundId);

event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 amount);         // shMON shares
event PrincipalWithdrawn(uint256 indexed roundId, address indexed user, uint256 amount);     // shMON shares

event Sponsored(uint256 indexed roundId, address indexed sponsor, uint256 amount, string memo);
event SponsorRefunded(uint256 indexed roundId, address indexed sponsor, uint256 amount);

event ProtocolFeeAccrued(uint256 indexed roundId, uint256 feeShares, address indexed feeRecipient);
event FeeAllocationsUpdated(FeeAllocation[] allocations);

event TransferDeferred(uint256 indexed rid, address indexed recipient, uint8 slot, uint256 shares);
event DeferredClaimSucceeded(uint256 indexed rid, address indexed recipient, uint8 slot, uint256 shares);

// Merkl-readable position surface
event Deposit(address indexed recipient, uint256 amount);
event Withdraw(address indexed recipient, uint256 amount);

// Governance / admin
event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
event PauserSet(address indexed pauser);
event KeeperSet(address indexed keeper, bool allowed);
event Paused(address indexed by);
event Unpaused(address indexed by);
event VaultStopped(uint64 stoppedAt);
event TicketPriceUpdated(uint256 ticketPriceAsset);
event OracleChangeQueued(address newOracle, uint64 effectiveAt);
event OracleChanged(address randomnessOracle);
event OracleChangeCancelled();
event NextRoundMetadataSet(address campaign, bytes32 metadata);
event VRFReserveDeposited(address indexed by, uint256 amount);
event VRFReserveWithdrawn(address indexed to, uint256 amount);
event ExecuteNext(uint256 indexed roundId, uint8 action);
```

If you build off events, key by topic hash, not name — earlier protocol generations (V2/V3) use differently-shaped events that the indexer disambiguates by topic.

---

## Owner and pauser surface

```solidity
// Ownership — two-step
function transferOwnership(address newOwner) external;   // owner
function acceptOwnership() external;                      // new owner

// Pauser is a SEPARATE role from owner
function setPauser(address newPauser) external;           // owner
function pause() external;                                // pauser — blocks new deposits only
function unpause() external;                              // pauser

function setKeeper(address keeper, bool allowed) external;
function setTicketPrice(uint256 newPrice) external;       // bounded ±10x per call; snapshotted per round
function setFeeAllocations(FeeAllocation[] calldata allocations) external;  // <=8 recipients, sum <= 2000 bps
function setNextRoundMetadata(address campaign, bytes32 metadata) external;

// Randomness oracle swap — 24h timelock
function queueOracleChange(address newOracle) external;
function commitOracleChange() external;                   // only after pendingOracleEffectiveAt
function cancelOracleChange() external;

// VRF reserve (native balance used to pay randomness fees)
function depositVRFReserve() external payable;
function withdrawVRFReserve(uint256 amount) external;

// Graceful retirement — one-way; stops new rounds, leaves claims/withdrawals open
function stop() external;

// Last resort for a round stuck in AwaitingVRF past the timeout
function emergencyForceSettle(uint256 rid) external;
```

**The owner cannot:** move user principal, redirect prize shares, change a round's fee/winners after it opens, raise the protocol fee above 20% (`MAX_TOTAL_FEE_BPS = 2000` is a `constant`), instantly swap the randomness oracle (24h timelock), or block `claimPrize` / `withdrawPrincipal` on settled rounds (those are not pausable). The **pauser** role can only block new deposits — never claims or withdrawals.

---

## Multi-winner and the fee router

- **Winners:** `numWinners` (1..32) and `winnerAllocationBps[]` are fixed at construction; the allocation sums to 10000. The draw selects distinct winning tickets and divides the prize by the allocation. If a round has fewer tickets than positions, the unfilled share (`forfeitBps`) returns pro-rata to depositors.
- **Fees:** `setFeeAllocations` sets up to 8 recipients summing to ≤ 2000 bps (20%). Allocations are snapshotted into each round at open time, so a change never applies retroactively. The fee is taken from the **prize yield only** — never from principal.

---

## Transfer resilience (deferred claims)

Every yield-vault payout (prize, principal, sponsor refund, fee) is wrapped: if a transfer can't complete (e.g. the yield token is briefly unavailable), the amount is recorded in `pendingClaims[rid][recipient][slot]` and a `TransferDeferred` event fires — it is never lost. The recipient retries with `claimDeferred(rid, slot)` (or `claimAllDeferred`). `hasPendingClaims(user)` is an O(1) check the frontend uses to surface a retry banner. Slot scheme: winner positions `0x00–0x1f`, fee recipients `0xf0–0xf7`, sponsor refund `0xfe`, principal `0xff`.

---

## Merkl-readable position surface

V4 exposes ERC-20-style read views and Deposit/Withdraw events so Merkl's generic indexer can track active positions and award shMonad points. The position is **non-transferable** — no `transfer`, `approve`, or `allowance`.

```solidity
function name()      external view returns (string memory);   // "EverDraw Position"
function symbol()    external view returns (string memory);   // per-vault, e.g. "EVRDRAW-A"
function decimals()  external view returns (uint8);           // 18 (native)
function balanceOf(address user) external view returns (uint256);  // active principal in asset units
function totalSupply()           external view returns (uint256);  // sum across users
```

`balanceOf` reflects currently-active principal (open + locked rounds), denominated in asset units; it drops on `withdrawPrincipal`.

---

## Constants

| Constant | Value | Meaning |
|---|---|---|
| `VERSION` | `"4.0.0"` | Contract version, for off-chain detection |
| `MAX_TOTAL_FEE_BPS` | `2000` | Protocol fee ceiling (20%), summed across recipients |
| `MAX_WINNERS` | `32` | Maximum winning positions per vault |
| `MAX_FEE_RECIPIENTS` | `8` | Maximum fee-allocation recipients |
| `VRF_CALLBACK_TIMEOUT` | `1 hour` | After this, owner can `emergencyForceSettle` a stuck AwaitingVRF round |
| `ORACLE_CHANGE_DELAY` | `24 hours` | Minimum time between `queueOracleChange` and `commitOracleChange` |

---

## Randomness oracle

V4 abstracts randomness behind `IRandomnessOracle`, implemented in production by `PythRandomnessOracle` (one adapter per vault, pinned to its consumer). The vault requests randomness on commit and receives it via `onRandomnessReceived`. The oracle can be migrated via the 24h timelock above. Full design: ADR-0029. The randomness mechanics from a user's perspective are in [Winner Selection](../how-it-works/winner-selection.md).

---

## Earlier generations

V2/V3 vaults (different contract names, block-hash or earlier-VRF randomness, single-winner) are retired or being retired as V4 takes over. Their addresses remain in the manifest with `retired`/`retiring` status for historical reference and in-flight claim settlement. Build new integrations against V4 only.
