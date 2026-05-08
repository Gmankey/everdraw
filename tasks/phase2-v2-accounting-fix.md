# V2 Contract — Accounting Fix + Yield Period (Critical, Blocks Deploy)

**Priority:** P0 — must merge before any mainnet deployment
**Parent:** `phase2-builder-spec-a-v2-contract.md`
**Tests:** `test-js/v2-full.spec.js` (63/67 passing — 4 failures are the accounting bug)
**Effort:** 3–4 hours contract + 1–2 hours test updates

---

## Issue 1: Missing Yield Period

The current V2 contract has no yield accrual window. It settles seconds after deposits close. This means ~0.04% daily yield as the prize — effectively nothing.

V1 had a 7-day yield period between deposit close and settlement. V2 should keep this. The user never asked for it to be removed.

### Fix

Add `yieldPeriodSec` as a constructor parameter (immutable). Change the commit gate so the keeper can only commit after deposits close AND yield has accrued.

**Constructor change:**

```solidity
uint32 public immutable yieldPeriodSec;

constructor(address _shmon, uint96 _ticketPriceMON, uint32 _roundDurationSec, uint32 _yieldPeriodSec, address _owner) {
    // ... existing validation ...
    if (_yieldPeriodSec < 3600 || _yieldPeriodSec > 30 days) revert BadConfig();
    yieldPeriodSec = _yieldPeriodSec;
    // ... rest unchanged ...
}
```

**`commit()` change — line 242:**

```solidity
// BEFORE:
if (block.timestamp < r.salesEndTime) revert SalesNotEnded();

// AFTER:
if (block.timestamp < r.salesEndTime + yieldPeriodSec) revert SalesNotEnded();
```

**`nextExecutable()` change — line 357:**

```solidity
// BEFORE:
if (r.state == RoundState.Open && block.timestamp >= r.salesEndTime) {

// AFTER:
if (r.state == RoundState.Open && block.timestamp >= r.salesEndTime + yieldPeriodSec) {
```

**No new states needed.** The round stays `Open` during both the deposit window and the yield window. Deposits are gated by `salesEndTime` (unchanged). Commit is gated by `salesEndTime + yieldPeriodSec` (changed above).

**Add convenience view:**

```solidity
function getCommitAfterTime(uint256 rid) external view returns (uint64) {
    return rounds[rid].salesEndTime + uint64(yieldPeriodSec);
}
```

**Deploy script update:** Add `YIELD_PERIOD_SEC=604800` (7 days) to constructor args.

**Keeper update:** No logic changes needed — keeper already calls `nextExecutable()` which now respects the yield gate.

### Impact on round timeline

```
Single vault cycle: [24hr deposits] → [7 days yield] → [commit+settle seconds] → next round
Total: ~8 days per round
```

Two vaults (C and D) will be staggered by ~4 days for availability, same pattern as V1.

---

## Issue 2: withdrawPrincipal Accounting Insolvency

`withdrawPrincipal()` returns each user's original `p.principalShmonShares`. But the prize is `totalShmonShares - principalSharesAtSettle`. When yield is positive, total outflows exceed the pool's share balance:

```
Total outflow = sum(originalShares) + prizeShares
              = totalShmonShares + (totalShmonShares - principalSharesAtSettle)
              > totalShmonShares ← pool balance → INSOLVENT
```

The winner's `claimPrize()` reverts because shares were drained by principal withdrawals.

**Reproduction:** `npx hardhat test test-js/v2-full.spec.js` — tests T49, T51, T57, T67 fail.

### Fix

For Settled rounds with positive yield, return the user's pro-rata share of `principalSharesAtSettle` based on their MON contribution. For Failed/Skipped/zero-yield rounds, return original shares unchanged.

**Why pro-rata by MON:** Both deposit paths charge the same MON per ticket. Pro-rata by MON ensures every user gets back shares worth exactly their deposited MON at the current rate, regardless of whether they deposited via MON or shMON.

```solidity
function withdrawPrincipal(uint256 rid) external nonReentrant {
    RoundData storage r = rounds[rid];
    if (r.state != RoundState.Settled && r.state != RoundState.Skipped && r.state != RoundState.Failed) {
        revert BadState();
    }

    UserPosition storage p = positions[rid][msg.sender];
    uint256 originalShares = p.principalShmonShares;
    if (originalShares == 0) revert NothingToWithdraw();

    uint256 shares;
    if (r.state == RoundState.Settled && r.prizeShares > 0) {
        // Positive yield: return shares worth user's MON principal at settle-time rate.
        shares = r.principalSharesAtSettle * uint256(p.principalMON) / r.totalPrincipalMON;
    } else {
        // Failed, Skipped, or zero/negative yield: return original shares unchanged.
        shares = originalShares;
    }

    p.principalMON = 0;
    p.principalShmonShares = 0;
    principalMON[rid][msg.sender] = 0;

    bool ok = shmon.transfer(msg.sender, shares);
    if (!ok) revert TransferFailed();

    emit PrincipalWithdrawn(rid, msg.sender, shares, shmon.convertToAssets(1e18));
}
```

**Rounding:** Solidity integer division rounds down. Each user gets up to 1 wei less. After all withdrawals, pool retains up to N wei dust (N = number of users). Winner claims exact `prizeShares`. Dust stays permanently. Acceptable.

---

## Issue 3: Missing `getWithdrawableShares` View

Frontend needs to display the exact MON value a user will receive on withdrawal. Without this view, the frontend must replicate the pro-rata math in JS.

```solidity
function getWithdrawableShares(uint256 rid, address user) external view returns (uint256) {
    RoundData storage r = rounds[rid];
    UserPosition storage p = positions[rid][user];
    if (p.principalShmonShares == 0) return 0;

    if (r.state == RoundState.Settled && r.prizeShares > 0) {
        return r.principalSharesAtSettle * uint256(p.principalMON) / r.totalPrincipalMON;
    }
    return p.principalShmonShares;
}
```

---

## Test Updates

### Tests needing adjustment for accounting fix

- **T35, T36** (`winner/loser withdraws principal`): Expect pro-rata amount, not original shares, for settled rounds with positive yield.
- **T37** (`multi-round withdraws`): Same adjustment per round.

### Currently failing tests (should pass after fix)

- **T49**: `total shares out (principal + prize) <= pool balance`
- **T51**: `after all withdraws + claims, pool balance ~= 0`
- **T57**: `pause blocks buys but allows withdraws/claims`
- **T67**: `multi-user mixed deposits, all withdraw`

### New tests to add

- **T68**: `getWithdrawableShares` returns pro-rata for positive-yield settled round
- **T69**: `getWithdrawableShares` returns original shares for zero-yield settled round
- **T70**: `getWithdrawableShares` returns original shares for Failed round
- **T71**: `getWithdrawableShares` returns 0 for user with no position
- **T72**: `commit reverts before salesEndTime + yieldPeriodSec`
- **T73**: `commit succeeds after salesEndTime + yieldPeriodSec`
- **T74**: `nextExecutable returns None during yield period`
- **T75**: `nextExecutable returns Commit after yield period`
- **T76**: `getCommitAfterTime returns correct value`
- **T77**: `constructor rejects yieldPeriodSec < 3600`

### Tests needing adjustment for yield period

All tests that call `commit()` immediately after `advancePastSales()` need to also advance past the yield period:

```js
// BEFORE:
await advancePastSales()       // +3601s past salesEnd
await pool.commit(1)

// AFTER:
await advancePastSalesAndYield() // +3601s + yieldPeriodSec past salesEnd
await pool.commit(1)
```

Update the `deployFixture` to pass `yieldPeriodSec` (use a short value like 7200 for tests to keep them fast).

---

## Acceptance Criteria

- [ ] Constructor accepts `yieldPeriodSec` parameter
- [ ] `commit()` gated by `salesEndTime + yieldPeriodSec`
- [ ] `nextExecutable()` respects yield period
- [ ] `getCommitAfterTime()` view works
- [ ] `withdrawPrincipal()` returns pro-rata for positive-yield rounds
- [ ] `getWithdrawableShares()` view works
- [ ] All 77 tests green
- [ ] Deploy script updated with `YIELD_PERIOD_SEC` env var
- [ ] No new compiler warnings
- [ ] Gas within 10% of current for all functions
