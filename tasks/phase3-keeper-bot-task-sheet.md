# Phase 3 Task Sheet — executeNext Keeper Bot

**Date:** 2026-03-01  
**Goal:** Run a reliable keeper that calls `executeNext()` for lifecycle progression on testnet/mainnet.

## Implemented artifact

- Script: `scripts/keeper-execute-next.js`

## Required env vars

- `RPC_URL` — Monad RPC endpoint
- `PRIVATE_KEY` — funded keeper EOA
- `POOL_ADDRESS` — deployed `TicketPrizePoolShmonShMonad` address

## Optional env vars

- `KEEPER_INTERVAL_MS` (default `30000`)
- `KEEPER_DRY_RUN` (`true|false`, default `false`)
- `KEEPER_GAS_LIMIT`
- `KEEPER_MAX_FEE_GWEI`
- `KEEPER_MAX_PRIORITY_FEE_GWEI`
- `KEEPER_LOW_BALANCE_MON` (default `0.2`)
- `KEEPER_ERROR_ALERT_THRESHOLD` (default `3`)
- `KEEPER_BALANCE_LOG_EVERY_TICKS` (default `20`)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## Runtime behavior

1. Poll `nextExecutable()`
2. If `action == None`, log idle
3. Else send `executeNext()` transaction
4. Wait for 1 confirmation and log status/gas
5. Track wallet balance and warn if below threshold
6. Track consecutive errors and alert once threshold is hit
7. Alert on `Recommit` action (missed draw window signal)
8. Repeat every interval

## Operational guidance

- Start with `KEEPER_DRY_RUN=true` for smoke test
- Use 30s cadence (or faster) to reduce chance of missing draw window
- Keep wallet funded and monitor balance
- Add process supervision in production (systemd/pm2/docker restart policy)
- Send logs to persistent sink/alerting

## Suggested follow-up hardening

- Multi-RPC failover
- Exponential backoff on transient RPC errors
- Alerting hooks (Slack/Discord/Telegram) for repeated failures
- Health endpoint / heartbeat file for external monitoring
- Log rotation via `scripts/logrotate-monad-prize-keeper.conf`

## Log rotation setup (Linux)

```bash
sudo cp scripts/logrotate-monad-prize-keeper.conf /etc/logrotate.d/monad-prize-keeper
sudo logrotate -f /etc/logrotate.d/monad-prize-keeper
```

Policy:
- Rotate daily
- Keep 14 archives
- Compress old logs
- `copytruncate` enabled for long-running node process
