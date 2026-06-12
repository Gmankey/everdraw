# Alerting audit + incident: why no Telegram alert fired for V4.1-A's missing VRF reserve

**Date:** 2026-06-12. **Trigger:** operator asked why the V4.1-A zero-reserve condition (treasury census) produced no Telegram alerts. **Evidence:** live Fly secrets/logs (`everdraw-keeper` app), live RPC reads, `scripts/keeper-execute-next.js`, `scripts/keeper-alert-watcher.js`, `scripts/keeper-watchdog.js`, `scripts/keeper/fly.toml`, `src/TicketPrizePoolV4.sol`.

## Root cause (verified, not inferred)

**The deployed keeper AND alert watcher are pointed exclusively at dead vaults.** Live `printenv` on the Fly machines (read 2026-06-12):

```
POOL_ADDRESSES    = 0x8F36…B1ee (V3-A, drained), 0x56b4…1c41 (V3-B, drained),
                    0x9263…C7E8 (V4-A, retired), 0x0032…c5fF (old V4-B, STOPPED)
POOL_ADDRESSES_V3 = same four
```

Not in the list: **V4.1-A** (`0x933F…`, live, user deposits), **V4-B active** (`0x08bd…`, live), **V4.1-B** (`0x1886…`, deployed 2026-06-11). The last Fly deploy was 2026-06-07 15:51 — 48 minutes *after* the V4.1-A deploy (15:03) — and the pool secrets were not updated. **No monitoring system has watched any live vault since June 7.** This is precisely the working-rule-#6 failure mode (deploy ran; live surface kept old config), recurring.

Both processes in the one Fly app share the same `POOL_ADDRESSES` secret, so a single config miss blinded the keeper and its "independent" watcher simultaneously.

### Why the silence was total — four compounding layers

1. **Wrong watch list (above).** The reserve checks themselves work — the keeper logs are full of `LOW VRF RESERVE` warnings every 30s… for the drained V3 vaults.
2. **One-shot alert dedup.** `checkVRFReserve`/`checkBalance` in the keeper send Telegram **once** per condition onset (`vrfLowReserveAlerted` flag), then console-only forever until recovery. A persistent critical condition produces one message — likely buried — and never repeats. (The alert-watcher's hourly re-alert is better, but its 5 MON threshold check was watching the same dead pools.)
3. **No config-drift detection anywhere.** Monitoring the wrong vaults is indistinguishable from "everything healthy": keeper idles happily on retired pools, watchdog confirms the *process* is alive, nothing reconciles the watched set against `deployments/monad-mainnet.json` or the frontend's `VITE_POOL_ADDRESSES`.
4. **Time bomb not yet visible to on-chain checks.** V4's `nextAction` only surfaces `Commit` after `salesEnd + yieldPeriodSec` (~6 days). V4.1-A round 1 wouldn't have attempted the VRF call until **~2026-06-14T15:00Z**, where `_commitDraw` would revert `InsufficientVRFFee` — only then producing keeper errors (if the keeper had been watching). The contract has no event/flag for "reserve insufficient for next commit," so the 4-day-old defect was invisible to event-based alerting by design.

### Status at audit time (live reads, 2026-06-12)

- V4.1-A reserve **now seeded with 9 MON** (recovery plan executed: Ledger 2.998→32.60, V3 reserves recovered, root key spent gas). Round 1 commit due ~06-14T15:00Z.
- **V4-B active (`0x08bd…`) has a pending `Skip` for round 1, sitting unexecuted ~4 days** — direct proof no keeper acts on it. No user funds (0 tickets), but progression is frozen.
- **HARD DEADLINE: the keeper must be watching V4.1-A before 2026-06-14T15:00Z** or round 1 (real user deposits) still won't settle even with the reserve fixed.

## Full alert-design inventory and gaps

### What exists today

| Component | Alerts implemented | Channel |
|---|---|---|
| Keeper (`keeper-execute-next.js`) | low wallet balance (<0.2); ≥3 consecutive pool errors; VRF callback timeout (V3-flagged pools only); low VRF reserve <0.05 (V3-flagged only); recommit; SIGTERM/crash/fatal | Telegram, once-per-onset |
| Alert watcher (`keeper-alert-watcher.js`) | governance events (ownership, entropy queue/commit, fee, keeper set, pause/unpause, reserve withdrawn, force-settle); VRF reserve <5 MON hourly w/ hourly re-alert; restart-gap notice | Telegram, retried 3× |
| Watchdog (`keeper-watchdog.js`) | keeper process down/stale (process-level only) | Telegram |
| Indexer | **nothing — zero alerting** | — |

### Gaps (ordered by severity)

1. **G1 — No config reconciliation (root cause).** Nothing asserts the watched-pool set == active vaults in `deployments/monad-mainnet.json` == frontend `VITE_POOL_ADDRESSES`. Fix: one canonical active-pool list in the repo; keeper/watcher boot-fail (and alert) if their env doesn't match it; daily reconciliation alert. This single control would have caught the June 7 miss within a day.
2. **G2 — Cutover runbooks have no verification step for monitoring.** Runbooks say "update Fly secrets" but never "read back `printenv` / confirm keeper boot log shows the new addresses." Add to every deploy runbook as a gate, per rule #6.
3. **G3 — One-shot dedup on persistent critical conditions** (keeper reserve + wallet-balance alerts). A condition that persists should re-alert on a backoff schedule (e.g., 1h → 4h → daily) until cleared, like the watcher does.
4. **G4 — Shared blindness: keeper and "watcher" share one app, one env, one Telegram path.** A single secret error, app outage, or TG token break kills everything silently. The V5 pipeline spec already mandates independence + dead-man heartbeats via an independent channel (healthchecks.io email); **pull that forward to V4 ops now** — it's a config task, not a build.
5. **G5 — No deadline-based "round overdue" alert.** Nothing says "round N on vault X should have settled by T and didn't." Event/state-based checks miss stuck-by-omission (the exact current state of V4-B round 1). Add: expected-settlement-time check per active vault, alert when overdue >1h.
6. **G6 — No "reserve insufficient for NEXT commit" pre-check.** Reserve thresholds (0.05 keeper / 5 watcher) check current balance, but nothing projects "commit due at T needs fee F, reserve < F." V4.1-A would have been flagged days before the 06-14 detonation. (V5: also consider contract-side — refuse to open rounds when reserve < min; noted for ADR-0036 §3.4.)
7. **G7 — Deploy gate missing: vault went live with zero reserve.** The V4.1-A audit log even *recorded* "zero contract balance/reserve at cutover" — recorded but gated nothing. Runbook must make "reserve seeded ≥ N, verified on-chain" a hard pre-cutover gate.
8. **G8 — `isV3`-flag fragility.** VRF reserve/timeout checks only run for pools listed in `POOL_ADDRESSES_V3`; a V4 pool added only to `POOL_ADDRESSES` silently gets no VRF monitoring. Works today only because ops happen to duplicate the lists. Make VRF checks default-on for V3+ pools.
9. **G9 — Indexer has no alerting at all** (stalled ingestion, DB errors, API down = silent frontend degradation).
10. **G10 — Stale records compound confusion:** `deployments/monad-mainnet.json` still lacks the V4.1-B entry and carries a stale V4-A balance; the canonical list in G1 needs this file accurate.

## Immediate actions (builder ticket — this doc is the ticket)

1. **NOW, before 2026-06-14T15:00Z (hard deadline):** update `everdraw-keeper` Fly secrets for BOTH processes: `POOL_ADDRESSES` = `POOL_ADDRESSES_V3` = `0x933FF608eaC2b3221088bd9AE19b05F266dBF7DA,0x08bdD3710abB0616Cc29f388867f5625106B2A3E,0x1886f329e486e934c76028B15a580850e74d404C,0x9263d84a141172d9618f4b08839f595EE03bC7E8` (V4.1-A, V4-B, V4.1-B, plus retired V4-A kept for `VRFReserveWithdrawn` visibility until closeout). **No `--stage`.** Verify per G2: read back `printenv` AND confirm the keeper boot log line `poolAddresses=` shows the new set AND confirm V4-B's pending round-1 `Skip` executes within minutes (observable proof the keeper acts on live vaults).
2. Confirm ~06-14T15:00Z that V4.1-A round 1 commits and settles end-to-end (VRF request visible on-chain).
3. Dead-man heartbeats on keeper + alerts processes via healthchecks.io (independent of Telegram), this week (G4).
4. Implement G1 (canonical pool list + boot assertion + daily reconcile), G3 (re-alert backoff), G5 (overdue check), G6 (next-commit fee projection) in the keeper/watcher — small diffs, cite this doc.
5. Record V4.1-B in `deployments/monad-mainnet.json` + ADR-0032 (G10).
6. Indexer minimal alerting: ingestion-lag and process-death to the same TG channel (G9).

## For V5 (feeds ADR-0036 §7.2 / M8 gates — already partially designed, now evidence-backed)

The V5 off-chain pipeline spec already mandates watcher independence, off-Fly hosting, dead-man heartbeats, and permissionless fallbacks as launch-gating M8 items. This incident is the proof of why: **the V4 "watcher" shared fate with the keeper and both were misconfigured by the same secret for 5 days.** Add to M8 drill list: a config-drift drill (point keeper at a wrong vault on testnet; reconciliation alert must fire within its SLA).
