# V2 Frontend UX — MON-Denominated, Ticket-First

**Priority:** P1 — ship alongside contract fix, before Vault C mainnet deploy
**Parent:** `phase2-builder-spec-a-v2-contract.md`
**Depends on:** `phase2-v2-accounting-fix.md` (needs `getWithdrawableShares` view)
**Effort:** 2–3 days

---

## Design Principles

1. **Tickets are the product.** Users buy and redeem tickets. Not "deposit shMON into a yield-bearing vault."
2. **MON is the currency.** Every price, balance, prize, and withdrawal value shown in MON. shMON share counts are never displayed to users.
3. **shMON by name.** When referencing the token, say "shMON" — not "staked MON." There are multiple LSTs on Monad (shMON, gMON, aprMON). Be specific.
4. **Simple redemption.** Don't show exact shMON amounts on withdrawal. Users redeem tickets, shMON arrives in their wallet. If power users notice share counts differ, that's a support conversation, not a UI problem.

---

## Wallet Balance Display

Top of page, when connected:

```
Wallet: 12.4 MON · 8.2 MON in shMON
```

- MON balance: native balance from `provider.getBalance(account)`
- shMON balance: `shmon.convertToAssets(shmon.balanceOf(account))` — always shown as MON equivalent
- Cache `convertToAssets(1e18)` for 15 seconds to avoid hammering RPC

---

## Vault Card

```
┌─────────────────────────────────────┐
│  Vault C — Round 14                 │
│  Ticket price: 1 MON               │
│  Est. prize: ~2.3 MON              │
│  412 tickets · 38 players          │
│  Deposits close in 14h 22m         │
│                                     │
│          [ Buy Tickets ]            │
└─────────────────────────────────────┘
```

**Round phases displayed to user:**

| Contract state | Time window | Card shows |
|---|---|---|
| Open, before salesEndTime | Deposit window | "Deposits close in Xh Ym" + Buy button enabled |
| Open, after salesEndTime, before commitAfterTime | Yield accruing | "Yield accruing · Drawing in Xd Xh" + Buy button hidden |
| Committed | Target block set | "Drawing..." + Buy button hidden |
| Settled | Winner picked | "Round complete · Winner: 0xAb...cD" |
| Skipped | No tickets | "Round skipped — no entries" |
| Failed | Blockhash expired | "Round cancelled" |

Use `getCommitAfterTime(rid)` to compute the "Drawing in" countdown.

---

## Buy Modal

```
┌─────────────────────────────────────┐
│  Buy Tickets — Round 14            │
│                                     │
│  Tickets: [ 5 ]  ×  1 MON  =  5 MON│
│                                     │
│  Pay with:                          │
│    ● MON          (bal: 12.4 MON)   │
│    ○ shMON        (bal: 8.2 MON)    │
│                                     │
│          [ Buy 5 Tickets ]          │
└─────────────────────────────────────┘
```

### Pay with MON
- Calls `buyTicketsMON(5)` with `msg.value = 5 * ticketPriceMON`
- Uses raw `eth_sendTransaction` pattern (carry forward from V1 nonce fix)
- Identical to V1 flow from user's perspective

### Pay with shMON
- Shows shMON balance as MON equivalent (via `convertToAssets`)
- If balance insufficient: "Insufficient shMON balance" inline error, button disabled
- If first time: two-step flow — "Approve shMON" → then "Buy 5 Tickets"
- Approval default: exact amount. Optional "Approve unlimited" checkbox for power users.
- Calls `buyTicketsShmon(5)` via raw `eth_sendTransaction`
- On success toast: "5 tickets purchased for Round 14"

### Validation
- Ticket count must be >= 1
- Ticket count input: number field with +/- buttons, max reasonable cap (e.g. 100)
- Disable buy button if wallet not connected or wrong network
- Disable buy button if deposit window has closed

---

## My Rounds — Active Round

```
Round 14  ·  5 tickets  ·  Deposits close in 14h 22m
```

or if past deposit window:

```
Round 14  ·  5 tickets  ·  Yield accruing · Drawing in 5d 12h
```

No action buttons during active round.

---

## My Rounds — Settled (Did Not Win)

```
Round 12  ·  5 tickets  ·  No win
Deposited: 5.00 MON

[ Redeem ]         Redeem as MON →
```

### Redeem (primary button)
- Calls `withdrawPrincipal(rid)` via raw `eth_sendTransaction`
- User receives shMON in wallet
- Toast: "Tickets redeemed successfully"
- Do NOT show shMON amount in toast or UI
- Row updates to show "Redeemed" status

### Redeem as MON (secondary text link)
- Calls `withdrawPrincipal(rid)` — same as above
- After transaction confirms, opens `https://shmonad.xyz` in new tab
- Toast: "Tickets redeemed. Opening shmonad.xyz to convert to MON..."
- We do NOT handle the shMON-to-MON conversion ourselves

---

## My Rounds — Settled (Won)

```
Round 12  ·  5 tickets  ·  Won!
Deposited: 5.00 MON  ·  Prize: 2.30 MON

[ Redeem ]   [ Claim Prize ]         Redeem as MON →
```

### Claim Prize
- Calls `claimPrize(rid)` via raw `eth_sendTransaction`
- Toast: "Prize claimed: 2.30 MON"
- Prize amount: `shmon.convertToAssets(prizeShares)` — always displayed in MON
- Button disappears after claim, row shows "Prize claimed"

### Redeem + Claim order
- Either order works (contract supports both)
- Both buttons visible until their respective action is completed
- Each button has independent busy state (spinner on the clicked button only)

---

## My Rounds — Failed / Skipped

```
Round 11  ·  3 tickets  ·  Round cancelled
Deposited: 3.00 MON

[ Redeem ]         Redeem as MON →
```

Same redemption flow. Failed/Skipped rounds return original shares (no pro-rata needed — no settlement occurred).

---

## Prize Display

**During deposit window (estimated):**

```
Est. prize: ~2.3 MON
```

Computed: `shmon.convertToAssets(totalShmonShares) - totalPrincipalMON` projected forward to end of yield period using current APY. If negative or negligible, show "~0 MON."

This is an estimate. Use conservative projection. Fine to be approximate — the exact prize is only known at settlement.

**During yield accrual:**

Same estimate, updated each refresh cycle. Gets more accurate as settlement approaches.

**After settlement:**

```
Prize: 2.30 MON
```

Exact value: `shmon.convertToAssets(prizeShares)` at the rate stored in `shareRateAtSettle`.

---

## No-Loss Messaging

**Header tagline (pick one):**
- "Buy tickets. One winner takes the yield. Everyone gets their MON back."
- "No-loss lottery. Your MON is always preserved."

**FAQ / tooltip (for users who ask):**
> When you buy tickets, your MON is converted to shMON and earns staking yield during the round. At the end, one lucky ticket holder wins all the yield. Everyone else redeems their tickets for the same MON value they put in. You never lose your deposit — only the yield is at stake.

---

## Deposited MON Value Display

When showing "Deposited: X MON" in My Rounds, use the recorded `principalMON` from the contract (via `getUserPosition`). This is the exact MON the user paid, regardless of deposit method.

For the withdrawable value:
- Call `getWithdrawableShares(rid, user)` → shares
- Convert: `shmon.convertToAssets(shares)` → MON value
- Display as "Deposited: 5.00 MON" (use the original principalMON, not the current value — they should always match in MON terms)

---

## Multiple Vaults

V2 uses two staggered vaults (Vault C and Vault D) for continuous availability. The frontend must:

- Show both vault cards on the main page
- Clearly label each (Vault C, Vault D)
- Indicate which is currently accepting deposits vs accruing yield
- My Rounds aggregates across both vaults (already works this way in V1)
- Pool address detection: `VITE_POOL_ADDRESSES_V2` env var, comma-separated

---

## Implementation Notes

- All write calls: raw `eth_sendTransaction` pattern (no ethers `populateTransaction`)
- All MON conversions: `shmon.convertToAssets(shares)` — cache the rate for 15s
- `getWithdrawableShares(rid, user)` for accurate withdrawal values
- `getCommitAfterTime(rid)` for yield period countdown
- `getRoundInfo(rid)` for round state, tickets, principal, prize
- `getUserPosition(rid, user)` for user's deposited MON and tickets
- Per-row busy state on Redeem/Claim buttons (carry forward `withdrawingRid` pattern from V1)
- Refresh interval: 60s for vault summaries, 60s for my rounds

---

## What's NOT in This Spec

- shMON management panel (Phase 2c) — still exists at `/shmon` as standalone feature, but main flow redirects to shmonad.xyz instead
- "Keep Playing" button — removed, users redeem and re-enter manually
- shMON share counts anywhere in the UI — never shown
- Post-redemption tracking — scope ends when shMON leaves our contract
