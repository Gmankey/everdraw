# Keeper Bot

The keeper is the off chain service that drives round transitions. Without it, rounds do not advance automatically. Anyone with gas can call the same functions, so funds are not at risk if it goes offline.

---

## What the keeper does

It polls `nextExecutable()` on each configured pool every 30 seconds. The function returns the round id and the next pending action. When an action is due, the keeper:

1. Runs preflight: simulates the call, checks gas, verifies preconditions.
2. Submits the transaction.
3. Waits for confirmation and reports to Telegram.
4. Retries on the next poll if it failed.

Action types:

- **Commit.** Fired at the end of the lock period. Closes the previous round and opens the next one in the same transaction.
- **Settle.** Fired three blocks after commit. Reads the target block hash and computes the winner.
- **MarkFailed.** Fired if the target block hash falls outside the 255 block retention window. Should not happen in normal operation.
- **None.** Nothing to do this tick.

---

## Anchor gating

V2 vaults run on fixed weekly schedules. The contract's `commit` becomes eligible 5 minutes before each scheduled anchor (Wed 13:00 UTC for Vault A, Sun 01:00 UTC for Vault B). The keeper does not fire `commit` until the wall clock reaches the exact anchor. This keeps each vault's deposit window opening on the same weekday and time every week.

`settle` runs immediately when eligible. There is no anchor gate on settle.

If the keeper is offline for more than 5 minutes spanning an anchor, the new round opens at the moment of recovery instead, which permanently shifts that vault's anchor. Recovery procedure is in the runbook (`tasks/mainnet-ops-runbook.md`).

---

## Reliability

- systemd unit with `Restart=always` and a 5 second restart delay
- Multi RPC failover via `FallbackProvider`. Configure with `RPC_URL` and `RPC_URL_FALLBACK`.
- Low balance Telegram alert at 0.2 MON
- Consecutive error Telegram alert after 3 failures on the same pool
- Uncaught exception alert and graceful exit

---

## Configuration

Environment variables (typical mainnet):

```
RPC_URL=https://...
RPC_URL_FALLBACK=https://...
PRIVATE_KEY=...
POOL_ADDRESSES_V2=0x2208a2Fe2d08061B2a5ee69A2a3b906B58C17888,<vaultB>
POOL_SCHEDULE_V2=0x2208…7888:Wed:13,<vaultB>:Sun:01
KEEPER_INTERVAL_MS=30000
KEEPER_LOW_BALANCE_MON=0.2
KEEPER_ERROR_ALERT_THRESHOLD=3
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

Secrets are read from a file outside the repository. Never commit live keys.

---

## Non privileged

The keeper cannot access user funds, modify contract parameters, or override draws. It only calls `commit` and `settle`, which are public on the contract. The contract is the source of truth.
