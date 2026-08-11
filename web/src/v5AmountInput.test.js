import assert from 'node:assert/strict'
import test from 'node:test'
import { formatV5MaxInput } from './v5AmountInput.js'

test('withdraw MAX preserves the exact on-chain principal', () => {
  assert.equal(
    formatV5MaxInput(20_243_410_196_438n),
    '0.000020243410196438',
  )
  assert.equal(
    formatV5MaxInput(20_057_020_243_410_196_438n),
    '20.057020243410196438',
  )
})

test('deposit MAX retains the existing four-decimal input buffer', () => {
  assert.equal(
    formatV5MaxInput(20_057_020_243_410_196_438n, { isDeposit: true }),
    '20.057',
  )
})
