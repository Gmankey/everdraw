# Phase 2a Builder Spec — V2 Contract (`TicketPrizePoolShmonV2`)

**Parent:** `phase2-shmon-native-plan.md`
**Tests:** `phase2-builder-spec-b-test-suite.md`
**Deploys as:** Vault C (parallel to V1 Vaults A & B)
**Effort:** 4-5 days contract + 2 days frontend + 1 day keeper

---

## Objective

Build `TicketPrizePoolShmonV2.sol` — a no-unstake, always-shMON lottery contract. Smaller, simpler, and faster to settle than V1. Reference V1 at `src/TicketPrizePoolShmonShMonad.sol` and diff from there.

---

## Core changes vs V1

| Concern | V1 | V2 |
|---|---|---|
| Settlement asset | MON (after unstake) | shMON shares (direct) |
| Unstake path in contract | `requestUnstake` → wait epoch → `completeUnstake` | **None** — contract never unstakes |
| State machine states | Open, Committed, Finalizing, Settled, Skipped | Open, Committed, Settled, Skipped, Failed |
| Settle time after salesEnd | Hours (epoch wait) | Seconds (blockhash only) |
| Yield calc | `monReceived - totalPrincipalMON` | `totalShmonShares - previewDeposit(totalPrincipalMON)` |
| Winner denomination | MON | shMON |
| Deposit options | MON only | MON or shMON (two entry functions) |
| Preference flags | N/A | N/A (removed from plan) |
| Keeper actions | Commit, RequestUnstake, CompleteUnstake, StartNext | Commit, Settle, StartNext, MarkFailed |

---

## File layout

**New:**
- `src/TicketPrizePoolShmonV2.sol` — the contract
- `script/DeployV2.s.sol` — Foundry deploy script (mirror existing deploy pattern)
- `scripts/deploy-v2-mainnet.js` — Hardhat deploy wrapper if V1 uses Hardhat for deploys (check existing `scripts/deploy-ticket-prize-pool-shmon-shmonad.js`)
- `abi/TicketPrizePoolShmonV2.json` — generated ABI for frontend + indexer

**Modified:**
- `web/src/App.jsx` — add V2 ABI, conditionally route Vault C to V2 logic (detect by contract address)
- `scripts/keeper-execute-next.js` — branch on V2 action enum
- `scripts/indexer/*` — add V2 event parsing (see indexer task below)

---

## Contract specification

### Imports & interfaces
Reuse V1's `IShMonad` interface but reconfirm it includes `previewDeposit`, `transfer`, `transferFrom`, `convertToAssets`. Add to the interface:
```solidity
interface IShMonad {
    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares);
    function previewDeposit(uint256 assets) external view returns (uint256 shares);
    function previewWithdraw(uint256 assets) external view returns (uint256 shares);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 shares) external returns (bool);
    function transferFrom(address from, address to, uint256 shares) external returns (bool);
    function approve(address spender, uint256 shares) external returns (bool);
}
```
**No** `requestUnstake`, `completeUnstake`, or `getInternalEpoch` — V2 never calls these.

### State

```solidity
enum RoundState { Open, Committed, Settled, Skipped, Failed }

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
    uint256 totalPrincipalMON;        // sum of nominal MON cost across all buys
    uint256 totalShmonShares;         // sum of actual shares held for round
    uint256 principalSharesAtSettle;  // previewDeposit(totalPrincipalMON) snapshot
    uint256 prizeShares;              // totalShmonShares - principalSharesAtSettle (saturating)
    uint256 shareRateAtSettle;        // convertToAssets(1e18) at settle, for reporting
    address winner;
    uint32 winningTicket;
    bool prizeClaimed;
    TicketRange[] ranges;
}

struct UserPosition {
    uint128 principalMON;
    uint128 principalShmonShares;
}

mapping(uint256 => RoundData) public rounds;
mapping(uint256 => mapping(address => UserPosition)) public positions;
mapping(uint256 => mapping(address => uint256)) public principalMON; // legacy-compat getter

uint256 public currentRoundId;
IShMonad public immutable shmon;
uint96 public ticketPriceMON;
uint32 public immutable roundDurationSec;
uint32 public constant TARGET_BLOCK_DELAY = 3;  // same as V1 or whatever V1 uses

// Owner + pause (copy from V1)
address public owner;
address public pendingOwner;
bool public paused;
uint8 private _locked; // reentrancy guard
```

Check V1's `TARGET_BLOCK_DELAY` constant before finalizing the V2 value; match it unless there's a reason to change.

### Custom errors
```solidity
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
```

### Events
All events emit **dual-denomination** (shares + MON-equivalent + rate snapshot) for reporting:

```solidity
event RoundStarted(uint256 indexed roundId, uint64 salesEndTime);

event TicketsPurchased(
    uint256 indexed roundId,
    address indexed buyer,
    uint32 ticketCount,
    uint256 costMON,
    uint256 sharesDeposited,
    uint256 shareRateAtDeposit,
    uint8 depositAsset            // 0 = MON, 1 = shMON
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
```

### Modifiers
Copy from V1: `onlyOwner`, `whenNotPaused`, `nonReentrant` (using `_locked` slot).

### Constructor
```solidity
constructor(
    address _shmon,
    uint96 _ticketPriceMON,
    uint32 _roundDurationSec,
    address _owner
) {
    if (_shmon == address(0) || _owner == address(0) || _ticketPriceMON == 0 || _roundDurationSec < 60 || _roundDurationSec > 30 days) {
        revert BadConfig();
    }
    shmon = IShMonad(_shmon);
    ticketPriceMON = _ticketPriceMON;
    roundDurationSec = _roundDurationSec;
    owner = _owner;
    _locked = 1;

    // Start round 1 immediately
    currentRoundId = 1;
    RoundData storage r = rounds[1];
    r.state = RoundState.Open;
    r.salesEndTime = uint64(block.timestamp + _roundDurationSec);
    emit RoundStarted(1, r.salesEndTime);
}
```

### Deposit: `buyTicketsMON`
```solidity
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
```

### Deposit: `buyTicketsShmon`
```solidity
function buyTicketsShmon(uint32 ticketCount) external whenNotPaused nonReentrant {
    uint256 rid = currentRoundId;
    RoundData storage r = rounds[rid];

    if (r.state != RoundState.Open) revert BadState();
    if (block.timestamp >= r.salesEndTime) revert SalesEnded();
    if (ticketCount == 0) revert ZeroTickets();

    uint256 cost = uint256(ticketCount) * uint256(ticketPriceMON);
    // Pull exact shares worth `cost` MON at current rate. +1 wei buffer to cover rounding.
    uint256 sharesOwed = shmon.previewWithdraw(cost) + 1;
    if (sharesOwed == 0) revert ZeroShares();

    bool ok = shmon.transferFrom(msg.sender, address(this), sharesOwed);
    if (!ok) revert TransferFailed();

    _recordPosition(rid, msg.sender, ticketCount, cost, sharesOwed, 1);
}
```
**Rounding decision:** default to `+1` wei buffer in the contract. If fork tests show `previewWithdraw` already rounds up, remove the `+1`. Document in test outcome.

### Internal: `_recordPosition`
```solidity
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

    p.principalMON         += uint128(costMON);
    p.principalShmonShares += uint128(shares);
    principalMON[rid][user] = p.principalMON; // legacy compat accessor

    r.totalPrincipalMON  += costMON;
    r.totalShmonShares   += shares;

    uint32 start = r.totalTickets;
    require(uint256(start) + uint256(ticketCount) <= type(uint32).max, "overflow");
    uint32 end = start + ticketCount;
    r.totalTickets = end;

    _mergeOrAppendRange(r, user, start, end);

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
    r.ranges.push(TicketRange({buyer: user, startInclusive: start, endExclusive: end}));
}
```

### Round lifecycle: `commit`
```solidity
function commit(uint256 rid) external nonReentrant {
    RoundData storage r = rounds[rid];
    if (r.state != RoundState.Open) revert BadState();
    if (block.timestamp < r.salesEndTime) revert SalesNotEnded();

    if (r.totalTickets == 0) {
        r.state = RoundState.Skipped;
        emit RoundSkipped(rid);
        _startNextRound();
        return;
    }

    r.state = RoundState.Committed;
    r.targetBlockNumber = uint64(block.number + TARGET_BLOCK_DELAY);
    emit RoundCommitted(rid, r.targetBlockNumber);
}
```

### Round lifecycle: `settle`
```solidity
function settle(uint256 rid) external nonReentrant {
    RoundData storage r = rounds[rid];
    if (r.state != RoundState.Committed) revert BadState();
    if (block.number <= r.targetBlockNumber) revert TooEarly();

    if (block.number > uint256(r.targetBlockNumber) + 255) {
        r.state = RoundState.Failed;
        emit RoundFailed(rid);
        _startNextRound();
        return;
    }

    bytes32 bh = blockhash(r.targetBlockNumber);
    if (bh == bytes32(0)) revert NoBlockhash();

    uint32 winningTicket = uint32(uint256(bh) % r.totalTickets);
    address winner = _resolveTicketOwner(r, winningTicket);

    uint256 principalShares = shmon.previewDeposit(r.totalPrincipalMON);
    uint256 prizeShares = r.totalShmonShares > principalShares
        ? r.totalShmonShares - principalShares
        : 0;
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

    _startNextRound();
}

function _resolveTicketOwner(RoundData storage r, uint32 ticket) internal view returns (address) {
    // Linear scan is fine for small range counts; binary search if needed.
    uint256 n = r.ranges.length;
    for (uint256 i = 0; i < n; i++) {
        TicketRange storage rg = r.ranges[i];
        if (ticket >= rg.startInclusive && ticket < rg.endExclusive) {
            return rg.buyer;
        }
    }
    revert("ticket not found");
}

function _startNextRound() internal {
    uint256 nextId = currentRoundId + 1;
    currentRoundId = nextId;
    RoundData storage r = rounds[nextId];
    r.state = RoundState.Open;
    r.salesEndTime = uint64(block.timestamp + roundDurationSec);
    emit RoundStarted(nextId, r.salesEndTime);
}
```

### Withdrawals
```solidity
function withdrawPrincipal(uint256 rid) external nonReentrant {
    RoundData storage r = rounds[rid];
    if (r.state != RoundState.Settled && r.state != RoundState.Skipped && r.state != RoundState.Failed) {
        revert BadState();
    }

    UserPosition storage p = positions[rid][msg.sender];
    uint256 shares = p.principalShmonShares;
    if (shares == 0) revert NothingToWithdraw();

    p.principalMON = 0;
    p.principalShmonShares = 0;
    principalMON[rid][msg.sender] = 0;

    bool ok = shmon.transfer(msg.sender, shares);
    if (!ok) revert TransferFailed();

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
```

### Keeper view: `nextExecutable`
```solidity
enum NextAction { None, Commit, Settle, MarkFailed }

function nextExecutable() external view returns (uint256 rid, NextAction action) {
    rid = currentRoundId;
    RoundData storage r = rounds[rid];
    if (r.state == RoundState.Open && block.timestamp >= r.salesEndTime) {
        return (rid, NextAction.Commit);
    }
    if (r.state == RoundState.Committed) {
        if (block.number > uint256(r.targetBlockNumber) + 255) return (rid, NextAction.MarkFailed);
        if (block.number > r.targetBlockNumber) return (rid, NextAction.Settle);
    }
    return (rid, NextAction.None);
}
```

### Owner functions
Copy from V1 pattern: `pause()`, `unpause()`, `transferOwnership(address)`, `acceptOwnership()`, `setTicketPrice(uint96)`. `setTicketPrice` should only be callable when there are no active rounds with tickets (check V1 for pattern).

### View accessors
Provide:
```solidity
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
);

function getUserPosition(uint256 rid, address user) external view returns (uint128 principalMON, uint128 principalShmonShares);
```

Note: V2 `getRoundInfo` **returns a different shape** than V1 — indexer + frontend must branch on pool address or ABI.

---

## Frontend changes

### Vault C detection
In `App.jsx`, add `VITE_POOL_ADDRESS_C` and detect V2 by address match. Route V2 pools through a new component (`VaultCardV2.jsx`) or branch inside `VaultCard.jsx`.

### New ABI entries
Add to `POOL_ABI_V2` constant:
- `function buyTicketsMON(uint32) payable`
- `function buyTicketsShmon(uint32)`
- `function settle(uint256)`
- New `getRoundInfo` return shape
- V2 events for listener hooks

### Buy flow for Vault C
- Two buttons: "Buy with MON" and "Buy with shMON"
- "Buy with shMON" flow:
  1. Check `shmon.allowance(user, poolAddress)`
  2. If insufficient, show "Approve shMON" button → calls `shmon.approve(poolAddress, sharesOwed)` (or MAX_UINT with a checkbox toggle)
  3. After approve confirmation, enable "Buy Tickets"
  4. Calls `pool.buyTicketsShmon(n)` (no value)
- Gas estimation: use `pool.buyTicketsShmon.estimateGas(n)` pattern same as the fix we added for V1 buyTickets.

### Withdraw flow for Vault C
- "Withdraw Principal" button → calls `withdrawPrincipal(rid)` → shMON arrives
- Toast: "Received X shMON. Visit the **shMON** tab to convert to MON."
- Link to `/shmon` tab

### Settlement display
- When Vault C round settles, display "Settled!" within seconds of target block (no more "unstaking..." state)
- Drop `unstakeCompletionEpoch` from UI for Vault C rounds

---

## Keeper changes (`scripts/keeper-execute-next.js`)

- Support both V1 and V2 contracts; detect by pool address
- V1 actions unchanged
- V2 action mapping:
  - `NextAction.Commit` → call `pool.commit(rid)`
  - `NextAction.Settle` → call `pool.settle(rid)`
  - `NextAction.MarkFailed` → call `pool.settle(rid)` (which handles Failed transition internally)
  - `NextAction.None` → sleep
- Remove any V2-specific code paths for requestUnstake/completeUnstake (V2 doesn't have them)
- Add V2 pool config to `scripts/keeper-mainnet.env`:
  ```
  POOL_ADDRESSES_V2=0x...vaultC
  ```

---

## Indexer changes

- Add V2 ABI entry
- Add columns to deposits table: `deposit_asset` (0/1), `share_rate_at_deposit`
- Add columns to settlements table: `principal_shares_at_settle`, `prize_shares`, `share_rate_at_settle`
- Drop references to `monReceived`, `unstakeCompletionEpoch`, `lossRatio` for V2 rounds
- Stats API: compute MON-equivalents using the rate snapshots stored in the events

---

## Deployment script

`script/DeployV2.s.sol`:
```solidity
// Foundry deploy - mirror V1 pattern
contract DeployV2 is Script {
    function run() external {
        address shmon = vm.envAddress("SHMON_ADDRESS");
        address owner = vm.envAddress("POOL_OWNER");
        uint96 ticketPrice = uint96(vm.envUint("TICKET_PRICE_MON"));
        uint32 duration = uint32(vm.envUint("ROUND_DURATION_SEC"));
        vm.startBroadcast();
        new TicketPrizePoolShmonV2(shmon, ticketPrice, duration, owner);
        vm.stopBroadcast();
    }
}
```
Deploy params for Vault C burn-in: `TICKET_PRICE_MON=100000000000000000` (0.1 MON), `ROUND_DURATION_SEC=86400`.

---

## Exit criteria

- [ ] Contract compiles, all custom errors wired
- [ ] Both deposit paths work in unit tests
- [ ] Settlement math correct under positive, zero, and negative yield scenarios
- [ ] Events emit dual-denomination snapshots
- [ ] Reentrancy protection verified
- [ ] Deployed to Monad testnet, runs 3+ full rounds via keeper
- [ ] Frontend Vault C card shows correct state, allows MON + shMON buys
- [ ] Keeper handles all V2 actions without reverting
- [ ] Indexer parses V2 events
- [ ] Slither/semgrep clean (no new high severity findings vs V1)
- [ ] Gas snapshot within 20% of V1 for `buyTicketsMON` (V2 should be ~equal or cheaper for settle)

---

## Known constraints

- Must not break V1 Vaults A/B — all V2 changes are additive
- Indexer must support both ABIs simultaneously
- Frontend must support both contract shapes (detect by address)
- Keeper must support both action enums (detect by contract ABI)
