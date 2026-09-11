import assert from 'node:assert/strict'
import test from 'node:test'
import { V5_NETWORK_RETRY_MESSAGE, isTransientRpcError, runRpcReads, v5UserError, withRpcReadRetry } from './v5RpcRead.js'

test('retries transient RPC read failures with backoff', async () => {
  let calls = 0
  const delays = []
  const value = await withRpcReadRetry(async () => {
    calls += 1
    if (calls < 3) throw Object.assign(new Error('missing revert data'), { code: 'CALL_EXCEPTION' })
    return 42
  }, { baseDelayMs: 10, sleep: async (ms) => delays.push(ms) })

  assert.equal(value, 42)
  assert.equal(calls, 3)
  assert.deepEqual(delays, [10, 20])
})

test('recognizes flaky RPC errors and never exposes their raw message', () => {
  const error = Object.assign(new Error('execution reverted: 0xfe5d38ec (missing revert data)'), { code: 'CALL_EXCEPTION' })
  assert.equal(isTransientRpcError(error), true)
  assert.equal(v5UserError(error), V5_NETWORK_RETRY_MESSAGE)
  assert.equal(v5UserError(new Error('opaque internal failure')), 'Something went wrong. Please try again.')
})

test('runs RPC reads with bounded concurrency and retries only the failed read', async () => {
  let active = 0
  let peak = 0
  const calls = [0, 0, 0, 0, 0, 0]
  const reads = calls.map((_, index) => async () => {
    calls[index] += 1
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    active -= 1
    if (index === 2 && calls[index] === 1) {
      throw Object.assign(new Error('failed to fetch'), { code: 'NETWORK_ERROR' })
    }
    return index
  })

  const results = await runRpcReads(reads, {
    concurrency: 3,
    attempts: 2,
    baseDelayMs: 0,
  })

  assert.deepEqual(results, [0, 1, 2, 3, 4, 5])
  assert.equal(peak, 3)
  assert.deepEqual(calls, [1, 1, 2, 1, 1, 1])
})
