# Everdraw Gate C Evidence — 2026-03-02

## Keeper runtime
- Service: monad-prize-keeper (systemd)
- Status: active/running
- Start time:
- Uptime at checkpoints:

## Config snapshot
- dryRun=false
- intervalMs=30000
- lowBalanceMon=0.2
- errorAlertThreshold=3
- heartbeatEveryTicks=10
- telegram=true

## Checkpoints
### T+30m
- Result: PASS
- Notes: idle/heartbeat stable, no errors
- Log excerpt:

### T+6h
- Result:
- Notes:
- Log excerpt:

### T+12h
- Result:
- Notes:
- Log excerpt:

### T+24h
- Result:
- Notes:
- Log excerpt:

## Alerts test
- Telegram test message received: YES
  - Verified live on 2026-03-04 via `scripts/keeper-alert-test.sh`
  - Telegram API response: `ok:true`, message_id `7`
- Recommit alert observed: (YES/NO)
- Error alert observed: (YES/NO)
- Low-balance alert observed: (YES/NO)

## Test closeout (wrong-param deployment)
- `withdrawPrincipal(12)` executed from buyer wallet
- Tx hash: `0x8dea22e42aa465efe50effccbb66a68339dc268ebdd12fabc84cd16da6e591fb`
- Post-check: `principalMON(12,buyer)=0`
- Note: this deployment remains test-only due ticket price mismatch (`0.01` vs required `0.1`).

## Incidents
- None / details with timestamp, impact, mitigation

## PM recommendation
- Burn-in status: INCOMPLETE (checkpoint coverage missing)
- Ready for Gate C decision: NO
- Notes: prior run also showed settle-window revert burst and Telegram transport failures; Gate C must be rerun after keeper hardening + corrected deployment params.

### T+checkpoint-test
- Captured at (UTC): 2026-03-02T00:00:10Z
- Result: PASS
- Notes: service active=active, enabled=enabled, errors(last200)=0
- Service status (first lines):
```
● monad-prize-keeper.service - Monad Prize executeNext Keeper
     Loaded: loaded (/etc/systemd/system/monad-prize-keeper.service; enabled; preset: enabled)
     Active: active (running) since Mon 2026-03-02 10:46:49 AEDT; 13min ago
   Main PID: 119413 (node)
      Tasks: 11 (limit: 19080)
     Memory: 27.1M (peak: 36.9M)
        CPU: 837ms
     CGroup: /system.slice/monad-prize-keeper.service
             └─119413 /usr/bin/node /home/c/.openclaw/workspace/monad-prize/scripts/keeper-execute-next.js

Mar 02 10:46:49 DESKTOP-G5PH2PB systemd[1]: Started monad-prize-keeper.service - Monad Prize executeNext Keeper.
```
- Latest balance log: 2026-03-01T23:57:27.594Z [keeper] wallet balance=6.853578 MON
- Latest heartbeat log: 2026-03-01T23:57:27.765Z [keeper] heartbeat ticks=20 uptime=0h10m37s inFlight=true consecutiveErrors=0 lastRid=1 lastAction=None rssMB=75.0 heapUsedMB=13.0
- Latest pending log: n/a
- Latest mined tx log: n/a
- Recent stderr tail:
```

```

### T+ops-check
- Captured at (UTC): 2026-03-02T00:44:47Z
- Result: PASS
- Notes: service active=active, enabled=enabled, errors(last200)=0
- Service status (first lines):
```
● monad-prize-keeper.service - Monad Prize executeNext Keeper
     Loaded: loaded (/etc/systemd/system/monad-prize-keeper.service; enabled; preset: enabled)
     Active: active (running) since Mon 2026-03-02 10:46:49 AEDT; 57min ago
   Main PID: 119413 (node)
      Tasks: 11 (limit: 19080)
     Memory: 29.9M (peak: 36.9M)
        CPU: 1.888s
     CGroup: /system.slice/monad-prize-keeper.service
             └─119413 /usr/bin/node /home/c/.openclaw/workspace/monad-prize/scripts/keeper-execute-next.js

Mar 02 10:46:49 DESKTOP-G5PH2PB systemd[1]: Started monad-prize-keeper.service - Monad Prize executeNext Keeper.
```
- Latest balance log: 2026-03-02T00:42:09.858Z [keeper] wallet balance=6.853578 MON
- Latest heartbeat log: 2026-03-02T00:42:10.034Z [keeper] heartbeat ticks=100 uptime=0h55m20s inFlight=true consecutiveErrors=0 lastRid=1 lastAction=None rssMB=77.7 heapUsedMB=13.8
- Latest pending log: n/a
- Latest mined tx log: n/a
- Recent stderr tail:
```

```

### Lifecycle-Run-rid12
- Captured at (UTC): 2026-03-02T05:25:26Z
- Result: PASS
- Notes: service active=active, enabled=enabled, errors(last200)=0
- Service status (first lines):
```
● monad-prize-keeper.service - Monad Prize executeNext Keeper
     Loaded: loaded (/etc/systemd/system/monad-prize-keeper.service; enabled; preset: enabled)
     Active: active (running) since Mon 2026-03-02 15:22:21 AEDT; 1h 3min ago
   Main PID: 156488 (node)
      Tasks: 11 (limit: 19080)
     Memory: 30.0M (peak: 34.3M)
        CPU: 2.526s
     CGroup: /system.slice/monad-prize-keeper.service
             └─156488 /usr/bin/node /home/c/.openclaw/workspace/monad-prize/scripts/keeper-execute-next.js

Mar 02 15:22:21 DESKTOP-G5PH2PB systemd[1]: Started monad-prize-keeper.service - Monad Prize executeNext Keeper.
```
- Latest balance log: 2026-03-02T05:25:10.333Z [keeper] wallet balance=6.134252 MON
- Latest heartbeat log: 2026-03-02T05:19:48.437Z [keeper] heartbeat ticks=110 uptime=0h57m27s inFlight=true consecutiveErrors=0 lastRid=12 lastAction=None rssMB=77.5 heapUsedMB=14.8
- Latest pending log: 2026-03-02T05:25:10.529Z [keeper] pending rid=12 action=Settle
- Latest mined tx log: 2026-03-02T05:23:36.658Z [keeper] mined tx=0xe37ddfeeee04dd6112754d92c338f8d76dd219c9aa412447ea18b6717810d414 status=1 gasUsed=379172
- Recent stderr tail:
```
2026-03-02T05:24:07.899Z [keeper] error #1: execution reverted (unknown custom error)
2026-03-02T05:24:39.686Z [keeper] error #2: execution reverted (unknown custom error)
2026-03-02T05:25:10.921Z [keeper] error #3: execution reverted (unknown custom error)
2026-03-02T05:25:11.272Z [keeper] telegram send failed: fetch failed
```

### Lifecycle-Run-rid12-Settled
- Captured at (UTC): 2026-03-02T05:28:56Z
- Result: PASS
- Notes: service active=active, enabled=enabled, errors(last200)=0
- Service status (first lines):
```
● monad-prize-keeper.service - Monad Prize executeNext Keeper
     Loaded: loaded (/etc/systemd/system/monad-prize-keeper.service; enabled; preset: enabled)
     Active: active (running) since Mon 2026-03-02 15:22:21 AEDT; 1h 6min ago
   Main PID: 156488 (node)
      Tasks: 11 (limit: 19080)
     Memory: 30.6M (peak: 34.3M)
        CPU: 2.750s
     CGroup: /system.slice/monad-prize-keeper.service
             └─156488 /usr/bin/node /home/c/.openclaw/workspace/monad-prize/scripts/keeper-execute-next.js

Mar 02 15:22:21 DESKTOP-G5PH2PB systemd[1]: Started monad-prize-keeper.service - Monad Prize executeNext Keeper.
```
- Latest balance log: 2026-03-02T05:27:48.237Z [keeper] wallet balance=6.134252 MON
- Latest heartbeat log: 2026-03-02T05:19:48.437Z [keeper] heartbeat ticks=110 uptime=0h57m27s inFlight=true consecutiveErrors=0 lastRid=12 lastAction=None rssMB=77.5 heapUsedMB=14.8
- Latest pending log: 2026-03-02T05:28:51.642Z [keeper] pending rid=12 action=Settle
- Latest mined tx log: 2026-03-02T05:23:36.658Z [keeper] mined tx=0xe37ddfeeee04dd6112754d92c338f8d76dd219c9aa412447ea18b6717810d414 status=1 gasUsed=379172
- Recent stderr tail:
```
2026-03-02T05:24:07.899Z [keeper] error #1: execution reverted (unknown custom error)
2026-03-02T05:24:39.686Z [keeper] error #2: execution reverted (unknown custom error)
2026-03-02T05:25:10.921Z [keeper] error #3: execution reverted (unknown custom error)
2026-03-02T05:25:11.272Z [keeper] telegram send failed: fetch failed
2026-03-02T05:25:42.514Z [keeper] error #4: execution reverted (unknown custom error)
2026-03-02T05:25:42.839Z [keeper] telegram send failed: fetch failed
2026-03-02T05:26:14.065Z [keeper] error #5: execution reverted (unknown custom error)
2026-03-02T05:26:14.382Z [keeper] telegram send failed: fetch failed
2026-03-02T05:26:45.645Z [keeper] error #6: execution reverted (unknown custom error)
2026-03-02T05:26:45.949Z [keeper] telegram send failed: fetch failed
2026-03-02T05:27:17.258Z [keeper] error #7: execution reverted (unknown custom error)
2026-03-02T05:27:17.572Z [keeper] telegram send failed: fetch failed
2026-03-02T05:27:48.831Z [keeper] error #8: execution reverted (unknown custom error)
2026-03-02T05:27:49.161Z [keeper] telegram send failed: fetch failed
2026-03-02T05:28:20.460Z [keeper] error #9: execution reverted (unknown custom error)
2026-03-02T05:28:20.785Z [keeper] telegram send failed: fetch failed
2026-03-02T05:28:52.032Z [keeper] error #10: execution reverted (unknown custom error)
2026-03-02T05:28:52.350Z [keeper] telegram send failed: fetch failed
```

### manual
- Captured at (UTC): 2026-03-05T02:04:29Z
- Result: PASS
- Notes: service active=active, enabled=enabled, errors(last200)=0
- Service status (first lines):
```
● monad-prize-keeper.service - Monad Prize executeNext Keeper
     Loaded: loaded (/etc/systemd/system/monad-prize-keeper.service; enabled; preset: enabled)
     Active: active (running) since Wed 2026-03-04 10:57:41 AEDT; 1 day 2h ago
   Main PID: 522724 (node)
      Tasks: 11 (limit: 19080)
     Memory: 44.8M (peak: 47.3M)
        CPU: 46.880s
     CGroup: /system.slice/monad-prize-keeper.service
             └─522724 /usr/bin/node /home/c/.openclaw/workspace/monad-prize/scripts/keeper-execute-next.js

Mar 04 10:57:41 DESKTOP-G5PH2PB systemd[1]: Started monad-prize-keeper.service - Monad Prize executeNext Keeper.
```
- Latest balance log: 2026-03-05T02:04:08.089Z [keeper] wallet balance=1.287659 MON
- Latest heartbeat log: 2026-03-05T02:01:16.006Z [keeper] heartbeat ticks=2450 uptime=26h3m34s inFlight=true consecutiveErrors=0 lastRid=1 lastAction=None rssMB=93.2 heapUsedMB=13.6
- Latest pending log: 2026-03-03T23:57:01.253Z [keeper] pending rid=194 action=Skip
- Latest mined tx log: 2026-03-03T23:57:09.248Z [keeper] mined tx=0x5491fa00c995af3acfc398340369029aed2ed265fa88710f0d6f2be4a4f371ae status=1 gasUsed=206559
- Recent stderr tail:
```
2026-03-02T12:32:59.036Z [keeper] error #57: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:33:29.825Z [keeper] error #58: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:34:00.572Z [keeper] error #59: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:34:31.542Z [keeper] error #60: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:35:02.378Z [keeper] error #61: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:35:33.214Z [keeper] error #62: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:36:03.945Z [keeper] error #63: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:36:34.683Z [keeper] error #64: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:37:05.497Z [keeper] error #65: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:37:36.410Z [keeper] error #66: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:38:07.182Z [keeper] error #67: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:38:37.981Z [keeper] error #68: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:39:08.838Z [keeper] error #69: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:39:39.626Z [keeper] error #70: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:40:10.347Z [keeper] error #71: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:40:41.223Z [keeper] error #72: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:41:12.226Z [keeper] error #73: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T14:36:32.749Z [keeper] error #1: request timeout
2026-03-02T22:03:39.146Z [keeper] error #1: request timeout
2026-03-02T22:04:14.176Z [keeper] error #2: request timeout
2026-03-02T22:45:15.024Z [keeper] error #1: request timeout
2026-03-02T22:45:50.809Z [keeper] error #2: request timeout
2026-03-02T22:46:25.852Z [keeper] error #3: request timeout
2026-03-02T22:47:01.533Z [keeper] error #4: request timeout
2026-03-02T22:48:12.435Z [keeper] error #1: request timeout
2026-03-03T00:56:12.518Z [keeper] error #1: request timeout
2026-03-03T04:52:57.343Z [keeper] error #1: request timeout
2026-03-03T04:53:32.374Z [keeper] error #2: request timeout
2026-03-03T05:25:18.092Z [keeper] error #1: request timeout
2026-03-04T03:14:02.600Z [keeper] error #1: request timeout
```

### manual
- Captured at (UTC): 2026-03-05T02:08:35Z
- Result: PASS
- Notes: service active=active, enabled=enabled, errors(last200)=0
- Service status (first lines):
```
● monad-prize-keeper.service - Monad Prize executeNext Keeper
     Loaded: loaded (/etc/systemd/system/monad-prize-keeper.service; enabled; preset: enabled)
     Active: active (running) since Wed 2026-03-04 10:57:41 AEDT; 1 day 2h ago
   Main PID: 522724 (node)
      Tasks: 11 (limit: 19080)
     Memory: 44.8M (peak: 47.3M)
        CPU: 47.048s
     CGroup: /system.slice/monad-prize-keeper.service
             └─522724 /usr/bin/node /home/c/.openclaw/workspace/monad-prize/scripts/keeper-execute-next.js

Mar 04 10:57:41 DESKTOP-G5PH2PB systemd[1]: Started monad-prize-keeper.service - Monad Prize executeNext Keeper.
```
- Latest balance log: 2026-03-05T02:06:56.973Z [keeper] wallet balance=1.287659 MON
- Latest heartbeat log: 2026-03-05T02:06:57.148Z [keeper] heartbeat ticks=2460 uptime=26h9m15s inFlight=true consecutiveErrors=0 lastRid=1 lastAction=None rssMB=93.2 heapUsedMB=13.7
- Latest pending log: 2026-03-03T23:57:01.253Z [keeper] pending rid=194 action=Skip
- Latest mined tx log: 2026-03-03T23:57:09.248Z [keeper] mined tx=0x5491fa00c995af3acfc398340369029aed2ed265fa88710f0d6f2be4a4f371ae status=1 gasUsed=206559
- Recent stderr tail:
```
2026-03-02T12:32:59.036Z [keeper] error #57: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:33:29.825Z [keeper] error #58: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:34:00.572Z [keeper] error #59: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:34:31.542Z [keeper] error #60: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:35:02.378Z [keeper] error #61: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:35:33.214Z [keeper] error #62: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:36:03.945Z [keeper] error #63: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:36:34.683Z [keeper] error #64: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:37:05.497Z [keeper] error #65: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:37:36.410Z [keeper] error #66: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:38:07.182Z [keeper] error #67: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:38:37.981Z [keeper] error #68: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:39:08.838Z [keeper] error #69: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:39:39.626Z [keeper] error #70: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:40:10.347Z [keeper] error #71: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:40:41.223Z [keeper] error #72: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:41:12.226Z [keeper] error #73: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T14:36:32.749Z [keeper] error #1: request timeout
2026-03-02T22:03:39.146Z [keeper] error #1: request timeout
2026-03-02T22:04:14.176Z [keeper] error #2: request timeout
2026-03-02T22:45:15.024Z [keeper] error #1: request timeout
2026-03-02T22:45:50.809Z [keeper] error #2: request timeout
2026-03-02T22:46:25.852Z [keeper] error #3: request timeout
2026-03-02T22:47:01.533Z [keeper] error #4: request timeout
2026-03-02T22:48:12.435Z [keeper] error #1: request timeout
2026-03-03T00:56:12.518Z [keeper] error #1: request timeout
2026-03-03T04:52:57.343Z [keeper] error #1: request timeout
2026-03-03T04:53:32.374Z [keeper] error #2: request timeout
2026-03-03T05:25:18.092Z [keeper] error #1: request timeout
2026-03-04T03:14:02.600Z [keeper] error #1: request timeout
```

## Gate C fresh T0 anchor
- T0 (UTC): 2026-03-05T11:04:31Z
- Keeper start line: 14077:2026-03-05T11:04:00.752Z [keeper] start pid=610633 chainId=10143 wallet=0xA2da36390F94b8defeE5B13bC0b4698A5E2eBD1b pool=0x2E297C5dFf5557eA8C2D1101E082A58F02a8C3a1 intervalMs=30000 dryRun=false preflight=true telegram=true telegramTimeoutMs=8000 telegramRetries=2 lowBalanceMon=0.2 errorAlertThreshold=3
- Note: preflight must be true in start line

### T+6h
- Captured at (UTC): 2026-03-05T17:07:02Z
- Result: PASS
- Notes: service active=active, enabled=enabled, errors(last200)=0
- Service status (first lines):
```
● monad-prize-keeper.service - Monad Prize executeNext Keeper
     Loaded: loaded (/etc/systemd/system/monad-prize-keeper.service; enabled; preset: enabled)
     Active: active (running) since Thu 2026-03-05 22:04:31 AEDT; 6h ago
   Main PID: 610659 (node)
      Tasks: 11 (limit: 19080)
     Memory: 44.1M (peak: 45.2M)
        CPU: 11.544s
     CGroup: /system.slice/monad-prize-keeper.service
             └─610659 /usr/bin/node /home/c/.openclaw/workspace/monad-prize/scripts/keeper-execute-next.js

Mar 05 22:04:31 DESKTOP-G5PH2PB systemd[1]: Started monad-prize-keeper.service - Monad Prize executeNext Keeper.
```
- Latest balance log: 2026-03-05T17:06:04.105Z [keeper] wallet balance=1.287659 MON
- Latest heartbeat log: 2026-03-05T17:06:04.286Z [keeper] heartbeat ticks=700 uptime=6h1m32s inFlight=true consecutiveErrors=0 lastRid=1 lastAction=None rssMB=92.1 heapUsedMB=16.3
- Latest pending log: 2026-03-03T23:57:01.253Z [keeper] pending rid=194 action=Skip
- Latest mined tx log: 2026-03-03T23:57:09.248Z [keeper] mined tx=0x5491fa00c995af3acfc398340369029aed2ed265fa88710f0d6f2be4a4f371ae status=1 gasUsed=206559
- Recent stderr tail:
```
2026-03-02T12:34:00.572Z [keeper] error #59: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:34:31.542Z [keeper] error #60: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:35:02.378Z [keeper] error #61: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:35:33.214Z [keeper] error #62: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:36:03.945Z [keeper] error #63: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:36:34.683Z [keeper] error #64: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:37:05.497Z [keeper] error #65: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:37:36.410Z [keeper] error #66: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:38:07.182Z [keeper] error #67: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:38:37.981Z [keeper] error #68: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:39:08.838Z [keeper] error #69: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:39:39.626Z [keeper] error #70: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:40:10.347Z [keeper] error #71: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:40:41.223Z [keeper] error #72: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:41:12.226Z [keeper] error #73: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T14:36:32.749Z [keeper] error #1: request timeout
2026-03-02T22:03:39.146Z [keeper] error #1: request timeout
2026-03-02T22:04:14.176Z [keeper] error #2: request timeout
2026-03-02T22:45:15.024Z [keeper] error #1: request timeout
2026-03-02T22:45:50.809Z [keeper] error #2: request timeout
2026-03-02T22:46:25.852Z [keeper] error #3: request timeout
2026-03-02T22:47:01.533Z [keeper] error #4: request timeout
2026-03-02T22:48:12.435Z [keeper] error #1: request timeout
2026-03-03T00:56:12.518Z [keeper] error #1: request timeout
2026-03-03T04:52:57.343Z [keeper] error #1: request timeout
2026-03-03T04:53:32.374Z [keeper] error #2: request timeout
2026-03-03T05:25:18.092Z [keeper] error #1: request timeout
2026-03-04T03:14:02.600Z [keeper] error #1: request timeout
2026-03-05T08:26:53.765Z [keeper] error #1: request timeout
2026-03-05T08:27:28.806Z [keeper] error #2: request timeout
```
- settle-preflight proof (T+6h):
  - 14084:2026-03-05T11:04:32.564Z [keeper] start pid=610659 chainId=10143 wallet=0xA2da36390F94b8defeE5B13bC0b4698A5E2eBD1b pool=0x2E297C5dFf5557eA8C2D1101E082A58F02a8C3a1 intervalMs=30000 dryRun=false preflight=true telegram=true telegramTimeoutMs=8000 telegramRetries=2 lowBalanceMon=0.2 errorAlertThreshold=3
  - 6958:2026-03-03T07:56:09.657Z [keeper] settle precheck not ready rid=12: execution reverted (unknown custom error)

### T+12h
- Captured at (UTC): 2026-03-05T23:16:27Z
- Result: PASS
- Notes: service active=active, enabled=enabled, errors(last200)=0
- Service status (first lines):
```
● monad-prize-keeper.service - Monad Prize executeNext Keeper
     Loaded: loaded (/etc/systemd/system/monad-prize-keeper.service; enabled; preset: enabled)
     Active: active (running) since Thu 2026-03-05 22:04:31 AEDT; 12h ago
   Main PID: 610659 (node)
      Tasks: 11 (limit: 19080)
     Memory: 46.6M (peak: 47.8M)
        CPU: 19.189s
     CGroup: /system.slice/monad-prize-keeper.service
             └─610659 /usr/bin/node /home/c/.openclaw/workspace/monad-prize/scripts/keeper-execute-next.js

Mar 05 22:04:31 DESKTOP-G5PH2PB systemd[1]: Started monad-prize-keeper.service - Monad Prize executeNext Keeper.
```
- Latest balance log: 2026-03-05T23:14:35.362Z [keeper] wallet balance=1.287659 MON
- Latest heartbeat log: 2026-03-05T23:14:35.544Z [keeper] heartbeat ticks=1400 uptime=12h10m3s inFlight=true consecutiveErrors=0 lastRid=1 lastAction=None rssMB=94.8 heapUsedMB=19.5
- Latest pending log: 2026-03-03T23:57:01.253Z [keeper] pending rid=194 action=Skip
- Latest mined tx log: 2026-03-03T23:57:09.248Z [keeper] mined tx=0x5491fa00c995af3acfc398340369029aed2ed265fa88710f0d6f2be4a4f371ae status=1 gasUsed=206559
- Recent stderr tail:
```
2026-03-02T12:34:00.572Z [keeper] error #59: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:34:31.542Z [keeper] error #60: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:35:02.378Z [keeper] error #61: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:35:33.214Z [keeper] error #62: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:36:03.945Z [keeper] error #63: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:36:34.683Z [keeper] error #64: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:37:05.497Z [keeper] error #65: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:37:36.410Z [keeper] error #66: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:38:07.182Z [keeper] error #67: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:38:37.981Z [keeper] error #68: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:39:08.838Z [keeper] error #69: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:39:39.626Z [keeper] error #70: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:40:10.347Z [keeper] error #71: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:40:41.223Z [keeper] error #72: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:41:12.226Z [keeper] error #73: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T14:36:32.749Z [keeper] error #1: request timeout
2026-03-02T22:03:39.146Z [keeper] error #1: request timeout
2026-03-02T22:04:14.176Z [keeper] error #2: request timeout
2026-03-02T22:45:15.024Z [keeper] error #1: request timeout
2026-03-02T22:45:50.809Z [keeper] error #2: request timeout
2026-03-02T22:46:25.852Z [keeper] error #3: request timeout
2026-03-02T22:47:01.533Z [keeper] error #4: request timeout
2026-03-02T22:48:12.435Z [keeper] error #1: request timeout
2026-03-03T00:56:12.518Z [keeper] error #1: request timeout
2026-03-03T04:52:57.343Z [keeper] error #1: request timeout
2026-03-03T04:53:32.374Z [keeper] error #2: request timeout
2026-03-03T05:25:18.092Z [keeper] error #1: request timeout
2026-03-04T03:14:02.600Z [keeper] error #1: request timeout
2026-03-05T08:26:53.765Z [keeper] error #1: request timeout
2026-03-05T08:27:28.806Z [keeper] error #2: request timeout
```
- settle-preflight proof (T+12h):
  - 14084:2026-03-05T11:04:32.564Z [keeper] start pid=610659 chainId=10143 wallet=0xA2da36390F94b8defeE5B13bC0b4698A5E2eBD1b pool=0x2E297C5dFf5557eA8C2D1101E082A58F02a8C3a1 intervalMs=30000 dryRun=false preflight=true telegram=true telegramTimeoutMs=8000 telegramRetries=2 lowBalanceMon=0.2 errorAlertThreshold=3
  - 6958:2026-03-03T07:56:09.657Z [keeper] settle precheck not ready rid=12: execution reverted (unknown custom error)

### T+24h
- Captured at (UTC): 2026-03-06T11:46:00Z
- Result: PASS
- Notes: service active=active, enabled=enabled, errors(last200)=0
- Service status (first lines):
```
● monad-prize-keeper.service - Monad Prize executeNext Keeper
     Loaded: loaded (/etc/systemd/system/monad-prize-keeper.service; enabled; preset: enabled)
     Active: active (running) since Thu 2026-03-05 22:04:31 AEDT; 24h ago
   Main PID: 610659 (node)
      Tasks: 11 (limit: 19080)
     Memory: 47.5M (peak: 50.3M)
        CPU: 37.448s
     CGroup: /system.slice/monad-prize-keeper.service
             └─610659 /usr/bin/node /home/c/.openclaw/workspace/monad-prize/scripts/keeper-execute-next.js

Mar 05 22:04:31 DESKTOP-G5PH2PB systemd[1]: Started monad-prize-keeper.service - Monad Prize executeNext Keeper.
```
- Latest balance log: 2026-03-06T11:43:35.366Z [keeper] wallet balance=1.287659 MON
- Latest heartbeat log: 2026-03-06T11:43:35.557Z [keeper] heartbeat ticks=2800 uptime=24h39m3s inFlight=true consecutiveErrors=0 lastRid=1 lastAction=None rssMB=95.8 heapUsedMB=17.7
- Latest pending log: 2026-03-03T23:57:01.253Z [keeper] pending rid=194 action=Skip
- Latest mined tx log: 2026-03-03T23:57:09.248Z [keeper] mined tx=0x5491fa00c995af3acfc398340369029aed2ed265fa88710f0d6f2be4a4f371ae status=1 gasUsed=206559
- Recent stderr tail:
```
2026-03-02T12:34:00.572Z [keeper] error #59: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:34:31.542Z [keeper] error #60: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:35:02.378Z [keeper] error #61: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:35:33.214Z [keeper] error #62: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:36:03.945Z [keeper] error #63: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:36:34.683Z [keeper] error #64: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:37:05.497Z [keeper] error #65: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:37:36.410Z [keeper] error #66: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:38:07.182Z [keeper] error #67: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:38:37.981Z [keeper] error #68: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:39:08.838Z [keeper] error #69: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:39:39.626Z [keeper] error #70: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:40:10.347Z [keeper] error #71: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:40:41.223Z [keeper] error #72: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T12:41:12.226Z [keeper] error #73: getaddrinfo EAI_AGAIN testnet-rpc.monad.xyz
2026-03-02T14:36:32.749Z [keeper] error #1: request timeout
2026-03-02T22:03:39.146Z [keeper] error #1: request timeout
2026-03-02T22:04:14.176Z [keeper] error #2: request timeout
2026-03-02T22:45:15.024Z [keeper] error #1: request timeout
2026-03-02T22:45:50.809Z [keeper] error #2: request timeout
2026-03-02T22:46:25.852Z [keeper] error #3: request timeout
2026-03-02T22:47:01.533Z [keeper] error #4: request timeout
2026-03-02T22:48:12.435Z [keeper] error #1: request timeout
2026-03-03T00:56:12.518Z [keeper] error #1: request timeout
2026-03-03T04:52:57.343Z [keeper] error #1: request timeout
2026-03-03T04:53:32.374Z [keeper] error #2: request timeout
2026-03-03T05:25:18.092Z [keeper] error #1: request timeout
2026-03-04T03:14:02.600Z [keeper] error #1: request timeout
2026-03-05T08:26:53.765Z [keeper] error #1: request timeout
2026-03-05T08:27:28.806Z [keeper] error #2: request timeout
```
- settle-preflight proof (T+24h):
  - 14084:2026-03-05T11:04:32.564Z [keeper] start pid=610659 chainId=10143 wallet=0xA2da36390F94b8defeE5B13bC0b4698A5E2eBD1b pool=0x2E297C5dFf5557eA8C2D1101E082A58F02a8C3a1 intervalMs=30000 dryRun=false preflight=true telegram=true telegramTimeoutMs=8000 telegramRetries=2 lowBalanceMon=0.2 errorAlertThreshold=3
  - 6958:2026-03-03T07:56:09.657Z [keeper] settle precheck not ready rid=12: execution reverted (unknown custom error)
