import assert from 'node:assert/strict'
import test from 'node:test'
import { buildV5ClaimManyArgs } from './v5ClaimProofs.js'

test('batches every claimable winner leaf into one claimMany payload', () => {
  const base = {
    claimable: true,
    distribution_id: '0x01',
    account: '0x02',
    token: '0x03',
    amount: '100',
    kind: 0,
    proof: ['0x04'],
  }
  const result = buildV5ClaimManyArgs([
    { ...base, leaf_index: 0 },
    { ...base, distribution_id: '0x05', leaf_index: 1, proof: ['0x06'] },
    { ...base, distribution_id: '0x07', leaf_index: 2, claimable: false },
  ])
  assert.equal(result.leaves.length, 2)
  assert.deepEqual(result.proofs, [['0x04'], ['0x06']])
})
