import assert from 'node:assert/strict';
import { isPointsCheckpointDue } from './service.js';

// Regression for the bug where runWeeklyCheckpoint() was defined but never invoked anywhere,
// so every wallet's streak/tier/multiplier was frozen at week 0 forever. The runner now gates
// on this pure function so the checkpoint fires on its own cadence, independent of how often
// (or rarely) block-scan cycles happen to complete.

const DAY = 86_400;
const HOUR = 3_600;

// Never run before (lastRunUnix=0, i.e. the dawn of unix time): due as soon as "now" is at
// least one interval past the epoch — in practice this is always true for a real timestamp.
assert.equal(isPointsCheckpointDue(30 * DAY, 0, 7 * DAY), true);

// Weekly cadence: not due a day after the last run.
assert.equal(isPointsCheckpointDue(10 * DAY, 9 * DAY, 7 * DAY), false);
// Due once 7 days have elapsed.
assert.equal(isPointsCheckpointDue(16 * DAY, 9 * DAY, 7 * DAY), true);
// Exactly at the boundary counts as due.
assert.equal(isPointsCheckpointDue(9 * DAY + 7 * DAY, 9 * DAY, 7 * DAY), true);

// Testnet-accelerated cadence (hourly): due after an hour, not before.
assert.equal(isPointsCheckpointDue(1000 + HOUR - 1, 1000, HOUR), false);
assert.equal(isPointsCheckpointDue(1000 + HOUR, 1000, HOUR), true);

// A tight poll loop calling this many times within the interval must stay false every time
// except the one tick that crosses the boundary — this is what stops runWeeklyCheckpoint from
// firing on every ~2-20s sync cycle instead of once per configured interval.
let due = 0;
for (let t = 1000; t <= 1000 + HOUR + 5; t += 3) {
  if (isPointsCheckpointDue(t, 1000, HOUR)) due += 1;
}
assert.ok(due > 0 && due < 5, `expected only the boundary-crossing ticks to be due, got ${due}`);

console.log('pointsCheckpointGate.test.ts ok');
