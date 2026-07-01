# Builder ticket — Points system redesign for the V5 TWAB vault

**Date:** 2026-07-01. **From:** PM. **Where the system lives:** `scripts/indexer/src/services/pointsMath.ts` + `derivePoints.ts` (+ `pointsRepo.ts`, `schema.sql`), surfaced on the points page (`web/`). **Keep points' value ambiguous** — no cash/token value anywhere in the UI (standing rule).

EverDraw points are **our own indexer**, not Merkl. (shMonad points are shMonad's separate system — out of scope here.)

## 1. Base points = entries (replaces `floor(tickets)`)
Per draw, a participant's base points = their **entries that draw** = their time-weighted deposit = `0.005 × (balance-minutes held this draw)` (the locked ticket rate; see `v5-odds-display-ux-builder-ticket.md`). A steady holder → `balance × 50.4` per weekly draw. This replaces the V4.1 `basePoints = floor(tickets)` in `calculateRoundPoints`. Then × the streak multiplier (unchanged).

## 2. Multipliers — KEEP streak-based (no change to `getMultiplierX100`/`getTier`)
| Tier | Weekly streak | Multiplier |
|---|---|---|
| Bronze | 0–3 | 1.00× |
| Silver | 4–7 | 1.10× |
| Gold | 8–12 | 1.25× |
| Platinum | 13–25 | 1.50× |
| Diamond | 26+ | 2.00× |

**Degen pool points: 5× source multiplier** on degen entries (degen deposits earn 5× base, zero win odds). Applies on top of the streak multiplier.

## 3. Bonuses — final set (update `pointsMath.ts` constants + `derivePoints.ts` triggers)
| Bonus | Value | Trigger |
|---|---|---|
| First Deposit | +25,000 | first ever deposit (one-time) |
| Win | +25,000 | win a draw |
| Comeback King | +100,000 | **rejoin after missing 2+ consecutive draws** — see §4, current impl is WRONG |
| Prize Patron (NEW) | +25,000 | first Degen pool deposit (one-time) |
| Loss Streak | +50,000 / +500,000 / +2,000,000 | 10 / 26 / 52 consecutive draws without a win |
| Streak Milestone | +10,000 / +50,000 / +200,000 / +500,000 / +1,000,000 | 2 / 4 / 13 / 26 / 52-week streaks |

- **REMOVE On The Double** (`ON_THE_DOUBLE_POINTS`, `hasReceivedOnTheDoubleBonus`, `onTheDouble` logic) — the two-pool concept is gone.
- All values are the ×1000-scaled versions of the old ones (base is now entries-sized), except Loss Streak 26/52 which the operator set to 500k/2M, and the new Prize Patron.

## 4. FIX Comeback King (it's currently mis-implemented)
Current code: `comebackKing = won && hadPriorDeposit` — i.e. "first win after any prior deposit." **That is wrong.** Correct definition: **awarded when a wallet was absent for 2+ consecutive draws and then rejoins (deposits/participates again).** Re-implement: track consecutive missed draws per wallet; when they participate after ≥2 consecutive misses, award Comeback King. (Confirm with PM whether it's one-time or repeatable — default: repeatable each genuine comeback.)

## 5. UI (points page) — reuse the existing design, change:
- **"Recent rounds" → "Recent draws"**; **"Tickets bought" → "Your entry"** (= entries that draw).
- Add a **Degen pool** points source row with a **5× badge** and "no chance to win" — the boost must be visible (it's the incentive).
- Add the **"Next multiplier"** element under the multiplier: uses `nextTierThreshold(streakWeeks)` → "keep your deposit in N more weekly draws to reach [tier] — [×]"; note "withdrawing resets your streak." (Reference PM mockup, 2026-07-01.)
- Total points + active multiplier + tier + weekly streak + bonuses panel all stay; wire them to the V5 draw cadence.
- No cash/token value shown.

## Acceptance
- Points derive from V5 draws: base = entries × streak multiplier, degen entries × 5×, all bonuses per §3 with the corrected Comeback King, On The Double removed. Points page shows "Recent draws", "Your entry", the Degen 5× source, and the "Next multiplier" progress. Unit tests updated (`pointsMath.test.ts`, `derivePoints.test.ts`). Own committed PR.
