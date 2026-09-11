import assert from 'node:assert/strict'
import test from 'node:test'
import { sameWalletAccount, v5WalletModalView, v5WalletSessionAccount } from './v5WalletSession.js'

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
