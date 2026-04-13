# EverDraw Points Program — Plan

**Status:** Design locked, ready for build spec
**Owner:** PM → Builder
**Date:** 2026-04-09
**Launch target:** Alongside Vault C (Phase 2a ship)

---

## TL;DR

"EverDraw Points" — a single, unified points balance earned by participating in EverDraw vaults. Points are awarded off-chain via event indexing, published as a public top-100 leaderboard, and distributed per season via merkle snapshot. Designed to drive **retention**, **deposit growth**, and preserve **airdrop optionality**.

Naming: **Points**. Plain and unambiguous — "you earned 120 points this round". No themed rebrand.

---

## Goals

**Primary**
1. Retention — reward users who come back round after round
2. Deposit growth — reward bigger and fresher MON inflows
3. Airdrop optionality — clean snapshot-able balances per wallet

**Secondary**
4. Partner boosts — off-chain multipliers for partner campaigns (later)

**Non-goals**
- On-chain points token (no ERC-20 yet)
- Real-time redemption / spending mechanics
- Cross-chain points
- Referral trees (season 2+ maybe)

---

## Earn mechanics

### Base rate
**~1 point per MON-round of participation**, measured from deposit principal at round commit. Exact curve tuned in builder spec; start linear.

### Multipliers (stack multiplicatively)

| Multiplier | Value | Trigger | Notes |
|---|---|---|---|
| Fresh MON bonus | **1.2×** | `buyTicketsMON` path only | Rewards net new MON into the protocol vs already-circulating shMON |
| Streak bonus | **1.1× / 1.25× / 1.5×** | 3 / 5 / 10 consecutive rounds | Pooled across all vaults; requires ≥1000 MON principal that round to count |
| Win bonus | **1.5×** on that round | User won the round | Small spike to soften the loser-retention skew |
| Partner boost | variable | Off-chain campaign flag | Season-configurable, PM-controlled |

### First-time bonus
- **500 points** one-time, awarded on first round where user deposits **≥1000 MON**
- Keyed by wallet address
- 1000 MON minimum is the sybil gate (capital requirement scales linearly with farming payoff — see model)
- If farming observed in season 1: tighten to "1000 MON locked for 3 consecutive rounds before bonus unlocks"

### Streak rules (strict)
- **Consecutive rounds only** — one miss resets to 0
- Skipped rounds count as "no round" — don't break streak, don't advance it
- Pooled across Vault A, Vault B, Vault C — participating in any eligible vault that round counts
- **≥1000 MON principal that round** required or the round doesn't count toward streak
- Streak multiplier applies to that round's points (not retroactive)

---

## Sybil / gaming model

**First-time bonus farming math (500 pts, 1000 MON gate):**

| Scenario | Capital | Gas | Bonus yield | Organic yield | Notes |
|---|---|---|---|---|---|
| 1 honest user, 1000 MON, 1 rd | 1000 MON × 24h | ~$0.50 | 500 | ~1000 | Legit |
| 10 sybils, 1000 MON each | 10,000 MON × 24h | ~$5 | 5000 | ~10,000 | Needs real 10k MON capital |
| 100 sybils | 100,000 MON × 24h | ~$50 | 50,000 | ~100,000 | Same — capital is the gate |

**Conclusion:** capital requirement is the sybil defense. A 100-wallet farmer with 100k MON earns the same total points as a single 100k MON whale — no sybil multiplier exists. 500 points is safe. Honest users are not diluted.

**Escalation path if farming observed:** add 3-round lock on the bonus. Keeps honest UX nearly unchanged, eliminates drive-by farming.

---

## Leaderboard

- **Top 100 public**, rendered on `/points` or similar route
- Columns: rank, wallet (truncated), total points, current streak, rounds played, last active round
- Refresh: every round close
- Ranking: total season points desc, tiebreaker = earliest first-round
- User's own rank visible even if outside top 100

---

## Seasons

- **Season 1** launches alongside Vault C
- Length: TBD (suggest 8–12 weeks for burn-in)
- End of season → merkle snapshot → distribution (airdrop or continuation TBD)
- Next season resets leaderboard and streaks; cumulative all-time total optionally tracked in a second column

---

## Distribution

- **Merkle snapshot** at end of each season
- Root published on-chain (separate lightweight contract) or via signed message, depending on usage
- Individual claims handled off-chain until there's a reason to move on-chain
- Nothing user-facing is promised about what points convert to — **airdrop optionality**, not obligation

---

## Partner boosts (secondary)

- Off-chain flag in config, applied at indexing time
- Example: "Partner X campaign: 2× points for wallets that also hold Partner X token"
- PM-controlled, no builder work per campaign after initial support is in
- Season-scoped

---

## Architecture

### Storage
- `points_ledger` — append-only per-round earn records: `(wallet, round_id, vault, base, multipliers_applied, total_points, reason)`
- `points_totals` — materialized per-wallet cumulative totals (rebuildable from ledger)
- `points_seasons` — season config: start/end block, multiplier overrides, partner flags
- `points_first_time` — wallets that have claimed the first-time bonus

All tables live in the indexer DB alongside existing `raw_events` / `rounds` / `wallet_rounds` from Phase 1.

### Earn trigger
- Hook into indexer finalization callback — after a round is `settled` or `skipped` (skipped = no points, drops the round out of the streak sequence), compute and write points for every participant of that round
- Idempotent by `(wallet, round_id)`

### API endpoints
- `GET /api/points/leaderboard` — top 100 for active season
- `GET /api/points/wallet/:addr` — wallet totals, rank, streak, history
- `GET /api/points/season` — active season info

### Frontend
- New `/points` route in `web/src/`
- Top 100 table
- User card (own wallet): total, rank, streak, next-streak-tier progress, first-time bonus claimed y/n
- Prominent streak indicator on main vault pages ("🔥 3-round streak — 1 more for 1.1×")

---

## Locked decisions (from design iteration)

| Question | Answer |
|---|---|
| Name | **Points** (plain, not themed) |
| Primary goals | Retention, deposit growth, airdrop optionality |
| Secondary goals | Partner boosts |
| Streak scope | Pooled across vaults |
| Streak minimum | 1000 MON/round |
| Streak type | Strict consecutive |
| First-time bonus | 500 points, ≥1000 MON minimum |
| Leaderboard | Top 100, public |
| Partner boosts | Off-chain |
| Seasons | Yes, starting later (season 1 w/ Vault C) |
| Fresh-MON bonus | 1.2× on `buyTicketsMON` path only |
| Launch | Alongside Vault C (Phase 2a) |
| Distribution | Merkle snapshot per season |

### Cut during iteration
- Item #5 (removed per user)
- Item #10 (duplicate of deposit growth)
- Item #14 (not this one)

---

## Open items (resolve in builder spec)

1. Exact base-rate curve (linear 1:1 MON-round, or sublinear to cap whale dominance?)
2. Streak multiplier stacking with fresh-MON bonus — cap at some ceiling (e.g., 2.5× total)?
3. Season length (8 / 10 / 12 weeks)
4. Leaderboard refresh cadence (per round vs every N rounds)
5. Whether partial-round entries (user buys then round skipped) count toward streak

---

## Build ordering

**Blocked on:** Phase 2a contract spec being frozen (so events are known) and Phase 2c shipping (so points can launch with Vault C).

**Order:**
1. Phase 2c ships → validates shMON UX
2. Phase 2a contract finalized → events known
3. Points indexer layer built against V2 events + existing V1 events (both vaults feed into the same ledger)
4. Points API endpoints
5. Points frontend
6. Season 1 starts on Vault C mainnet deploy

**Effort estimate:** 3–4 days indexer + 1 day API + 2 days frontend = ~1 week after Phase 2a is ready.

---

## Reporting

- Dashboard card: "Total points awarded this season", "Unique earners", "Top streak active"
- Weekly digest to PM: leaderboard movement, suspected farming patterns, streak distribution

---

## Memory index entry

Add to `MEMORY.md`:
```
- [project_everdraw_points.md](project_everdraw_points.md) — EverDraw Points program design
```
