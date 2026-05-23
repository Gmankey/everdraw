import assert from 'node:assert/strict';
import { calculateRoundPoints, getMultiplierX100, lossStreakThresholdBonus, nextMilestone, STREAK_MILESTONE_POINTS } from './pointsMath.js';

assert.equal(getMultiplierX100(0), 100);
assert.equal(getMultiplierX100(1), 100);
assert.equal(getMultiplierX100(4), 110);
assert.equal(getMultiplierX100(8), 125);
assert.equal(getMultiplierX100(13), 150);
assert.equal(getMultiplierX100(26), 200);
assert.deepEqual(lossStreakThresholdBonus(9, 0), null);
assert.deepEqual(lossStreakThresholdBonus(10, 0), { threshold: 10, points: 50 });
assert.deepEqual(lossStreakThresholdBonus(26, 10), { threshold: 26, points: 200 });
assert.deepEqual(lossStreakThresholdBonus(52, 26), { threshold: 52, points: 500 });
assert.equal(STREAK_MILESTONE_POINTS.get(2), 10);
assert.equal(nextMilestone(0), 2);
assert.equal(nextMilestone(2), 4);

assert.deepEqual(calculateRoundPoints({ tickets: 10, streakWeeks: 1, won: false, onTheDouble: false, firstDeposit: false, comebackKing: false }), {
  basePoints: 10,
  multiplierX100: 100,
  bonuses: {},
  totalPoints: 10,
});

assert.deepEqual(calculateRoundPoints({ tickets: 10, streakWeeks: 4, won: true, onTheDouble: true, firstDeposit: true, comebackKing: true }), {
  basePoints: 10,
  multiplierX100: 110,
  bonuses: { win: 25, on_the_double: 50, first_deposit: 25, comeback_king: 100 },
  totalPoints: 211,
});

assert.deepEqual(calculateRoundPoints({ tickets: 10, streakWeeks: 8, won: false, onTheDouble: false, lossStreakBonusPoints: 50, firstDeposit: false, comebackKing: false }), {
  basePoints: 10,
  multiplierX100: 125,
  bonuses: { loss_streak: 50 },
  totalPoints: 63,
});

assert.deepEqual(calculateRoundPoints({ tickets: 10, streakWeeks: 26, won: false, onTheDouble: true, lossStreakBonusPoints: 50, firstDeposit: false, comebackKing: false, skippedOrFailed: true }), {
  basePoints: 0,
  multiplierX100: 200,
  bonuses: {},
  totalPoints: 0,
});

console.log('pointsMath.test.ts ok');
