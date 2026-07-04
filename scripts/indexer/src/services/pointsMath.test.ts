import assert from 'node:assert/strict';
import {
  calculateRoundPoints,
  getDegenMultiplierX100,
  getMultiplierX100,
  lossStreakThresholdBonus,
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

assert.deepEqual(lossStreakThresholdBonus(9, 0), null);
assert.deepEqual(lossStreakThresholdBonus(10, 0), { threshold: 10, points: 50_000 });
assert.deepEqual(lossStreakThresholdBonus(26, 10), { threshold: 26, points: 500_000 });
assert.deepEqual(lossStreakThresholdBonus(52, 26), { threshold: 52, points: 2_000_000 });

assert.equal(STREAK_MILESTONE_POINTS.get(2), 10_000);
assert.equal(STREAK_MILESTONE_POINTS.get(4), 50_000);
assert.equal(STREAK_MILESTONE_POINTS.get(13), 200_000);
assert.equal(STREAK_MILESTONE_POINTS.get(26), 500_000);
assert.equal(STREAK_MILESTONE_POINTS.get(52), 1_000_000);
assert.equal(nextMilestone(0), 2);
assert.equal(nextMilestone(2), 4);

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
  bonuses: { win: 25_000, first_deposit: 25_000, comeback_king: 100_000, prize_patron: 25_000 },
  totalPoints: 175_011,
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

assert.deepEqual(calculateRoundPoints({
  entries: 10,
  streakWeeks: 26,
  won: false,
  lossStreakBonusPoints: 50_000,
  firstDeposit: false,
  comebackKing: false,
  skippedOrFailed: true,
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

console.log('pointsMath.test.ts ok');
