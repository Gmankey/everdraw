import assert from 'node:assert/strict'
import test from 'node:test'
import { lowReserveFailure } from './protocol-monitor-policy.mjs'

test('active pools still fail below the VRF reserve threshold', () => {
  assert.equal(lowReserveFailure({ reserveMon: 0, stoppedAt: 0, thresholdMon: 5 }), 'VRF reserve 0.0000 MON below 5')
})

test('stopped pools are excluded from the VRF reserve alarm', () => {
  assert.equal(lowReserveFailure({ reserveMon: 0, stoppedAt: 1780000000, thresholdMon: 5 }), null)
})

test('healthy active pools do not produce a reserve failure', () => {
  assert.equal(lowReserveFailure({ reserveMon: 8.23, stoppedAt: 0, thresholdMon: 5 }), null)
})
