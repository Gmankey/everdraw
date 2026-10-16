import assert from 'node:assert/strict';
import test from 'node:test';
import { RpcPolicy } from './rpcPolicy.js';

function policy(overrides: Record<string, unknown> = {}) {
  return new RpcPolicy({
    timeoutMs: 50,
    attempts: 2,
    baseDelayMs: 1,
    maxDelayMs: 1,
    fallbackMaxRequestsPerHour: 2,
    fallbackCooldownMs: 1_000,
    sleep: async () => {},
    ...overrides,
  });
}

test('primary retries do not race or call the fallback early', async () => {
  const rpc = policy();
  let primaryCalls = 0;
  let fallbackCalls = 0;
  const result = await rpc.request({
    role: 'canonical',
    method: 'eth_blockNumber',
    operation: async () => {
      primaryCalls += 1;
      if (primaryCalls === 1) throw new Error('temporary outage');
      return 123;
    },
    fallback: async () => {
      fallbackCalls += 1;
      return 999;
    },
  });
  assert.equal(result, 123);
  assert.equal(primaryCalls, 2);
  assert.equal(fallbackCalls, 0);
});

test('fallback is disabled by default and never converts an RPC error to empty data', async () => {
  const rpc = policy({ fallbackMaxRequestsPerHour: 0 });
  await assert.rejects(
    rpc.request({
      role: 'logs',
      method: 'eth_getLogs',
      operation: async () => { throw new Error('logs unavailable'); },
      fallback: async () => [],
      fallbackReason: 'log-ingestion',
    }),
    /fallback disabled/,
  );
  assert.equal(rpc.snapshot().calls['fallback:eth_getLogs'], undefined);
});

test('fallback usage is budgeted and reports its reason', async () => {
  let now = 10_000;
  const rpc = policy({ attempts: 1, now: () => now });
  const request = () => rpc.request({
    role: 'canonical' as const,
    method: 'eth_getBlockByNumber',
    operation: async () => { throw new Error('primary down'); },
    fallback: async () => ({ hash: '0x01' }),
    fallbackReason: 'range-boundary',
  });
  await request();
  now += 1;
  await request();
  now += 1;
  await assert.rejects(request(), /hourly budget exhausted/);
  const snapshot = rpc.snapshot();
  assert.equal(snapshot.fallbackRequestsInWindow, 2);
  assert.equal(snapshot.fallbackReasons['range-boundary'], 2);
});

test('a failing fallback enters cooldown without consuming urgent services elsewhere', async () => {
  let now = 10_000;
  const rpc = policy({ attempts: 1, now: () => now });
  await assert.rejects(
    rpc.request({
      role: 'canonical',
      method: 'eth_call',
      operation: async () => { throw new Error('primary down'); },
      fallback: async () => { throw new Error('fallback down'); },
      fallbackReason: 'wiring',
    }),
    /fallback down/,
  );
  now += 100;
  await assert.rejects(
    rpc.request({
      role: 'canonical',
      method: 'eth_call',
      operation: async () => { throw new Error('primary down'); },
      fallback: async () => '0x',
      fallbackReason: 'wiring',
    }),
    /cooldown active/,
  );
});
