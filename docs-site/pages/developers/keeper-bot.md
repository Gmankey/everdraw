# Keeper Bot

The keeper bot is the automated off-chain service that drives round state transitions. It is the operational backbone of EverDraw — without it, rounds do not progress automatically. However, any wallet can call the same functions manually.

---

## What the keeper does

The keeper polls `nextExecutable()` on a regular interval. This function returns the round ID and the action that is currently due (Commit, Draw, Settle, or None). When an action is due, the keeper:

1. Runs preflight safety checks — simulates the transaction, checks gas, verifies state preconditions
2. Submits the transaction via `executeNext()`
3. Monitors for confirmation
4. Sends a Telegram alert for the outcome (success or failure)
5. Retries with backoff on failure

**Action types:**
- `Commit` — called when the sales window closes. Locks the target block number.
- `Draw` — called when the target block is reached. Draws the winner.
- `Settle` — called when ShMON unstaking completes (epoch check). Finalises the round.
- `Skip` — called when a round needs to be skipped (e.g. zero tickets sold).

---

## Preflight safety

Before submitting any transaction, the keeper:

- Simulates the call via `eth_call` and checks for reverts
- Verifies the contract state matches the expected preconditions
- Checks that gas estimates are within acceptable bounds
- Verifies the keeper wallet has sufficient MON for gas

If any preflight check fails, the transaction is not submitted, and an alert is sent to the operator. This prevents gas burns on failed transactions and ensures the keeper only submits when it is safe to do so.

---

## Operational characteristics

- Runs as a systemd service with automatic restart on failure
- Telegram alerting for all state transitions, errors, and anomalies
- Configurable polling interval and retry logic
- Operates autonomously — no manual intervention required for normal round operations

---

## Non-privileged design

The keeper is not a privileged operator. It cannot:
- Access or move user funds
- Modify contract parameters
- Override round outcomes

Any wallet can call `executeNext()`. The keeper simply ensures it is called reliably. If the keeper goes down, rounds pause until it recovers — but no funds are at risk. The contract is the source of truth, not the keeper.
