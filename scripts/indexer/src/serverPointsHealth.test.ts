import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApiServer } from './server.js';
import type { PointsReplayStatus } from './runner/service.js';

function healthServer(points: PointsReplayStatus) {
  return createApiServer({
    port: 0,
    runner: {
      async getStatus() {
        return {
          lastScannedBlock: 500,
          chainHead: 512,
          confirmedHead: 500,
          lag: 0,
          canonicalHash: `0x${'ab'.repeat(32)}`,
          rewindCount: 0,
          v5Deployments: [],
          points,
        };
      },
    } as never,
    roundsRepo: {} as never,
    walletRoundsRepo: {} as never,
    pointsRepo: {} as never,
    startedAt: Date.now(),
  });
}

test('/api/health reports points health separately from ingestion health', async (t) => {
  const degraded = await healthServer({
    status: 'degraded',
    lastSuccessUnix: 1_757_000_000,
    lastErrorUnix: 1_757_003_600,
    lastError: 'Points formula changed without a versioned migration',
    staleSeconds: 3_600,
  }).start();
  t.after(() => degraded.close());

  const response = await fetch(`http://127.0.0.1:${(degraded.address() as AddressInfo).port}/api/health`);
  // A frozen points replay does not stop ingestion, so the indexer must not report itself down.
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, any>;
  assert.equal(body.dbStatus, 'ok');
  assert.equal(body.lastScannedBlock, 500);
  // Everything monitoring needs to alert on points specifically, without inferring it from logs.
  assert.equal(body.points.status, 'degraded');
  assert.match(body.points.lastError, /versioned migration/);
  assert.equal(body.points.lastErrorUnix, 1_757_003_600);
  assert.equal(body.points.lastSuccessUnix, 1_757_000_000, 'the last good rebuild must stay visible');
  assert.equal(body.points.staleSeconds, 3_600);
});

test('/api/health reports a healthy points replay', async (t) => {
  const healthy = await healthServer({
    status: 'ok',
    lastSuccessUnix: 1_757_003_600,
    lastErrorUnix: null,
    lastError: null,
    staleSeconds: 4,
  }).start();
  t.after(() => healthy.close());

  const response = await fetch(`http://127.0.0.1:${(healthy.address() as AddressInfo).port}/api/health`);
  const body = await response.json() as Record<string, any>;
  assert.equal(body.points.status, 'ok');
  assert.equal(body.points.lastError, null);
  assert.equal(body.points.staleSeconds, 4);
});
