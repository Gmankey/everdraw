import assert from 'node:assert/strict';
import {
  calculateRoundPoints,
  getDegenMultiplierX100,
  getMultiplierX100,
  lossStreakThresholdBonus,
  minQualifyingEntries,
  MIN_QUALIFYING_MON,
  multiplierForTranche,
  nextMilestone,
  STREAK_MILESTONE_POINTS,
  trancheTenureWeeks,
} from './pointsMath.js';

assert.equal(getMultiplierX100(0), 100);
assert.equal(getMultiplierX100(1), 100);
assert.equal(getMultiplierX100(4), 110);
assert.equal(getMultiplierX100(8), 125);
assert.equal(getMultiplierX100(13), 150);
assert.equal(getMultiplierX100(26), 200);

assert.equal(getDegenMultiplierX100(1), 200);
assert.equal(getDegenMultiplierX100(2), 300);
assert.equal(getDegenMultiplierX100(3), 400);
assert.equal(getDegenMultiplierX100(4), 500);
assert.equal(getDegenMultiplierX100(52), 500);

// ADR-0049 §2 — rebalanced loss-streak values.
assert.deepEqual(lossStreakThresholdBonus(9, 0), null);
assert.deepEqual(lossStreakThresholdBonus(10, 0), { threshold: 10, points: 5_000 });
assert.deepEqual(lossStreakThresholdBonus(26, 10), { threshold: 26, points: 50_000 });
assert.deepEqual(lossStreakThresholdBonus(52, 26), { threshold: 52, points: 200_000 });

// ADR-0049 / audit M-2 — every newly-crossed threshold is awarded, not just the
// highest. A wallet advancing multiple thresholds in one processing step (replay /
// catch-up) previously lost the lower awards silently.
assert.deepEqual(lossStreakThresholdBonus(26, 0), { threshold: 26, points: 55_000 });
assert.deepEqual(lossStreakThresholdBonus(52, 0), { threshold: 52, points: 255_000 });
// Already-awarded thresholds are never re-awarded.
assert.deepEqual(lossStreakThresholdBonus(52, 52), null);

// ADR-0049 §2 — rebalanced streak milestones.
assert.equal(STREAK_MILESTONE_POINTS.get(2), 5_000);
assert.equal(STREAK_MILESTONE_POINTS.get(4), 10_000);
assert.equal(STREAK_MILESTONE_POINTS.get(13), 20_000);
assert.equal(STREAK_MILESTONE_POINTS.get(26), 50_000);
assert.equal(STREAK_MILESTONE_POINTS.get(52), 100_000);
assert.equal(nextMilestone(0), 2);
assert.equal(nextMilestone(2), 4);

// The full one-off stack must stay at the ADR-0049 calibration of 455,000 —
// ~10% of a 1,000 MON year (4,392,360), i.e. about one month of a serious holder.
// If someone changes a constant without re-deriving the Sybil calibration, this fails.
const oneOffStack =
  [...STREAK_MILESTONE_POINTS.values()].reduce((sum, value) => sum + value, 0)
  + 5_000 + 50_000 + 200_000 // loss streak 10 / 26 / 52
  + 10_000 // comeback king (one-time)
  + 2_500 // first deposit
  + 2_500; // prize patron
assert.equal(oneOffStack, 455_000);

// ADR-0049 §3/§5 — the qualifying entries floor scales with cadence by construction,
// so the gate means "100 MON held through the draw" at any draw period.
assert.equal(MIN_QUALIFYING_MON, 100);
assert.equal(minQualifyingEntries(604_800), 5_040); // weekly
assert.equal(minQualifyingEntries(21_600), 180); // 6-hourly
assert.equal(minQualifyingEntries(3_600), 30); // hourly
assert.equal(minQualifyingEntries(604_800, 10), 504); // custom threshold
// Degenerate configuration disables the gate rather than blocking every award.
assert.equal(minQualifyingEntries(0), 0);
assert.equal(minQualifyingEntries(604_800, 0), 0);
assert.equal(minQualifyingEntries(-1), 0);

assert.deepEqual(calculateRoundPoints({
  entries: 10,
  streakWeeks: 1,
  won: false,
  firstDeposit: false,
  comebackKing: false,
}), {
  basePoints: 10,
  multiplierX100: 100,
  bonuses: {},
  totalPoints: 10,
});

assert.deepEqual(calculateRoundPoints({
  entries: 10,
  streakWeeks: 4,
  won: true,
  firstDeposit: true,
  comebackKing: true,
  prizePatron: true,
}), {
  basePoints: 10,
  multiplierX100: 110,
  bonuses: { win: 2_500, first_deposit: 2_500, comeback_king: 10_000, prize_patron: 2_500 },
  totalPoints: 17_511,
});

assert.deepEqual(calculateRoundPoints({
  entries: 10,
  streakWeeks: 8,
  won: false,
  lossStreakBonusPoints: 50_000,
  firstDeposit: false,
  comebackKing: false,
}), {
  basePoints: 10,
  multiplierX100: 125,
  bonuses: { loss_streak: 50_000 },
  totalPoints: 50_013,
});

// Skipped/failed draws still award points (§2b.6). This is now structural — there is
// no skip-zeroing path at all — so the parameter that used to gate it is gone.
assert.deepEqual(calculateRoundPoints({
  entries: 10,
  streakWeeks: 26,
  won: false,
  lossStreakBonusPoints: 50_000,
  firstDeposit: false,
  comebackKing: false,
}), {
  basePoints: 10,
  multiplierX100: 200,
  bonuses: { loss_streak: 50_000 },
  totalPoints: 50_020,
});

assert.equal(trancheTenureWeeks(1, 26), 26);
assert.equal(trancheTenureWeeks(26, 26), 1);
assert.equal(multiplierForTranche({ poolType: 'vault', firstFullWeightDrawId: 1, drawId: 26 }), 200);
assert.equal(multiplierForTranche({ poolType: 'vault', firstFullWeightDrawId: 26, drawId: 26 }), 100);
assert.equal(multiplierForTranche({ poolType: 'degen', firstFullWeightDrawId: 1, drawId: 4 }), 500);
assert.equal(multiplierForTranche({ poolType: 'degen', firstFullWeightDrawId: 4, drawId: 4 }), 200);
