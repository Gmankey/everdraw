# Builder Ticket: Reset points tables before public launch

**Date:** 2026-05-08
**PM:** Claude
**Priority:** Pre-launch, blocks public open
**Spec:** ADR-0008 ("No backfill. Points start fresh at launch.")

## Context

Points implementation shipped and is computing correctly (math verified). However, the deploy backfilled historical events: the test wallet (`0x69b3F8FA1759272EF770103E5B014A2379dC9EBc`) already shows 276 lifetime points, a recorded "first win" bonus, and a populated `wallet_round_points` history.

ADR-0008 explicitly says no backfill. Points start at zero on day one for everyone. Reset needed before public launch so:

- The PM/owner wallet does not start ahead of every public user.
- The "first win bonus" remains available for actual first wins post-launch (currently consumed for Round 22 historical).
- The on-protocol leaderboard begins with everyone at zero, not one wallet at 276.

## Scope

### 1. One-shot reset script

Add `scripts/indexer/scripts/reset-points-tables.ts` (or equivalent location consistent with existing migration patterns):

```typescript
// Truncates all points-related state. Must be run on the live indexer
// after stopping the points settlement processor, then restart.

await db.exec("DELETE FROM wallet_round_points");
await db.exec("DELETE FROM wallet_streaks");
await db.exec("DELETE FROM wallet_points");
```

Document at the top of the script:
- When to run (one-time pre-public-launch reset).
- That it does NOT reset round / participation data, only points-derived tables.
- That after reset, future round settlements compute points from a clean slate.

### 2. Configure indexer to skip historical-event point computation

So this does not happen again on future deploys. Pick whichever of these matches the indexer's existing patterns:

a. Add a `POINTS_START_BLOCK` env var (number). The settlement processor only awards points for rounds that **settled at or after this block**. Earlier settled rounds remain in `rounds` / `wallet_rounds` for history but produce no points.

b. Or add a `POINTS_START_UNIX` env var (timestamp) and gate by `RoundSettled.block_timestamp >= POINTS_START_UNIX`.

Set the value to the block (or timestamp) at which this reset runs in production. Document the chosen value in the indexer README so future deploys preserve the gate.

### 3. Run the reset on the live Fly indexer

After deploying the script and the env-var change:

1. SSH into the Fly app: `flyctl ssh console -a everdraw-indexer`
2. Run the reset script: `node dist/scripts/reset-points-tables.js` (or however the project scripts are wired).
3. Verify with `curl` that `/api/points/0x69b3F8FA1759272EF770103E5B014A2379dC9EBc` returns `lifetime_points: 0`, `has_received_first_win_bonus: 0`, etc.
4. Restart the indexer process if necessary so the points processor picks up the new gate.

### 4. Verification

- API for the test wallet returns all zeros.
- Leaderboard endpoint returns no entries (or one entry at zero, depending on how empty-state is handled).
- Frontend `/profile` page renders the empty state cleanly: 0 points, 0 streak, no "first win unlocked" chip.
- Subsequent rounds settle and award points correctly per ADR-0008.

## Acceptance criteria

1. `wallet_points`, `wallet_streaks`, `wallet_round_points` are empty post-reset.
2. The configured `POINTS_START_BLOCK` (or timestamp) is documented and persisted in env config.
3. The next settled round on either Vault A or Vault B awards points using the live formula on a fresh slate.
4. PM (Claude) verified post-reset via the public API endpoint.

## Out of scope

- Removing or modifying historical `rounds` / `wallet_rounds` / `participants` data. Only points-derived tables get reset.
- Any UI changes. The frontend already handles the zero state correctly per the live screenshot.
- Changes to the points formula itself. Only the starting state is being reset.
