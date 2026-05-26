# Builder Ticket: MyRounds shows zero prize for V3 winners (and breaks Redeem)

**Target:** `web/src/App.jsx` (frontend only — no contract or indexer changes)  
**Deadline:** Wed 2026-05-28 12:00 UTC (before Vault A V3 goes live at 13:00 UTC; once V3 has winners the bug becomes user-facing)  
**Related:** Builds on `0b12c7a fix(frontend): unify redeem button flows`. This is a follow-up fix to a gap that PR didn't cover.

---

## The bug

In the MyRounds tab, V3 winners will see:

- **Prize column:** `0.0000 MON` (wrong — they actually won a real prize)
- **Action column:** no Redeem button (because the gating check `prizeWei > 0n` evaluates false)

The /winners page works correctly — it has its own prize-computation path via `winnersUsesSharePrizeAccounting`. The bug is isolated to the MyRounds tab.

V2 winners are unaffected; V2 has a working branch. Legacy V1 winners are unaffected; they use a different loop that reads `info.yieldMON` directly.

## Why it happens

In `web/src/App.jsx`, the MyRounds data is assembled by two loops:

1. **Legacy V1 loop** (around lines 1985–2027): iterates `poolAddresses` (the `VITE_POOL_ADDRESSES` env). Uses `POOL_ABI` and reads `info.yieldMON` via `roundYieldWei(info, false)`. Correct as-is.

2. **Indexer-rows loop** (around lines 2030–2083): iterates rows from `${INDEXER_URL}/api/wallets/${account}/rounds`. This is where V2 **and** V3 rounds appear.

In loop #2, there is a V2-specific re-fetch branch that computes the prize via share accounting:

```js
if (isV2round) {
  const pool = new ethers.Contract(r.poolAddress, POOL_V2_ABI, provider)
  const [info, commitAt, userPos] = await Promise.all([...])
  prizeWei = roundYieldWei(info, true)   // share accounting
  prizeClaimed = Boolean(info.prizeClaimed)
  // ...
}
```

There is **no equivalent V3 branch**. So for a V3 row:

- `prizeWei` stays as `BigInt(r.prizeClaimed || '0')`, which is the indexer's *claimed amount* field — `0` until the winner claims.
- `prizeClaimed` stays as `r.prizeClaimed !== '0'`, which means "have they claimed yet" — but is `false` for unclaimed prizes.

Combined effect: an unclaimed V3 winner sees `prizeWei = 0` and the row's `canClaimPrize` check fails.

## The fix

Add a V3 branch to the indexer-rows loop, mirroring the existing V2 branch but adapted to V3's different on-chain shape.

### V3-specific facts to use

- V3 pool addresses live in `poolAddressesV3` (parsed from `VITE_POOL_ADDRESSES_V3`).
- V3 `getRoundInfo(rid)` returns `principalSharesAtSettle` and `prizeShares` (in shMON shares). It does **not** return `shareRateAtSettle` — V3 settlement emits `(roundId, principalShares, prizeShares)` only.
- Converting V3 `prizeShares` to MON requires calling `shmon.previewRedeem(prizeShares)` at read time. This returns the current MON value of those shares.
- `info.prizeClaimed` is a bool on the V3 round struct, same as V2.

### Code change

In `web/src/App.jsx`, in the indexer-rows loop, add a V3 branch alongside the V2 one. Approximate shape:

```js
const isV2round = poolAddressesV2.some((a) => a.toLowerCase() === r.poolAddress.toLowerCase())
const isV3round = !isV2round && poolAddressesV3.some((a) => a.toLowerCase() === r.poolAddress.toLowerCase())

// ...existing state derivation...

if (isV2round) {
  // existing V2 branch unchanged
}

if (isV3round) {
  try {
    const pool = new ethers.Contract(r.poolAddress, POOL_V3_ABI, provider)
    const [info, userPos] = await Promise.all([
      getCachedRoundInfo(pool, r.poolAddress, BigInt(r.roundId), ac.signal),
      _cached(
        `userPositionV3:${r.poolAddress}:${r.roundId}:${account}`,
        10_000,
        () => pool.getUserPosition(BigInt(r.roundId), account).catch(() => null),
        ac.signal,
      ),
    ])
    normalizedState = Number(info.state)
    prizeClaimed = Boolean(info.prizeClaimed)

    const prizeShares = BigInt(info.prizeShares || 0n)
    if (prizeShares > 0n) {
      const shmonContract = new ethers.Contract(SHMON_ADDRESS, SHMON_ABI, provider)
      prizeWei = await _cached(
        `shmonPreviewRedeem:${prizeShares.toString()}`,
        15_000,
        () => shmonContract.previewRedeem(prizeShares).catch(() => 0n),
        ac.signal,
      )
    } else {
      prizeWei = 0n
    }

    if (userPos) {
      remainingPrincipalWei = BigInt(userPos[0] || 0n)
    }
  } catch (err) {
    if (isAbortError(err)) throw err
  }
}
```

Notes on the snippet:

- `POOL_V3_ABI` must include at minimum `getRoundInfo(uint256)`, `getUserPosition(uint256, address)`, and any view selectors the existing helpers use. If it doesn't already exist in `App.jsx`, define it next to `POOL_V2_ABI`.
- `SHMON_ABI` currently only has `getInternalEpoch`. Extend it with `function previewRedeem(uint256 shares) view returns (uint256)`. Don't add anything else in this PR — keep the ABI tight.
- `SHMON_ADDRESS` — define from env (`VITE_SHMON_ADDRESS`) or hardcode the mainnet address `0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c`. Prefer env so testnet still works.
- The `_cached` wrapper around `previewRedeem` keys by share amount only, with a 15s TTL. This avoids one RPC call per render and per row. Stale-by-15s is acceptable for a display value.
- Wrap the whole branch in a `try/catch` that only rethrows on abort, matching the existing V2 pattern.

### Don't change the legacy V1 loop

The first loop (around lines 1985–2027) is correct for legacy V1 pools and must not be touched. Verify by leaving any test that asserts on legacy rows unchanged.

### Update the `getUserPosition` fallback

If the V3 contract's `getUserPosition` shape differs from V2, the destructure (`userPos[0]`) must match V3's returns. Verify against `src/TicketPrizePoolShmonV3.sol`. If V3 uses a different selector (e.g. just reading `principalMON(rid, account)` directly), use that instead and skip the `userPos` fetch.

## Edge cases the fix must handle

| Case | Expected |
|------|----------|
| V3 round, user is winner, prize not yet claimed | Prize column shows MON value via `previewRedeem`; Redeem button enabled |
| V3 round, user is winner, prize already claimed | Prize column shows the claimed amount (already correct via indexer); Redeem button only enabled if principal is still in (won't be once `withdrawPrincipal` ran) |
| V3 round, user is depositor but not winner, principal still in | Redeem button enabled for principal-only |
| V3 round, no yield (prizeShares == 0) | Prize column shows `0.0000 MON`; no Redeem prize attempt (canClaimPrize stays false) |
| V3 round in `Open` / `AwaitingVRF` / `Drawn` (not yet Settled) | `canWithdraw` and `canClaimPrize` both false (the existing `isTerminalRound` check handles this) |
| V3 round skipped | `prizeShares == 0`, no prize, principal withdrawable — same as legacy skipped |
| RPC failure mid-fetch | Row falls back to indexer-only values (same as the V2 branch's `catch`); does not throw out of the loop |

## Test plan

No contract tests needed. Verification is end-to-end in the browser.

### Manual on testnet (preferred)

1. Connect to Monad testnet, point frontend at a V3 testnet vault that has at least one settled round with a winner.
2. As the winning wallet, open MyRounds. Confirm the prize column shows a non-zero MON value and the Redeem button is enabled.
3. Click Redeem. Confirm two transactions fire (claimPrize + withdrawPrincipal) per the prior PR.
4. After both confirm, refresh MyRounds. Prize column should now show the claimed amount (from the indexer's `prizeClaimed` field). Row should no longer show a Redeem button.

### Mainnet smoke after V3 deploys

5. Once Vault A V3 has its first settled round with a winner (~Wed evening), the winner should see the same correct values.

### Regression

6. Confirm a V2 winning round in MyRounds still shows the correct prize and Redeem button (no change to that path).
7. Confirm a legacy V1 row in MyRounds still shows the correct prize and Redeem button (no change to that path).
8. Confirm participants-only rows (non-winning depositors) still show Redeem for principal-only on terminal rounds.

## Deliverable

PR against `staging` containing only:

- `web/src/App.jsx` — V3 branch added to the indexer-rows loop; `SHMON_ABI` extended with `previewRedeem`; `POOL_V3_ABI` added if not already present; `SHMON_ADDRESS` defined.
- No new ADR (this is a bug fix, not a design change).

`npm run build` must pass. The branch should land before Wed 2026-05-28 12:00 UTC so the deploy after Vault A V3 deploys reflects the fix.

## Out of scope

- Indexer changes (exposing `unclaimedPrizeMon` server-side would be cleaner long-term but is more work and isn't needed if the frontend fetches on-chain).
- Any UI restyling of the MyRounds tab.
- Anything touching contracts or the keeper.

## Don't

- Don't modify the legacy V1 loop. It is correct.
- Don't change the V2 branch except to verify nothing regressed.
- Don't replace `previewRedeem` with a stored share-rate read — V3 doesn't store one.
- Don't add new fields to the row object that aren't strictly needed for this fix.
- Don't silently drop the row on RPC failure — fall back to indexer values like the V2 branch does.
