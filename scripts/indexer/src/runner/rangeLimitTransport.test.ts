import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import Database from 'better-sqlite3';
import { JsonRpcProvider } from 'ethers';
import { applySchema } from '../db/database.js';
import { createRawEventsRepo } from '../repositories/rawEventsRepo.js';
import { createIndexerStateRepo } from '../repositories/indexerStateRepo.js';
import { createIndexerRunner, isLogRangeLimitError } from './service.js';

test('real ethers range-limit wrappers are bisected sequentially', async (t) => {
  const ranges: Array<[number, number]> = [];
  let active = 0;
  let maxActive = 0;
  const server = http.createServer(async (request, response) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    let body = '';
    for await (const part of request) body += part;
    const calls = JSON.parse(body);
    const handle = (call: { id: number; method: string; params: Array<Record<string, string>> }) => {
      if (call.method === 'eth_chainId') return { jsonrpc: '2.0', id: call.id, result: '0x8f' };
      if (call.method !== 'eth_getLogs') throw new Error(`Unexpected method ${call.method}`);
      const filter = call.params[0];
      const from = Number(filter.fromBlock);
      const to = Number(filter.toBlock);
      ranges.push([from, to]);
      if (to - from + 1 > 2) {
        return {
          jsonrpc: '2.0',
          id: call.id,
          error: { code: -32602, message: 'eth_getLogs block range limited to 2 blocks' },
        };
      }
      return { jsonrpc: '2.0', id: call.id, result: [] };
    };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(Array.isArray(calls) ? calls.map(handle) : handle(calls)));
    active -= 1;
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback server address');
  const logsProvider = new JsonRpcProvider(`http://127.0.0.1:${address.port}`, 143, {
    staticNetwork: true,
    batchMaxCount: 1,
  });
  t.after(() => logsProvider.destroy());
  const db = new Database(':memory:');
  t.after(() => db.close());
  applySchema(db);
  const canonical = {
    getNetwork: async () => ({ chainId: 143n }),
    getBlockNumber: async () => 107,
    getBlock: async (blockNumber: number) => ({
      hash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
      timestamp: 1_700_000_000,
    }),
  };
  const service = { rebuild() {}, rebuildFromRaw() {} };
  const indexerStateRepo = createIndexerStateRepo(db);
  const runner = createIndexerRunner({
    config: {
      rpcUrl: 'http://unused.invalid',
      chainId: 143,
      poolAddresses: ['0x00000000000000000000000000000000000000aa'],
      v5Deployments: [],
      claimProofIngestSecret: "a".repeat(32),
      deployBlock: 100,
      confirmations: 1,
      chunkSize: 1000,
      maxBlocksPerSync: 1000,
      pollIntervalMs: 15_000,
      rpcRetryAttempts: 1,
      rpcTimeoutMs: 1000,
      pointsMinQualifyingMon: 0,
      pointsReplayMaxIdleMs: 60_000,
    },
    provider: canonical as never,
    logsProvider,
    rawEventsRepo: createRawEventsRepo(db),
    indexerStateRepo,
    deriveRoundsService: service,
    deriveWalletRoundsService: service,
    deriveWalletStatsService: service,
  });

  await runner.syncOnce();
  assert.deepEqual(ranges[0], [100, 106]);
  assert.ok(ranges.slice(1).some(([from, to]) => to - from + 1 <= 2));
  assert.equal(maxActive, 1, 'recursive splitting must not fan out concurrent requests');
  assert.equal((await runner.getStatus()).lastScannedBlock, 106);
});

test('quota and compute-unit errors are not misclassified as block-range limits', () => {
  assert.equal(isLogRangeLimitError({
    shortMessage: 'could not coalesce error',
    error: { code: 429, message: 'compute unit rate limit exceeded' },
  }), false);
});
