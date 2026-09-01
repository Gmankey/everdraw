import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { AbiCoder, keccak256, toUtf8Bytes } from 'ethers';
import { createApiServer } from './server.js';

test('claim-proof API rejects unauthenticated writes and serves vault-scoped winner proofs', async (t) => {
  const row = {
    chainId: 143,
    vaultAddress: '0x0000000000000000000000000000000000000011',
    drawManagerAddress: '0x0000000000000000000000000000000000000022',
    claimManagerAddress: '0x0000000000000000000000000000000000000033',
    drawId: 9,
    distributionId: '0x' + '11'.repeat(32),
    leafIndex: 0,
    account: '0x0000000000000000000000000000000000000044',
    token: '0x0000000000000000000000000000000000000055',
    amount: '100',
    kind: 0,
    leafHash: '0x' + '22'.repeat(32),
    proof: '[]',
    root: '0x' + '22'.repeat(32),
    publishedAt: new Date(0).toISOString(),
  };
  const abi = AbiCoder.defaultAbiCoder();
  const distributionId = keccak256(abi.encode(['address', 'uint256'], [row.drawManagerAddress, row.drawId]));
  const leafHash = keccak256(abi.encode(
    ['bytes32', 'uint256', 'uint256', 'address', 'bytes32', 'uint256', 'address', 'address', 'uint256', 'uint8'],
    [
      keccak256(toUtf8Bytes('everdraw-v5-claim-leaf/3')),
      3,
      row.chainId,
      row.claimManagerAddress,
      distributionId,
      row.leafIndex,
      row.account,
      row.token,
      row.amount,
      row.kind,
    ],
  ));
  const payload = {
    algoVersion: 'everdraw-v5-draw-algorithm/3',
    chainId: row.chainId,
    vaultAddress: row.vaultAddress,
    drawManagerAddress: row.drawManagerAddress,
    claimManagerAddress: row.claimManagerAddress,
    drawId: row.drawId,
    root: leafHash,
    leafCount: 1,
    leaves: [{
      leafIndex: row.leafIndex,
      account: row.account,
      token: row.token,
      amount: row.amount,
      kind: row.kind,
      leaf: leafHash,
      proof: [],
    }],
  };
  let storedRows: unknown[] = [];
  let liveRoot = '0x' + 'ff'.repeat(32);
  const api = createApiServer({
    port: 0,
    runner: {} as never,
    roundsRepo: {} as never,
    walletRoundsRepo: {} as never,
    pointsRepo: {} as never,
    v5ClaimProofsRepo: {
      publishDraw(rows) { storedRows = rows; },
      listWinnerAccounts() { return []; },
      listWinnerProofs(account, vault) {
        return account === row.account && vault === row.vaultAddress ? [row] : [];
      },
    },
    v5Deployments: [{
      chainId: row.chainId,
      vaultAddress: row.vaultAddress,
      drawManagerAddress: row.drawManagerAddress,
      claimManagerAddress: row.claimManagerAddress,
    }],
    claimProofIngestSecret: 'x'.repeat(32),
    claimProofDistributionReader: async () => ({
      source: row.drawManagerAddress,
      sourceKey: '0x' + BigInt(row.drawId).toString(16).padStart(64, '0'),
      root: liveRoot,
      leafCount: 1,
      registeredAt: 1,
    }),
    startedAt: Date.now(),
  });
  const server = await api.start();
  t.after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  const base = 'http://127.0.0.1:' + port;

  const denied = await fetch(base + '/api/internal/v5/claim-proofs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(denied.status, 401);

  const wrongRoot = await fetch(base + '/api/internal/v5/claim-proofs', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + 'x'.repeat(32),
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  assert.equal(wrongRoot.status, 400);
  assert.equal(storedRows.length, 0);

  liveRoot = leafHash;
  const accepted = await fetch(base + '/api/internal/v5/claim-proofs', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + 'x'.repeat(32),
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  assert.equal(accepted.status, 200);
  assert.equal(storedRows.length, 1);

  const response = await fetch(base + '/api/v5/claims?account=' + row.account + '&vault=' + row.vaultAddress);
  assert.equal(response.status, 200);
  const proofs = await response.json();
  assert.equal(proofs.length, 1);
  assert.equal(proofs[0].draw_id, 9);
});
