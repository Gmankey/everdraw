# Round Lifecycle

Every vault runs in repeating rounds. A round opens for deposits, locks while it earns yield, draws its winner(s), and then opens for claims and withdrawals as the next round begins. The app walks you through these stages with a status ring and countdown.

---

## 1. Deposit

The vault is open and accepting tickets. Buy at any point during the deposit window. Each ticket costs the vault's ticket price in MON, and your deposit is held as shMON inside the vault — yield starts accruing the moment your transaction confirms.

The status ring runs green while deposits are open. Buys are disabled in the final seconds before the window closes so transactions don't revert on the boundary. You cannot withdraw mid-round, so plan your deposit timing.

---

## 2. Yield Accruing (locked)

The deposit window has closed and the round is locked. Your shMON sits in the vault earning Monad's native staking yield. The status ring runs purple. The yield earned during the lock is the prize — a longer lock and a larger pool mean a bigger prize.

---

## 3. The Draw

When the lock ends, the round is committed and a verifiable random draw is requested. Within seconds to minutes, the randomness is delivered and the winning ticket(s) are computed and written on-chain. At the same moment the round settles, the vault's next deposit window opens — the cycle restarts with no gap.

The randomness comes from an external verifiable source and is committed before it can be known, so nobody — including the operator — can predict or influence the outcome in advance. The result is fully reproducible from on-chain data.

[How winners are selected →](winner-selection.md)

---

## 4. Claim / Withdraw

The just-settled round becomes available for action:

- **Winners** claim their prize.
- **Everyone else** withdraws their full principal.

Claims and withdrawals never expire. Funds stay in the contract until you action them, and you can return at any time to collect.

---

## At a glance

| Stage | What's happening | Status ring |
|---|---|---|
| Deposit | Tickets accepted | Green |
| Yield Accruing | shMON earns staking yield | Purple |
| Draw | Winner(s) selected, next round opens | — |
| Claim / Withdraw | Funds available, no expiry | — |

---

## Edge cases

**No participants.** If nobody buys tickets in a round, no draw runs and the next round simply opens. Any sponsor contributions to that round are refundable.

**Randomness timeout.** Randomness has a built-in timeout. If the draw isn't delivered in time, the round can be settled with no winner and every depositor withdraws their full principal. No prize is paid, and no round can be permanently locked.

**Temporary pause.** A vault can be paused, which stops new deposits while leaving existing claims and withdrawals fully available. A paused vault shows a closed status in the app.

**Deferred payouts.** In the rare event a payout transfer can't complete (for example, if the underlying yield token is briefly unavailable), the amount is recorded as a pending claim you can retry later — it is never lost.

## Multiple vaults

EverDraw runs more than one vault, on staggered schedules, so there is regularly a draw approaching across the protocol. Each vault is independent: it has its own ticket price, round timing, and prize structure, and behaves identically to the lifecycle above.
