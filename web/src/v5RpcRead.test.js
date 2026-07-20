import assert from 'node:assert/strict'
import test from 'node:test'
import { V5_NETWORK_RETRY_MESSAGE, isTransientRpcError, v5UserError, withRpcReadRetry } from './v5RpcRead.js'

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
