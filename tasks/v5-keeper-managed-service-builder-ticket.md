# Builder ticket — Run the V5 keeper as a managed always-on service (do FIRST)

**Priority:** 1 of the V5 launch sequence — prerequisite for the soak and for mainnet. The keeper has died repeatedly because it runs as a manual terminal process; no soak or launch is viable until it's supervised and auto-restarting.
**Implements:** the keeper reliability work (see `tasks/v5-keeper-reliability-builder-ticket.md`) + `tasks/move-keeper-to-fly-2026-05-28.md` pattern, extended to V5.

## Current state
A managed-keeper pattern already exists: fly app `everdraw-keeper` (`scripts/keeper/fly.toml` + `scripts/keeper/Dockerfile` + `scripts/keeper/entrypoint.sh`) with alerting env already wired (`KEEPER_LOW_BALANCE_MON`, `KEEPER_ERROR_ALERT_THRESHOLD`, `KEEPER_HEARTBEAT_LOG_EVERY_TICKS`, `KEEPER_PREFLIGHT`). BUT its Dockerfile `CMD` runs the **V4** keeper (`scripts/keeper-execute-next.js`), not `scripts/keeper-v5.js`. The V5 keeper is currently only ever run by hand in a terminal.

## Do
1. Make the keeper deployable as a fly app running **`keeper-v5.js`** in an auto-restart loop (the app/machine restarts on crash; no reliance on a terminal). Either extend the entrypoint to select V5 by env, or a dedicated `everdraw-keeper-v5` app + fly config — your call, but keep prod (`everdraw-keeper`, V4.1-B) and the V5 keeper independently deployable.
2. **Env/secrets:** `RPC_URL`, `PRIVATE_KEY` (the primary-proposer key — via fly secret, never committed), `DRAW_MANAGER_ADDRESS`, `CLAIM_MANAGER_ADDRESS`, `V5_KEEPER_FROM_BLOCK`, `KEEPER_LOOP=true`, `KEEPER_INTERVAL_MS`, `KEEPER_RECENT_CLAIM_WINDOW`. Preserve the existing alerting env.
3. **Keep the operator-holds-keys rule:** the private key is set as a fly secret by the operator; the builder wires the plumbing but never generates or holds a key.
4. **Health/liveness:** expose or log a heartbeat and surface the existing low-balance / error-threshold alerts so a stalled or under-funded keeper is noticed (this is the gap that caused the silent V4.1-A reserve incident — don't repeat it for V5).
5. **UAT first:** deploy a V5 keeper app pointed at the UAT DrawManager `0x9eb6…d89c` / ClaimManager `0xF95e…01eb` and confirm it advances draws unattended across a machine restart before it's used for the soak.

## Acceptance
- The V5 keeper runs on fly, survives a forced machine restart, and resumes advancing draws with no human in the loop.
- A deliberately induced crash auto-restarts; a low keeper balance fires the existing alert.
- Verified on the UAT vault: draws finalize continuously without a terminal open.

## External dependencies (rule #5)
- Monad testnet/mainnet RPC (keeper's own RPC ideally, per launch checklist §5 — don't share the frontend's).
- Pyth entropy (draw seeds) — already validated on testnet.
- fly.io (managed runtime) — operator sets the `PRIVATE_KEY` secret.
- Depends on nothing being blocked by `v5-keeper-catchup-efficiency-builder-ticket.md`, but that fix makes recovery-after-downtime much faster and should land close behind this.
