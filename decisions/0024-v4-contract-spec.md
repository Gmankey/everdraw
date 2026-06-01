# ADR-0024 — V4 Contract Integrated Specification

**Status:** Accepted. Canonical V4 design.
**Date:** 2026-05-31
**Deciders:** Owner
**Replaces:** Earlier ADR-0024 draft on branch `decisions/adr-0025-multi-winner` (which was not merged). This is the single authoritative V4 spec.

This ADR is the canonical V4 contract specification. Individual subsystem ADRs (0025 multi-winner, 0026 sponsor drop-in, 0027 fee router, 0028 transfer-failure resilience, 0029 randomness oracle abstraction) define the rationale for each subsystem. **This ADR defines how they integrate into a single deployable contract.**

---

## Why V4 exists

V3 was deployed 2026-05-27 (Vault A) and 2026-05-31 (Vault B). V3 is missing the **Merkl-readable position surface** that was a hard requirement in ADR-0006. The omission was a PM error in design — V3 was written without carrying forward ADR-0006's V2 surface. Without that surface, the V3 vaults cannot integrate with Merkl (no `Deposit`/`Withdraw` events for their indexer, no `balanceOf`/`totalSupply` for their reads).

Since V3 is immutable and Merkl integration is non-negotiable, V4 is required. **This ADR establishes that we are not shipping a minimum-viable V4 to fix only the Merkl gap.** We are shipping a comprehensive V4 that closes every accumulated design debt at once, because the audit + deploy cost is the same whether V4 includes one fix or twenty.

---

## V4 feature inventory

V4 ships with the following capabilities. Each row links to its detail ADR.

| # | Feature | Source ADR | Why |
|---|---------|-----------|-----|
| 1 | Merkl position surface (`name`, `symbol`, `decimals`, `balanceOf`, `totalSupply`, `Deposit`, `Withdraw` events) | This ADR §3 | The trigger. Restores ADR-0006 surface that V3 dropped. |
| 2 | Generic asset support (native + ERC-20 deposit pathways, ERC-4626 yield abstraction) | This ADR §4 | Phase 3 vision: stablecoin vaults. Without this, every new asset requires a new contract source. |
| 3 | Multi-winner rounds (configurable winner count + allocation) | ADR-0025 | Phase 3 cross-protocol mega draws; product flexibility. |
| 4 | Sponsor drop-in cash | ADR-0026 | Phase 3 sponsor model. Simple variant; stake-yield deferred to V4.1. |
| 5 | Multi-recipient fee router (`FeeAllocation[]` instead of single recipient) | ADR-0027 | Enables protocol + sponsor + partner cuts atomically. |
| 6 | Try/catch on yield-vault transfer (transfer-failure resilience) | ADR-0028 | Unblocks setting `feeBps > 0` safely. V3 has `feeBps = 0` permanently because shMON pause would brick rounds. |
| 7 | Randomness oracle abstraction (`IRandomnessOracle` wrapping Pyth) | ADR-0029 | Future-proofs against Pyth interface changes; enables Chainlink VRF / Drand swap without redeploy. |
| 8 | Graceful retirement (`stop()`, irreversible, blocks new deposits, allows existing rounds to settle) | This ADR §5 | Cleaner than V3's `pause()` which blocks settlement. |
| 9 | Mutable ticket price with per-round snapshot | This ADR §6 | Allows price adjustment as asset value moves. Snapshot defends in-flight rounds. |
| 10 | Self-describing metadata views (`asset()`, `assetSymbol()`, `assetDecimals()`, `depositMode()`, `yieldVault()`) | This ADR §7 | Indexer + frontend can discover vault config from address alone. No off-chain config needed for new vaults. |
| 11 | All V3 hardening carried forward (entropy timelock, fee snapshot, per-round metadata, indexed events, 2-step ownership, VERSION constant) | ADR-0021 | Don't regress. |
| 12 | Pause role separation (owner is default pauser; can delegate to a pause-controller contract) | This ADR §8 | Enables Tier 4 pause-controller hub in a future deploy without redoing V4. |

**Explicitly deferred to V4.1 (do not include in V4):**

- Sponsor stake-yield model (separate `sponsorShares` accounting category — too complex for the V4 timeline)
- Factory + registry contract (Phase 4 marketplace — V4 is factory-compatible but the factory itself ships separately)
- Cross-vault MegaDraw orchestrator (separate contract referencing V4 vaults)
- Pause-controller hub contract (V4 supports pause-role delegation, the hub itself ships separately)
- TWAB / continuous-deposit accounting

---

## §3. Merkl-readable position surface (mandatory)

### Views

```solidity
function name() external view returns (string memory);     // "EverDraw Position"
function symbol() external view returns (string memory);   // per-vault, e.g. "EVRDRAW-MON" or "EVRDRAW-USDC"
function decimals() external view returns (uint8);         // matches asset decimals (18 for MON, 6 for USDC)
function balanceOf(address user) external view returns (uint256);
function totalSupply() external view returns (uint256);
```

### Events

```solidity
event Deposit(address indexed recipient, uint256 amount);
event Withdraw(address indexed recipient, uint256 amount);
```

`Deposit` fires on every `buyTickets` call (along with the existing `TicketsBought` event). `Withdraw` fires on every `withdrawPrincipal` call (along with existing `PrincipalWithdrawn`). The dual-event approach keeps backwards compatibility with our own indexer/frontend while satisfying Merkl's generic indexer.

### Semantics

- `balanceOf(user)` returns the user's currently active deposit principal across all open and locked rounds, denominated in deposit-asset units (MON wei for MON vaults, USDC units for USDC vaults, etc.).
- `totalSupply()` returns the sum across all users.
- Position is non-transferable. No `transfer`, `approve`, `allowance`, `transferFrom` functions exist. This is intentional per ADR-0006.
- Comment block at the start of the Merkl section must state the non-transferable intent in source code so future auditors don't flag missing ERC-20 functions as a bug.

### Cross-vault behavior

Each V4 vault has its own independent `balanceOf` and event stream. A user depositing into two V4 vaults appears separately on each. Merkl integration registers both addresses; their indexer sums off-chain.

---

## §4. Generic asset and yield abstraction

Picked per-vault at deploy via `DepositMode` enum. Same contract source supports both modes.

```solidity
enum DepositMode { Native, ERC20 }
DepositMode public immutable depositMode;
IERC20      public immutable asset;       // address(0) iff Native
IYieldVault public immutable yieldVault;  // ERC-4626 compatible
```

**Native mode** (e.g. MON + shMON):
- `buyTickets(uint32) external payable`
- Contract calls `yieldVault.deposit{value: cost}(cost, address(this))`

**ERC-20 mode** (e.g. USDC + sUSDC):
- `buyTickets(uint32) external` (not payable; rejects msg.value)
- `asset.safeTransferFrom(msg.sender, address(this), cost)`
- `asset.forceApprove(yieldVault, cost)`
- `yieldVault.deposit(cost, address(this))`

Both converge on `shares` (yield-vault shares minted), and from there all downstream logic is identical.

Withdrawal returns yield-vault shares directly (per V3 pattern). User redeems them at the yield vault if they want the underlying asset.

VRF reserve is **always** in native chain currency regardless of deposit asset. Every V4 vault, even USDC vaults, holds ~20 MON for Pyth fees. Documented in runbook templates so operators don't get surprised.

---

## §5. Graceful retirement

```solidity
uint64 public stoppedAt;

function stop() external onlyOwner {
    require(stoppedAt == 0, "already stopped");
    stoppedAt = uint64(block.timestamp);
    emit VaultStopped(stoppedAt);
}
```

When `stoppedAt > 0`:
- `buyTickets` reverts (`VaultStopped` error)
- All settlement (`commitDraw`, `finalizeDraw`, `emergencyForceSettle`) keeps working
- All exits (`claimPrize`, `withdrawPrincipal`, `claimDeferred`) keep working
- Existing rounds in-flight finish normally
- No new rounds open after the current one completes (the `_startNextRound` path checks `stoppedAt`)

**One-way, no `restart()`.** A stopped vault stays stopped; if you want to resume the product, you deploy a new vault.

---

## §6. Mutable ticket price with snapshot

```solidity
uint256 public ticketPriceAsset;  // owner-settable, capped
```

Owner-only setter `setTicketPrice(uint256 newPrice)` with sanity bound: must be within `[lastSetPrice / 10, lastSetPrice * 10]` — prevents off-by-3-zeros mistakes. Initial value set in constructor.

Per-round snapshot:
```solidity
struct RoundData {
    // ...
    uint256 ticketPriceAtRoundOpen;
}
```

Set at round open from current `ticketPriceAsset`. `buyTickets` uses the snapshot to compute cost. Owner changing `ticketPriceAsset` mid-round affects only the next round.

---

## §7. Self-describing metadata

All vault config is on-chain-readable:

```solidity
function asset() external view returns (address);              // address(0) iff Native
function assetSymbol() external view returns (string memory);   // cached from IERC20Metadata at deploy
function assetDecimals() external view returns (uint8);
function depositMode() external view returns (uint8);
function yieldVault() external view returns (address);
function numWinners() external view returns (uint8);
function winnerAllocationBps(uint8 index) external view returns (uint16);
function VERSION() external view returns (string memory);       // "4.0.0"
```

Indexer reads these once per vault at first-seen time. No off-chain config needed for new vaults — they're introspectable from address alone. This is the single biggest improvement over V3 for Phase 4 marketplace ergonomics.

---

## §8. Pause role separation

V3's `pause()` is owner-only. V4 adds:

```solidity
address public pauser;  // defaults to owner at deploy

function setPauser(address newPauser) external onlyOwner;

modifier onlyPauser() {
    require(msg.sender == pauser, "not pauser");
    _;
}

function pause() external onlyPauser;
function unpause() external onlyPauser;
```

Default: owner is the pauser. Owner can delegate the pause role to a separate contract (e.g. a future pause-controller hub that holds the pause role across many vaults) without losing the rest of admin control.

`onlyOwner` and `onlyPauser` are distinct.

---

## §9. RoundData storage shape

Final V4 `RoundData` integrating all the per-round snapshots:

```solidity
struct RoundData {
    // Lifecycle (from V3)
    RoundState state;
    uint64 salesEndTime;
    uint64 vrfSequenceNumber;
    bytes32 randomNumber;
    uint64 vrfRequestTime;

    // Tickets (from V3)
    uint32 totalTickets;
    Range[] ranges;

    // Accounting (from V3)
    uint256 totalPrincipalAsset;       // renamed from totalPrincipalMON
    uint256 totalPrincipalShares;      // renamed from totalPrincipalShmonShares
    uint256 principalSharesAtSettle;

    // Multi-winner (ADR-0025)
    uint32[] winningTickets;
    address[] winners;
    uint256[] winnerPrizeShares;       // pre-computed at finalize, indexed by position
    mapping(uint8 => bool) prizeClaimedAt;
    uint16 forfeitBps;                 // for totalTickets < numWinners

    // Sponsor (ADR-0026)
    uint256 sponsoredPrize;            // in asset units, added directly to prize pool

    // Fee (ADR-0027 multi-recipient)
    FeeAllocation[] roundFeeSnapshot;  // copied from live config at round open

    // Snapshots (this ADR §6, ADR-0021)
    uint256 ticketPriceAtRoundOpen;
    address roundCampaign;
    bytes32 roundMetadata;
}
```

### Deferred-balance per-user state (ADR-0028)

```solidity
mapping(uint256 => mapping(address => uint256)) public pendingPrincipal;   // rid → user → shares
mapping(uint256 => mapping(uint8 => uint256)) public pendingPrizeAt;       // rid → position → shares
```

When a transfer fails, the amount is recorded here. User calls `claimDeferred(rid)` later to retry.

---

## §10. Constructor

```solidity
struct V4Config {
    DepositMode depositMode;
    address asset;                  // 0 iff Native
    address yieldVault;
    uint256 ticketPriceAsset;
    uint32 roundDurationSec;
    uint32 yieldPeriodSec;
    uint8 numWinners;               // 1..32
    uint16[] winnerAllocationBps;   // length == numWinners, sum == 10000
    address randomnessOracle;       // IRandomnessOracle implementation
    bytes randomnessOracleInitData; // opaque, oracle-specific (Pyth: provider address)
    string vaultSymbol;             // for Merkl (e.g. "EVRDRAW-MON")
}

constructor(V4Config memory cfg) { ... }
```

Validation enumerated in source:
- Mode-asset consistency (Native ↔ asset=0, ERC20 ↔ asset≠0)
- `numWinners ∈ [1, 32]`, `winnerAllocationBps.length == numWinners`, `Σ allocBps == 10000`
- `ticketPriceAsset > 0`
- Durations within sane bounds (60s ≤ roundDurationSec ≤ 30d, yieldPeriodSec ≤ 30d)
- `randomnessOracle` and `yieldVault` non-zero, contracts (have code)
- `yieldVault.previewDeposit(ticketPriceAsset)` returns non-zero (sanity check the yield source is alive)
- For ERC-20 mode: `asset` is a contract, `decimals()` callable

---

## §11. What changes outside the contract

### Indexer

- Schema migration: add asset metadata columns to `pools` table (asset_address, asset_symbol, asset_decimals, deposit_mode)
- New event handlers: `Deposit`, `Withdraw` (Merkl-style), `Sponsored`, `WinnersDrawn`, `VaultStopped`, `TransferDeferred`
- Amount columns become asset-typed (don't assume MON wei)
- Per-vault decimals stored, used in API responses

### Frontend

- Per-vault asset rendering (read `assetSymbol`, `assetDecimals` from contract)
- ERC-20 deposit flow: approval modal then buy modal (two-tx UX for ERC-20 vaults)
- Sponsor button + flow (one-off `sponsor(rid, memo)` from the round detail page)
- Winners view shows N winners with allocations
- Stopped vaults render with a "Retired" badge, deposit button disabled

### Merkl

- Re-register V4 vault addresses (V3 ones are not Merkl-readable)
- Drop V3 addresses from the previous form submission
- Confirm decimal-aware `balanceOf` handling for stablecoin vaults

---

## §12. Migration from V3

V3 vaults stay live until natural completion. V4 vaults deploy alongside:

1. V4 contract deployed for each active vault role (Vault A V4 on Wed anchor, Vault B V4 on Sun anchor)
2. Frontend env updated: `VITE_POOL_ADDRESSES_V4` added, both V3 and V4 visible during transition
3. Keeper schedule updated: V4 vaults take the Wed/Sun anchors, V3 vaults stay in `POOL_ADDRESSES` (no longer in schedule) for finalization of their last rounds
4. Users with V3 positions complete their final V3 round, claim/withdraw, and migrate to V4 by depositing fresh
5. V3 vaults marked retired in the manifest; frontend stops listing them as active once all in-flight rounds settle
6. Merkl integration switches: existing form submission's V3 addresses removed, V4 addresses added

Total user-visible impact: **none, if transition is timed correctly.** A V3 user can keep their position to natural settlement, claim normally, then deposit fresh into V4 next round. No forced migration tx.

---

## §13. Out-of-scope items, locked

These do NOT ship in V4. The next major contract version (V4.1 or V5) covers them:

- Sponsor stake-shMON-yield model (separate `sponsorShares[rid][sponsor]` accounting)
- Factory + registry pattern (`VaultFactory.create()` and `VaultRegistry`)
- Cross-vault MegaDraw orchestrator
- Pause-controller hub contract
- TWAB / continuous-deposit accounting (still deferred per ADR-0007)
- Cross-chain bridging (Phase 5)
- Transferable position tokens (conflicts with non-transferable Merkl surface)

If any of these become a hard requirement before V4 ships, this ADR must be amended.

---

## §14. Audit scope

V4 audit covers, in priority order:

1. **Merkl surface correctness** — `balanceOf` invariant under all deposit/withdraw/claim paths; no double-counting; no missed events
2. **Generic asset pathway** — ERC-20 approval and transfer semantics; fee-on-transfer rejection; reentrancy on both modes
3. **Multi-winner selection** — algorithm correctness; uniqueness; gas bound under worst case
4. **Sponsor accounting** — sponsored funds reach the prize pool; sponsor cannot withdraw; sponsored prize is non-recoverable
5. **Fee router** — multi-recipient allocation math; no overflow; `MAX_FEE_BPS` cap enforced on sum
6. **Transfer-failure resilience** — `claimDeferred` is reachable; no path where funds are permanently locked
7. **Randomness oracle abstraction** — same security properties as V3's direct Pyth integration; provider change timelock still 24h
8. **Stop semantics** — exits work after stop; new deposits revert; settlement of in-flight rounds proceeds
9. **Pause role separation** — pauser is distinct from owner; only pauser can pause
10. **All V3 properties preserved** — regression test surface

**Internal audit, no external firm for V4.** Same posture as V3. We accept the risk in exchange for the timeline. Document this trade-off in the audit report itself.

---

## Consequences

- V4 is materially more complex than V3 (estimated 1500–1800 lines vs V3's 1000)
- Audit scope is roughly 3x V3's
- The integrated design lets us close 8 design debts in one deploy event
- After V4 deploys, the next mandatory redeploy is V5 (factory pattern + sponsor stake-yield + TWAB) — at least 6 months away

This is the contract spec. Implementation ticket is at `tasks/v4-builder-ticket-2026-05-31.md`. Deploy runbook at `tasks/v4-deploy-runbook.md`.
