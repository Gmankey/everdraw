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

**Degen pool points: a RAMPING multiplier that builds to 5×** based on consecutive weeks in the Degen pool (not a flat 5×). Add a **degen-specific streak** (consecutive weekly draws with an active degen position; resets on full degen withdraw), and a `getDegenMultiplier(degenWeeks)` mirroring `getMultiplierX100`:

| Weeks in Degen pool | Degen multiplier |
|---|---|
| 1 (first) | 2× |
| 2 | 3× |
| 3 | 4× |
| 4+ | 5× (cap) |

Degen points = degen entries × this ramp. **Do NOT also apply the vault streak multiplier to degen points** (that would double-count tenure) — vault points use the vault streak; degen points use the degen ramp. Degen entries still carry zero win odds.

## 2b. Anti-gaming — the multiplier is PER-TRANCHE tenure, not account-level
**Problem:** an account-level streak multiplier lets a user pre-farm the *rate* with 1 MON of dust for weeks, then apply it to a large late deposit. **Fix:** the multiplier tracks **each deposit's own continuous tenure**, so fresh money always starts at the base rung regardless of account history. All off-chain (indexer) — **no gas / no contract change.**

**Model:**
- Each deposit is a **tranche** `{amount, startWeek, pool: vault|degen}` in the indexer.
- A tranche's multiplier = the vault streak curve (1.0→2.0×) or degen ramp (2→5×) indexed by **that tranche's tenure** (weeks since created, still held) — not the account streak.
- Points per draw = **Σ over open tranches** `(tranche.amount × time-in-draw × 0.005) × trancheMultiplier`. Bonuses stay flat (added after, not multiplied).

**Nuances + decisions (defaults marked ✅ — flag any to change):**
1. **Withdrawal — full resets, partial only affects the withdrawn portion (operator decision, 2026-07-02).**
   - **Full withdrawal (position → 0):** everything resets for that pool — all tranches removed, and the account weekly streak / tier / multiplier reset to zero.
   - **Partial withdrawal: LIFO** — the withdrawn amount is taken from your **newest tranches first**; only those lose their tenure. **Surviving (older) tranches keep their tenure**, and your **account weekly streak continues** (you still hold a position). Only the withdrawn portion is affected — a long-held holder who trims a bit keeps their earned multiplier on the rest.
   - Vault and Degen tranches/streaks are independent (withdrawing from one doesn't touch the other).
2. **Withdrawal is gated by a confirmation modal** (see §5), context-aware: a **full** withdrawal warns it resets the whole streak/multiplier; a **partial** warns it removes your newest portion (and its tenure) while the rest keeps its streak. **Confirm / Cancel.**
3. **Tranche merge (bounds storage + UI): merge deposits within the same draw-week into one tranche ✅**, hard cap ~52 tranches/user with oldest-merge fallback. Prevents a micro-deposit spam from bloating the ledger.
4. **Vault and degen tranches are separate sets ✅** (separate curves).
5. **Tier + bonuses stay ACCOUNT-level; only the multiplier is per-tranche ✅.** The tier badge (Bronze…Diamond) and streak-milestone / loss-streak bonuses use the account weekly streak (loyalty status). The points *multiplier* is per-tranche. → the UI header shows an **effective multiplier** = points-weighted average across your tranches, with the tier badge shown separately. [This split is the main UX consequence — confirm.]
6. **Points on skipped / no-prize draws: award them ✅** (you participated; entries were earned) — this is a CHANGE from the current code, which zeroes points on `skippedOrFailed`. [alt: keep zeroing.]
7. **Migration:** at V5 launch, seed each existing balance as one tranche at **tenure 0** ✅ (everyone starts fresh on the per-tranche clock).

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
- Add a **Degen pool** points source row showing the **current ramp multiplier** (e.g. "3× — builds to 5×") and "no chance to win" — the boost must be visible (it's the incentive). Ideally show the degen ramp progress ("1 more week to 4×"), like the vault "next multiplier" element.
- **Multiplier is now per-tranche (§2b)** — the header shows an **effective (points-weighted) multiplier** across the user's tranches, with the **tier badge** (account streak) shown separately.
- **"Next multiplier"** element: reflects the user's ramping tranche(s) — "your deposit from [week] reaches [next ×] in N days"; note a full withdrawal resets. (For the degen row, show its ramp progress the same way.)
- **Withdrawal confirmation modal (required), context-aware** (guardrail for §2b decision 1):
  - **Full withdrawal:** "Withdrawing everything resets your streak. You're on an N-week streak at [×]; you'll rebuild from zero." Confirm / Cancel.
  - **Partial withdrawal:** "This removes your most recent [X MON] and its multiplier tenure. The rest of your position keeps its N-week streak." Confirm / Cancel.
  - Only proceed on Confirm.
- Total points + tier + weekly streak + bonuses panel all stay; wire to the V5 draw cadence.
- No cash/token value shown.

## Acceptance
- Points derive from V5 draws with **per-tranche tenure multipliers (§2b)**: each deposit tranche earns the vault curve (1→2×) or degen ramp (2→5×) by *its own* age; fresh money starts at base regardless of account history (anti-gaming). LIFO withdrawal, per-week tranche merge, full-exit reset. Bonuses per §3 (corrected Comeback King, On The Double removed) stay account-level and flat. Tier stays account-streak; the shown multiplier is the effective (blended) per-tranche rate. Points page shows "Recent draws", "Your entry", the Degen source, effective multiplier + "next multiplier". Unit tests updated (`pointsMath.test.ts`, `derivePoints.test.ts`) incl. the anti-gaming case (dust-streak + late large deposit does NOT get the high rate). Own committed PR.
