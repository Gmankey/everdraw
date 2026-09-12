import assert from 'node:assert/strict'
import test from 'node:test'
import { sameWalletAccount, subscribeV5WalletSession, v5WalletModalView, v5WalletSessionAccount } from './v5WalletSession.js'

test('opens Connect for guests and Account for connected wallets', () => {
  assert.equal(v5WalletModalView(''), 'Connect')
  assert.equal(v5WalletModalView('0xabc'), 'Account')
})

test('restores the cached AppKit account and clears it on disconnect', () => {
  assert.equal(v5WalletSessionAccount({ isConnected: true, address: '0xCached' }), '0xCached')
  assert.equal(v5WalletSessionAccount({ isConnected: true }, ['0xProvider']), '0xProvider')
  assert.equal(v5WalletSessionAccount({ isConnected: false, address: '0xStale' }), '')
})

test('compares restored accounts case-insensitively', () => {
  assert.equal(sameWalletAccount('0xAbC', '0xaBc'), true)
  assert.equal(sameWalletAccount('0xAbC', '0xDef'), false)
})

test('reads a restored session immediately even when Reown emits no initial event', () => {
  const cached = { isConnected: true, address: '0xCached' }
  const received = []
  let listener
  let unsubscribed = false
  const fakeModal = {
    getAccount: () => cached,
    subscribeAccount: (callback) => {
      listener = callback
      return () => { unsubscribed = true }
    },
  }
  const unsubscribe = subscribeV5WalletSession(fakeModal, (session) => received.push(session))
  assert.deepEqual(received, [cached])
  listener({ isConnected: true, address: '0xSwitched' })
  listener({ isConnected: false })
  assert.deepEqual(received.map(v5WalletSessionAccount), ['0xCached', '0xSwitched', ''])
  unsubscribe()
  assert.equal(unsubscribed, true)
})
