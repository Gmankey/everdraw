# Everdraw — Mainnet Ops Runbook

**Updated:** 2026-03-02  
**Scope:** Keeper operations for `TicketPrizePoolShmonShMonad` (`executeNext()` automation)

---

## 1) Prerequisites

- Node.js installed
- Repo checked out at:
  - `/home/c/.openclaw/workspace/monad-prize`
- Keeper env file configured:
  - `scripts/keeper.env`

Required env vars in `scripts/keeper.env`:
- `RPC_URL`
- `PRIVATE_KEY`
- `POOL_ADDRESS`

Recommended env vars:
- `KEEPER_INTERVAL_MS` (default `30000`)
- `KEEPER_DRY_RUN` (`true|false`)
- `KEEPER_LOW_BALANCE_MON`
- `KEEPER_ERROR_ALERT_THRESHOLD`
- `KEEPER_BALANCE_LOG_EVERY_TICKS`
- `KEEPER_HEARTBEAT_LOG_EVERY_TICKS`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

---

## 2) Local/manual run (quick test)

> Important: `keeper.env` lives under `scripts/`, so load it first.

```bash
cd /home/c/.openclaw/workspace/monad-prize
set -a
source scripts/keeper.env
set +a
node scripts/keeper-execute-next.js
```

Stop with `Ctrl+C`.

---

## 3) systemd operation (recommended)

### Install/start
```bash
cd /home/c/.openclaw/workspace/monad-prize
mkdir -p logs
sudo cp scripts/monad-prize-keeper.service /etc/systemd/system/monad-prize-keeper.service
sudo systemctl daemon-reload
sudo systemctl enable --now monad-prize-keeper
```

### Common commands
```bash
sudo systemctl status monad-prize-keeper --no-pager
sudo systemctl restart monad-prize-keeper
sudo systemctl stop monad-prize-keeper
sudo journalctl -u monad-prize-keeper -f
```

### Logs
```bash
tail -f /home/c/.openclaw/workspace/monad-prize/logs/keeper.out.log
tail -f /home/c/.openclaw/workspace/monad-prize/logs/keeper.err.log
```

---

## 4) PM2 operation (alternative, not primary)

Use PM2 only if systemd is unavailable. Do not run both PM2 and systemd at the same time.

```bash
npm i -g pm2
cd /home/c/.openclaw/workspace/monad-prize
pm2 start scripts/pm2.ecosystem.config.cjs
pm2 save
pm2 startup
```

---

## 5) One-command health check

```bash
cd /home/c/.openclaw/workspace/monad-prize
npm run keeper:health
```

This prints:
- systemd enabled/active status
- top service status block
- recent keeper out logs
- quick metrics (errors/recommit warnings/last heartbeat/last mined tx)
- recent keeper err logs

---

## 6) Gate C evidence capture

Use this at each checkpoint:

```bash
cd /home/c/.openclaw/workspace/monad-prize
./scripts/collect-gate-c-evidence.sh "T+6h"
./scripts/collect-gate-c-evidence.sh "T+12h"
./scripts/collect-gate-c-evidence.sh "T+24h"
```

Evidence file:
- `tasks/everdraw-gate-c-evidence-2026-03-02.md`

---

## 7) Incident quick actions

### Service not running
```bash
sudo systemctl restart monad-prize-keeper
sudo systemctl status monad-prize-keeper --no-pager
```

### RPC instability
- Update `RPC_URL` in `scripts/keeper.env`
- Restart service

### Repeated tx failures
- Set `KEEPER_DRY_RUN=true`
- Restart service
- Verify chain, pool address, paused state, and wallet balance

### Low balance alerts
- Top up keeper wallet
- Confirm fresh balance log appears

---

## 8) Change management checklist

Before production config changes:
- [ ] Backup `scripts/keeper.env`
- [ ] Apply config change
- [ ] `sudo systemctl restart monad-prize-keeper`
- [ ] Confirm `active (running)`
- [ ] Run `npm run keeper:health`
- [ ] Watch logs for 10–15 minutes
