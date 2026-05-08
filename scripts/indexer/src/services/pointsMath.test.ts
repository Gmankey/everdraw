import assert from 'node:assert/strict';
import { calculateRoundPoints, getMultiplierX100 } from './pointsMath.js';

assert.equal(getMultiplierX100(0), 100);
assert.equal(getMultiplierX100(1), 100);
assert.equal(getMultiplierX100(4), 110);
assert.equal(getMultiplierX100(8), 125);
assert.equal(getMultiplierX100(13), 150);
assert.equal(getMultiplierX100(26), 200);

assert.deepEqual(calculateRoundPoints({ tickets: 10, streakWeeks: 1, won: false, hasBothVaults: false, consecutiveNonWins: 0, firstDeposit: false, firstWin: false }), {
  basePoints: 10,
  multiplierX100: 100,
  bonuses: {},
  totalPoints: 10,
});

assert.deepEqual(calculateRoundPoints({ tickets: 10, streakWeeks: 4, won: true, hasBothVaults: true, consecutiveNonWins: 0, firstDeposit: true, firstWin: true }), {
  basePoints: 10,
  multiplierX100: 110,
  bonuses: { win: 25, both_vaults: 1, first_deposit: 25, first_win: 100 },
  totalPoints: 162,
});

assert.deepEqual(calculateRoundPoints({ tickets: 10, streakWeeks: 8, won: false, hasBothVaults: false, consecutiveNonWins: 10, firstDeposit: false, firstWin: false }), {
  basePoints: 10,
  multiplierX100: 125,
  bonuses: { loss_streak: 3 },
  totalPoints: 16,
});

assert.deepEqual(calculateRoundPoints({ tickets: 10, streakWeeks: 26, won: false, hasBothVaults: true, consecutiveNonWins: 10, firstDeposit: false, firstWin: false, skippedOrFailed: true }), {
  basePoints: 0,
  multiplierX100: 200,
  bonuses: {},
  totalPoints: 0,
});

console.log('pointsMath.test.ts ok');
