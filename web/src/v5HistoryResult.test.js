import assert from 'node:assert/strict'
import test from 'node:test'
import { v5HistoryResult } from './v5HistoryResult.js'

test('a non-winning draw never displays the draw prize pool as wallet winnings', () => {
  assert.deepEqual(v5HistoryResult(null), { result: 'No win', prizeAmount: null })
})

test('a winning draw displays the wallet compounded amount', () => {
  assert.deepEqual(v5HistoryResult({ compoundedAmount: '466900000000000000' }), {
    result: 'WINNER',
    prizeAmount: '466900000000000000',
  })
})
