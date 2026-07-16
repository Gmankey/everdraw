import assert from 'node:assert/strict';
import { normalizeVaultQuery, scopeRowsByVault } from './vaultFilter.js';

const currentVault = '0x00000000000000000000000000000000000000aa';
const oldVault = '0x00000000000000000000000000000000000000bb';
const rows = [
  { id: 'current', vaultAddress: currentVault.toUpperCase().replace('0X', '0x') },
  { id: 'old', vaultAddress: oldVault },
];

const query = normalizeVaultQuery(currentVault.toUpperCase().replace('0X', '0x'));
assert.equal(query.valid, true);
assert.deepEqual(scopeRowsByVault(rows, query.address).map((row) => row.id), ['current']);
assert.equal(normalizeVaultQuery(['not', 'one', 'address']).valid, false);
assert.deepEqual(scopeRowsByVault(rows, null), rows);

console.log('vaultFilter.test.ts ok');
