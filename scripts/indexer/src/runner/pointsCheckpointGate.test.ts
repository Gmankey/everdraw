import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./service.ts', import.meta.url), 'utf8');
assert.equal(source.includes('last_points_checkpoint_unix'), false);
assert.equal(source.includes('pending_points_checkpoint_unix'), false);
assert.equal(source.includes('isPointsCheckpointDue'), false);
assert.equal(source.includes('runWeeklyCheckpoint('), false);

console.log('pointsCheckpointGate.test.ts ok');
