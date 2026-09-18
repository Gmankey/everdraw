import assert from 'node:assert/strict'
import test from 'node:test'
import { buildV5DataAvailability, buildV5DrawHealth } from "./v5DrawHealth.js"

function stateAt({ blockTime = 1_000, nextPeriodStart = 1_000, drawPeriod = 100, due = false, lastDrawAdvancedAtMs = 0 }) {
  return { block: { timestamp: blockTime }, readAtMs: 10_000, nextPeriodStart: BigInt(nextPeriodStart), drawPeriod: BigInt(drawPeriod), preview: { due }, lastDrawAdvancedAtMs }
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
test('keeps deposits open while an overdue backlog is actively advancing', () => {
  const h = buildV5DrawHealth({
    state: stateAt({ blockTime: 1_301, due: true, lastDrawAdvancedAtMs: 9_000 }),
    nowMs: 10_000,
  })
  assert.deepEqual([h.isStarting, h.isStalled], [true, false])
})
test('advances countdown between RPC reads', () => {
  assert.equal(buildV5DrawHealth({ state: stateAt({}), nowMs: 15_000 }).secondsRemaining, 95)
})

test("does not show the unavailable banner while the first verification is loading", () => {
  assert.deepEqual(buildV5DataAvailability("loading"), { isReady: false, showUnavailable: false })
})

test("shows the unavailable banner only after verification fails", () => {
  assert.deepEqual(buildV5DataAvailability("unavailable"), { isReady: false, showUnavailable: true })
  assert.deepEqual(buildV5DataAvailability("ready"), { isReady: true, showUnavailable: false })
})
