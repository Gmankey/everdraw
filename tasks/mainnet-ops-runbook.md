# Everdraw — Mainnet Ops Runbook

**Updated:** 2026-03-02  
**Scope:** Keeper operations for `TicketPrizePoolShmonShMonad` (`executeNext()` automation)

---

## Keeper

Lives on Fly.io as `everdraw-keeper`. Source: `scripts/keeper-watchdog.js` (supervisor) + `scripts/keeper-execute-next.js` (worker). Config: `scripts/keeper/fly.toml`.

Keeper hot wallet: `0x80dE4674dEFC68F06F4772B8Ec2F89aBda43DBE9` — authorized on all V3 vaults via `setKeeper`. Top up periodically; alert fires below `0.2 MON`.

| Action | Command |
|--------|---------|
| View logs | `flyctl logs -a everdraw-keeper` |
| Tail logs (live) | `flyctl logs -a everdraw-keeper -f` |
| Check machine status | `flyctl status -a everdraw-keeper` |
| Restart (picks up secret changes) | `flyctl machine restart -a everdraw-keeper` |
| Update a pool address / schedule | `flyctl secrets set -a everdraw-keeper POOL_ADDRESSES='...'` |
| SSH in for debugging | `flyctl ssh console -a everdraw-keeper` |
| Stop temporarily | `flyctl scale count 0 -a everdraw-keeper` |
| Resume | `flyctl scale count 1 -a everdraw-keeper` |
| Redeploy after code change | `flyctl deploy -c scripts/keeper/fly.toml` |
| Rotate keeper hot key | `flyctl secrets set -a everdraw-keeper PRIVATE_KEY='...'`, call `setKeeper(newAddr, true)` from the owner wallet on each vault, then call `setKeeper(oldAddr, false)` to retire the old signer. |

Required cutover order:

1. Create the Fly app with `flyctl apps create everdraw-keeper`.
2. Set all Fly secrets from `/home/c/.config/everdraw/keeper-mainnet.env`; never commit the values.
3. Deploy first with `KEEPER_DRY_RUN=true`.
4. Tail Fly logs for about 10 minutes and confirm RPC, pool reads, ABI decoding, and Telegram heartbeat are healthy.
5. Stop the local keeper with `pkill -f keeper-watchdog.js` and `pkill -f keeper-execute-next.js`.
6. Confirm `ps -ef | grep keeper` has no local keeper process.
7. Flip Fly to live mode by setting `KEEPER_DRY_RUN=false`, then restart the machine.
8. Confirm the next keeper action, or no-action poll, appears only in Fly logs.
9. Disable any local autostart path so the laptop cannot restart a second signer.

Rollback before final cutover confirmation:

```bash
flyctl scale count 0 -a everdraw-keeper
cd ~/.openclaw/workspace/everdraw-clean
set -a
. /home/c/.config/everdraw/keeper-mainnet.env
set +a
nohup node scripts/keeper-watchdog.js > /tmp/keeper-watchdog.log 2>&1 &
```

After cutover, `/home/c/.config/everdraw/keeper-mainnet.env` remains the emergency local fallback. Do not delete it.

If the keeper is stopped for more than 30 minutes during an active VRF window on V3, the owner can call `emergencyForceSettle` after the 1-hour VRF timeout to recover.

### Keeper alert watcher

The same Fly app also runs `scripts/keeper-alert-watcher.js` as a separate `alerts` process. It watches only governance/security events on `POOL_ADDRESSES` and sends Telegram alerts for:

- `OwnershipTransferred`
- `EntropyChangeQueued`, `EntropyChanged`, `EntropyChangeCancelled`
- `FeeUpdated`
- `KeeperSet`
- `Paused`, `Unpaused`
- `VRFReserveWithdrawn`
- `EmergencyForceSettled`
- periodic low VRF reserve warnings

Required before enabling the `alerts` process:

```bash
flyctl volumes create everdraw_keeper_alert_state --region sjc --size 1 -a everdraw-keeper
flyctl secrets set -a everdraw-keeper VRF_LOW_THRESHOLD_MON='5'
```

`POOL_ADDRESSES`, `RPC_URL`, `RPC_URL_FALLBACK`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID` must already be present on `everdraw-keeper`. The watcher stores its catch-up cursor in `/data/keeper-alert-watcher-state.json`; do not remove the Fly volume unless you intentionally accept a manual governance-event review from the last stored block.

Deploy and scale:

```bash
flyctl deploy . -c scripts/keeper/fly.toml --ha=false
flyctl scale count keeper=1 alerts=1 -a everdraw-keeper
flyctl status -a everdraw-keeper
flyctl logs -a everdraw-keeper
```

Expected logs:

- boot line: `[alert-watcher] start ... watching N pools`
- scan lines when new blocks are processed
- heartbeat every 15 minutes: `[alert-watcher] heartbeat ...`

Smoke test after deploy:

1. From the owner wallet, call an idempotent benign governance action such as `setKeeper(existingKeeper, true)` on a watched vault.
2. Confirm a Telegram `Keeper ... authorized` alert arrives within 30 seconds.
3. If Telegram does not arrive, treat the alert path as broken and investigate before relying on it.

Add a recurring monthly operator check that repeats the same benign governance action and confirms Telegram delivery.

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

---

## 9) V2 two-vault staggered redeploy ops

**Applies to:** `TicketPrizePoolShmonV2` two-vault deployment per ADR-0001, ADR-0004, ADR-0005, and ADR-0006.

### Vault A pre-deploy checklist

- [ ] Confirm final Merkl metadata strings with PM before deploy:
  - `name = "EverDraw shMON Position"`
  - `symbol = "EVRDRAW-SHMON"`
- [ ] Confirm deploy params:
  - `ROUND_DURATION_SEC=86400`
  - `YIELD_PERIOD_SEC=518100`
- [x] PM-approved target anchor: Wednesday 13:00 UTC for 2026-05-06 redeploy, after the Wednesday 12:00 UTC window was aborted per timing guardrail.
- [ ] Submit the deploy transaction within the PM-approved window for the current attempt. For 2026-05-06 Vault A: submit at 12:59:50–12:59:55 UTC; abort config swaps if mined before 12:59:50 UTC or after 13:00:30 UTC. Per ADR-0005, the block timestamp of Vault A's first opened round becomes the permanent weekly anchor.
- [ ] Record Vault A address, deploy tx, deploy block, and first `RoundStarted.salesEndTime`.

### Vault B deploy trigger

- [ ] Schedule Vault B deployment exactly 3.5 days after Vault A's first round opens; with the 2026-05-06 13:00 UTC Vault A target, this is Sunday 2026-05-10 01:00 UTC.
- [ ] For Vault B, stage at T-15, run T-4 dry-run, then submit at 00:59:52 UTC inside the 00:59:50–01:00:30 UTC window; abort config swaps if mined outside that window.
- [ ] Use the same constructor params as Vault A unless PM explicitly changes ticket price or owner.
- [ ] Record Vault B address, deploy tx, deploy block, and first `RoundStarted.salesEndTime`.
- [ ] Register both Vault A and Vault B addresses with Merkl/shMonad after deployment.

### Keeper V2 env/config

Use `scripts/keeper-execute-next-v2.js` for the fresh vaults.

Required:
- `RPC_URL`
- `RPC_URL_FALLBACK` — distinct Monad mainnet RPC endpoint for `ethers.FallbackProvider`
- `PRIVATE_KEY`
- `POOL_ADDRESSES_V2=<vaultA>,<vaultB>`
- `POOL_SCHEDULE_V2=<vaultA>:Wed:13,<vaultB>:Sun:01` — replace placeholders with the fresh deployed addresses for the 2026-05-06 13:00 UTC / 2026-05-10 01:00 UTC schedule.

Keeper behavior:
- Polling stays at `KEEPER_INTERVAL_MS=30000`.
- `commit()` is gated to the pool's configured weekly anchor window, ±60 seconds.
- `settle()` / mark-failed settlement is not anchor-gated and should run as soon as `nextExecutable()` allows it.
- Existing retry-on-next-tick and Telegram alert thresholds remain unchanged.

### Keeper anchor-shift recovery (ADR-0005 H)

If a keeper outage or bad config causes a vault to commit outside the intended weekday/time anchor:

1. Pause the affected vault as owner with `pause()`.
2. Wait until the next correct weekly anchor time for that vault.
3. At the target moment, unpause with `unpause()` and let the keeper execute the next eligible `commit()` cycle.
4. A skipped/missed round during outage recovery is acceptable for Phase 1 per ADR-0005 H.
5. Update `POOL_SCHEDULE_V2` only if PM intentionally accepts the new anchor.

Do not add an absolute-time scheduling contract change or timed-deploy tooling for this recovery path; both are explicitly out of scope.

### Retiring current Vault A

Current V2 vault to retire later: `0xed67ad46C694a5e963119a1Ca5F88eEBbb6e5a8a`.

After its current round settles and the user withdraws principal:
- [ ] Remove the old address from keeper `POOL_ADDRESSES_V2`.
- [ ] Remove the old address from frontend `VITE_POOL_ADDRESSES_V2`.
- [ ] Keep historical indexer data; do not delete on-chain or DB history.
