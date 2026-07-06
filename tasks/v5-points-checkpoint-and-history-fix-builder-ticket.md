# Builder ticket — Wire the points streak checkpoint + fix UAT history fetch (BUGS, do FIRST)

**Implements:** ADR-0008 (points) / the merged `tasks/v5-points-redesign-builder-ticket.md` §2 (streak multipliers).
**Priority:** 1 of 3 (before the points-page reconciliation and ADR-0043 auto-compound).
**Where:** `scripts/indexer/` + `web/src/App.jsx` (V5 experience). UAT indexer app: `everdraw-indexer-uat` (Fly); UAT site: everdraw-v5-uat.vercel.app (Vercel project `everdraw-v5-uat`, `VITE_V5_UAT=true` already set).

## Bug 1 — `runWeeklyCheckpoint` is defined but NEVER called
`scripts/indexer/src/services/derivePoints.ts` defines `runWeeklyCheckpoint()` (advances `current_streak_weeks`, tier, multiplier, awards streak-milestone bonuses) but **nothing in the runner or server invokes it**. Verified live: wallet `0x4733…a90a` has participated in 13+ settled draws yet shows `current_streak_weeks: 0`, Bronze, 1.00× — the progression is frozen for every wallet, forever.

**Fix:**
- Invoke the checkpoint from the runner's sync loop. Persist a **global** `last_points_checkpoint_unix` in `indexer_state` (the per-wallet `lastCheckpointUnix` is not a scheduler).
- Cadence must be **env-configurable**: `POINTS_CHECKPOINT_INTERVAL_SEC` (default `604800` = weekly, mainnet semantics). On the UAT indexer set it to `3600` so the hourly-draw testnet actually exercises streak → tier (Silver at 4) → multiplier (1.10×) → milestone bonuses within hours. Do not hardcode testnet cadence.
- Guard: only run when the interval has elapsed AND at least one round settled since the last checkpoint (the existing `hasAnySettledRoundBetween` guard covers the second half).
- Idempotency: a crash-restart must not double-award milestone bonuses (existing `highestStreakMilestoneAwarded` guard should hold — add a test proving it across a re-run).

**Acceptance:** on UAT after ≥4 checkpoint intervals with an active position: `current_streak_weeks ≥ 4`, tier Silver, `current_multiplier_x100 = 110`, streak-milestone bonus rows present. A wallet that exits fully resets to 0 at the next checkpoint.

## Bug 2 — V5 history tab queries the PRODUCTION indexer
On the V5 frontend (branch `feat/v5-degen-flow`), `web/src/App.jsx` line ~2675 hardcodes `https://everdraw-indexer.fly.dev/api/rounds/...` — the production indexer, which knows nothing about the UAT V5 vault → the "my history" tab renders empty on UAT.

**Fix:** route every indexer fetch through the single `INDEXER_URL` / `VITE_INDEXER_URL` resolution (already used elsewhere in the file). Grep the whole of `web/src` for any other hardcoded `everdraw-indexer.fly.dev` and eliminate them.

**Acceptance:** on everdraw-v5-uat.vercel.app with `0x4733…a90a`, the history tab lists the settled draws (wins + prizes) served by `everdraw-indexer-uat.fly.dev`. Verify on the LIVE deployed site, not just locally (CLAUDE.md rule 6).

## External dependencies (CLAUDE.md rule 5)
- UAT indexer (Fly `everdraw-indexer-uat`) — checkpoint env var set there; redeploy required.
- Vercel `everdraw-v5-uat` — frontend redeploy picks up the fetch fix; env vars already correct.
- No contract or keeper changes.
