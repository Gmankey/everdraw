import assert from 'node:assert/strict'
import test from 'node:test'

import { v5PeriodAccountEvents } from './v5PeriodAccountEvents.js'

const iso = (seconds) => new Date(seconds * 1000).toISOString()

test('ticket reconstruction includes participant transfers and excludes Patron and prior-period activity', () => {
  const events = v5PeriodAccountEvents([
    { pool_type: 'vault', action: 'deposit', amount: '10', block_number: 2, log_index: 0, block_timestamp: iso(110) },
    { pool_type: 'vault', action: 'transfer_in', amount: '4', block_number: 3, log_index: 0, block_timestamp: iso(120) },
    { pool_type: 'vault', action: 'transfer_out', amount: '3', block_number: 4, log_index: 0, block_timestamp: iso(130) },
    { pool_type: 'vault', action: 'withdraw', amount: '2', block_number: 5, log_index: 0, block_timestamp: iso(140) },
    { pool_type: 'degen', action: 'deposit', amount: '99', block_number: 6, log_index: 0, block_timestamp: iso(150) },
    { pool_type: 'vault', action: 'deposit', amount: '88', block_number: 1, log_index: 0, block_timestamp: iso(99) },
  ], 100)

  assert.deepEqual(events.map(({ type, amount }) => ({ type, amount })), [
    { type: 'deposit', amount: '10' },
    { type: 'deposit', amount: '4' },
    { type: 'withdraw', amount: '3' },
    { type: 'withdraw', amount: '2' },
  ])
})
