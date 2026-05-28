# Smart Contract

EverDraw runs two parallel prize vaults on a weekly stagger. **V3 is the current production contract** (`TicketPrizePoolShmonV3`), live since 2026-05-27, with Pyth Entropy VRF for randomness and a configurable (currently zero) protocol fee. V2 vaults remain active for the brief overlap window during the V3 migration.

The full trust model is documented in [ADR-0022](https://github.com/Gmankey/everdraw/blob/staging/decisions/0022-operational-trust-assumptions.md) and [ADR-0023](https://github.com/Gmankey/everdraw/blob/staging/decisions/0023-shmon-dependency-model.md).

---

## Canonical mainnet deployments

**Always verify any transaction signed at [everdraw.xyz](https://everdraw.xyz) interacts with one of the addresses below.** The authoritative manifest including runtime bytecode hashes and constructor arguments is at [`deployments/monad-mainnet.json`](https://github.com/Gmankey/everdraw/blob/staging/deployments/monad-mainnet.json).

| Vault | Network | Address | Contract | Anchor | Status |
|---|---|---|---|---|---|
| Vault A V3 | Monad Mainnet | `0x8F36aaAD5E88585aA54Cc160ef2Eb4d2B2C7B1ee` | `TicketPrizePoolShmonV3` | Wed 13:00 UTC | Active (current) |
| Vault A V2 | Monad Mainnet | `0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888` | `TicketPrizePoolShmonV2` | — (no new rounds; in-flight finalization only) | Retiring |
| Vault B V2 | Monad Mainnet | `0xd4F4286CE1E72562fdAfcD9F491974D0F245Ea9d` | `TicketPrizePoolShmonV2` | Sun 01:00 UTC | Active until V3 Vault B deploys 2026-05-31 |
| Vault B V3 | Monad Mainnet | (deploys 2026-05-31 01:00 UTC, address recorded post-deploy) | `TicketPrizePoolShmonV3` | Sun 01:00 UTC | Scheduled |
| Legacy Vault B (retired) | Monad Mainnet | `0xed67ad46C694a5e963119a1Ca5F88eEBbb6e5a8a` | `TicketPrizePoolShmonShMonad` | — | Quarantined per [ADR-0018](https://github.com/Gmankey/everdraw/blob/staging/decisions/0018-legacy-vault-b-quarantine.md) — claims only, no new deposits |

All active contracts are verified on [the Monad explorer](https://monadexplorer.com). Source, ABI, and constructor arguments are public and independently checkable.

---

## V3 Constructor

```solidity
constructor(
    uint96  _ticketPriceMON,
    uint32  _roundDurationSec,
    uint32  _yieldPeriodSec,
    address _shmon,
    address _entropy,
    address _entropyProvider
)
```

| Parameter | Description | Mainnet value |
|---|---|---|
| `_ticketPriceMON` | Price per ticket, in wei (1e18 = 1 MON) | `1000000000000000000` |
| `_roundDurationSec` | Deposit window length in seconds | `86400` (24h) |
| `_yieldPeriodSec` | Lock / yield period in seconds | `518100` (~6 days minus 5 min) |
| `_shmon` | shMON ERC-4626 vault address | `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c` |
| `_entropy` | Pyth Entropy contract | `0xD458261E832415CFd3BAE5E416FdF3230ce6F134` |
| `_entropyProvider` | Pyth-operated provider address | `0x52DeaA1c84233F7bb8C8A45baeDE41091c616506` |

Owner is set to `msg.sender` at construction. Cadence values are pinned by [ADR-0010](https://github.com/Gmankey/everdraw/blob/staging/decisions/0010-cadence-invariant-for-vault-a-and-b.md).

---

## Round states (V3)

| Value | State | Meaning |
|---|---|---|
| 0 | Open | Deposit window active |
| 1 | AwaitingVRF | Deposit window closed, Pyth randomness requested, waiting for callback |
| 2 | Drawn | VRF callback received, random number stored, awaiting finalize |
| 3 | Settled | Winner selected, prize and principal claimable |

A round with zero tickets at the deposit-window close is **skipped** directly to Settled and emits `RoundSkipped` instead of running through the VRF cycle.

If a Pyth callback does not arrive within `VRF_CALLBACK_TIMEOUT = 1 hour`, the owner can call `emergencyForceSettle(rid)` to mark the round Settled with no winner. Depositors recover full principal.

---

## Read functions

```solidity
function currentRoundId() external view returns (uint256);

function getRoundInfo(uint256 rid) external view returns (
    uint8   state,
    uint64  salesEndTime,
    uint64  vrfSequenceNumber,    // Pyth sequence; 0 until commitDraw
    uint32  totalTickets,
    uint256 totalPrincipalMON,
    uint256 totalShmonShares,
    uint256 principalSharesAtSettle,
    uint256 prizeShares,
    uint256 shareRateAtSettle,     // reserved; always 0
    address winner,
    uint32  winningTicket,
    bool    prizeClaimed
);

function getUserPosition(uint256 rid, address user)
    external view returns (uint128 principalMON, uint128 principalShmonShares);

function getCommitAfterTime(uint256 rid) external view returns (uint64);

// V3 protocol-fee surface (currently zeroed; see ADR-0023)
function feeBps() external view returns (uint16);
function feeRecipient() external view returns (address);
function getRoundFee(uint256 rid) external view returns (uint16 bps, address recipient);

// V3 round-metadata surface (per-round campaign/sponsor pointer)
function getRoundMetadata(uint256 rid) external view returns (address campaign, bytes32 metadata);

// Lifecycle planner (used by the keeper)
// action: 0 None, 1 Skip, 2 Commit, 3 Finalize
function nextAction(uint256 rid) external view returns (uint8 action);
function nextExecutable() external view returns (uint256 rid, uint8 action);

// Pyth Entropy state surface
function entropy() external view returns (address);
function entropyProvider() external view returns (address);
function pendingEntropy() external view returns (address);
function pendingEntropyProvider() external view returns (address);
function pendingEntropyEffectiveAt() external view returns (uint64);
```

---

## Write functions

```solidity
// User entry — pay with native MON. msg.value must equal ticketPriceMON × ticketCount.
function buyTickets(uint32 ticketCount) external payable;
function buyTicketsMON(uint32 ticketCount) external payable;   // alias

// Lifecycle. All permissionless — anyone can call, keeper is authorized but not required.
function executeNext() external returns (uint256 rid, uint8 action);
function executeNext(uint256 rid) external returns (uint8 action);
function commitDraw(uint256 rid) external;
function skipRound(uint256 rid) external;
function finalizeDraw(uint256 rid) external;

// Post-settle.
function claimPrize(uint256 rid) external;          // winner only, idempotent
function withdrawPrincipal(uint256 rid) external;   // any depositor
```

Note: V3 has no `buyTicketsShmon` (shMON-deposit entry was removed in V3). V3 also has no `settle` — the `_finalizeDraw` step covers settlement and is exposed publicly as `finalizeDraw`.

---

## Events

```solidity
event RoundStarted(uint256 indexed roundId, uint64 salesEndTime);
event TicketsBought(uint256 indexed roundId, address indexed buyer, uint32 ticketCount, uint256 monPaid);

event VRFRequested(uint256 indexed roundId, uint64 indexed sequence, uint128 fee);
event VRFFulfilled(uint256 indexed roundId, uint64 indexed sequence, bytes32 randomNumber);
event WinnerDrawn(uint256 indexed roundId, address indexed winner, uint32 winningTicket);
event RoundSettled(uint256 indexed roundId, uint256 principalShares, uint256 prizeShares);
event RoundSkipped(uint256 indexed roundId);
event EmergencyForceSettled(uint256 indexed roundId);

event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 amount);          // amount in shMON shares
event PrincipalWithdrawn(uint256 indexed roundId, address indexed user, uint256 amount);     // amount in shMON shares

event ProtocolFeeAccrued(uint256 indexed roundId, uint256 feeShares, address indexed feeRecipient);

// Governance / admin
event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
event KeeperSet(address indexed keeper, bool allowed);
event FeeUpdated(uint16 feeBps, address feeRecipient);
event EntropyChangeQueued(address newEntropy, address newProvider, uint64 effectiveAt);
event EntropyChanged(address entropy, address entropyProvider);
event EntropyChangeCancelled();
event NextRoundMetadataSet(address campaign, bytes32 metadata);
event VRFReserveDeposited(address indexed by, uint256 amount);
event VRFReserveWithdrawn(address indexed to, uint256 amount);
event Paused(address indexed by);
event Unpaused(address indexed by);
event ExecuteNext(uint256 indexed roundId, uint8 action);
```

V2 contracts use different event signatures (e.g. `TicketsPurchased` with extra shares-detail fields, `RoundCommitted`, V2-shaped `RoundSettled`). The indexer recognizes both shapes by topic hash. If you build off events directly, key by topic hash, not name.

---

## Owner surface (V3)

The owner can call all of the following. Trust model and mitigations documented in [ADR-0022](https://github.com/Gmankey/everdraw/blob/staging/decisions/0022-operational-trust-assumptions.md).

```solidity
function pause() external;
function unpause() external;
function transferOwnership(address newOwner) external;   // step 1 of 2
function acceptOwnership() external;                      // step 2 (new owner)

// Keepers
function setKeeper(address keeper, bool allowed) external;

// Protocol fee — capped at 2000 bps (20%); snapshotted into each round at open time
function setFee(uint16 newFeeBps, address newFeeRecipient) external;

// Pyth Entropy migration — 24-hour public timelock between queue and commit
function queueEntropyChange(address newEntropy, address newProvider) external;
function commitEntropyChange() external;     // only after pendingEntropyEffectiveAt
function cancelEntropyChange() external;

// Per-round metadata (campaign/sponsor pointer for future CampaignManager use)
function setNextRoundMetadata(address campaign, bytes32 metadata) external;

// VRF reserve — owner funds the contract balance used to pay Pyth fees
function depositVRFReserve() external payable;
function withdrawVRFReserve(uint256 amount) external;

// Last-resort: settle a round stuck in AwaitingVRF after VRF_CALLBACK_TIMEOUT (1h)
function emergencyForceSettle(uint256 rid) external;
```

**The owner cannot:** move user principal, redirect prize shares, change a round's fee after that round opens, raise the fee above 20% (`MAX_FEE_BPS = 2000` is a `constant`, not mutable), instantly swap the entropy provider (24h timelock enforced), or block already-settled rounds from `claimPrize` / `withdrawPrincipal` (these are not pausable).

---

## Merkl readable position surface

The contract exposes ERC-20-style read views and events so Merkl's generic vault indexer can track active positions and award shMonad points. The position is **non-transferable**. There is no `transfer`, `approve`, or `allowance`.

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

## Constants

| Constant | Value | Meaning |
|---|---|---|
| `VERSION` | `"3.0.0"` | Contract version, for off-chain detection |
| `MAX_FEE_BPS` | `2000` | Protocol fee ceiling in basis points (20%) |
| `VRF_CALLBACK_TIMEOUT` | `1 hour` | After this, owner can `emergencyForceSettle` a stuck AwaitingVRF round |
| `ENTROPY_CHANGE_DELAY` | `24 hours` | Minimum time between `queueEntropyChange` and `commitEntropyChange` |

---

## V2 (legacy) reference

V2 contracts (`0x2208...` and `0xd4F4286...`) use the V2Compat interface: `commit` / `settle` instead of `commitDraw` / `finalizeDraw`, block-hash-based randomness, no Pyth integration, no protocol fee. They are being retired as V3 vaults take over their anchors. See `src/TicketPrizePoolShmonV2.sol` in the repo and the indexer ABI at `abi/TicketPrizePoolShmonV2.json` for the full V2 interface.
