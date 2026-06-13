# EverDraw protocol alerting runbook (2026-06-13)

This is the minimum production alerting posture before accepting meaningful public funds.

## Required alert paths

Use three independent paths. Telegram alone is not acceptable.

1. **Fly keeper local alerts**: keeper, alert watcher, and watchdog processes inside `everdraw-keeper`.
2. **External dead-man**: healthchecks.io checks for keeper, alert watcher, watchdog, and protocol monitor. Alerts must go to email plus a second channel such as SMS, PagerDuty, Opsgenie, or Slack.
3. **External read-only protocol monitor**: GitHub Actions `protocol-monitor` workflow every 5 minutes. It uses no private key and exits non-zero if the protocol needs intervention.

OpenClaw cron is not part of production safety. It can remind humans, but it is not a protocol monitor.

## Healthchecks.io setup

Create four checks:

| Check | Period | Grace | Secret |
|---|---:|---:|---|
| `everdraw-keeper-execute` | 5 min | 5 min | `KEEPER_HEALTHCHECK_URL` |
| `everdraw-keeper-alert-watcher` | 15 min | 5 min | `ALERT_WATCHER_HEALTHCHECK_URL` |
| `everdraw-keeper-watchdog` | 5 min | 5 min | `KEEPER_WATCHDOG_HEALTHCHECK_URL` |
| `everdraw-protocol-monitor` | 5 min | 5 min | `PROTOCOL_MONITOR_HEALTHCHECK_URL` |

For each check, configure alerts to at least two channels. Email-only is not enough.

## GitHub Actions secrets

Set these in `Gmankey/everdraw` repository secrets:

```text
MONAD_MAINNET_RPC_URL=https://rpc.monad.xyz
PROTOCOL_MONITOR_HEALTHCHECK_URL=<healthchecks ping URL>
PROTOCOL_MONITOR_HEALTHCHECK_FAIL_URL=<optional explicit /fail URL>
```

Then run:

```bash
gh workflow run protocol-monitor.yml --ref staging
gh run list --workflow protocol-monitor.yml --limit 3
```

The workflow must pass once before this control counts as live.

## Fly keeper secrets

Set these on the production Fly app:

```bash
flyctl secrets set -a everdraw-keeper \
  KEEPER_POOL_RECONCILE=true \
  KEEPER_ALERT_REPEAT_MS=3600000 \
  ALERT_WATCHER_ACTION_OVERDUE_MS=600000 \
  ALERT_WATCHER_ACTION_OVERDUE_CHECK_MS=60000 \
  KEEPER_HEALTHCHECK_URL='<keeper healthcheck URL>' \
  ALERT_WATCHER_HEALTHCHECK_URL='<alert watcher healthcheck URL>' \
  KEEPER_WATCHDOG_HEALTHCHECK_URL='<watchdog healthcheck URL>'
```

Then deploy and verify:

```bash
flyctl deploy . -c scripts/keeper/fly.toml --ha=false
flyctl machines list -a everdraw-keeper
flyctl logs -a everdraw-keeper
```

Required log evidence:

- Keeper start log includes `canonicalPoolReconcile=true` and `healthcheck=true`.
- Alert watcher start log includes `canonicalPoolReconcile=true` and `healthcheck=true`.
- Watchdog start log includes `root=/app` and `healthcheck=true`.
- `POOL_ADDRESSES` contains exactly:

```text
0x933FF608eaC2b3221088bd9AE19b05F266dBF7DA,0x08bdD3710abB0616Cc29f388867f5625106B2A3E,0x1886f329e486e934c76028B15a580850e74d404C,0x9263d84a141172d9618f4b08839f595EE03bC7E8
```

## V4.1-A round 1 verification

Commit becomes due at `2026-06-14T14:58:17Z`.

At or after `2026-06-14T15:10:00Z`, run:

```bash
RPC_URL=https://rpc.monad.xyz npm run protocol:monitor
cast call --rpc-url https://rpc.monad.xyz 0x933FF608eaC2b3221088bd9AE19b05F266dBF7DA 'nextExecutable()(uint256,uint8)'
cast call --rpc-url https://rpc.monad.xyz 0x933FF608eaC2b3221088bd9AE19b05F266dBF7DA 'currentRoundId()(uint256)'
```

Expected: `nextExecutable` is not stuck actionable. If it returns `action=2` (`Commit`) or another non-zero action, keeper automation failed and the protocol monitor must alert.

## Operator-only actions

Builder/PM must not create, fund, hold, sweep, or use private keys.

These remain operator/Ledger-only:

- V4-A `withdrawVRFReserve`.
- V4-A `stop()`.
- V4-B retirement actions.
- Any emergency execution if the keeper fails and a public caller is not used.
