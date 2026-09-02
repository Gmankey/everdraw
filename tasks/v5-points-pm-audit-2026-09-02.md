# PM audit — V5 points system as shipped (staging `ecc71cd`)

**Date:** 2026-09-02. **Auditor:** PM. **Scope:** points derivation, checkpointing, tranche ledger, formulas, frontend surfacing.
**Method:** read the shipped code on `origin/staging` and compared it against spec. Every finding below was traced through the code — none inferred from names, comments, or prior reports.

## Which spec is authoritative — and the first finding

Two documents describe the points system and **they materially contradict each other**:

- `decisions/0008-points-system-design.md` (ADR, **Accepted**) — the V4 round-based model: account-level streak multiplier, bonuses of 25/50/100/200/500/1000, "On the Double", Wednesday 13:00 UTC anchor, two-vault mechanics.
- `tasks/v5-points-redesign-builder-ticket.md` (builder ticket, 2026-07-01) — the model actually shipped: per-tranche tenure multipliers (§2b), bonuses ×1000-scaled (§3), degen ramp 2→5×, On The Double removed, Comeback King redefined (§4), points awarded on skipped draws (§2b.6).

**The shipped code implements the ticket, not the ADR.** The ticket is the real working spec, so the ×1000 bonus values are **deliberate and documented — not a defect**. I verified this before flagging it.

But per CLAUDE.md rules 1 and 3, a redesign of this magnitude belongs in an ADR, and **ADR-0008 is now actively misleading**: anyone auditing points from `decisions/` gets a false picture of the live system. This is the same failure mode as ADR-0004's false V2 claim, which propagated unchallenged through V4 and became the ADR-0037 cadence defect. See M-3.

---

## HIGH

### H-1 — Sybil resistance is void under the ×1000 bonus scaling

ADR-0008 rests its Sybil defence on base-points linearity:

> "Per-MON-round linear math means splitting wallets gives no advantage."
> "Sybil resistance: ... Streak bonus is capped at 2x so zombie-wallet farming is unattractive."

That held when bonuses were 25–1000 points against a comparable base. It **does not hold now**. Bonuses were scaled ×1000 (§3) while base stayed entries-sized, so flat **account-level** bonuses now dominate lifetime totals — and each one multiplies per wallet.

Base is genuinely linear (splitting gives no base advantage). Bonuses are not:

| Vector | One wallet | Split into N=10 |
|---|---|---|
| First Deposit | 25,000 | **250,000** |
| Prize Patron | 25,000 | **250,000** |
| Streak milestones through 26w (10k+50k+200k+500k) | 760,000 | **7,600,000** |
| Loss-streak thresholds (10/26/52) | up to 2,550,000 | **up to 25,500,000** |

A 10-way split yields **+225,000 points immediately** and roughly **+6.8M by week 26** for a holder with identical capital and identical behaviour. The 2× multiplier cap constrains the *rate* but does nothing about flat per-wallet bonuses, so the cited defence does not cover them.

Neither spec addresses this: the ticket scaled the bonuses without revisiting ADR-0008's Sybil analysis, and ADR-0008 still asserts a property the system no longer has.

**This is an operator design decision, not a code fix.** Options: scale bonuses back toward base magnitude; make large one-time bonuses proportional to position size rather than flat; gate them behind a minimum deposit or minimum tenure; or explicitly accept bonus farming and delete the false claim. **What is not acceptable is leaving the claim standing while the property is absent.**

### H-2 — "Weeks" are really "draws", and the invariant is unenforced across two config surfaces

Every user-facing points curve is denominated in **weeks** — tier ladder (4/8/13/26), streak milestones (2/4/13/26/52), loss-streak thresholds, tranche tenure. All are computed from **draw counts**:

- `pointsMath.trancheTenureWeeks()` returns `drawId - firstFullWeightDrawId + 1` — a draw delta named "weeks".
- `derivePoints.runWeeklyCheckpoint()` advances the streak by `consecutiveParticipated` — the number of **draws** in the window.

Correctness depends on an unstated invariant:

```
on-chain drawPeriod  ==  POINTS_CHECKPOINT_INTERVAL_SEC  ==  1 week
```

These live on **two independent surfaces with no cross-validation**: `drawPeriod` is a constructor arg on `DrawManagerV5`; `pointsCheckpointIntervalSec` is `Number(process.env.POINTS_CHECKPOINT_INTERVAL_SEC ?? 604_800)` in `runner/config.ts`, validated against nothing.

**This is the root cause of the contaminated UAT data** (the 486/535-week streak). UAT ran hourly draws against a mismatched checkpoint interval, so streaks accrued up to 168× too fast and milestones fired that were never earned. It was never purely a data problem — the model has no unit discipline.

**This is live risk right now**, because the timelocked `drawPeriod` tunable is being added to `DrawManagerV5`. Once cadence is changeable in production, changing it silently rescales every points curve — and under ADR-0008's append-only rule, totals computed under the old cadence become incomparable with new ones.

**Required:** state the invariant and enforce it. Minimum: a startup assertion that the configured checkpoint interval matches the on-chain `drawPeriod`, refusing to start if not. Better: derive tenure from **elapsed time** rather than draw index, making the curves cadence-independent by construction. If cadence-independence is not adopted, the cadence tunable and the points system are coupled, and any period change needs a documented points migration.

---

## MEDIUM

### M-1 — Same-draw tranche merge not implemented; no tranche bound exists

§2b.3 specifies "merge deposits within the same draw-week into one tranche ✅, hard cap ~52 tranches/user with oldest-merge fallback." The 2026-09-02 audit correctly refused the cross-tenure oldest-merge fallback as not points-safe — **that judgement is right and I endorse it**. But the *safe* half went with it: there is no same-draw merge anywhere in `scripts/indexer/src`, and no cap.

So every deposit opens a tranche, unbounded. Per-wallet tranche count grows with deposit count and each draw's computation iterates all open tranches. Not a correctness bug today — an unbounded-growth and compute surface, cheap to trigger on a low-gas chain.

Same-draw merge is points-equivalent (identical tenure, identical multiplier), so it can ship without resolving the open design question. Implement it; leave the cap deferred.

### M-2 — Loss-streak and milestone multi-crossing are inconsistent

`pointsMath.lossStreakThresholdBonus()` loops thresholds and keeps only the **last** match, returning one award. The checkpoint milestone loop awards **every** crossed milestone (correctly — defect #8's fix).

A wallet crossing 10 and 26 in one processing step receives only the 26 award; a wallet crossing milestones 2 and 4 receives both. ADR-0008 says each threshold "fires once", implying each should fire. In steady state non-wins increment by one per draw so this cannot trigger — but the defect-#8 class (catch-up/replay advancing multiple steps) is exactly where it would. Make the paths consistent.

### M-3 — ADR-0008 contradicts the shipped system; nothing supersedes it

ADR-0008 is marked **Accepted** and documents a model untrue since the V5 redesign. Either supersede it with a V5 points ADR carrying §1–§5 of the ticket plus the decisions from this audit, or amend it in place with an explicit "superseded for V5 by …" header. The Sybil claim (H-1) must be corrected in the same change, not left standing.

---

## LOW

- **L-1** `calculateRoundPoints()` accepts `skippedOrFailed` and **never reads it**. It previously gated zeroing; §2b.6 changed the behaviour and the parameter was left behind. Callers still pass it, so a future reader may reasonably think it works. Remove it.
- **L-2** `runWeeklyCheckpoint(checkpointUnix, fromUnix = checkpointUnix - 7 * 86400)` keeps a hard-coded 7-day default. Production always passes explicit values from `runner/service.ts`, so it is latent — but it is the exact assumption defect #4 removed, still present as a default.
- **L-3** Points formulas are not versioned or frozen. The 2026-09-02 audit raises this itself and is right: a formula change plus a rebuild silently rewrites historical totals, contradicting ADR-0008's append-only guarantee. Freeze or version before mainnet.

---

## Verified correct (traced through code, not accepted on report)

The 13 remediated defects hold up. Specifically confirmed:

- Bonus constants match §3 **exactly**, including the operator's non-uniform 500k/2M loss-streak values and the new Prize Patron.
- Vault ladder and tier boundaries match ADR-0008 and ticket §2 (1.0/1.1/1.25/1.5/2.0 at 0–3/4–7/8–12/13–25/26+).
- Degen ramp returns 2×/3×/4×/5× at tenure 1/2/3/4+ per §2.
- Per-tranche multiplier is applied and the account-streak multiplier is **not** re-applied on V5 draws (`multiplierX100Override: 100`) — §2b honoured, no double-count.
- Withdrawal consumes tranches **newest-first** (`for (let i = stack.length - 1; ...)`) — LIFO per §2b.1 — and over-withdrawal throws rather than silently under-consuming.
- Skipped draws award points (§2b.6): the round filter includes `skipped`.
- Win detection unions three sources — `participant.won`, `round.winner`, and finalized claim-proof winners — closing defects #9/#10.
- Comeback King fires at ≥2 consecutive missed draws and is repeatable (§4). I traced the full-exit interaction specifically: the boundary zeroes the counter on the exit draw only, then it increments normally, so a genuine comeback still qualifies.
- Checkpoint crash-idempotency is correct: the one-time award marker is persisted **before** the checkpoint cursor, so a mid-write crash cannot double-award on retry. The ordering comment reflects real behaviour.
- Skipped checkpoints consume their cursor in `runner/service.ts` (`LAST_POINTS_CHECKPOINT_UNIX_KEY` is set even when skipped) — defect #5 genuinely fixed; the early return in `derivePoints` is not a regression.
- Checkpoint interval is configuration-driven at the call site — defect #4 fixed.
- Multiple milestones crossed in one checkpoint all award — defect #8 fixed.
- Frontend `effectiveTrancheMultiplierX100()` computes an amount-weighted average across tranches — defect #12 fixed.

## Verdict

The remediation work is sound and the 13 defects are genuinely fixed. The system behaves as the **builder ticket** specifies.

It does **not** behave as `decisions/` describes, and two properties the specs claim are not actually present: Sybil-neutrality (H-1) and a stable notion of a "week" (H-2). Neither is a coding error — both are design gaps that survived because the redesign scaled the numbers without re-deriving the properties that depended on them.

**Points should stay blocked from production until H-1 and H-2 have operator decisions**, independent of the UAT data reset already required.
