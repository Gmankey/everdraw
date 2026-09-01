import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveWalletConnectProjectId } from './walletProjectId.js'

test('mainnet production builds reject missing and placeholder WalletConnect project IDs', () => {
  for (const projectId of ['', 'demo-project-id', 'your-project-id', 'replace-me']) {
    assert.throws(
      () => resolveWalletConnectProjectId({ projectId, chainId: 143, production: true }),
      /real VITE_WALLETCONNECT_PROJECT_ID/,
    )
  }
  assert.equal(
    resolveWalletConnectProjectId({ projectId: 'real-project-id', chainId: 143, production: true }),
    'real-project-id',
  )
})

test('the placeholder remains available only outside a production mainnet build', () => {
  assert.equal(
    resolveWalletConnectProjectId({ projectId: '', chainId: 10143, production: true }),
    'demo-project-id',
  )
  assert.equal(
    resolveWalletConnectProjectId({ projectId: '', chainId: 143, production: false }),
    'demo-project-id',
  )
})
