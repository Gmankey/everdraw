# ADR-0024: Generic Asset Vault Design (V4)

**Status:** Accepted as design spec for V4. No V3 contract changes.
**Date:** 2026-05-31
**Deciders:** Owner
**Sequence:** V4 design ADR. Depends on ADR-0025 for round storage shape (multi-winner-ready). Must land before V4 implementation begins.

---

## Context

V3 is locked to:
- **Native MON only.** `buyTickets` is `payable`, `msg.value` is the principal source. Cannot accept ERC-20 deposits.
- **shMON only as yield source.** `IShMonad public immutable shmon`, hardcoded `deposit{value}` calling convention, hardcoded `previewDeposit` semantics for prize-share computation.

Phase 3 vision explicitly calls for stablecoin vaults (USDC, USDT) and Phase 4 calls for ERC-4626-compatible permissionless vault creation. Both are blocked by these constraints. New deploys of V3 cannot adapt — the asset and yield source are constructor immutables baked into immutable storage.

This ADR defines the V4 contract's generic-asset shape so that one source-code base can be deployed for MON+shMON, USDC+sUSDC, USDT+sUSDT, or any future asset/yield-vault pair without code changes.

It also establishes the boundary between things that vary by asset (deposit currency, yield wrapper, share→asset conversion) and things that stay fixed across deployments (round lifecycle, randomness mechanism, fee semantics, multi-winner shape).

---

## Decision

### 1. Two deposit-currency models, picked per-vault at deploy time

V4 supports two distinct deposit pathways. Each vault picks one at construction; the contract source is the same.

**Model A — Native-token deposit.** Used by MON-on-Monad, ETH-on-Ethereum, MATIC-on-Polygon, etc.
- `buyTickets(uint32 ticketCount) external payable` accepts the native currency
- Contract calls `yieldVault.deposit{value: cost}(cost, address(this))`
- shMON falls here on Monad

**Model B — ERC-20 deposit.** Used by USDC, USDT, DAI, etc.
- `buyTickets(uint32 ticketCount) external` (NOT payable)
- Contract calls `asset.transferFrom(msg.sender, address(this), cost)` first
- Then `asset.approve(yieldVault, cost)` (or `safeApprove` pattern with revoke-then-approve)
- Then `yieldVault.deposit(cost, address(this))`
- sUSDC / Aave aUSDC / etc. fall here

The model is picked by a constructor flag:

```solidity
enum DepositMode { Native, ERC20 }
DepositMode public immutable depositMode;
```

The pathway is selected at the top of `_buyTickets`:

```solidity
if (depositMode == DepositMode.Native) {
    if (msg.value != cost) revert WrongValue();
    shares = yieldVault.deposit{value: cost}(cost, address(this));
} else {
    if (msg.value != 0) revert UnexpectedValue();  // ERC-20 path should not receive native
    asset.safeTransferFrom(msg.sender, address(this), cost);
    asset.forceApprove(address(yieldVault), cost);  // OZ SafeERC20
    shares = yieldVault.deposit(cost, address(this));
}
```

Both pathways converge on `shares` — the number of yield-vault shares minted. From that point forward the contract logic is identical for both modes.

**Why two paths rather than one universal abstraction:** The Solidity calling convention differs (`payable` + `msg.value` vs `transferFrom` + approval) and there is no clean way to abstract that in a non-allocating way. Two narrow branches are simpler to audit than a generic adapter. The `immutable depositMode` keeps both paths gas-cheap.

### 2. Yield vault is ERC-4626-compatible at the interface level

V4 abstracts the yield source to the ERC-4626 standard interface:

```solidity
interface IYieldVault {
    // Native variant uses payable; ERC-20 variant uses regular
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares);

    // Read shape (both)
    function previewDeposit(uint256 assets) external view returns (uint256 shares);
    function previewRedeem(uint256 shares) external view returns (uint256 assets);

    // Standard ERC-20 (yield vaults are also ERC-20 share tokens)
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}
```

shMON already satisfies this (ADR-0004). For ERC-20 vaults (sUSDC, aUSDC, ERC-4626 wrappers), the interface is satisfied by definition.

The contract takes `IYieldVault public immutable yieldVault` plus `IERC20 public immutable asset` (which is `address(0)` for native mode). The pair must be consistent — validated in constructor:

```solidity
constructor(..., DepositMode _mode, address _asset, address _yieldVault, ...) {
    if (_yieldVault == address(0)) revert BadConfig();
    if (_mode == DepositMode.Native && _asset != address(0)) revert BadConfig();
    if (_mode == DepositMode.ERC20 && _asset == address(0)) revert BadConfig();
    depositMode = _mode;
    asset = IERC20(_asset);
    yieldVault = IYieldVault(_yieldVault);
    // ... rest of construction
}
```

### 3. Share-rate model is unchanged

Prize computation is the same exchange-rate model documented in ADR-0004:

```
principalSharesAtSettle = yieldVault.previewDeposit(totalPrincipalAsset)
grossPrizeShares = totalPrincipalYieldShares - principalSharesAtSettle  (or 0 if negative)
```

This works identically for any ERC-4626-compatible yield vault. Yield rate goes up over the lock period → `previewDeposit(M)` returns fewer shares at rate R₁ than were minted at rate R₀ → the surplus is the prize.

ERC-4626 vaults that move backwards (share rate decreases due to slashing or pool losses) hit the same `grossPrizeShares == 0` case as shMON — depositors get their full deposited share count back, but those shares are now worth less in asset terms. The "no-loss" promise is contingent on the underlying yield vault not losing value. This is the same trust assumption documented in ADR-0023; same words, broader scope.

### 4. Withdrawal returns yield-vault shares (not the underlying asset)

V3 returns `shmon.transfer(user, shares)` at `withdrawPrincipal` time — the user receives shMON shares and unstakes them off-platform if they want native MON. V4 keeps this pattern.

For ERC-20 vaults: `withdrawPrincipal` calls `yieldVault.transfer(msg.sender, sharesToReturn)`. The user receives e.g. sUSDC shares; they redeem at the yield-vault contract for USDC if they want the underlying.

**Rejected: redeem-on-behalf-of-user.** Considered: `yieldVault.redeem(shares, msg.sender, address(this))` to send underlying directly. Rejected because (a) it adds an external call on every withdraw which expands the reentrancy surface and gas cost, (b) it removes user agency over when to materialize the underlying (they may prefer to hold the yield-bearing share until later for tax or yield-compounding reasons), (c) the V3 pattern is already shipped and well-understood. Keeping it.

The frontend will need per-vault copy explaining what the user gets back (shMON vs sUSDC vs ...) and where to unstake. Per ADR-0024-frontend follow-up.

### 5. Ticket-price denomination matches the deposit asset

`ticketPriceAsset` (renamed from V3's `ticketPriceMON`) is the per-ticket cost denominated in the vault's deposit asset. Stored as `uint256` rather than `uint96` to accommodate USDC's 6-decimal precision needs (1 USDC = 1e6, headroom matters less but uniform type is cleaner).

The frontend uses the asset's decimals to display the price correctly. The indexer stores prices with explicit decimal information per-vault.

### 6. Round storage compatibility with ADR-0025 (multi-winner)

The `RoundData` struct from ADR-0025 carries `winners[]`, `winningTickets[]`, `prizeClaimedAt` per-position mapping, plus the fee snapshot from ADR-0020 and metadata from ADR-0021.

V4 adds two more fields to make the round self-describing across asset variants:

```solidity
// Already in ADR-0025
uint32[] winningTickets;
address[] winners;
mapping(uint8 => bool) prizeClaimedAt;
uint16 forfeitBps;  // from ADR-0025 §5.1

// New in ADR-0024
uint256 ticketPriceAtRoundOpen;  // snapshot — protects against mid-round vault parameter changes
```

The `ticketPriceAtRoundOpen` snapshot is a defense against an attack vector that exists once `ticketPriceAsset` becomes mutable (which it should — Phase 3 vision implies dynamic pricing as a configuration knob). If the owner could change the ticket price mid-round, a buyer who entered at 1 USDC and later finds the price was changed to 100 USDC mid-round would face an unclear refund situation. Snapshotting eliminates the ambiguity: every ticket in the round costs the snapshotted price, regardless of later changes.

Whether `ticketPriceAsset` is actually mutable in V4 is a separate sub-decision (see Open Questions §1). Either way, the snapshot field is cheap insurance.

### 7. Fee handling unchanged

The protocol fee from ADR-0020 (snapshotted per-round, applied to prize yield only) applies identically. Fee is taken from `grossPrizeShares` in yield-vault-share denomination before allocation to winners.

Per-asset fee rates are NOT supported — there is one `feeBps` per vault. If MON vault and USDC vault should have different fees, deploy them with different `feeBps`. Per-asset rate routing inside a single contract was considered and rejected (adds storage, audit surface, governance complexity, no clear use-case).

### 8. Randomness unchanged

V4 keeps the Pyth Entropy integration verbatim from V3+ADR-0021. The 24h entropy-change timelock applies. The user-side seed construction is the same. The selection algorithm changes per ADR-0025 (multi-winner) but the source of randomness does not.

The VRF reserve is denominated in the **native currency of the chain** (MON on Monad, ETH on Ethereum). Pyth Entropy charges its fee in native. Each V4 vault — regardless of deposit asset — holds a native-currency reserve. For an ERC-20 vault on Monad (e.g., USDC vault), the contract still has a `receive() external payable {}` and `depositVRFReserve()` taking native MON.

This is potentially confusing to operators (a USDC vault that needs MON top-ups). Mitigation: the runbook for deploying any V4 vault explicitly states "every vault, regardless of asset, requires a 20 MON VRF reserve at deploy time." Documented in deploy runbook templates.

### 9. Cross-asset abstraction in the indexer and frontend

The contract carries enough metadata to be self-describing per vault:

- `asset() view returns (address)` — ERC-20 address (or address(0) for native)
- `assetDecimals() view returns (uint8)` — for display formatting
- `assetSymbol() view returns (string)` — for UI labels (read from `IERC20Metadata.symbol()` at construction and stored as immutable bytes32, or fall back to the address)
- `depositMode() view returns (uint8)` — 0 for native, 1 for ERC-20
- `yieldVault() view returns (address)`

The indexer reads these once per vault at first-seen time and caches them in its schema. The frontend reads them via the same path. No off-chain config (env vars, hand-maintained lists) is needed to know the asset shape of a vault — the contract self-describes.

**This is a structural improvement over V3** where the frontend hardcodes "MON" everywhere and would need extensive refactoring to handle any other asset. V4 vaults are introspectable from address alone.

### 10. Constructor surface

The V4 constructor:

```solidity
constructor(
    DepositMode  _depositMode,
    address      _asset,             // address(0) iff Native
    address      _yieldVault,        // the ERC-4626-compatible yield source
    uint256      _ticketPriceAsset,
    uint32       _roundDurationSec,
    uint32       _yieldPeriodSec,
    uint8        _numWinners,        // ADR-0025
    uint16[]     _winnerAllocationBps,  // ADR-0025 — must sum to 10000
    address      _entropy,
    address      _entropyProvider
)
```

Validation in constructor:
- Mode-asset consistency (§2)
- `numWinners` in 1..32, `winnerAllocationBps.length == numWinners`, sum == 10000
- `_ticketPriceAsset > 0`, in valid decimals for the chosen asset
- Round/yield durations within sane bounds (matches V3)
- All addresses non-zero where required

The constructor calls `yieldVault.previewDeposit(_ticketPriceAsset)` once as a sanity check that the yield vault is alive and the asset/yield pairing makes sense. If this reverts, the constructor reverts — no half-deployed vault.

---

## Consequences

### Contract

- V4 contract source is materially different from V3 — different deposit pathways, different storage, different events. Not a drop-in replacement. The migration model is "V3 vaults retire as users withdraw; V4 vaults open in parallel."
- Two-mode dispatch in `_buyTickets` adds a small gas cost (one immutable read, one branch). Negligible.
- `safeTransferFrom` + `safeApprove` for ERC-20 paths introduce the standard ERC-20 footguns (fee-on-transfer tokens, non-standard return semantics). OpenZeppelin's `SafeERC20` library is the right primitive; explicitly disallow fee-on-transfer assets at deploy time via the constructor sanity check.
- Vault is now self-describing — `asset()`, `assetDecimals()`, `depositMode()`, `yieldVault()` views become the canonical source of truth. ADR-0017 production-source-control invariant still applies; the manifest must record all these constructor args.
- Audit scope expands. The new ERC-20 deposit path is novel for this protocol (V1/V2/V3 never took ERC-20). Approval-and-deposit reentrancy is the classic place this can go wrong; the audit must specifically cover it.

### Indexer

- Per-vault asset metadata must be discovered (via contract reads) and stored. New columns in the `pools` table: `asset_address`, `asset_symbol`, `asset_decimals`, `deposit_mode`, `yield_vault_address`.
- All amount columns (`mon_paid`, `prize_claimed`, `principal_withdrawn`, etc.) become **denomination-typed** — the schema needs to either rename columns to be asset-neutral (`asset_amount`) or keep names but introduce per-column joins to the pool's asset metadata. Likely the cleaner refactor is renaming + adding a `decimals` column in each amount field so frontend rendering can be consistent.
- Cross-vault aggregations (e.g., "total prizes paid out across all vaults") become meaningful only when normalized to USD or another reference unit. Indexer may need a price oracle integration to normalize for display purposes; or simply expose per-vault breakdowns without aggregation.

### Frontend

- The vault list / discovery surface (planned for Phase 4 marketplace) becomes truly multi-asset. Per-vault rendering reads asset metadata from the contract.
- Per-asset balance checks and approval flows. ERC-20 vaults need an `approve` step before `buyTickets` — separate UX from native vaults' single-tx flow. Standard wallet pattern (approve modal → buy modal).
- Display formatting respects per-vault decimals — USDC at 6 decimals, MON/ETH at 18.
- The "where to unstake" copy varies per yield vault. The frontend should read it from a per-vault metadata config (deploy-time chosen) or hardcode a lookup table for known assets.

### Audit

V4 audit scope, beyond ADR-0025's items:
- ERC-20 deposit pathway: approval handling, `safeTransferFrom` return-value checks, fee-on-transfer detection, allowance race conditions
- Native + ERC-20 mode mutual exclusion (no path where both `msg.value` and `transferFrom` succeed)
- Constructor sanity check (`previewDeposit` callable + sensible return)
- Native VRF reserve for ERC-20-asset vaults (still works, still owner-only withdraw)
- Reentrancy on the new external call surface (`asset.transferFrom`, `asset.approve`, `yieldVault.deposit` in ERC-20 mode)

---

## Rejected alternatives

**Single deposit pathway via wrap-native-on-the-fly.** Considered: wrap MON to WMON at deposit time, treat all vaults as ERC-20 internally. Rejected because (a) it adds a wrap-tx cost to every native deposit, (b) WMON would become a hard runtime dependency added to the trust surface, (c) the two-mode branch is simpler than abstracting over a wrap layer.

**Use a vault-router pattern (single contract, multi-asset).** Considered: one master contract that holds many asset/vault tuples and routes per-deposit. Rejected because (a) it concentrates risk — one bug compromises all assets, (b) per-vault parameters (winner count, fee, cadence) become per-tuple state, ballooning storage, (c) audit complexity scales with asset count rather than being constant per deploy, (d) the multi-vault frontend already needs to handle many contracts; one-contract-per-vault has the same UX with cleaner blast-radius.

**Native + multiple ERC-20 in the same vault.** Considered: one vault accepts both MON and USDC deposits, combines them via an oracle conversion. Rejected because (a) introduces a price oracle dependency (currently zero), (b) breaks the "ticket price is one number" simplicity, (c) prize distribution across asset types is complicated (do USDC winners get USDC and MON winners get MON? proportional? oracle-converted?). Out of scope for V4; possibly revisitable in V5+ if a clear product need emerges.

**Permissionless factory in V4.** Considered: ship V4 as a factory-deployable contract from day one. Rejected for V4 specifically because (a) the factory pattern (per Phase 4 vision and ADR-0028 future) requires a different ownership model than V4 vaults will need, and (b) operationally we want to deploy a few hand-curated V4 vaults first to find issues before opening it to permissionless deployment. Factory is a separate concern, designed in a separate ADR.

**Yield-vault-share-as-deposit (skip the deposit step).** Considered: let users deposit already-yielding shares directly (e.g., deposit shMON shares instead of MON). Rejected because (a) users mostly hold the native asset, not the yield-bearing share, and the deposit-and-stake should be atomic from UX standpoint, (b) the share-rate computation at settlement depends on having known the asset-amount-deposited, which is muddier when deposits arrive as shares of varying ages, (c) the V2-shMON-deposit path was previously supported and explicitly disabled in V3 with a `"shMON entry disabled"` revert — that was the right call and we keep it.

**Cross-chain abstraction.** Considered: bake in cross-chain message-passing for the Phase 5 vision. Rejected as out of scope for V4. Cross-chain deserves its own ADR and likely a different contract architecture (deposit registry on origin chain, prize pool on destination, etc.). Don't pre-design something we don't yet know the shape of.

---

## Open questions (settle before V4 implementation begins)

### 1. Is `ticketPriceAsset` mutable post-deploy?

Pros of mutable: real-world economics may require adjusting the entry price as the asset's USD value moves. A 1 USDC entry is appropriate; a 1 BTC entry is not (without splitting tickets), and BTC denomination of a hypothetical bitcoin vault would want adjustable ticket sizes.

Cons of mutable: every mutable parameter is an owner surface. Even with the per-round snapshot in §6, owner can change pricing for future rounds in surprising ways.

**Provisional decision:** mutable, owner-only, with the per-round snapshot mandatory. Documented as a trust assumption alongside `feeBps`. Revisit if the audit firm raises concerns.

### 2. Should V4 have an "asset retirement" mechanism for graceful shutdown?

A V4 vault might want to stop accepting new deposits (e.g., regulatory pressure on stablecoins, exit of the yield-vault project, etc.) while still allowing existing depositors to claim and withdraw.

Pros: clean ops story. Cons: another owner-settable lever, another piece of state.

**Provisional decision:** YES, add a `stoppedAt` timestamp field — owner-settable, irreversible. When set, `buyTickets` reverts. All other functions (`claimPrize`, `withdrawPrincipal`, settlement) keep working. Round currently in progress finishes normally; no new rounds open.

This is meaningfully better than the V3 `pause()` mechanism (which blocks settlement too). Adds about 30 lines of code. Saves a future emergency.

### 3. Approval pattern for ERC-20 mode

OpenZeppelin's `SafeERC20.forceApprove` is one option. Allowance-decrement-after-deposit is another. The forceApprove pattern is simpler and audit-friendlier; the decrement pattern allows for partial-deposit recovery scenarios (rare).

**Provisional decision:** `forceApprove` to exact-amount before each deposit. The allowance is reset to zero by the yield-vault's own consumption. Simplest model with no leaked allowance state.

### 4. How does V4 handle a yield-vault that returns 0 shares for a non-zero deposit (a slashed-to-zero state)?

The V3 contract reverts with `ZeroSharesMinted`. V4 same.

This is correct behavior — a yield vault that can't price the deposit is broken from EverDraw's perspective, and the deposit should fail loud, not silently produce a stuck deposit.

---

## Sequencing and migration notes

V4 cannot drop in alongside V3 trivially because the ABI and storage shapes differ. The migration model:

1. **V4 contracts deploy alongside V3 vaults.** Different addresses. Both indexed and visible to users.
2. **New deposits flow to V4 vaults** by default. Frontend's Vault A/B selection (or marketplace-list once Phase 4 ships) shows V4 vaults as primary.
3. **V3 vaults run to natural completion.** Existing depositors finish their rounds, claim prizes, withdraw principal. No forced migration.
4. **V3 vaults are retired** once all rounds have settled and depositors have cleared. The keeper schedule is updated to remove them; the frontend stops listing them as active.
5. **Indexer continues to serve V3 history** indefinitely for users who want to look up old rounds. No data is purged.

The transition is the same shape as the V2→V3 migration we just executed. The runbook from Sun 2026-05-31 can be templated for V3→V4 once that time comes.

Vault A V3 (`0x8F36aaAD...`) and Vault B V3 (`0x56b49421...`) are both safe to keep running for months. The V4 transition is not time-pressured.

---

## ADR-0024 + ADR-0025 together = enough to start V4 spec

Combined with ADR-0025, this ADR establishes the V4 contract's:
- Deposit pathway (native + ERC-20)
- Yield abstraction (ERC-4626)
- Round storage (multi-winner-ready, fee-snapshotted, metadata-snapshotted)
- Self-describing metadata views
- Constructor surface
- Audit scope

What's still NOT in V4 design (separately tracked):
- ADR-0026: Sponsor accounting — drop-in cash model
- ADR-0027: Sponsor accounting — yield-stake model
- ADR-0028: Factory + registry pattern (Phase 4 marketplace)
- ADR-0029: Multi-recipient fee router
- ADR-0030: Pause controller / multi-vault batch operations

These can be designed in parallel and integrated into V4's constructor / state once stabilized. The structural decisions in ADRs 0024 and 0025 do NOT prejudice them — they leave room for sponsor-balance fields, fee-router addresses, registry-hook addresses, etc., as additional immutable or owner-settable parameters.

When the next four ADRs are written and the operator decides V4 is ready to ship, the contract source is the integration of all of them. That contract gets one audit cycle and one deploy event. Doing the design work up front pays back in audit and deploy concentration.
