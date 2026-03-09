# Everdraw Gate C Evidence — 2026-03-04 (Correct-Param Redeploy)

## Deployment cutover snapshot
- Network: Monad testnet (`chainId=10143`)
- New pool address: `0x2E297C5dFf5557eA8C2D1101E082A58F02a8C3a1`
- Deployer: `0xA2da36390F94b8defeE5B13bC0b4698A5E2eBD1b`

## Parameter verification (on-chain)
- `ticketPriceMON = 0.1`
- `commitDelayBlocks = 10`
- `roundDurationSec = 604800`
- `shmon = 0x282BdDFF5e58793AcAb65438b257Dbd15A8745C9`
- `currentRoundId = 1`

## Keeper hardening status
- Preflight gate enabled (`KEEPER_PREFLIGHT=true`) to block revert-bound tx sends
- Telegram transport hardened (timeout/retries + fallback)
- Telegram live test passed (`keeper-alert-test.sh`, Telegram API `ok:true`)

## Gate C checkpoint template
### T+0 (start)
- Result: PASS
- Notes: Keeper restarted and confirmed on new pool with hardened settings.
- Service restart time: 2026-03-04 10:57:41 AEDT
- Keeper start log:
  - `start pid=522724 chainId=10143 ... pool=0x2E297C5dFf5557eA8C2D1101E082A58F02a8C3a1 ... preflight=true telegram=true telegramTimeoutMs=8000 telegramRetries=2 ...`
- First post-restart state:
  - wallet balance logged
  - `idle rid=1 action=None`

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

## Operator command execution
Completed by operator:
```bash
sudo systemctl restart monad-prize-keeper
sudo systemctl status monad-prize-keeper --no-pager
cd /home/c/.openclaw/workspace/monad-prize
npm run keeper:health
tail -n 80 logs/keeper.out.log
```

## Gate C sign-off readiness
- Current: IN PROGRESS (burn-in running on corrected deployment)

### T+6h
- Captured at (UTC): 2026-03-04T10:20:44Z
- Result: PASS
- Notes: service active=active, enabled=enabled, errors(last200)=0
- Service status (first lines):
```
● monad-prize-keeper.service - Monad Prize executeNext Keeper
     Loaded: loaded (/etc/systemd/system/monad-prize-keeper.service; enabled; preset: enabled)
     Active: active (running) since Wed 2026-03-04 10:57:41 AEDT; 10h ago
   Main PID: 522724 (node)
      Tasks: 11 (limit: 19080)
     Memory: 43.2M (peak: 44.5M)
        CPU: 20.464s
     CGroup: /system.slice/monad-prize-keeper.service
             └─522724 /usr/bin/node /home/c/.openclaw/workspace/monad-prize/scripts/keeper-execute-next.js

Mar 04 10:57:41 DESKTOP-G5PH2PB systemd[1]: Started monad-prize-keeper.service - Monad Prize executeNext Keeper.
```
- Latest balance log: 2026-03-04T10:20:13.715Z [keeper] wallet balance=2.028564 MON
- Latest heartbeat log: 2026-03-04T10:20:13.888Z [keeper] heartbeat ticks=1060 uptime=10h22m32s inFlight=true consecutiveErrors=0 lastRid=1 lastAction=None rssMB=91.6 heapUsedMB=15.4
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

### T+12h
- Captured at (UTC): 2026-03-04T14:06:56Z
- Result: PASS
- Notes: service active=active, enabled=enabled, errors(last200)=0
- Service status (first lines):
```
● monad-prize-keeper.service - Monad Prize executeNext Keeper
     Loaded: loaded (/etc/systemd/system/monad-prize-keeper.service; enabled; preset: enabled)
     Active: active (running) since Wed 2026-03-04 10:57:41 AEDT; 14h ago
   Main PID: 522724 (node)
      Tasks: 11 (limit: 19080)
     Memory: 44.6M (peak: 45.6M)
        CPU: 28.648s
     CGroup: /system.slice/monad-prize-keeper.service
             └─522724 /usr/bin/node /home/c/.openclaw/workspace/monad-prize/scripts/keeper-execute-next.js

Mar 04 10:57:41 DESKTOP-G5PH2PB systemd[1]: Started monad-prize-keeper.service - Monad Prize executeNext Keeper.
```
- Latest balance log: 2026-03-04T14:05:02.776Z [keeper] wallet balance=2.028564 MON
- Latest heartbeat log: 2026-03-04T14:05:02.949Z [keeper] heartbeat ticks=1470 uptime=14h7m21s inFlight=true consecutiveErrors=0 lastRid=1 lastAction=None rssMB=92.8 heapUsedMB=13.0
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
