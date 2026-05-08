# Builder Ticket: EverDraw Points System Implementation

**Date:** 2026-05-08
**PM:** Claude
**Spec:** ADR-0008 (`../decisions/0008-points-system-design.md`). Read first.

## Goal

Ship the EverDraw points system end to end: indexer schema, settlement processor, weekly streak checkpoint, public APIs, and frontend surfaces. Off-chain, no contract changes.

## Scope

### 1. Indexer schema additions

Add three tables in the existing SQLite indexer.

```sql
CREATE TABLE IF NOT EXISTS wallet_points (
  wallet TEXT PRIMARY KEY,
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  has_received_first_deposit_bonus INTEGER NOT NULL DEFAULT 0,
  has_received_first_win_bonus INTEGER NOT NULL DEFAULT 0,
  highest_streak_milestone_awarded INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_streaks (
  wallet TEXT PRIMARY KEY,
  current_streak_weeks INTEGER NOT NULL DEFAULT 0,
  longest_streak_weeks INTEGER NOT NULL DEFAULT 0,
  last_checkpoint_unix INTEGER,
  consecutive_non_wins INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_round_points (
  wallet TEXT NOT NULL,
  pool_address TEXT NOT NULL,
  round_id INTEGER NOT NULL,
  base_points INTEGER NOT NULL,
  multiplier_x100 INTEGER NOT NULL,         -- 100 = 1.0x, 200 = 2.0x
  bonuses_breakdown TEXT NOT NULL,          -- JSON: {"both_vaults": 10, "loss_streak": 20, "win": 25}
  total_points INTEGER NOT NULL,
  awarded_at_unix INTEGER NOT NULL,
  PRIMARY KEY (wallet, pool_address, round_id)
);

CREATE INDEX IF NOT EXISTS idx_wallet_round_points_wallet ON wallet_round_points (wallet);
CREATE INDEX IF NOT EXISTS idx_wallet_points_lifetime ON wallet_points (lifetime_points DESC);
```

### 2. Settlement processor

When the indexer ingests a `RoundSettled`, `RoundSkipped`, or `RoundFailed` event for a pool, run point accounting for every wallet that participated in that round.

For each participant:

```
base_points        = ticket_count
multiplier_x100    = lookup_multiplier(current_streak_weeks)
bonuses            = {}

if round was won by this wallet:
  bonuses.win = 25

if user_holds_position_in_other_vault_at_this_checkpoint:
  bonuses.both_vaults = round((base_points * multiplier_x100 / 100) * 0.10)

if consecutive_non_wins >= 10 and not winning this round:
  bonuses.loss_streak = round((base_points * multiplier_x100 / 100) * 0.20)

# One-time bonuses
if not has_received_first_deposit_bonus and this is wallet's first ever deposit:
  bonuses.first_deposit = 25
  set has_received_first_deposit_bonus = true

if not has_received_first_win_bonus and round won by this wallet:
  bonuses.first_win = 100
  set has_received_first_win_bonus = true

total = round(base_points * multiplier_x100 / 100) + sum(bonuses)

INSERT into wallet_round_points
UPDATE wallet_points.lifetime_points += total

if round won:
  consecutive_non_wins = 0
else:
  consecutive_non_wins += 1
```

Skipped and Failed rounds: award zero round points but do not increment `consecutive_non_wins` (no draw happened, the user wasn't in a real lottery).

### 3. Weekly streak checkpoint job

A cron-style job that runs every Wednesday 13:00 UTC.

For every wallet that has had any deposit ever:

```
has_active_position = wallet has at least 1 ticket in any pool's
                      current Open or Committed round at checkpoint moment
has_position_in_A = same, scoped to Vault A
has_position_in_B = same, scoped to Vault B

if has_active_position:
  current_streak_weeks += 1
  longest_streak_weeks = max(longest_streak_weeks, current_streak_weeks)

  # Streak milestone bonuses, one-time
  for milestone in [4, 13, 26, 52]:
    if current_streak_weeks == milestone and highest_streak_milestone_awarded < milestone:
      award {50, 200, 500, 1000}[milestone] points
      set highest_streak_milestone_awarded = milestone
else:
  current_streak_weeks = 0

last_checkpoint_unix = checkpoint_time
```

If the protocol itself failed to operate during the checkpoint week (no rounds settled across both vaults, indexer or keeper outage), skip the checkpoint entirely. Do not break any user's streak. Log the skipped checkpoint clearly.

### 4. API endpoints

```
GET  /api/points/:wallet
     -> { wallet, ens?, lifetime_points, current_streak_weeks,
          longest_streak_weeks, current_multiplier_x100, current_tier,
          consecutive_non_wins }

GET  /api/points/:wallet/history?limit=12
     -> array of { pool_address, round_id, base_points,
                   multiplier_x100, bonuses_breakdown,
                   total_points, awarded_at_unix }

GET  /api/leaderboard?limit=100&period=all|month
     -> array of { wallet, ens?, lifetime_points (or month_points),
                   current_streak_weeks, current_tier }

GET  /api/points/preview?wallet=...&pool=...&tickets=N
     -> { estimated_base_points, estimated_multiplier_x100,
          estimated_bonuses_preview, estimated_total }
     For the deposit-preview line. Does not write state.
```

ENS resolution should be best-effort, optional, do not block the endpoint if resolver is slow.

### 5. Frontend surfaces (`web/src/`)

a. **Persistent header element** (top-right or near wallet pill): total points number plus current streak shown as flame icon with week count. Click expands a small panel with tier badge and link to profile.

b. **Deposit preview line.** Below the buy button on the active vault, show: "You'll earn approximately X points this round." Source from `/api/points/preview`. Update on ticket count input change.

c. **Settlement card update.** On the previous-vault view, when the user was a participant in the settled round, show: "+X points earned (base Y, streak multiplier Z, bonuses ...)." Concise, expandable.

d. **`/profile` page.** New route. Sections:

- Header: wallet (shortened, with ENS if available), tier badge, lifetime points big number
- Streak block: current streak with progress bar to next tier multiplier, longest streak, active multiplier, next milestone
- Recent rounds: last 12 rounds with points breakdown
- Bonuses earned: list of one-time bonuses received (first deposit, first win, milestones)

e. **`/leaderboard` page.** New route. Top 100 by lifetime points. Toggle between "all time" and "this month." Wallet column shows shortened address (`0x1234…abcd`) with ENS override. Tier badge column. Streak column. The current user's row, if outside top 100, shown as a sticky footer with their rank.

f. **Milestone banners.** When the streak crosses 4, 13, 26, or 52 weeks, show a one-shot in-app banner congratulating the user and noting the bonus awarded. When tier upgrades (Bronze → Silver, etc.), show a smaller banner.

### 6. Tier display

Use the multiplier ladder from ADR-0008. Render tier badges as simple colored chips, not full graphics.

```
Bronze    1-3 weeks    1.0x
Silver    4-7 weeks    1.1x
Gold      8-12 weeks   1.25x
Platinum  13-25 weeks  1.5x
Diamond   26+ weeks    2.0x
```

### 7. Verification

- Unit tests on the points calculation function. Cover: base, streak multipliers at each tier, both-vaults bonus, loss-streak consolation kicks in at 10, all one-time bonuses fire exactly once.
- Integration test: replay a sequence of mock rounds through the settlement processor, verify state is correct end to end.
- Checkpoint job test: assert outage detection skips the checkpoint without breaking streaks.
- API smoke tests: verify shapes and pagination on all four endpoints.
- Frontend visual: deposit preview updates live, settlement card renders, profile page accurate, leaderboard shows top 100 with shortened addresses, milestone banner fires once.

## Out of scope

- Email or push notifications. Phase 1 is in-app banners only.
- Referrals. Deferred per ADR.
- Backfilling points from rounds before launch. No retro per user instruction.
- Token integration, NFT badges, redemption flows.

## Acceptance criteria

1. Schema migrations applied in indexer.
2. Settlement processor awards correct points for at least one full Vault A cycle and one Vault B cycle, verified by manual spot check against the formula.
3. Weekly checkpoint runs Wednesday 13:00 UTC and updates streaks for all qualifying wallets.
4. All four API endpoints return correct data and respond within 500ms p95.
5. Frontend shows points header, deposit preview, settlement card, profile page, and leaderboard. All five render with no console errors.
6. PM (Claude) signs off after reviewing one full week of live data including a streak increment, a both-vaults bonus, and a loss-streak consolation if any user qualifies.

## Spec reference

ADR-0008 is the single source of truth for behaviour. If anything in this ticket appears to contradict ADR-0008, the ADR wins. Flag back to PM.
