import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { applySchema } from '../db/database.js';
import { createV5ClaimProofsRepo, type V5ClaimProofRow } from './v5ClaimProofsRepo.js';

const wallet = '0x0000000000000000000000000000000000000044';
const vault = '0x0000000000000000000000000000000000000011';
const row: V5ClaimProofRow = {
  chainId: 143,
  vaultAddress: vault,
  drawManagerAddress: '0x0000000000000000000000000000000000000022',
  claimManagerAddress: '0x0000000000000000000000000000000000000033',
  drawId: 9,
  distributionId: '0x' + '11'.repeat(32),
  leafIndex: 0,
  account: wallet,
  token: '0x0000000000000000000000000000000000000055',
  amount: '100',
  kind: 0,
  leafHash: '0x' + '22'.repeat(32),
  proof: '[]',
  root: '0x' + '22'.repeat(32),
  publishedAt: new Date(0).toISOString(),
};

test('claim proofs publish idempotently, reject replacement, and remain vault scoped', () => {
  const db = new Database(':memory:');
  applySchema(db);
  const repo = createV5ClaimProofsRepo(db);
  repo.publishDraw([row]);
  repo.publishDraw([row]);
  assert.throws(() => repo.publishDraw([{ ...row, amount: '101' }]), /immutable/);
  assert.equal(repo.listWinnerProofs(wallet, vault).length, 1);
  assert.equal(repo.listWinnerProofs(wallet, vault)[0].amount, '100');
  assert.deepEqual(repo.listWinnerAccounts(row.drawManagerAddress, row.drawId), [wallet]);
  assert.equal(repo.listWinnerProofs(wallet, '0x0000000000000000000000000000000000000099').length, 0);
  db.close();
});
