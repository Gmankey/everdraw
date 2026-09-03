# Points data correction — UAT full reset and rederive (2026-09-03)

**Environment:** UAT (`everdraw-indexer-uat`, Monad testnet). Production untouched.
**Operator:** PM (acting as builder, operator-approved 2026-09-03). No signer key involved.
**Authority:** `tasks/points-data-correction-runbook.md` — PM approval given; UAT correction, no wallet key.
**Linked change:** ADR-0049 (`decisions/0049-v5-points-model-and-sybil-resistance.md`), PR #286 (staging `3a31fd7`).
**Reason:** UAT points were contaminated — inflated streaks (486–1,351 "weeks"), milestones that were never earned, and totals computed under the pre-ADR-0049 bonus scale. The code fix preventing recurrence was merged before this correction, as the runbook requires.

## Pre-correction state

Public API `/api/leaderboard` before:

| Wallet | Lifetime points | Streak |
|---|---|---|
| `0xa2da3639…` | 1,985,700 | 506 |
| `0x47331c39…` | 1,760,000 | 1,351 |
| `0x69b3f8fa…` | 1,760,000 | 1,087 |

Saved to `points-snapshot-before.json`. Note 1,760,000 is exactly the pre-ADR-0049 full milestone stack (10k+50k+200k+500k+1M) — two wallets had maxed every milestone.

In-machine row counts before: `{wallet_round_points: 8, wallet_streaks: 3, wallet_points: 3}`.

## Defect found during deployment (guard working as intended)

Deploying the new indexer **failed to start**, by design:

```
Points cadence mismatch for 0x13f6482864bc0c17b9882a2ef9f3f7448ede0e90:
on-chain drawPeriod is 21600s but POINTS_CHECKPOINT_INTERVAL_SEC is 3600s.
```

The UAT stack had been moved to **6-hourly draws (21600s)** while the points checkpoint remained **hourly (3600s)**. That is the exact mismatch class that produced the original contamination: streaks would have advanced 6× too fast and milestones fired unearned. The ADR-0049 §5 assertion caught it on first boot rather than allowing silent corruption.

**Remediation:** `POINTS_CHECKPOINT_INTERVAL_SEC=21600` set as a Fly secret on `everdraw-indexer-uat`. Machine restarted; startup then succeeded.

> Follow-up: `scripts/indexer/fly.uat.toml` still declares `POINTS_CHECKPOINT_INTERVAL_SEC = "3600"` in `[env]`. The Fly secret overrides it, so runtime is correct, but the checked-in default is now stale and should be updated to 21600 to avoid confusing a future deploy.

## Command executed

```
flyctl ssh console -a everdraw-indexer-uat -C "sh -c 'cd /app && npm run reset:points'"
```

`scripts/reset-points-tables.ts` deletes only `wallet_round_points`, `wallet_streaks`, `wallet_points`. Raw events, rounds, `wallet_rounds`, tranches, and auth data are untouched, so points are rederived from preserved participation history.

Script output:

```
[points-reset] deleted points-derived tables only
[points-reset] before { walletRoundPoints: 8, walletStreaks: 3, walletPoints: 3 }
[points-reset] after  { walletRoundPoints: 0, walletStreaks: 0, walletPoints: 0 }
```

Rederivation is automatic: `rebuildDerivedState()` runs each sync batch once caught up.

## Post-correction state

In-machine row counts after rebuild: `{wallet_round_points: 8, wallet_streaks: 1, wallet_points: 1}` — all 8 participation rows recomputed; only one wallet has activity within the current deployment scope.

Public API after, wallet `0xa2da36390f94b8defee5b13bc0b4698a5e2ebd1b`:

| Field | Before | After |
|---|---|---|
| lifetime_points | 1,985,700 | **18,200** |
| current_streak_weeks | 506 | **0** |
| tier | (inflated) | **Bronze** |
| highest_streak_milestone_awarded | (inflated) | **0** |
| highest_loss_streak_bonus_awarded | — | **0** |
| has_received_first_deposit_bonus | — | **0** |

Per-draw breakdown: base 109.77/draw across 8 draws (sum 698.9), bonuses `{win: 2500}` × 7 = 17,500. Total 18,200.

## Verification that ADR-0049 is actually in force

- **New bonus values applied:** Win pays 2,500, not 25,000.
- **Qualifying gate active and correct:** at the 6-hourly cadence the floor is `0.005 × 100 MON × 360 min = 180` entries. This wallet's base is 109.77/draw (≈61 MON held), below the floor, so **First Deposit was correctly denied** (`has_received_first_deposit_bonus: 0`).
- **Win correctly exempt:** the same sub-threshold wallet still receives Win bonuses, as specified — expected wins scale with share of TWAB, so splitting confers no advantage and gating it would punish small players for no security benefit.
- **No unearned milestones or loss-streak awards.**
- Indexer health `1/1`, syncing normally.

## Rollback

No rollback was required. Had it been needed: the deleted tables are fully derivable from preserved raw events and `wallet_rounds`, so re-running `rebuildSettlementPoints()` reconstructs them. The pre-correction public values are preserved in `points-snapshot-before.json`. Note that a rollback would restore the *pre-ADR-0049 formula* results only if the old code were also redeployed — the tables are derived, not authoritative.

## Residual notes

- The two wallets that dropped off the leaderboard (`0x47331c39…`, `0x69b3f8fa…`) had history on a previous UAT stack and no participation in the current deployment scope. This is expected after a stack redeploy, not data loss.
- Points formulas remain unversioned (audit L-3). A future formula change plus a rebuild would rewrite historical totals again. Freeze or version before mainnet, where the append-only guarantee applies to real balances.
