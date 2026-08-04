# V5 M8 testnet inputs (operator-provided) + watcher-host decision

Operator-supplied 2026-06-22. Feeds the M8 deploy/soak. Addresses only - keys stay with operator (no agent keys).

## Wallets (Monad testnet, chain id 10143)
| Role | Address | Notes |
|---|---|---|
| Deployer | `0xd5cc1f1D7b78943bDF09541A2ace41B5c6D83431` | operator signs Step-5 deploy with this |
| Keeper | `0x629Bd7f323fD29E3dF75855C9BC542889c6c1268` | starts draws / proposes roots on testnet |
| Watcher | `0x4fD78E6eb3B66E8624Ee6aE579866947415adedC` | **NOT used by the watcher script - it is read-only and never signs.** Kept for completeness; no key needs deploying |

Fund deployer + keeper with testnet MON. Watcher needs no balance (read-only).

## Healthchecks.io
| Check | Ping URL |
|---|---|
| Keeper | `https://hc-ping.com/df536db3-abc1-444c-bf26-87625cc1d4c4` |
| Watcher | `https://hc-ping.com/55f6416f-a4d9-44bb-87c0-221c990c9c96` |

## Watcher host decision (Step 3) - GitHub Actions
The V5 draw watcher (`scripts/draw/watch-root-proposals.mjs`) is **read-only** (polls `RootProposed`, recomputes via `compute_winners.py`, alarms on mismatch, pings healthcheck - no signing). Decision: run it as a **scheduled GitHub Actions workflow** (off-Fly, no shared fate with the Fly keeper), mirroring the existing `protocol-monitor.yml` pattern. No separate server.

**Builder action:** `.github/workflows/v5-watcher.yml` runs every 15 minutes. It rebuilds the input for each proposed root directly from chain events using `scripts/draw/write-watch-inputs.mjs`; it does not consume the keeper's local `draw-inputs/` directory or share Fly storage.

**Operator action:** set repo secrets `V5_WATCHER_UAT_RPC_URL` (testnet archive RPC, different provider than keeper), optional `V5_WATCHER_UAT_LOGS_RPC_URL` (an archive RPC that supports wide `eth_getLogs` ranges; otherwise the watcher RPC is used), `V5_WATCHER_UAT_HEALTHCHECK_URL` (watcher URL above), `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID`. The workflow reads the active DrawManager and deploy block from `deployments/monad-testnet.json`, so no address secret is needed after a recorded redeploy.

## Still pending before soak starts
- [ ] Operator: repository watcher secrets set.
- [ ] Builder: `v5-watcher.yml` workflow + independent input reconstruction.
- [ ] Step 5 testnet deploy -> records all V5 testnet addresses in `deployments/monad-testnet.json`.
- [ ] Keeper started against V5 testnet addresses (operator-owned key).
