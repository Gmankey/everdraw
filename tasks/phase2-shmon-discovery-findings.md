# Phase 2 shMON Discovery Findings

**Date:** 2026-04-08
**Contract:** `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c`
**Network:** Monad mainnet
**Purpose:** answer Phase 2c discovery questions before any implementation work

---

## Summary

Current best findings from direct RPC probing:

1. **Per-user pending unstake introspection**
   - Tried common getter candidates:
     - `pendingUnstake(address)`
     - `unstakeInfo(address)`
     - `unstakes(address)`
     - `pendingUnstakes(address)`
   - All of them **reverted / do not appear to exist**.
   - **Working conclusion:** pending state will need to be discovered via **event scan fallback**, unless a different custom getter is found later.

2. **Multiple simultaneous pending unstakes**
   - PM provided operational behavior from prior shMON usage: if a wallet starts a scheduled unstake, waits partway through, then requests another scheduled unstake, the **entire pending amount resets to a fresh full wait window**.
   - Working conclusion: shMON behaves like a **single-slot pending unstake model**, not independent parallel pending positions.
   - Current status: **operationally assumed confirmed for product behavior**, though still worth validating with ABI/source or a tiny write-path test if we need production-grade technical proof.

3. **`completeUnstake()` args**
   - `getInternalEpoch()` is callable and returns a live epoch value.
   - `requestUnstake(uint256)` selector resolves cleanly.
   - `completeUnstake()` zero-arg selector resolves cleanly.
   - `completeUnstake(uint256)` also hashes as a plausible selector, but this was only interface probing, not proof the contract implements it.
   - Based on existing spec + keeper assumptions, **zero-arg `completeUnstake()` remains the leading candidate**, but this still needs ABI/log/explorer confirmation before implementation is locked.

4. **Other surface behavior**
   - Confirmed callable / working:
     - `getInternalEpoch()`
     - `balanceOf(address)`
     - `asset()`
     - `decimals()`
     - `symbol()`
     - `previewDeposit(uint256)`
     - `previewWithdraw(uint256)`
     - `previewRedeem(uint256)`
     - `convertToAssets(uint256)`
   - Confirmed broken / reverting:
     - `convertToShares(uint256)`
   - Important note: prior docs said `name()` and `totalSupply()` revert, but current probing suggests that note may now be stale or environment-dependent. Do **not** rely on old assumptions blindly.

---

## Detailed findings

### 1. Pending unstake getter discovery

Probed these candidate read methods directly against mainnet shMON:

- `pendingUnstake(address)`
- `unstakeInfo(address)`
- `unstakes(address)`
- `pendingUnstakes(address)`

Result:
- all failed with call exceptions / revert behavior
- no evidence yet of a public per-user getter on those common names

**Implication for 2c:**
- build `useShmon` to support **event-backed reconciliation** as the default design
- localStorage persistence is still useful, but it cannot be the source of truth by itself

### 2. Epoch read

`getInternalEpoch()` is live and returns a valid epoch.

Observed during probing:
- `getInternalEpoch() -> 602`

**Implication for 2c:**
- polling epoch every 30s is viable
- readiness can be modeled as `currentEpoch >= completionEpoch`

### 3. ERC-20 / ERC-4626 surface probing

Confirmed usable in read path:
- `balanceOf(address)`
- `convertToAssets(uint256)`
- `previewRedeem(uint256)`
- `previewWithdraw(uint256)`
- `previewDeposit(uint256)`
- `asset()`
- `symbol()`
- `decimals()`

Confirmed problematic:
- `convertToShares(uint256)` reverts

**Important correction vs earlier notes:**
- previous planning notes said `name()` and `totalSupply()` revert
- current probing suggests those warnings may be stale, inconsistent, or no longer true on live mainnet
- safest implementation stance is still: **don’t depend on optional metadata calls unless needed**

### 4. Event discovery status

I attempted to confirm:
- exact `UnstakeRequested` signature
n- whether there is `UnstakeCompleted` / `UnstakeClaimed` or only standard ERC-4626 events
- topic0 hashes + parse shape

Current blocker:
- Monad public RPC is extremely restrictive for `eth_getLogs`
- it hard-limits range size to **100 blocks** and made broader exploratory log scanning slow/noisy
- I was able to establish that this will require narrow-window or paged scanning, but I do **not** yet consider event signatures fully confirmed

**Current confidence:**
- `UnstakeRequested(address indexed user, uint256 shares, uint64 completionEpoch)` is still the leading guess from the spec and interface probing
- but **not fully confirmed yet** from parsed live logs

### 5. Write-path questions still open

Still unresolved until a funded-wallet test:
- exact technical mechanism for the known product behavior where a second scheduled unstake resets the timer for the full pending amount
- whether `requestUnstake` explicitly merges into one pending slot, overwrites a stored slot, or reuses another internal accounting pattern
- is `completeUnstake()` definitely zero-arg in the actual deployed bytecode path?
- what completion event, if any, is emitted?

---

## Builder recommendation before 2c implementation

Before writing UI code, do one short follow-up verification pass using either:

1. explorer ABI/source, if available, or
2. a tiny funded-wallet write test on testnet / small mainnet value

That pass should lock down:
- exact `UnstakeRequested` event signature
- completion event signature (if any)
- exact contract-level mechanism behind the observed single-slot reset behavior
- whether `completeUnstake()` is definitely zero-arg in deployed behavior

---

## Working implementation assumptions if PM wants progress unblocked

If we need to proceed with 2c scaffolding before full write-path verification, the safest temporary assumptions are:

- pending unstake source of truth = **event scan + localStorage reconciliation**
- pending model = **single-slot reset semantics**: a new scheduled unstake while one is pending resets the timer for the full amount
- readiness = `getInternalEpoch() >= completionEpoch`
- completion call = **assume `completeUnstake()` zero-arg**, but keep the contract wrapper isolated so it can be changed fast if discovery disproves it

Those assumptions are reasonable for scaffolding, but **not yet safe enough for production implementation signoff**.
