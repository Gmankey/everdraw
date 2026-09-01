import { timingSafeEqual } from 'node:crypto';
import { AbiCoder, getAddress, keccak256, solidityPacked, toUtf8Bytes } from 'ethers';
import type { V5ClaimProofRow } from '../repositories/v5ClaimProofsRepo.js';
import type { V5DeploymentScope } from '../types/domain.js';

const abi = AbiCoder.defaultAbiCoder();
const LEAF_DOMAIN = keccak256(toUtf8Bytes('everdraw-v5-claim-leaf/3'));
const CLAIM_LEAF_VERSION = 3n;
const ALGO_VERSION = 'everdraw-v5-draw-algorithm/3';
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

export interface PublishedClaimProofs {
  algoVersion: string;
  chainId: string | number;
  vaultAddress: string;
  drawManagerAddress: string;
  claimManagerAddress: string;
  drawId: string | number;
  root: string;
  leafCount: number;
  leaves: Array<{
    leafIndex: string | number;
    account: string;
    token: string;
    amount: string;
    kind: number;
    leaf: string;
    proof: string[];
  }>;
}

export function secureSecretEqual(expected: string | undefined, supplied: string | undefined): boolean {
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function bytes32(value: unknown, label: string): string {
  const normalized = String(value || '').toLowerCase();
  if (!BYTES32.test(normalized)) throw new Error("Invalid " + label);
  return normalized;
}

function uint(value: unknown, label: string): bigint {
  try {
    const normalized = BigInt(String(value));
    if (normalized < 0n) throw new Error();
    return normalized;
  } catch {
    throw new Error("Invalid " + label);
  }
}

function proofRoot(leaf: string, proof: string[]): string {
  let hash = bytes32(leaf, 'leaf');
  for (const siblingValue of proof) {
    const sibling = bytes32(siblingValue, 'proof node');
    const [a, b] = hash < sibling ? [hash, sibling] : [sibling, hash];
    hash = keccak256(solidityPacked(['bytes32', 'bytes32'], [a, b])).toLowerCase();
  }
  return hash;
}

export function validatePublishedClaimProofs(
  payload: PublishedClaimProofs,
  deployments: V5DeploymentScope[],
): V5ClaimProofRow[] {
  if (!payload || payload.algoVersion !== ALGO_VERSION) throw new Error('Unsupported claim-proof algorithm');
  const chainId = Number(payload.chainId);
  const vaultAddress = getAddress(payload.vaultAddress).toLowerCase();
  const drawManagerAddress = getAddress(payload.drawManagerAddress).toLowerCase();
  const claimManagerAddress = getAddress(payload.claimManagerAddress).toLowerCase();
  const drawId = Number(uint(payload.drawId, 'drawId'));
  if (!Number.isSafeInteger(chainId) || !Number.isSafeInteger(drawId)) throw new Error('Invalid chainId or drawId');
  const deployment = deployments.find((item) =>
    item.chainId === chainId
    && item.vaultAddress === vaultAddress
    && item.drawManagerAddress === drawManagerAddress
    && item.claimManagerAddress === claimManagerAddress
  );
  if (!deployment) throw new Error('Claim proof does not match an active V5 deployment');

  const root = bytes32(payload.root, 'root');
  if (!Array.isArray(payload.leaves) || payload.leaves.length !== Number(payload.leafCount)) {
    throw new Error('Claim-proof leaf count mismatch');
  }
  const distributionId = keccak256(abi.encode(['address', 'uint256'], [drawManagerAddress, drawId])).toLowerCase();
  const seen = new Set<string>();
  const publishedAt = new Date().toISOString();

  return payload.leaves.map((leaf) => {
    const leafIndexBig = uint(leaf.leafIndex, 'leafIndex');
    const leafIndex = Number(leafIndexBig);
    const amount = uint(leaf.amount, 'amount');
    const kind = Number(leaf.kind);
    if (!Number.isSafeInteger(leafIndex) || ![0, 1, 2].includes(kind)) throw new Error('Invalid claim leaf');
    if (seen.has(String(leafIndex))) throw new Error('Duplicate claim leaf index');
    seen.add(String(leafIndex));
    const account = getAddress(leaf.account).toLowerCase();
    const token = getAddress(leaf.token).toLowerCase();
    const expectedLeaf = keccak256(abi.encode(
      ['bytes32', 'uint256', 'uint256', 'address', 'bytes32', 'uint256', 'address', 'address', 'uint256', 'uint8'],
      [LEAF_DOMAIN, CLAIM_LEAF_VERSION, chainId, claimManagerAddress, distributionId, leafIndexBig, account, token, amount, kind],
    )).toLowerCase();
    if (bytes32(leaf.leaf, 'leaf') !== expectedLeaf) throw new Error('Claim leaf payload does not match leaf hash');
    if (!Array.isArray(leaf.proof) || proofRoot(expectedLeaf, leaf.proof) !== root) {
      throw new Error('Claim proof does not resolve to the proposed root');
    }
    return {
      chainId,
      vaultAddress,
      drawManagerAddress,
      claimManagerAddress,
      drawId,
      distributionId,
      leafIndex,
      account,
      token,
      amount: amount.toString(),
      kind,
      leafHash: expectedLeaf,
      proof: JSON.stringify(leaf.proof.map((node) => bytes32(node, 'proof node'))),
      root,
      publishedAt,
    };
  });
}


export interface ClaimProofDistributionSnapshot {
  source: string;
  sourceKey: string;
  root: string;
  leafCount: number | bigint;
  registeredAt: number | bigint;
}

export function assertPublishedProofsMatchDistribution(
  rows: V5ClaimProofRow[],
  distribution: ClaimProofDistributionSnapshot,
): void {
  if (rows.length === 0) throw new Error('Claim-proof publication cannot be empty');
  const first = rows[0];
  const expectedSourceKey = '0x' + BigInt(first.drawId).toString(16).padStart(64, '0');
  if (getAddress(distribution.source).toLowerCase() !== first.drawManagerAddress) {
    throw new Error('Claim-proof distribution source does not match DrawManager');
  }
  if (bytes32(distribution.sourceKey, 'distribution source key') !== expectedSourceKey) {
    throw new Error('Claim-proof distribution source key does not match draw');
  }
  if (bytes32(distribution.root, 'distribution root') !== first.root) {
    throw new Error('Claim-proof root does not match finalized on-chain distribution');
  }
  if (BigInt(distribution.leafCount) !== BigInt(rows.length)) {
    throw new Error('Claim-proof leaf count does not match finalized on-chain distribution');
  }
  if (BigInt(distribution.registeredAt) === 0n) {
    throw new Error('Claim-proof distribution is not finalized on-chain');
  }
}
