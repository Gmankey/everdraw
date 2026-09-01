# EverDraw V5 points correctness audit

**Date:** 2026-09-02
**Status:** Points remain blocked from production until this code is merged/deployed and contaminated UAT data is reset and rederived.

## Confirmed defects corrected

1. Full exits missed ERC20 transfer-outs; zero-position boundaries now come from the tranche ledger.
2. Historical replay rebuilt loss/missed counters across full exits; those counters now reset at each boundary.
3. Skipped held draws were excluded from checkpoints; they now count.
4. The checkpoint used a hard-coded seven-day lookback on shorter UAT cadence; it now uses configured deterministic intervals.
5. Empty/skipped checkpoints did not advance their cursor; they now do.
6. Checkpoints were not crash-idempotent; pending boundaries and per-wallet markers now make retry deterministic.
7. Deposits after a draw but before checkpoint could earn an unearned streak; wallet draw participation is now required.
8. Catch-up draws advanced only once and could skip milestones; consecutive draws and crossed milestones are now handled.
9. PrizeCompounded winners were omitted from winner derivation.
10. Finalized proof winners who had not claimed could miss the Win bonus.
11. Pre-first-period deposits could remain at base tenure indefinitely.
12. The frontend displayed account/oldest-tranche multipliers rather than the amount-weighted effective tranche multiplier.
13. The required dust-streak plus late-large-deposit anti-gaming fixture was absent; it is now covered.

## Verification

- Indexer build: pass.
- Indexer test files: 18/18 pass.
- Frontend test commands: 13/13 pass.
- Frontend build and lint: pass.
- git diff check: pass.

## UAT correction required

Current UAT points are contaminated. The 486-week streak, 2x multiplier after exit, false milestones, and affected lifetime totals must not be trusted. After PM approval, follow tasks/points-data-correction-runbook.md using scripts/indexer/scripts/reset-points-tables.ts, with backup, pre/post snapshots, exact command/SQL, operator, timestamp, reason, and rollback evidence.

## Open design decision

The ticket's cross-tenure "oldest merge" fallback for a 52-tranche cap is not points-safe: it can give new capital old tenure or penalize old capital. Same-draw merging is safe. Cross-tenure compaction needs a PM-approved, points-equivalent representation; it must not be guessed.

Points formulas must also be versioned or frozen at mainnet launch so a later rebuild cannot silently rewrite historical totals.
