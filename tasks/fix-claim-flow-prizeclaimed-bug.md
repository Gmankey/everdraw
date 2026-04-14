# Bug Fix: claimPrize tx always fails for winners in My Rounds

**File:** `web/src/App.jsx`
**Severity:** P0 — users cannot withdraw after winning
**Status:** Ready to fix

---

## What's broken

When a winner opens the "My Rounds" tab and clicks "Claim" on a settled round, the wallet shows "This transaction is likely to fail" and the tx fails on-chain.

**Root cause:** The `loadMyRounds` function reads `info.prizeClaimed` from `getRoundInfo` but never stores it on the row object. The modal mode is always set to `'winner'` for any round where `isWinner === true`, so clicking "Withdraw Shmon directly to wallet" always calls `claimPrize(rid)` — even if the prize was already claimed in a previous transaction. The contract reverts with `PrizeAlreadyClaimed`.

**Why the button still shows:** `canWithdraw = state === 3 && principal > 0n`. A winner's principal is still > 0 after claiming the prize (because `claimPrize` only takes yield, not principal). So the button keeps appearing and opening in winner mode, which keeps calling `claimPrize`, which keeps failing.

---

## Three edits to make

### Edit 1 — Store `prizeClaimed` in the row (line ~1377)

Find the `rows.push({...})` block inside `loadMyRounds`. Add `prizeClaimed`:

```js
// BEFORE:
rows.push({
  rid,
  state: Number(info.state),
  isWinner,
  principalWei: principal,
  principalMon: Number(ethers.formatEther(principal)).toFixed(4),
  yieldWei: BigInt(info.yieldMON || 0n),
  canWithdraw: Number(info.state) === 3 && principal > 0n,
})

// AFTER:
rows.push({
  rid,
  state: Number(info.state),
  isWinner,
  prizeClaimed: Boolean(info.prizeClaimed),   // ← ADD
  principalWei: principal,
  principalMon: Number(ethers.formatEther(principal)).toFixed(4),
  yieldWei: BigInt(info.yieldMON || 0n),
  canWithdraw: Number(info.state) === 3 && principal > 0n,
})
```

---

### Edit 2 — Use `prizeClaimed` to pick the correct modal mode (line ~1743)

Find the `openClaimFlow({...})` call inside the My Rounds table button onClick. Change the `mode` line:

```js
// BEFORE:
mode: r.isWinner ? 'winner' : 'principal',

// AFTER:
mode: (r.isWinner && !r.prizeClaimed) ? 'winner' : 'principal',
```

**Why this fixes it:**
- Winner, prize not yet claimed → `'winner'` → calls `claimPrize` ✓
- Winner, prize already claimed, principal still available → `'principal'` → calls `withdrawPrincipal` ✓
- Non-winner with principal → `'principal'` → calls `withdrawPrincipal` ✓

---

### Edit 3 — Fix broken status labels in My Rounds table (line ~1726)

Currently all non-open states show "Yield Accumulating" which is wrong for Settled rounds (shows "Yield..." truncated in the table — this is confusing and partly why the PM didn't catch this earlier).

```js
// BEFORE:
const myRoundStatusLabel = r.state === 0 ? 'Accepting Deposits'
  : 'Yield Accumulating'

// AFTER:
const myRoundStatusLabel = r.state === 0 ? 'Accepting Deposits'
  : r.state === 1 ? 'Draw Pending'
  : r.state === 2 ? 'Finalizing'
  : 'Settled'
```

---

## Verification

1. `cd web && npm run dev`
2. Connect a wallet that **has previously won and already claimed the prize** for a settled round
3. Go to My Rounds → the "Claim" button should now open in **principal mode** (title: "How do you want to claim your principal?" not "How do you want to claim this round?")
4. Click "Withdraw Shmon directly to wallet" → confirm the wallet shows `withdrawPrincipal` call (not `claimPrize`) — gas simulation should pass
5. Tx should succeed and principal MON returned to wallet
6. Also verify a wallet that has **NOT yet claimed prize**: "Claim" button should still open in winner mode, `claimPrize` still called
7. Status column in My Rounds table should now show "Settled" instead of "Yield Accumulating" for settled rounds
