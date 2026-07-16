import assert from 'node:assert/strict'
import test from 'node:test'
import { scopeV5RowsToVault } from './v5VaultScope.js'

const currentVault = '0x00000000000000000000000000000000000000AA'
const oldVault = '0x00000000000000000000000000000000000000bb'
const rows = [
  { id: 'current-vault', vault_address: currentVault.toLowerCase(), remaining_amount: '10' },
  { id: 'old-vault', vault_address: oldVault, remaining_amount: '20' },
]

test('shows only current-vault tranches and position events', () => {
  assert.deepEqual(scopeV5RowsToVault(rows, currentVault).map((row) => row.id), ['current-vault'])
})

test('fails closed when the active vault is unavailable', () => {
  assert.deepEqual(scopeV5RowsToVault(rows, ''), [])
})
