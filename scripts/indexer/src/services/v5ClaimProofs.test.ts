import assert from 'node:assert/strict';
import test from 'node:test';
import { AbiCoder, keccak256, toUtf8Bytes } from 'ethers';
import { validatePublishedClaimProofs } from './v5ClaimProofs.js';

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
