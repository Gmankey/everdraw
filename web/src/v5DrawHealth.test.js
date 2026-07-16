import assert from 'node:assert/strict'
import test from 'node:test'
import { buildV5DrawHealth } from './v5DrawHealth.js'

function stateAt({ blockTime = 1_000, nextPeriodStart = 1_000, drawPeriod = 100, due = false }) {
  return { block: { timestamp: blockTime }, readAtMs: 10_000, nextPeriodStart: BigInt(nextPeriodStart), drawPeriod: BigInt(drawPeriod), preview: { due } }
}
test('reports loading before the schedule is available', () => {
  assert.equal(buildV5DrawHealth({ state: null }).isLoading, true)
})

test('keeps deposits open while counting down', () => {
  const h = buildV5DrawHealth({ state: stateAt({}), nowMs: 10_000 })
  assert.deepEqual([h.secondsRemaining, h.isStarting, h.isStalled], [100, false, false])
})
test('uses settling during the first overdue period', () => {
  const h = buildV5DrawHealth({ state: stateAt({ blockTime: 1_101, due: true }), nowMs: 10_000 })
  assert.deepEqual([h.isStarting, h.isStalled], [true, false])
})
test('stalls only after more than one full period overdue', () => {
  assert.equal(buildV5DrawHealth({ state: stateAt({ blockTime: 1_200, due: true }), nowMs: 10_000 }).isStalled, false)
  const h = buildV5DrawHealth({ state: stateAt({ blockTime: 1_201, due: true }), nowMs: 10_000 })
  assert.deepEqual([h.isStarting, h.isStalled], [false, true])
})
test('advances countdown between RPC reads', () => {
  assert.equal(buildV5DrawHealth({ state: stateAt({}), nowMs: 15_000 }).secondsRemaining, 95)
})
