# Builder backlog — consolidated (2026-06-25)

Everything accumulated for the builder, prioritized. P0 = affects the live V4.1 mainnet product / launch; P1 = required before V5 mainnet (most already have detailed docs — linked).

---

## P0 — Production (live V4.1 mainnet, affects users now)

### P0-1. Indexer pool-config drift (root cause of the "stats show wrong/old vaults" incident)
- The deployed `everdraw-indexer` `POOL_ADDRESSES` had drifted to **old V2/V3/retired pools** and was missing every live vault (V4.1-A `0x933F…`, V4.1-B `0x1886…`, current V4-B `0x08bd…`). Same failure class as the keeper-watching-dead-vaults incident.
- **Hotfix already applied (PM, 2026-06-24):** set `POOL_ADDRESSES` = V4.1-A, V4-B, V4.1-B; `START_BLOCK=79606901`; reverted RPC to `rpc.monad.xyz` (Alchemy rejects the indexer's multi-address `getLogs`); removed a bad testnet fallback (`cannot mix providers on different networks`).
- **Builder fix:** the indexer's pool set must be **reconciled against canonical `deployments/monad-mainnet.json` / the frontend's `VITE_POOL_ADDRESSES`**, not hand-set Fly secrets that silently rot. Add a boot-time assertion + daily reconciliation alarm (mirror the keeper G1 control). Also **remove the legacy unused secrets** (`V4_A_ADDRESS`, `V4_B_ADDRESS`, `V4_A_DEPLOY_BLOCK`, `V4_B_DEPLOY_BLOCK`, `POOL_ADDRESSES_V2/V3`) — `config.ts` reads only `POOL_ADDRESSES` + `START_BLOCK`, so those mislead.

### P0-2. Indexer rebuild is too slow / fragile (~8h full backfill)
- The indexer scans 100-block chunks on `rpc.monad.xyz` (capped at 100-block ranges, throttled ~2 getLogs/s) → ~125 blocks/s. Monad's head is ~83M with deploy at ~79.6M → a **full rebuild is ~8 hours**. Steady-state is fine (50× headroom over the ~2.6 blocks/s chain rate) — the problem is **any DB reset = multi-hour stats outage**.
- **Builder fixes (any/all):**
  - **Per-pool `getLogs`** (single address per call) instead of a multi-address array — this lets the indexer use **Alchemy** (which rejects the multi-address form but is fast and allows large ranges) → rebuild in minutes, and removes the `rpc.monad.xyz` 100-block cap.
  - **Persist/snapshot the SQLite DB** (or checkpoint cursor + back it up) so a restart never rebuilds from scratch.
  - Make `START_BLOCK` track the *current* vault generation so rebuilds don't re-scan dead history.

### P0-3. Indexer API: `?pool=` ignored + global roundId sort (the "weird ordering")
- `/api/rounds?pool=<addr>` returns the **global** list (the pool filter is not applied), and rounds are sorted by **roundId descending across all pools**, so pool X round 44 (May) sits next to pool Y round 16 (June) → jumbled timeline.
- **Builder fix:** honor the `?pool=` filter; sort by date (or per-vault), not global roundId; the stats page should show current vaults grouped/ordered sensibly.

### P0-4. Frontend "could not coalesce error" on fast vault switching
- Rapid vault switching fires a burst of overlapping RPC reads (`currentRoundId`/`getRoundInfo`/`getUserPosition`…); Alchemy rate-limits the burst and/or ethers v6 batch-coalesce fails. Read-only, self-recovers, **not fund-threatening** — but a launch-UX wart.
- **Builder fix:** **debounce** vault switching (~300 ms before firing reads); **retry** transient RPC errors; lean on wagmi query cache (switching back uses cache). If it persists debounced, it's an Alchemy CU/s limit → second RPC for reads or a higher tier.

### P0-5. Beta-UI live-surface verification (working rule #6)
- Confirm on production `everdraw.xyz` that the Beta pill + tooltip, the long risk disclaimer (no duplicate top text), and the 25k-ticket UI cap (correct remaining-count message) actually render. Merged ≠ live. (Record: `tasks/beta-ui-safety-changes-2026-06-22.md`.)

### P0-6 (note). V4.1 cadence defect is live on mainnet (ADR-0037)
- Empty/skipped rounds reopen at `now+24h` instead of a fixed calendar slot, so the "next round opens at T" promise can drift. Not fixable in V4.1 (immutable); **don't promise exact open-clock times** in user comms. The real fix is the V5 calendar-anchored cadence (below).

---

## P1 — V5 (required before V5 mainnet; detailed docs already filed)

### P1-1. Phantom-TWAB bug — HIGH / likely launch-blocker
- `tasks/v5-soak-finding-phantom-twab-draw11.md`. Draw 11 reported `totalTwab=2.99` and minted a prize for a period with **zero deposits** (only deposit was a later period). Likely a TwabController correctness bug (later deposit polluting an earlier period) or a draw/period-boundary error. The off-chain builder correctly computes 0. Investigate per that doc's checklist.

### P1-2. V5 keeper: replace off-chain prediction with a contract view
- `tasks/v5-keeper-prediction-fragility-rootcause.md`. The 3 live-soak keeper patches (empty-period skip tolerance, TWAB-not-finalized defer, insufficient-oracle-fee retry + fee buffer) are correct **stopgaps**. Proper fix: a `previewStartDraw() → (due, willSkip, requiredFee)` view so the keeper stops re-deriving contract logic off-chain. Add **regression tests** for all three revert paths (currently none — only caught live).

### P1-3. V5 keeper input-builder → proper indexer
- The `scripts/draw/write-watch-inputs.mjs` RPC-scan input building (paginated getLogs, dual-RPC, retry/backoff) is a working stopgap but slow/fragile on public RPCs. Mainnet needs an **indexer/event-archive** for winner-input building (same theme as P0-2).

### P1-4. Shortfall deposit-rounding boundary
- `tasks/v5-shortfall-deposit-rounding-note.md`. A fresh deposit reads back at ~99.9% backing (real shMON ERC-4626 rounding), sitting **right on** the 10 bps shortfall threshold → a healthy deposit could trip shortfall mode. Review `SOLVENCY_TOLERANCE_BPS` vs deposit rounding; add a no-false-shortfall-on-deposit test. Before V5 mainnet.

### P1-5. V5 calendar-anchored cadence + drift test (ADR-0037)
- V5 DrawManager must use fixed, calendar-anchored periods; a skipped/zero-TWAB period must still consume exactly one `drawPeriod` slot (no rolling). Add the drift-simulation test (N empty periods advance by exactly N·drawPeriod). Hard gate before V5 mainnet.

---

## Notes for whoever picks this up
- The P0 indexer hotfix is live but it's a **hand-set Fly secret** — treat P0-1 (reconciliation control) as the durable fix so it can't silently drift again.
- The V5 soak is **paused** pending P1-1 (phantom-TWAB). M3–M5 contracts are merged; M6/M7 docs landed; M8 was in progress when the soak surfaced P1-1.
