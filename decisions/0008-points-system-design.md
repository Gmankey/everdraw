# ADR-0008 — EverDraw points system design

**Status:** Accepted
**Date:** 2026-05-08
**Deciders:** User + Claude (PM)

## Context

EverDraw needs an internal points program to reward consistent participation, drive retention through streaks, and create a recognisable status hierarchy among users. shMonad's points already accrue for active EverDraw deposits via the Merkl integration (ADR-0006), but those are shMonad ecosystem points. EverDraw's own program runs alongside, independent budget, independent purpose.

The program is off-chain, indexer-driven, and launches as a Phase 1 feature. No token signalling is attached. Copy treats points as recognition, not currency.

## Decision

### Base formula

```
points_earned_per_round = tickets × streak_multiplier
```

- 1 ticket equals 1 MON equals 1 base point.
- Points are awarded on round settlement, not on deposit, so deposit-then-withdraw cycles cannot be gamed (relevant once Phase 2 / TWAB allows mid-round withdrawal).
- Skipped and Failed rounds award no points but do not break streaks (the user participated).

### Streak mechanic

A user's streak counts consecutive **weekly checkpoints** at which they hold an active deposit in any vault.

- Checkpoint anchor: every Wednesday 13:00 UTC (Vault A's weekly anchor).
- Active deposit: principal sitting in any open or locked round at the checkpoint moment, regardless of which vault.
- Increment by 1 if the user has any active deposit at the checkpoint, reset to 0 if not.
- One vault per week is sufficient. Holding positions in both A and B in the same week counts as one streak week, not two (with a separate bonus, see below).

If the protocol itself fails to settle a checkpoint week (extended keeper outage, indexer downtime), the indexer skips that checkpoint rather than break every user's streak.

### Multiplier ladder

| Streak (weeks) | Multiplier | Tier |
|---|---|---|
| 1 to 3 | 1.0x | Bronze |
| 4 to 7 | 1.1x | Silver |
| 8 to 12 | 1.25x | Gold |
| 13 to 25 | 1.5x | Platinum |
| 26+ | 2.0x | Diamond |

Capped at 2.0x at half a year. No streak shield, no insurance, no grace period. Strict.

### Bonuses

Layered on top of base × multiplier. Additive in points.

**One-time per wallet:**

- First deposit: +25 points.
- First win: +100 points.
- First time hitting 4-week, 13-week, 26-week, 52-week streak: +50, +200, +500, +1000 points respectively.

**Recurring:**

- Win bonus: +25 points per round won.
- Both-vaults bonus: +10% on the round's points if the user has an active deposit in both Vault A and Vault B at the same weekly checkpoint.
- Loss-streak consolation: after 10 consecutive non-winning rounds, +20% on round points until the user wins. Resets on first win.

### What's not in Phase 1

- Referral bonuses. Off-chain attribution is messy and Sybil-prone. Defer.
- Whale tier multipliers (e.g. "100+ tickets equals 1.1x"). The yield prize already rewards big deposits. Stacking points on top creates a runaway dynamic.
- Held-through-lock bonuses. Conflict with natural withdraw-redeposit cycles. Phase 2 makes this irrelevant.
- Cross-protocol points stacking. shMonad's Merkl integration already runs in parallel, no coordination needed.
- Token roadmap signalling. Copy frames points as recognition only, not future currency.

### Retroactive points

**No backfill.** Points start fresh at launch. Existing depositors do not get retroactive round points or first-deposit bonuses. Everyone starts at zero on day one. Streak counters start at zero on day one.

This keeps the launch honest and removes any kingmaker dynamic where early users wake up with a permanent points advantage that wasn't earned under the live system.

### How users see their points

- **Header.** Persistent top-right element showing total points and current streak (flame icon plus week count). Click to expand to a panel.
- **Deposit preview.** Below the buy button: "You'll earn approximately X points this round."
- **Settlement card.** When a round settles, the previous-vault view shows points earned alongside prize and withdraw actions.
- **Profile page** at `/profile`:
  - Lifetime points.
  - Current streak with progress bar to next tier.
  - Active multiplier and tier badge.
  - Round-by-round history, last 12 rounds.
- **Leaderboard.** Top 100 by lifetime points, public, filterable by all-time or current month. Wallet addresses shown shortened (e.g. `0x1234…abcd`), with ENS resolution overriding when available.

### Notifications

- Streak milestone hit: in-app banner.
- Tier upgrade: in-app banner.
- Streak reset: small note on the user's next deposit.
- No email or push for Phase 1.

### Copy framing

> "Points are EverDraw's way of recognising loyal participants. They may inform future protocol rewards."

Enough to motivate without legal exposure. Do not promise monetary value, token allocation, or fiat redemption.

## Rationale

- **Per-MON-round base** is fair, transparent, and Sybil-neutral. Splitting wallets gives no advantage.
- **2x multiplier cap** rewards loyalty meaningfully but does not price out new users. A new whale with a 10x deposit beats a half-year veteran on points easily.
- **Strict streak (no insurance)** is simpler and more honest. Insurance mechanics often turn into engagement-debt features.
- **Settlement-time award** future-proofs against TWAB.
- **No retroactive backfill** is the cleanest start.
- **Generic tier names** match generic financial product expectations and avoid forced thematic branding that could feel try-hard.

## Alternatives considered

- **Per-deposit flat bonus.** Rejected. Treats a 1-MON deposit the same as a 100-MON deposit. Unfair and doesn't reward depositing seriously.
- **Aggressive multipliers (5x+).** Rejected. Locks out late joiners.
- **Vault-loyalty streak (must always deposit in same vault).** Rejected. Forces artificial constraint when the two-vault design is supposed to give users flexibility.
- **Streak based on per-round participation rather than per-week checkpoint.** Rejected. Would require depositing in both A and B every week to maintain streak. Too punishing.
- **Backfilling round points retroactively for existing depositors.** Rejected per user instruction. Cleaner launch, no kingmaker.

## Consequences

### Indexer

New schema and a settlement processor plus a weekly checkpoint job. Detail in the builder ticket.

### Frontend

Header element, profile page, leaderboard view, deposit-preview line, settlement-card line, milestone banners.

### Backend services

Hourly or per-block tick to detect when a `RoundSettled` event lands and compute points for participants. Weekly cron at Wednesday 13:00 UTC to update streaks.

### Sybil resistance

Per-MON-round linear math means splitting wallets gives no advantage. Streak bonus is capped at 2x so zombie-wallet farming is unattractive (high operational overhead for modest multiplier).

### Phase 2 evolution

Once TWAB ships, the per-round model becomes per-time-weighted-balance. The same settlement-time award pattern still works. Streak mechanic stays as designed.

## Open questions

None. All resolved with user.

## Related

- ADR-0006 (Merkl readable position surface, shMonad's parallel points pipeline)
- ADR-0007 (Phase 2 / TWAB roadmap)
- Builder ticket: `../tasks/points-system-implementation-2026-05-08.md`
