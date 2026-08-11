import assert from 'node:assert/strict'
import test from 'node:test'
import { runV5ConfirmedFollowups } from './v5TransactionLifecycle.js'

test('closes receipt-driven UI before refreshing reads', async () => {
  const calls = []
  await runV5ConfirmedFollowups({
    context: { account: '0xabc' },
    onReceipt: () => calls.push('receipt'),
    refresh: async () => calls.push('refresh'),
    afterConfirm: async () => calls.push('confirmed'),
  })
  assert.deepEqual(calls, ['receipt', 'refresh', 'confirmed'])
})

test('a failed post-confirmation refresh cannot block modal close or followups', async () => {
  const calls = []
  await runV5ConfirmedFollowups({
    context: { account: '0xabc' },
    onReceipt: () => calls.push('receipt'),
    refresh: async () => {
      calls.push('refresh')
      throw new Error('temporary RPC failure')
    },
    afterConfirm: async () => calls.push('confirmed'),
  })
  assert.deepEqual(calls, ['receipt', 'refresh', 'confirmed'])
})
