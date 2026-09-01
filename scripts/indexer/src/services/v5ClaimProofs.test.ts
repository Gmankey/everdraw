import assert from 'node:assert/strict';
import test from 'node:test';
import { AbiCoder, keccak256, toUtf8Bytes } from 'ethers';
import {
  assertPublishedProofsMatchDistribution,
  validatePublishedClaimProofs,
} from './v5ClaimProofs.js';

const abi = AbiCoder.defaultAbiCoder();
const chainId = 143;
const vaultAddress = '0x0000000000000000000000000000000000000011';
const drawManagerAddress = '0x0000000000000000000000000000000000000022';
const claimManagerAddress = '0x0000000000000000000000000000000000000033';
const account = '0x0000000000000000000000000000000000000044';
const token = '0x0000000000000000000000000000000000000055';
const drawId = 9;
const distributionId = keccak256(abi.encode(['address', 'uint256'], [drawManagerAddress, drawId]));
const leaf = keccak256(abi.encode(
  ['bytes32', 'uint256', 'uint256', 'address', 'bytes32', 'uint256', 'address', 'address', 'uint256', 'uint8'],
  [keccak256(toUtf8Bytes('everdraw-v5-claim-leaf/3')), 3, chainId, claimManagerAddress, distributionId, 0, account, token, 100, 0],
));
const deployments = [{ chainId, vaultAddress, drawManagerAddress, claimManagerAddress }];
const payload = {
  algoVersion: 'everdraw-v5-draw-algorithm/3',
  chainId,
  vaultAddress,
  drawManagerAddress,
  claimManagerAddress,
  drawId,
  root: leaf,
  leafCount: 1,
  leaves: [{ leafIndex: 0, account, token, amount: '100', kind: 0, leaf, proof: [] }],
};

test('accepts a scoped v3 winner proof and normalizes it for persistence', () => {
  const rows = validatePublishedClaimProofs(payload, deployments);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].distributionId, distributionId.toLowerCase());
  assert.equal(rows[0].root, leaf.toLowerCase());
  assert.equal(rows[0].account, account.toLowerCase());
});

test('rejects payload tampering and a different deployment scope', () => {
  assert.throws(() => validatePublishedClaimProofs({ ...payload, leaves: [{ ...payload.leaves[0], amount: '101' }] }, deployments), /leaf payload/);
  assert.throws(() => validatePublishedClaimProofs(payload, [{ ...deployments[0], vaultAddress: account }]), /active V5 deployment/);
});


test('requires the finalized on-chain source, draw key, root, and leaf count', () => {
  const rows = validatePublishedClaimProofs(payload, deployments);
  const finalized = {
    source: drawManagerAddress,
    sourceKey: '0x' + BigInt(drawId).toString(16).padStart(64, '0'),
    root: leaf,
    leafCount: 1,
    registeredAt: 1,
  };
  assert.doesNotThrow(() => assertPublishedProofsMatchDistribution(rows, finalized));
  assert.throws(
    () => assertPublishedProofsMatchDistribution(rows, { ...finalized, root: '0x' + 'ff'.repeat(32) }),
    /finalized on-chain distribution/,
  );
  assert.throws(
    () => assertPublishedProofsMatchDistribution(rows, { ...finalized, leafCount: 2 }),
    /leaf count/,
  );
  assert.throws(
    () => assertPublishedProofsMatchDistribution(rows, { ...finalized, registeredAt: 0 }),
    /not finalized/,
  );
});
