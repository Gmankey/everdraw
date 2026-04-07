# Everdraw Testnet Burn-in Checklist (2026-03-02)

## 0) Security first (must do before restart)
- [ ] **Rotate keeper private key immediately** (key is currently present in `scripts/keeper.env`).
- [ ] Fund the **new** keeper wallet with MON for gas.
- [ ] Update `scripts/keeper.env` with new key.
- [ ] Confirm Telegram vars are set:
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`

## 1) Keeper config sanity
- [ ] `KEEPER_DRY_RUN=true` for initial dry-run.
- [ ] `KEEPER_INTERVAL_MS=30000` (or PM-approved value).
- [ ] `KEEPER_LOW_BALANCE_MON` set (default 0.2 MON).
- [ ] `KEEPER_ERROR_ALERT_THRESHOLD` set (default 3).
- [ ] `KEEPER_HEARTBEAT_LOG_EVERY_TICKS` set (default 10).

## 2) Process supervision sanity
Use exactly one supervisor (systemd **or** pm2), not both.

### systemd path
- [ ] Install service file to systemd unit location.
- [ ] `sudo systemctl daemon-reload`
- [ ] `sudo systemctl enable --now monad-prize-keeper`
- [ ] Verify restarts on failure (`Restart=always`).

### pm2 path
- [ ] `pm2 start scripts/pm2.ecosystem.config.cjs`
- [ ] `pm2 save`
- [ ] Verify autorestart and log paths.

## 3) Dry-run smoke test (15-30 min)
- [ ] Start keeper in dry-run.
- [ ] Confirm logs show:
  - startup line with pid/chainId/pool
  - periodic `idle` / `pending`
  - periodic `heartbeat` line (uptime, mem, error counters)
  - wallet balance logs
- [ ] Confirm no unhandled exception/rejection exits.
- [ ] Trigger/observe recommit condition if possible; verify warning + Telegram alert.

## 4) Live burn-in (24-48h)
- [ ] Set `KEEPER_DRY_RUN=false`.
- [ ] Run continuously for 24-48h.
- [ ] During run, verify:
  - tx sends/mines when actions are pending
  - no sustained consecutive errors
  - low-balance alerts fire when expected
  - missed-draw/recommit alerts fire when expected
  - process restarts cleanly if killed

## 5) Evidence pack for Gate C review
- [ ] Last 24h keeper logs (out + err)
- [ ] Tx hashes for executeNext actions
- [ ] Telegram alert screenshots/messages
- [ ] Incident summary (if any): timestamp, cause, mitigation
- [ ] Recommendation on keeper owner policy (D1)

## 6) Gate dependencies reminder
- [ ] D1 keeper owner decision (post burn-in)
- [ ] D5 ShMonad address finalization (still required before mainnet)
