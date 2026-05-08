# Round Lifecycle

Every round runs for one week. The first 24 hours are the deposit window. The next 6 days are the lock, where your deposit earns staking yield. At the end of the lock, a winner is drawn and the previous round opens for claim and withdrawal. The same vault's next deposit window opens at that exact moment.

The UI walks you through 4 stages.

---

## 1. Deposit

**Duration: 24 hours.**

The vault is open. Buy tickets at any point in the window. Each ticket costs 1 MON, and your deposit is held as shMON inside the vault. Yield starts accruing the moment your transaction confirms.

The countdown ring runs green. Buys are disabled in the final 30 seconds before the window closes to avoid transactions reverting on the boundary.

You cannot withdraw mid round. Plan your deposit timing accordingly.

---

## 2. Yield Accruing

**Duration: 6 days.**

The deposit window has closed. Your shMON sits in the vault and earns Monad's native staking yield. The countdown ring runs purple. Nothing else happens on chain. There is no internal unstaking, the contract holds shMON the whole time.

The yield earned during these 6 days is the prize. The longer the lock, the bigger the pot.

---

## 3. Winner Revealed

When the lock countdown reaches zero, the keeper closes the round and records a target block number on chain. Three blocks later (around six seconds on Monad), it reads that block's hash and uses it to compute the winning ticket. The winner's address is written to chain immediately.

At the same moment the round closes, the vault's next deposit window opens. Vault A re-opens every Wednesday at 13:00 UTC. Vault B every Sunday at 01:00 UTC. The cycle restarts with no gap.

The randomness is verifiable. The target block is committed before it is mined, so nobody, including the keeper, can know the winning number in advance.

---

## 4. Claim / Withdraw

The just-finished round becomes available for action.

- **Winners** claim the prize.
- **Everyone else** withdraws their principal.

Claims and withdrawals stay open indefinitely. Funds sit in the contract until you action them. There is no expiry.

---

## Timeline at a glance

| Stage | Duration | Happening |
|---|---|---|
| Deposit | 24 hours | Tickets accepted |
| Yield Accruing | 6 days | shMON earns staking yield |
| Winner Revealed | seconds | Draw runs, next deposit window opens |
| Claim / Withdraw | indefinite | Funds available to action |

---

## Edge cases

**Skipped.** If nobody bought tickets in the round, no draw runs. The next deposit window opens on schedule. No funds are at risk because there were none.

**Failed.** If the keeper somehow misses the settlement window for more than 255 blocks (Monad's block hash retention limit), the round is finalized without a draw and every depositor can withdraw their original principal. No prize is paid. This has never happened in production and is not a state users should plan around.


