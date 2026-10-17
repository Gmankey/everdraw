import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

for (const scenario of ['valid', 'expired', 'deadline-mismatch', 'finalized-upgrade', 'finalized-invalid', 'reorg', 'idle']) {
  test(`watcher main fails closed for ${scenario}`, () => {
    const result = spawnSync(process.execPath, ['scripts/draw/watch-root-proposals.main-fixture.mjs', scenario], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
}
