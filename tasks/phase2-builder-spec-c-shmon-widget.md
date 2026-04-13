# Phase 2c Builder Spec — shMON Unstake Widget

**Parent:** `phase2-shmon-native-plan.md`
**Builds against:** V1 (no contract changes)
**Ships:** independently, before Phase 2a
**Effort:** 2-3 days

---

## Objective

Add a standalone **"shMON" tab** to everdraw.xyz that lets any user with shMON balance manage their conversion to MON directly through our UI. The widget talks to the shMON contract at `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c` — **no EverDraw contracts involved**.

This validates the unstake UX ahead of V2 and becomes the natural post-withdraw destination when V2 ships.

---

## User-facing flows

### Flow 1 — Read state
On tab load (wallet connected):
- `shmon.balanceOf(user)` → "X shMON available"
- `shmon.convertToAssets(balance)` → "≈ Y MON"
- Query pending unstake state (see "Discovery item 1" below) → "Z shMON unstaking, ready in 4h 32m"

### Flow 2 — Instant unstake (~0.975% fee)
Modal:
```
Amount:      [input, default=max balance]
You send:    N shMON
You receive: M MON   (via shmon.previewRedeem)
Fee:         ~0.975% (X MON lost to instant-redeem spread)
[Cancel] [Confirm]
```
Tx: `shmon.redeem(shares, user, user)`
On success: refresh balances, toast "Received M MON".

### Flow 3 — Scheduled unstake (free, ~18-22hr)

**Step A — Request:**
```
Amount:      [input]
You unstake: N shMON
You'll receive: ~M MON (via shmon.convertToAssets, final subject to rate at completion)
Wait:        ~18-22 hours (1 shMON internal epoch)
[Cancel] [Request Unstake]
```
Tx: `shmon.requestUnstake(shares)` → emits `UnstakeRequested(...)` with `completionEpoch`

**Step B — Track pending:**
- "Pending Unstakes" card lists each pending entry: amount, target epoch, time remaining
- Poll `shmon.getInternalEpoch()` every 30s
- When `currentEpoch >= completionEpoch`, show green "Complete Unstake" button

**Step C — Complete:**
Tx: `shmon.completeUnstake()` → MON arrives in wallet → clear pending entry → refresh.

---

## Component structure

```
web/src/components/ShmonPanel/
├── ShmonPanel.jsx           # main container, tab body, nav wiring
├── BalanceCard.jsx          # balance + convertToAssets display
├── InstantUnstakeModal.jsx  # redeem flow (Flow 2)
├── ScheduledUnstakeModal.jsx # requestUnstake flow (Flow 3A)
├── PendingUnstakesCard.jsx  # list + complete button (Flow 3B/C)
└── useShmon.js              # hook: state, reads, writes, polling
```

Use existing `App.css` patterns (cards, `.btn`, `.filled`). Match vault card styling — match background `#100d1e`.

---

## `useShmon` hook responsibilities

- Reads: `balance`, `rateAssetsPerShare`, `pendingUnstakes[]`, `currentEpoch`
- Writes: `instantUnstake(shares)`, `requestScheduled(shares)`, `completeScheduled()`
- Auto-refresh every 30s while panel is mounted
- Reconcile pending unstake state from both **localStorage** and **on-chain event scan** on every mount (so state survives cache clear)
- Persist pending entries under key `everdraw:shmon:pending:<userAddr>`
- Use existing `getReadProvider()` and `getWalletProvider()` helpers from `App.jsx`

---

## Contracts to call (direct shMON)

| Action | Call | Returns | Auth |
|---|---|---|---|
| Read balance | `balanceOf(user)` | shares (bigint) | view |
| Convert to MON | `convertToAssets(shares)` | MON-eq | view |
| Preview instant | `previewRedeem(shares)` | MON out (post-fee) | view |
| Instant unstake | `redeem(shares, user, user)` | MON out | user tx |
| Preview scheduled | `convertToAssets(shares)` | MON out (fee-free estimate) | view |
| Request scheduled | `requestUnstake(shares)` | `completionEpoch` (uint64) | user tx |
| Poll epoch | `getInternalEpoch()` | current epoch | view |
| Complete scheduled | `completeUnstake()` | — | user tx |

---

## shMON ABI to add

Create `web/src/abi/shmon.json` (or inline in a new module) with:
```json
[
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function previewRedeem(uint256) view returns (uint256)",
  "function previewWithdraw(uint256) view returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function requestUnstake(uint256 shares) returns (uint64 completionEpoch)",
  "function completeUnstake()",
  "function getInternalEpoch() view returns (uint64)",
  "event UnstakeRequested(address indexed user, uint256 shares, uint64 completionEpoch)"
]
```
Verify `UnstakeRequested` event signature from shMON explorer before finalizing — the exact name/args may differ.

---

## Discovery items (resolve at start of build)

1. **How does shMON expose per-user pending unstake state?**
   - Try in order: `pendingUnstake(address)`, `unstakeInfo(address)`, `unstakes(address)`, or similar view.
   - If no view exists → scan `UnstakeRequested` events filtered by user address; reconcile with `completeUnstake` events to detect completion.
   - Document finding in a code comment and update this spec if fallback is needed.

2. **Can a user have multiple simultaneous pending unstakes?**
   - Test by attempting a second `requestUnstake` while one is outstanding (on testnet or via static-call).
   - If single-slot: UI shows one pending entry, new request button is disabled until completed.
   - If multi-slot: UI shows a list.

3. **Does `completeUnstake()` take any args?**
   - Assume zero-arg (`completeUnstake()`) based on V1 keeper usage. Verify via ABI.

4. **`UnstakeRequested` event signature.**
   - Verify exact topic0 and indexed fields before relying on log filters.

---

## UI copy (ready to use)

**Empty state:**
> You don't have any shMON. shMON is Monad's liquid-staking token that earns yield automatically. Learn more on [shmonad.xyz](https://shmonad.xyz).

**Instant unstake explainer:**
> Instant unstake gives you MON immediately but pays a ~1% fee to the shMON protocol for the liquidity. Use this if you need MON right now.

**Scheduled unstake explainer:**
> Scheduled unstake is free but takes ~18-22 hours to complete. You can close this tab and come back later — we'll remember your pending unstake.

**Pending entry:**
> Unstaking **{shares} shMON** → **~{mon} MON**
> Ready in **{timeRemaining}** (epoch {completionEpoch})

**Ready entry:**
> ✓ **{shares} shMON** ready to claim → **{mon} MON**
> [Complete Unstake]

---

## Error handling

| Error | Message to user |
|---|---|
| Wallet not connected | "Connect your wallet to manage shMON" |
| Wrong network | Reuse existing `ensureCorrectNetwork` flow |
| Insufficient shMON balance | "You only have X shMON" |
| Tx rejected (code 4001) | Silent (no error toast) |
| `redeem` reverts | "Instant unstake unavailable right now. Try scheduled unstake." |
| `requestUnstake` reverts | "Unable to schedule unstake. You may have an unstake already pending." |
| `completeUnstake` reverts with "not ready" | "Your unstake isn't ready yet. Please wait until epoch {target}." |

---

## Exit criteria

- [ ] New "shMON" tab visible in main nav, gated on wallet connection
- [ ] BalanceCard shows shMON balance and MON equivalent, auto-refreshing
- [ ] Instant unstake: user enters amount → modal shows fee → confirms → MON arrives in wallet
- [ ] Scheduled unstake request: user enters amount → modal shows wait → confirms → pending card appears
- [ ] Pending card updates time remaining live, persists across page reloads
- [ ] "Complete Unstake" button activates when ready, completes successfully, clears pending
- [ ] Works on MetaMask (injected) and WalletConnect paths
- [ ] All three write paths handle user rejection gracefully
- [ ] No regressions in existing V1 pool pages

---

## File change summary

**New files:**
- `web/src/components/ShmonPanel/ShmonPanel.jsx`
- `web/src/components/ShmonPanel/BalanceCard.jsx`
- `web/src/components/ShmonPanel/InstantUnstakeModal.jsx`
- `web/src/components/ShmonPanel/ScheduledUnstakeModal.jsx`
- `web/src/components/ShmonPanel/PendingUnstakesCard.jsx`
- `web/src/components/ShmonPanel/useShmon.js`
- `web/src/abi/shmon.json`

**Modified files:**
- `web/src/App.jsx` — add "shMON" tab to nav, route to `ShmonPanel`
- `web/src/App.css` — any new styles (or add a scoped CSS file in the component directory)

**No changes to:**
- Any contracts
- Any keeper scripts
- Any indexer code
- Existing vault pages

---

## Testing checklist (manual, pre-deploy)

- [ ] Fund a test wallet with 1 MON on Monad mainnet
- [ ] Call `shmon.deposit{value: 1 ether}(1 ether, user)` to get some shMON
- [ ] Open everdraw.xyz/#shmon — verify balance displays
- [ ] Instant-unstake 0.1 shMON → verify MON received ≈ `previewRedeem` output
- [ ] Schedule-unstake 0.1 shMON → verify pending card appears
- [ ] Hard-refresh page → verify pending card still shows
- [ ] Wait for epoch to advance (may need to skip to testnet for speed)
- [ ] Click "Complete Unstake" → verify MON received
- [ ] Repeat with WalletConnect wallet

---

## Deploy

Standard Vercel deploy: `npx vercel --prod` from `/web`.
No env var changes required.
