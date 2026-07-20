import assert from 'node:assert/strict'
import test from 'node:test'
import { buildV5PrizeWins } from './v5PrizeWins.js'

test('joins a prize compound to its credited tranche and winning draw', () => {
  const wins = buildV5PrizeWins([
    {
      tx_hash: '0xcompound',
      log_index: 13,
      block_timestamp: '2026-07-16T05:04:53.000Z',
      action: 'deposit',
      amount: '79487845611576211',
      source: 'prize_compound',
    },
    { tx_hash: '0xuser', action: 'deposit', amount: '100', source: 'user' },
  ], [
    {
      opened_tx_hash: '0xCOMPOUND',
      opened_log_index: 13,
      start_draw_id: 29,
      amount: '79487845611576211',
      remaining_amount: '70000000000000000',
    },
  ])

  assert.equal(wins.length, 1)
  assert.equal(wins[0].drawId, 28)
  assert.equal(wins[0].compoundedAmount, '79487845611576211')
  assert.equal(wins[0].remainingAmount, '70000000000000000')
})

test('keeps a withdrawn win discoverable but does not select it for withdrawal', () => {
  const wins = buildV5PrizeWins([
    { tx_hash: '0xclosed', log_index: 1, action: 'deposit', amount: '50', source: 'prize_compound' },
  ], [
    { opened_tx_hash: '0xclosed', opened_log_index: 1, start_draw_id: 4, remaining_amount: '0' },
  ])

  assert.equal(wins[0].drawId, 3)
  assert.equal(wins[0].remainingAmount, '0')
})
