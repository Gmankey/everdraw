# Draw Lifecycle

EverDraw V5 still has draw periods and draw IDs internally, but deposits and withdrawals are continuous. Your live balance is measured over time, and each weekly draw uses the time-weighted balance from that draw period.

---

## 1. Deposit anytime

Deposit MON or shMON whenever you want. Once confirmed, the deposit becomes vault principal, is staked as shMON, and starts earning entries for the current weekly draw from that moment onward.

Depositing earlier in the draw period gives that balance more time to count. Depositing late is fine; it just earns a smaller slice of entries for that draw.

---

## 2. Entries accrue through the draw period

Entries accrue from balance over time at the V5 rate:

```
0.005 entries per MON per minute
```

The app shows your live entries for the current draw and a progress bar toward the next prize draw. This countdown is not a deposit deadline. It is simply the time until the current draw period is measured and a prize can be awarded.

---

## 3. The weekly draw runs

At the end of the draw period, the keeper starts the draw. The protocol snapshots the time-weighted entry totals, escrows the available yield as the prize, requests verifiable randomness, and finalizes the winner set.

If there is no prize yield or no eligible entries, the draw can be skipped. Holding through a skipped draw can still matter for points and streaks, but there is no empty prize paid.

[How winners are selected ->](winner-selection.md)

---

## 4. Claim or auto-compound prize

If you win, the prize is surfaced in the app. V5 supports prize restaking, so a prize may be compounded back into your vault principal unless you opt out where the app provides that choice. Claimable prizes do not expire.

---

## 5. Withdraw anytime

You can withdraw principal at any time. Withdrawing stops future entries on the withdrawn amount, but it does not erase the time-weighted entries already earned during the current draw period.

Withdrawals can affect points streaks and tranche tenure. A full withdrawal resets that pool's streak; a partial withdrawal consumes the newest tranche first while older remaining tranches keep their tenure.

---

## At a glance

| Stage | What is happening |
|---|---|
| Deposit | MON or shMON enters the vault and starts earning entries |
| Accrue | Entries build from time-weighted balance during the weekly draw period |
| Draw | Randomness selects winner(s) from that draw's entries |
| Prize | Yield is paid or restaked; principal remains withdrawable |
| Withdraw | Principal can leave anytime, subject to points-streak effects |

---

## Edge cases

**No entries or no prize.** If a draw has no eligible entries or no yield to pay, the keeper can skip it rather than creating a meaningless prize.

**Randomness delay.** If randomness is delayed, the draw waits for the configured recovery path. Principal withdrawals remain separate from prize finalization.

**Temporary pause.** A pause can stop new deposits while preserving withdrawals and claims.

**Deferred payouts.** If a payout transfer cannot complete immediately, it is recorded for retry. Funds are not lost.
