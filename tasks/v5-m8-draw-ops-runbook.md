# V5 M8 Draw Ops Runbook

**Status:** Draft for M8 execution.

## Normal Cycle

For each accelerated testnet cycle, record:

- cycle/draw id
- native MON deposit tx
- direct shMON deposit tx
- optional sponsor deposit tx
- draw start tx
- seed tx/event
- root proposal tx and root
- finalization tx/event
- claim tx
- withdraw tx
- frontend/indexer screenshots or API responses

## Keeper Path

Builder-safe checks:

```bash
npm run keeper:env-check
npm run draw:watch
```

Operator/Builder with approved testnet keeper only:

- Start keeper against the V5 testnet addresses.
- Verify heartbeat pings.
- Verify no repeated errors.
- Verify root proposals match the watcher recomputation.

## Keeper-Outage Drill

1. Record keeper healthy state and latest heartbeat.
2. Stop/kill the keeper.
3. Wait for watcher/healthcheck stale alert.
4. Complete a cycle through permissionless fallback calls.
5. Restart keeper.
6. Confirm keeper reconciles state without double-acting.

## Config-Drift Drill

1. Point keeper at a deliberately wrong V5 testnet vault.
2. Confirm reconciliation alert fires within SLA.
3. Restore correct config.
4. Confirm next heartbeat and reconciliation return healthy.

## Abort Conditions

- Watcher is down during an active root challenge window.
- Root mismatch alert is ignored or cannot be independently reproduced.
- Keeper and watcher are hosted on the same failure domain.
- Permissionless fallback cannot progress the draw.
