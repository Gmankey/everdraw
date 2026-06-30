# V5 Degen Security Hardening Evidence

Date: 2026-06-30

## ADR-0042 Changes

- `PrizeVaultV5.setDrawManager()` now performs only the initial draw-manager setup immediately.
- Once a draw manager is already set, `setDrawManager()` queues the replacement behind the existing 24 hour `STRATEGY_CHANGE_DELAY`.
- Added `commitDrawManagerChange()` and `cancelDrawManagerChange()`.
- Added `pendingDrawManager`, `pendingDrawManagerEffectiveAt`, `DrawManagerChangeQueued`, and `DrawManagerChangeCancelled`.

## Owner Surface Audit

- `queueStrategyChange` / `commitStrategyChange`: already timelocked fund-affecting strategy migration.
- `setDrawManager`: now timelocked after initial setup; this closes the direct yield-escrow drain path.
- `setDepositCap`: remains instant. It can restrict new deposits but cannot withdraw principal/yield; monitor alerts on `DepositCapUpdated`.
- `setMinDeposit`: remains instant. It only gates future deposit size and does not move funds.
- `setPauser`, `pause`, `unpause`, `stop`: remain instant safety controls. Withdrawals remain live under pause/stop; monitor alerts on pause/stop events.
- `transferOwnership` / `acceptOwnership`: remains two-step ownership handoff; monitor alerts on pending and accepted ownership events.

## Monitor

`scripts/protocol-monitor.js` now watches configured V5 vaults via:

- `PROTOCOL_MONITOR_V5_VAULTS` or `V5_PRIZE_VAULT_ADDRESS`
- `PROTOCOL_MONITOR_ADMIN_LOOKBACK_BLOCKS`
- `PROTOCOL_MONITOR_SKIP_POOLS=true` for V5-only testnet checks

It alerts through the existing fail healthcheck path on queued strategy changes, queued draw-manager changes, ownership transfer started/accepted, pause/unpause, stop, deposit-cap changes, and currently pending admin changes.

## Verification

- `forge test --match-path test/v5/PrizeVaultV5.t.sol -vv` passed: 29 tests.
- `forge test --match-path test/v5/DrawManagerV5.t.sol -vv` passed: 22 tests.
- `forge test --match-path test/v5/ClaimManagerV5.t.sol -vv` passed: 8 tests.
- `forge test --match-path test/v5/V5M6IntegrationAudit.t.sol -vv` passed: 5 tests.
- `npm run build` passed.
- `node --check scripts/protocol-monitor.js` passed.
- `node --test scripts/protocol-monitor.test.mjs` passed.
- Broad `forge test --match-path 'test/v5/*.t.sol' --no-match-path 'test/v5/PrizeVaultV5Fork.t.sol' -vv` did not finish within 5 minutes after picking up heavier V5 suites; focused suites above were run instead.
- Live V5 testnet monitor check passed:
  - `RPC_URL=https://testnet-rpc.monad.xyz`
  - `PROTOCOL_MONITOR_CHAIN_ID=10143`
  - `PROTOCOL_MONITOR_SKIP_POOLS=true`
  - `V5_PRIZE_VAULT_ADDRESS=0x5dB2AA29ACf832baf43d10BAEd6ff53a23549f10`
  - Result: `v5Vaults=1`, `paused=false`, `events=0`, `ok`.
