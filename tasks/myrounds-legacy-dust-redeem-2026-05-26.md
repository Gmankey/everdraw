# Builder Ticket: MyRounds shows phantom Redeem button on legacy/retired vaults

**Target:** `web/src/App.jsx` (frontend only — no contract or indexer changes)  
**Severity:** User-visible. Causes failed transactions on rounds that are actually fully redeemed.  
**Deadline:** Anytime, but ideally before Wednesday's V3 launch so we don't ship more confusion on top.

---

## The bug

On the MyRounds tab, fully-redeemed rounds on the retired Legacy Vault B (`0xed67ad46...`) show a **REDEEM** button. Clicking it triggers a `withdrawPrincipal` transaction that immediately reverts on simulation ("Transaction is likely to fail").

Confirmed example:
- Pool: `0xed67ad46C694a5e963119a1Ca5F88eEBbb6e5a8a`
- Round: 4
- Wallet: winner of that round
- On-chain truth: `principalMON(4, winner) == 0`, `prizeClaimed == true`
- UI shows: Prize column "0.0027 MON" (correct — this is the historical claimed amount), Action column **REDEEM** (wrong — should be "Claimed")

## Root cause

In the indexer-rows loop (`web/src/App.jsx` around lines 2030–2083), `remainingPrincipalWei` is computed as:

```js
const monPaidWei = BigInt(r.monPaid || '0')
const principalWithdrawnWei = BigInt(r.principalWithdrawn || '0')
let remainingPrincipalWei = principalWithdrawnWei >= monPaidWei
  ? 0n
  : monPaidWei - principalWithdrawnWei
```

For legacy / V2-compat contracts, the on-chain `PrincipalWithdrawn` event emits an amount that is the **MON equivalent of the shMON shares returned to the user** at withdraw time. Because the shMON share rate is non-trivially > 1 by the time of withdraw, that MON equivalent is slightly **less** than the user's original `monPaid`. The subtraction therefore leaves a tiny positive residual (~0.0000277 MON in the case above) even though the on-chain `principalMON[rid][user]` slot has been zeroed.

The dust survives the `>= monPaidWei` guard because it's still strictly less. `canWithdraw = remainingPrincipalWei > 0n` becomes true. The Redeem button appears. Clicking it calls `withdrawPrincipal`, which reverts.

The V2 branch in the same loop sidesteps this by re-fetching `getUserPosition(rid, user)` from the V2 contract and overwriting `remainingPrincipalWei`. There is no equivalent re-fetch for non-V2, non-V3 rows (i.e. legacy and V2-compat contracts like `0xed67...`).

## The fix

In the indexer-rows loop, add an on-chain re-fetch for rows where the pool is **not** in `poolAddressesV2` and **not** in `poolAddressesV3`. Use the legacy `POOL_ABI` already imported. Call `pool.principalMON(rid, user)` and overwrite `remainingPrincipalWei` with the on-chain value.

Approximate placement — alongside the existing V2 branch:

```js
const isV2round = poolAddressesV2.some((a) => a.toLowerCase() === r.poolAddress.toLowerCase())
const isV3round = !isV2round && poolAddressesV3.some((a) => a.toLowerCase() === r.poolAddress.toLowerCase())
const isLegacyRound = !isV2round && !isV3round

// ... existing V2 branch unchanged ...
// ... V3 branch from the separate myrounds-v3-prize-display ticket goes here ...

if (isLegacyRound) {
  try {
    const pool = new ethers.Contract(r.poolAddress, POOL_ABI, provider)
    const onchainPrincipal = await _cached(
      `legacyPrincipal:${r.poolAddress}:${r.roundId}:${account}`,
      10_000,
      () => pool.principalMON(BigInt(r.roundId), account).catch(() => null),
      ac.signal,
    )
    if (onchainPrincipal !== null) {
      remainingPrincipalWei = BigInt(onchainPrincipal)
    }
  } catch (err) {
    if (isAbortError(err)) throw err
  }
}
```

Notes:

- Use the cache key `legacyPrincipal:` (distinct from the V2 cache key) so this doesn't collide with anything.
- Use a 10-second TTL — matches the V2 pattern.
- Fail safe: on RPC error, fall back to the indexer-computed value. We don't want a flakey RPC to throw the whole MyRounds load.
- This adds one RPC call per legacy/retired row per wallet per refresh. For most wallets this is 0–2 rows. Acceptable.

## Action column verification

No code change required in the rendering. The current logic is:

```js
const canRedeemRound = Boolean(r.canClaimPrize || r.canWithdraw)
// ...
{canRedeemRound ? (
  <button>Redeem</button>
) : (
  r.state === 0 ? <button>Deposit</button>
                : (isTerminalRound(r.state, r.isV2) && !canRedeemRound ? 'Claimed' : '—')
)}
```

Once `remainingPrincipalWei` correctly reflects on-chain zero, `r.canWithdraw` becomes false, `canRedeemRound` becomes false, and the action column will correctly show "Claimed" for the user's case. **Do not relabel or restructure the action or prize column** — the only required change is fixing the underlying `remainingPrincipalWei` value.

## Edge cases the fix must handle

| Case | Expected |
|------|----------|
| Legacy round, prize claimed + principal withdrawn (Round 4 on `0xed67`) | Action column: "Claimed". No Redeem button. |
| Legacy round, prize claimed + principal NOT withdrawn (someone only claimed prize) | Action column: "Redeem". Clicking it fires only `withdrawPrincipal`. |
| Legacy round, prize NOT claimed + principal withdrawn | Action column: "Redeem". Clicking it fires only `claimPrize`. |
| Legacy round, neither claimed | Action column: "Redeem". Clicking it fires both (via the existing redeem-flow PR). |
| Legacy round, never won, principal already withdrawn | Action column: "Claimed". No Redeem button. |
| V2 round, fully redeemed | Already works via existing `getUserPosition` re-fetch — must not regress. |
| V3 round (after V3 launches) | Handled by the separate `myrounds-v3-prize-display` ticket. Not in scope here. |
| RPC failure mid-fetch on a legacy row | Falls back to indexer-computed remaining; row may incorrectly show Redeem button. Acceptable degradation. Wrap in try/catch matching the V2 pattern. |

## Test plan

End-to-end in the browser. No contract or unit-test changes needed.

1. **Reproduce the bug first.** Connect the winning wallet to https://everdraw.xyz, open MyRounds, find Round #4 on `0xed67`. Confirm the **REDEEM** button is visible and clicking it triggers a "transaction is likely to fail" wallet warning.
2. **Deploy the fix locally** and confirm the same row now shows **Claimed** in the action column. Prize column should still display 0.0027 MON unchanged.
3. **Don't regress V2.** Open a V2 round on `0x2208...` or `0xd4F4...` where you've fully redeemed. Confirm it correctly shows "Claimed". Open one where you still need to redeem — confirm Redeem button works.
4. **Spot-check legacy round still-claimable case.** If you can find any wallet that participated in a legacy round and has principal still in the contract, confirm Redeem button still works for that case.

## Deliverable

PR against `staging` containing only:

- `web/src/App.jsx` — the on-chain re-fetch for non-V2, non-V3 indexer rows.

`npm run build` must pass. Hand-test against production data on staging before deploying to prod.

## Out of scope

- Indexer changes. The on-chain re-fetch makes the indexer's slight overcount harmless for the UI.
- Any change to the prize column label or value (user explicitly wants it unchanged).
- Any change to the action column wording — current "Claimed" / "Redeem" / "Deposit" labeling is fine once the underlying state is correct.
- V3 prize display — separate ticket (`myrounds-v3-prize-display-2026-05-26.md`).

## Don't

- Don't apply a dust threshold (e.g. "treat anything below 1e10 wei as 0"). Thresholds are arbitrary and will hide real bugs in the future. The contract is the source of truth — read from it.
- Don't change the indexer's `principalWithdrawn` accounting. The indexer is correctly reporting what the events say. The mismatch with the contract slot is a property of legacy V2-compat — fix the consumer, not the source.
- Don't fold this into the V3 prize-display ticket. They live in the same loop and might both ship together, but the bugs and the test cases are distinct — separate tickets keep the review scope clear.
