# Builder Ticket — Two-Vault Staggered Redeploy

**Date:** 2026-05-03
**PM:** Claude
**Source of truth:** `docs/decisions/0001` through `docs/decisions/0005`. Read those before starting. This ticket is the implementation plan; the ADRs are the spec.

## Goal

Replace the current single Vault A (`0xed67ad46C694a5e963119a1Ca5F88eEBbb6e5a8a`) with two staggered V2 vaults running on a fixed weekly cadence offset by 3.5 days. Worst-case deposit wait: ~3.5 days.

## Scope (single redeploy bundle)

### 1. Contract deploys

Deploy two fresh `TicketPrizePoolShmonV2` contracts **with the Merkl-readable position surface added per ADR-0006**:

- `name() = "EverDraw shMON Position"`, `symbol() = "EVRDRAW-SHMON"`, `decimals() = 18`
- `balanceOf(user)` and `totalSupply()` views tracking MON-principal currently in active rounds
- `Deposit(user, amount)` emitted on `buyTicketsMON` / `buyTicketsShmon` (amount = MON-principal cost)
- `Withdraw(user, amount)` emitted on `withdrawPrincipal` (amount = user's original MON-principal for that round)
- **Explicitly NOT added**: `transfer`, `transferFrom`, `approve`, `allowance` — non-transferable by design
- Contract source must include a comment header on the Merkl section: "ERC-20-readable position accounting for Merkl indexing. NOT a transferable token."
- Tests added per builder note (passing on V2 critical 15 / V2 full+critical 92)

Constructor params (unchanged from previous version of this ticket):

- `_shmon` = current shMON address (unchanged)
- `_ticketPriceMON` = current price (confirm with PM at deploy time, default = unchanged)
- `_roundDurationSec = 86400` (24h Open window)
- `_yieldPeriodSec = 518100` (6 days minus 5 minutes — see ADR-0004 §"Scheduling strategy")
- `_owner` = current owner

**Vault A**: deploy first. Whatever weekday/time the deploy mines becomes Vault A's permanent weekly anchor.

**Vault B**: deploy 3.5 days after Vault A's anchor. Whatever weekday/time the Vault B deploy mines becomes Vault B's permanent weekly anchor.

No migration tooling needed — the user is the sole depositor on current Vault A and will withdraw manually after its current round settles. See ADR-0003.

### 2. Keeper changes (`scripts/keeper-execute-next-v2.js`)

a. **Per-pool scheduling gate.** Before calling `commit()` for a pool, check the current wall-clock time against that pool's anchor weekday/time.
   - Each pool has a configured `anchorWeekdayUtc` (0–6) and `anchorHourUtc` (0–23).
   - Even if `nextExecutable()` returns `Commit`, do not fire until wall-clock matches anchor (within ±60s).
   - This prevents drift; the contract's relative scheduling self-aligns when commits fire at the exact target moment.

b. **Multi-RPC failover.** Replace `new ethers.JsonRpcProvider(RPC_URL)` with `new ethers.FallbackProvider([primary, secondary])` using two distinct Monad mainnet RPC endpoints. Add `RPC_URL_FALLBACK` env var. Same pattern in indexer (see §3).

c. **Config additions** to `scripts/keeper-mainnet.env`:
   - `POOL_ADDRESSES_V2=<vaultA>,<vaultB>`
   - `RPC_URL_FALLBACK=<second RPC>`
   - Per-pool anchor config: serialize as `POOL_SCHEDULE_V2=<vaultA>:Sat:00,<vaultB>:Wed:00` (or whatever schema you prefer; document it).
   - Keep `KEEPER_INTERVAL_MS=30000`, `KEEPER_LOW_BALANCE_MON=0.2`, `KEEPER_ERROR_ALERT_THRESHOLD=3` unchanged.

d. **Existing keeper logic unchanged**: 30s polling, retry-on-next-tick, Telegram alerting after 3 consecutive errors, `Restart=always` systemd. ADR-0005 (H) explicitly accepts the "anchor shifts on >5min keeper outage" failure mode — no extra recovery logic needed in code; runbook covers it.

### 3. Indexer changes

a. **Multi-RPC failover** — same `FallbackProvider` pattern as keeper.

b. **Pool-scope `/api/rounds/:roundId/participants`.** Currently queries by `round_id` only and merges entrants from both pools when round numbers collide. Fix:
   - Endpoint: `/api/rounds/:roundId/participants?pool=<address>` (or path-scoped variant).
   - Update frontend `loadParticipantsForView()` to pass the pool address.
   - Backwards-compat shim acceptable for now; deprecate the unscoped form.

c. **Withdrawal-latency tracking** (per ADR-0005 A):
   - For each settled round, record:
     - `settled_at` = block timestamp of the `RoundSettled` (or `RoundSkipped`/`RoundFailed`) event
     - For each `PrincipalWithdrawn` event in that round, `withdrawn_at` = block timestamp
   - Expose via API:
     - Per-wallet per-round delta: `withdrawn_at - settled_at` (seconds), null if unwithdrawn
     - Aggregate per round: count withdrawn, count outstanding, median/p90/p99 latency among withdrawn
     - Aggregate across all rounds per pool: same stats
   - Used as a Phase 2 design input (does auto-rollover meaningfully help retention?). Storage / API shape at builder's discretion.

### 4. Frontend changes

a. **Final-30s buy cutoff.** In the buy flow, disable the buy button when `shownSecondsRemaining < 30`. Show a brief explainer ("Buying paused for the last 30 seconds to prevent failed transactions"). This avoids the race where a tx submitted at T-5s mines at T+2s and reverts with `SalesEnded`, costing the user gas.

b. **Fix `ClaimFlowModal` copy for principal-mode users.** Currently the modal shows "How do you want to claim this round?" + "CLAIM" + "KEEP PLAYING" + "CLAIM AND CONVERT" regardless of whether the user is a winner or just a non-winning depositor. For principal-mode (non-winner) users:
   - Title should be principal-framed (e.g. "How do you want to handle your principal?")
   - "CLAIM" → "WITHDRAW" or similar (no prize to claim)
   - "KEEP PLAYING" stays (re-deposit into next round)
   - "CLAIM AND CONVERT" → "WITHDRAW AND CONVERT TO MON"
   - Winner-mode copy stays as-is

   **Important:** confirm copy with PM before shipping. The user explicitly flagged earlier that copy was changed without permission; do not invent new wording — propose options, get sign-off.

c. **Pool-scoped participants fetch** (paired with §3b).

d. **Update env config:** `VITE_POOL_ADDRESSES_V2=<vaultA>,<vaultB>`. Remove old `0xed67…` from frontend config after current round settles.

### 5. Runbook updates (`tasks/mainnet-ops-runbook.md` or successor)

Document:

a. **Keeper anchor-shift recovery procedure.** If a keeper outage causes a vault's anchor to shift to an unintended weekday:
   1. Pause the vault contract (`pause()` as owner).
   2. Wait until the next correct weekday/time anchor.
   3. At the target moment, unpause and let the next commit cycle re-anchor.
   4. Skipped round during the outage is acceptable per ADR-0005 (H).

b. **Pre-deploy checklist for Vault A:** confirm tx submission within ±2 minutes of intended anchor weekday/time. Manual coordination — no tooling.

c. **Vault B deploy trigger:** schedule for exactly 3.5 days after Vault A's first round opens.

### 6. Merkl registration

After both vaults are deployed:
- Register Vault A and Vault B addresses with Merkl/shMonad's indexer integration team.
- Confirm `Deposit` and `Withdraw` events are being indexed and time-weighted balances are flowing to shMonad's points pipeline.
- This is an off-chain coordination step — contract surface itself is complete at deploy.

### 7. Retire current Vault A

After `0xed67…` round 38 settles and the user withdraws principal:
- Remove from `POOL_ADDRESSES_V2` (keeper) and `VITE_POOL_ADDRESSES_V2` (frontend).
- Leave on-chain (immutable) — direct contract calls remain available if ever needed.
- Indexer can keep historical data archived; do not delete.

## Out of scope

- Auto-rollover for principal (deferred to Phase 2 per ADR-0005 A)
- Live yield estimate, leaderboard, social tiles during Lock state (per ADR-0005 C)
- Unclaimed-fund reclaim policy (deferred per ADR-0005 D)
- Contract change for absolute-time scheduling (rejected per ADR-0005 H)
- Auto top-up for keeper EOA (existing low-balance Telegram alert is sufficient for Phase 1)
- Testnet rehearsal (skipped per ADR-0005 F)
- Timed-deploy tooling (manual deploy is acceptable)

## Acceptance criteria

1. Both new vaults deployed; `POOL_ADDRESSES_V2` and `VITE_POOL_ADDRESSES_V2` updated; old `0xed67…` removed.
2. Keeper successfully fires `commit()` for both vaults at their target anchor times for at least 2 full cycles each (≥2 weeks of observation) without anchor drift beyond ±5 seconds.
3. `/api/rounds/:roundId/participants?pool=...` returns pool-scoped entrants; frontend renders correct participant lists for two pools with overlapping round numbers.
4. Indexer surfaces withdrawal-latency metrics in API responses.
5. Frontend disables buy button in last 30 seconds before `salesEndTime`.
6. `ClaimFlowModal` copy in principal mode reviewed and approved by PM.
7. RPC failover smoke-tested: temporarily kill primary RPC, confirm keeper and indexer continue operating on fallback.
8. Runbook updated with anchor-shift recovery procedure.
9. Both vault addresses registered with Merkl; first `Deposit` event observed flowing into shMonad's points indexer.
10. PM (Claude) signs off post-deploy after 1 full Vault A cycle completes successfully.

## ADR references

- [ADR-0001 — Two-vault staggered deposit cadence](../decisions/0001-two-vault-staggered-cadence.md)
- [ADR-0002 — Lock-period semantics and draw timing](../decisions/0002-lock-period-and-draw-timing.md)
- [ADR-0003 — Migration plan and Vault B deployment](../decisions/0003-migration-and-vault-b-deployment.md)
- [ADR-0004 — V2 contract behavior verified](../decisions/0004-v2-contract-behavior-verified.md)
- [ADR-0005 — UX and operational decisions](../decisions/0005-ux-and-ops-decisions.md)
- [ADR-0006 — Merkl-readable position surface on V2 vault](../decisions/0006-merkl-readable-position-surface.md)

If anything in this ticket appears to contradict an ADR, the ADR wins. Flag the contradiction back to PM before proceeding.
