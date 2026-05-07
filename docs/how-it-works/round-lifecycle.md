# Round Lifecycle

A round runs for one week. The first 24 hours are the deposit window. The next 6 days are the lock, where your shMON balance grows in value as Monad's staking yield accrues. At the end of the lock, the keeper draws a winner and the cycle starts again.

EverDraw runs two vaults on offset weekly schedules. Vault A opens every Wednesday at 13:00 UTC. Vault B opens every Sunday at 01:00 UTC. The worst case wait for the next deposit window is around 2.5 days.

---

## State 1. Open

**Duration: 24 hours.**

The vault accepts deposits. You can buy tickets at any point in the window. Each purchase is staked as shMON inside the contract and starts accruing yield immediately.

The UI shows a green progress ring with the time remaining. When the timer hits zero, deposits close and the lock begins.

You cannot withdraw during an open round. Your principal stays in the vault until the round settles.

---

## State 2. Committed

The keeper closes the round and records a target block number. That block hash is the source of randomness for the draw. This happens automatically the moment the lock period elapses, and the new deposit window for next week opens at the same time.

If nobody bought tickets, the round goes straight to **Skipped** and no draw runs.

---

## State 3. Lock (yield accrual)

**Duration: 6 days.**

Your shMON sits in the vault and earns Monad's staking yield. Nothing else happens on chain. The UI shows a purple ring counting down to settlement.

The yield accrued during the lock is the prize. There is no unstaking step. The contract holds shMON the whole time.

---

## State 4. Settled

A few seconds after the lock ends, the keeper reads the committed block hash and computes the winning ticket. The winner is recorded on chain. The previous round is now visible under "Previous Vault" in the UI.

From this point:

- **Winners** can claim the prize and withdraw their principal.
- **Everyone else** can withdraw their principal.

Both actions are available immediately. There is no claim deadline.

If the keeper somehow misses the settlement window for more than 255 blocks (the EVM block hash retention limit), the round goes to **Failed** and every depositor can withdraw their original shMON. No prize is paid. This has never happened in production and is not a state users should plan around.

---

## Timeline

| State | Duration | Happening |
|---|---|---|
| Open | 24 hours | Deposits accepted |
| Committed | one keeper transaction | Random source locked, next round opens |
| Lock | 6 days | shMON accrues staking yield (the prize) |
| Settled | indefinite | Claim and withdraw available |

---

## Two vaults, offset by 3.5 days

Vault A and Vault B run the same lifecycle on different anchors. At any given moment, exactly one is in its lock period and the other is around 3.5 days away from its next open. You don't have to choose between them. They are the same product on staggered schedules so you never wait a full week to deposit.
