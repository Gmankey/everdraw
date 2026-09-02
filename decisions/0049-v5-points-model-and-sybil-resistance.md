# ADR-0049: V5 points model — per-tranche tenure, rebalanced bonuses, and Sybil resistance

**Status:** Accepted (operator, 2026-09-02)
**Supersedes for V5:** ADR-0008 (points system design) — see §Supersession
**Relates to:** ADR-0036 (V5 TWAB architecture), ADR-0039 (transferable share token / non-transferable tenure), ADR-0040 (prize booster vault), ADR-0043 (prize auto-compound)
**Implements:** `tasks/v5-points-redesign-builder-ticket.md` §1–§5, plus the corrections in this ADR
**Triggered by:** PM points audit 2026-09-02 (`tasks/v5-points-pm-audit-2026-09-02.md`) finding H-1 — Sybil resistance claimed by ADR-0008 was not present in the shipped system.

## Supersession — why ADR-0008 was wrong on the record

ADR-0008 remained **Accepted** while describing a system that stopped existing at the V5 redesign. It documents an account-level streak multiplier, a "On the Double" bonus, a Wednesday 13:00 UTC anchor, two-vault mechanics, and bonuses of 25–1000 points. None of that is the live system.

The V5 model shipped from a **builder ticket**, not an ADR, so `decisions/` gave a false picture of a live, user-facing system. This is the ADR-0004 failure mode that propagated into V4 and became the ADR-0037 cadence defect. This ADR closes it: **for V5, this document is authoritative and ADR-0008 is historical.**

## Context — the defect

ADR-0008 justified its Sybil resistance on base-points linearity:

> "Per-MON-round linear math means splitting wallets gives no advantage."

That held when bonuses were 25–1000 points against a comparable base. The V5 redesign scaled bonuses **×1000** (ticket §3) while base stayed entries-sized, and **did not re-derive the property that depended on the old ratio**. Flat, account-level bonuses came to dominate lifetime totals — and every one of them multiplies per wallet.

Measured against the shipped code:

- A **1,000 MON position held 52 weekly draws** earns **4,392,360** points from base × per-tranche multiplier.
  (`0.005 entries/MON/min × 1000 × 10,080 min = 50,400`/draw; tenure 1→52 across the 1.0/1.1/1.25/1.5/2.0 ladder = 87.15 multiplier-draws.)
- The **complete one-off bonus stack was ~4,360,000** — obtainable with dust.

A real UAT wallet demonstrated it accidentally: **4,360,171 points from a 2 MON deposit**, of which **~171 was base**. Same points as a 1,000 MON year, on 500× less capital.

## Decision

### 1. Model (unchanged, now recorded)

Base, multiplier, and tenure work as the redesign ticket specifies and the code implements:

- **Base points per draw = entries** = `0.005 × MON × minutes held in draw`.
- **Multiplier is per-tranche tenure**, not account-level (ticket §2b). Each deposit tranche earns the vault curve by *its own* continuous age; fresh capital always starts at the base rung. This is the anti-gaming property that stops dust pre-farming a rate for a later large deposit.
- **Vault ladder:** 1.00× (tenure 0–3), 1.10× (4–7), 1.25× (8–12), 1.50× (13–25), 2.00× (26+).
- **Degen ramp:** 2× / 3× / 4× / 5× at tenure 1 / 2 / 3 / 4+, applied *instead of* the vault multiplier — never both.
- **Tier badge stays account-level** (display only); the shown multiplier is the amount-weighted effective rate across tranches.
- **Withdrawal:** LIFO — newest tranches consumed first; survivors keep tenure. Full exit resets the pool's tranches and account streak.
- Points accrue on **skipped draws** (participation occurred).

### 2. Rebalanced bonus values (operator, 2026-09-02)

| Bonus | Value | Type |
|---|---|---|
| Loss Streak 10 / 26 / 52 | 5,000 / 50,000 / **200,000** | one-time each |
| Streak Milestone 2 / 4 / 13 / 26 / 52 | 5,000 / 10,000 / 20,000 / 50,000 / **100,000** | one-time each |
| Comeback King | 10,000 | **one-time — NOT repeatable** |
| First Deposit | 2,500 | one-time |
| Prize Patron | 2,500 | one-time |
| Win | 2,500 | recurring |

**Total farmable one-off stack: 455,000** (down from ~4,360,000 — a 9.6× reduction).

Calibration: 455,000 is **10.4% of a 1,000 MON year**, or ~4.5 draws at full Diamond — roughly one month of a serious holder, versus ten months before.

**Comeback King must not be repeatable.** At 100,000 and repeatable it was an unbounded loop (exit → miss 2 draws → rejoin → repeat). It is now one-time per wallet, gated on `hasReceivedComebackKingBonus`.

**Win needs no Sybil treatment** — expected wins are proportional to share of TWAB, so splitting confers no advantage.

### 3. Qualifying threshold for one-time bonuses

**One-time bonuses require a qualifying position of ≥ 100 MON.** Recurring Win is exempt (Sybil-neutral).

**The threshold is a position held *through the awarding draw*, not a balance at deposit time.** Awards fire on settled-draw participation, never on the deposit transaction. Without this, the same 100 MON cycles through unlimited wallets — deposit, collect, withdraw, repeat.

Rationale for 100 MON: a wallet holding exactly the threshold earns `100 × 4,392 ≈ 439,000` base per year, against a 455,000 one-off stack. Bonuses therefore ≈ base per qualifying unit, capping Sybil gain at roughly **2× total points** rather than the ~1000× available today.

### 4. Accepted residual risk

**A flat bonus behind a threshold is bounded, not eliminated.** Splitting costs an attacker no capital — they divide the same MON across more wallets — so the threshold caps the multiplier at `capital / 100 MON`, it does not remove it. The residual Sybil gain is ~2× total points.

Rejected alternative: **stake-proportional bonuses** (`award = value × balance / 100 MON`, uncapped) are exactly Sybil-neutral, because splitting yields an identical total. Rejected for V5.0 on simplicity grounds; the ~2× residual is accepted. **Revisit if points ever acquire value, or if farming is observed** — the calculation changes completely if these become worth money (ADR-0008's framing, retained: recognition, not currency).

During beta the **25,000 MON deposit cap structurally bounds this to ~250 qualifying stacks**.

### 5. Checkpoint cadence invariant

Streaks, tiers, milestones and tenure are denominated in "weeks" but computed from **draw counts**: `trancheTenureWeeks = drawId − firstFullWeightDrawId + 1`, and the checkpoint advances the streak by the number of draws participated in its window.

**Draw-aligned accrual is intentional and correct** — tenure is earned by participating in draws, not by wall-clock time. But it requires an invariant that is currently unenforced across two independent surfaces:

```
on-chain drawPeriod  ==  POINTS_CHECKPOINT_INTERVAL_SEC
```

`drawPeriod` is a `DrawManagerV5` constructor argument; `pointsCheckpointIntervalSec` is an env var validated against nothing. Their mismatch is the root cause of the contaminated UAT data (the 486/535-"week" streak): hourly draws batched into a longer checkpoint window advanced streaks up to 168× too fast and fired milestones that were never earned.

**Required:** the indexer asserts this equality at startup and refuses to run on mismatch.

**Consequence of the cadence tunable:** the timelocked `drawPeriod` setter being added to `DrawManagerV5` means cadence can change in production. Because the curves are calibrated at one draw ≈ one week, **any cadence change rescales the earning rate** and makes pre- and post-change totals incomparable under the append-only rule. A cadence change therefore requires an explicit points decision — recalibrate the ladders, or accept the new rate — recorded at that time.

### 6. Formula versioning

Points formulas are **versioned and frozen at mainnet launch**. A rebuild after a formula change must not silently rewrite historical totals; ADR-0008's append-only guarantee is retained and applies to production balances.

## Consequences

- `pointsMath.ts` constants change; a qualifying-balance gate is added to the one-time award paths in `derivePoints.ts`; Comeback King is gated on its existing marker.
- UAT points data is contaminated and must be reset and rederived under `tasks/points-data-correction-runbook.md` before these values mean anything.
- ADR-0008's Sybil claim is corrected here rather than left standing.
- Same-draw tranche merge (ticket §2b.3) remains unimplemented; the cross-tenure "oldest merge" cap is **correctly deferred** as not points-safe and must not be guessed. Same-draw merge is points-equivalent and may ship independently.

## Rejected alternatives

- **Keep the ×1000 bonuses.** Rejected: they make points a measure of wallet count, not participation.
- **Stake-proportional bonuses.** Correct in principle and exactly Sybil-neutral; rejected for V5.0 on complexity. Named here as the upgrade path.
- **Threshold alone with no rebalance.** Rejected: a 100 MON gate on a 4.36M stack still yields ~10× per wallet.
- **Wall-clock tenure instead of draw-indexed.** Rejected: draw-aligned accrual is the intended model. The exposure is handled by the §5 invariant instead.
