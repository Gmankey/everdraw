import assert from 'node:assert/strict'
import test from 'node:test'
import { walletParticipatedInDraw } from './v5DrawParticipation.js'

const draw = {
  roundId: 12,
  openedAt: '2026-07-20T00:00:00.000Z',
  salesEndTime: '2026-07-20T01:00:00.000Z',
}

test('includes only draws overlapped by an active participant tranche', () => {
  const active = { pool_type: 'vault', opened_at: '2026-07-20T00:30:00.000Z', closed_at: null }
  const exitedBefore = { pool_type: 'vault', opened_at: '2026-07-19T22:00:00.000Z', closed_at: '2026-07-19T23:00:00.000Z' }
  const patron = { pool_type: 'degen', opened_at: '2026-07-19T22:00:00.000Z', closed_at: null }

  assert.equal(walletParticipatedInDraw(draw, [active]), true)
  assert.equal(walletParticipatedInDraw(draw, [exitedBefore]), false)
  assert.equal(walletParticipatedInDraw(draw, [patron]), false)
  assert.equal(walletParticipatedInDraw(draw, []), false)
  assert.equal(walletParticipatedInDraw({ roundId: 12 }, [{ pool_type: 'vault', start_draw_id: null }]), false)
})

test('keeps a winning draw even when old tranche timing data is unavailable', () => {
  assert.equal(walletParticipatedInDraw(draw, [], { drawId: 12 }), true)
})
