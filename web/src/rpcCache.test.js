import assert from 'node:assert/strict'
import test from 'node:test'
import { _cached, _rpcCache, getCachedRoundInfo, isAbortError } from './rpcCache.js'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('cached helper dedupes pending promises for the same key', async () => {
  _rpcCache.clear()
  let calls = 0
  const fetcher = async () => {
    calls += 1
    await delay(25)
    return { ok: true }
  }

  const [a, b, c] = await Promise.all([
    _cached('pool:a:round:1', 1000, fetcher),
    _cached('pool:a:round:1', 1000, fetcher),
    _cached('pool:a:round:1', 1000, fetcher),
  ])

  assert.equal(calls, 1)
  assert.deepEqual(a, { ok: true })
  assert.equal(a, b)
  assert.equal(b, c)
})

test('aborted callers detach from an in-flight cached request without killing the canonical promise', async () => {
  _rpcCache.clear()
  let calls = 0
  const ac = new AbortController()
  const fetcher = async () => {
    calls += 1
    await delay(40)
    return 'fresh'
  }

  const aborted = _cached('pool:b:round:2', 1000, fetcher, ac.signal)
  const shared = _cached('pool:b:round:2', 1000, fetcher)
  ac.abort()

  await assert.rejects(aborted, isAbortError)
  assert.equal(await shared, 'fresh')
  assert.equal(calls, 1)
})

test('round info cache dedupes rapid per-pool reads', async () => {
  _rpcCache.clear()
  let calls = 0
  const pool = {
    async getRoundInfo() {
      calls += 1
      await delay(25)
      return { state: 0, totalTickets: 1 }
    },
  }

  const [a, b] = await Promise.all([
    getCachedRoundInfo(pool, '0xpool', 7n),
    getCachedRoundInfo(pool, '0xpool', 7n),
  ])

  assert.equal(calls, 1)
  assert.equal(a, b)
})
