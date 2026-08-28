import type { V5DeploymentScope } from '../types/domain.js';

export interface RunnerConfig {
  rpcUrl: string;
  rpcUrlFallback?: string;
  chainId: number;
  poolAddresses: string[];
  v5Deployments: V5DeploymentScope[];
  deployBlock: number;
  confirmations: number;
  chunkSize: number;
  maxBlocksPerSync: number;
  pollIntervalMs: number;
  pointsCheckpointIntervalSec: number;
}

export function getRunnerConfig(): RunnerConfig {
  const rpcUrl = process.env.RPC_URL ?? process.env.INDEXER_RPC_URL;
  const rpcUrlFallback = process.env.RPC_URL_FALLBACK?.trim() || undefined;
  const raw = process.env.POOL_ADDRESSES ?? process.env.POOL_ADDRESS ?? process.env.INDEXER_POOL_ADDRESS ?? '';
  const poolAddresses = raw.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
  const deployBlock = Number(process.env.START_BLOCK ?? process.env.INDEXER_DEPLOY_BLOCK ?? 0);
  const chainId = Number(process.env.INDEXER_CHAIN_ID ?? process.env.CHAIN_ID ?? 0);
  const confirmations = Number(process.env.INDEXER_CONFIRMATIONS ?? 12);
  const v5Deployments = parseV5Deployments(process.env.V5_DEPLOYMENTS_JSON ?? '[]');

  if (!rpcUrl) throw new Error('Missing RPC_URL');
  if (!poolAddresses.length) throw new Error('Missing POOL_ADDRESSES');
  if (!deployBlock) throw new Error('Missing START_BLOCK');
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('Missing or invalid INDEXER_CHAIN_ID');
  if (!Number.isInteger(confirmations) || confirmations <= 0) {
    throw new Error('INDEXER_CONFIRMATIONS must be a positive integer');
  }

  for (const deployment of v5Deployments) {
    if (deployment.chainId !== chainId) {
      throw new Error(`V5 deployment chain mismatch: expected ${chainId}, got ${deployment.chainId}`);
    }
    for (const address of [deployment.vaultAddress, deployment.drawManagerAddress, deployment.claimManagerAddress]) {
      if (!poolAddresses.includes(address)) {
        throw new Error(`V5 deployment address missing from POOL_ADDRESSES: ${address}`);
      }
    }
  }

  return {
    rpcUrl,
    rpcUrlFallback,
    chainId,
    poolAddresses,
    v5Deployments,
    deployBlock,
    confirmations,
    chunkSize: Number(process.env.INDEXER_CHUNK_SIZE ?? 100),
    maxBlocksPerSync: Number(process.env.INDEXER_MAX_BLOCKS_PER_SYNC ?? 10_000),
    pollIntervalMs: Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 2000),
    pointsCheckpointIntervalSec: Number(process.env.POINTS_CHECKPOINT_INTERVAL_SEC ?? 604_800),
  };
}

function parseV5Deployments(raw: string): V5DeploymentScope[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('V5_DEPLOYMENTS_JSON must be valid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('V5_DEPLOYMENTS_JSON must be an array');

  const seenRoles = new Set<string>();
  return parsed.map((item, index) => {
    if (item == null || typeof item !== 'object') throw new Error(`Invalid V5 deployment at index ${index}`);
    const value = item as Record<string, unknown>;
    const deployment: V5DeploymentScope = {
      chainId: Number(value.chainId),
      vaultAddress: normalizeAddress(value.vaultAddress, 'vaultAddress', index),
      drawManagerAddress: normalizeAddress(value.drawManagerAddress, 'drawManagerAddress', index),
      claimManagerAddress: normalizeAddress(value.claimManagerAddress, 'claimManagerAddress', index),
    };
    for (const [role, address] of [
      ['vault', deployment.vaultAddress],
      ['drawManager', deployment.drawManagerAddress],
      ['claimManager', deployment.claimManagerAddress],
    ] as const) {
      const key = `${role}:${address}`;
      if (seenRoles.has(key)) throw new Error(`Duplicate V5 ${role} address: ${address}`);
      seenRoles.add(key);
    }
    if (new Set([deployment.vaultAddress, deployment.drawManagerAddress, deployment.claimManagerAddress]).size !== 3) {
      throw new Error(`Ambiguous V5 contract roles at index ${index}`);
    }
    return deployment;
  });
}

function normalizeAddress(value: unknown, field: string, index: number): string {
  const address = String(value ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error(`Invalid ${field} at V5 deployment index ${index}`);
  return address;
}
