import type { V5DeploymentScope } from '../types/domain.js';
import { MIN_QUALIFYING_MON } from '../services/pointsMath.js';

export interface RunnerConfig {
  rpcUrl: string;
  rpcUrlFallback?: string;
  chainId: number;
  poolAddresses: string[];
  v5Deployments: V5DeploymentScope[];
  claimProofIngestSecret: string;
  deployBlock: number;
  confirmations: number;
  chunkSize: number;
  maxBlocksPerSync: number;
  pollIntervalMs: number;
  pointsCheckpointIntervalSec: number;
  /** ADR-0049 §3 — MON a wallet must hold through a draw to earn one-time bonuses. */
  pointsMinQualifyingMon: number;
}

export function getRunnerConfig(): RunnerConfig {
  const rpcUrl = process.env.RPC_URL ?? process.env.INDEXER_RPC_URL;
  const rpcUrlFallback = process.env.RPC_URL_FALLBACK?.trim() || undefined;
  const raw = process.env.POOL_ADDRESSES ?? process.env.POOL_ADDRESS ?? process.env.INDEXER_POOL_ADDRESS ?? '';
  const poolAddresses = raw.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
  const deployBlock = Number(process.env.START_BLOCK ?? process.env.INDEXER_DEPLOY_BLOCK ?? 0);
  const chainId = Number(process.env.INDEXER_CHAIN_ID ?? process.env.CHAIN_ID ?? 0);
  const confirmations = Number(process.env.INDEXER_CONFIRMATIONS ?? 12);
  const rawV5Deployments = process.env.V5_DEPLOYMENTS_JSON;
  if (!rawV5Deployments?.trim()) {
    throw new Error('Missing V5_DEPLOYMENTS_JSON; managed V5 indexing requires an explicit deployment tuple');
  }
  const v5Deployments = parseV5Deployments(rawV5Deployments);
  const claimProofIngestSecret = process.env.CLAIM_PROOF_INGEST_SECRET?.trim() ?? '';

  if (!rpcUrl) throw new Error('Missing RPC_URL');
  if (!poolAddresses.length) throw new Error('Missing POOL_ADDRESSES');
  if (!deployBlock) throw new Error('Missing START_BLOCK');
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('Missing or invalid INDEXER_CHAIN_ID');
  if (!Number.isInteger(confirmations) || confirmations <= 0) {
    throw new Error('INDEXER_CONFIRMATIONS must be a positive integer');
  }
  if (claimProofIngestSecret.length < 32) {
    throw new Error('CLAIM_PROOF_INGEST_SECRET must be at least 32 characters for V5 deployments');
  }

  // ADR-0049 §3 — Sybil control. Defaults to the ADR value rather than "off", so a
  // deployment that forgets the env var is still gated. 0 explicitly disables it.
  const pointsMinQualifyingMon = Number(process.env.POINTS_MIN_QUALIFYING_MON ?? MIN_QUALIFYING_MON);
  if (!Number.isFinite(pointsMinQualifyingMon) || pointsMinQualifyingMon < 0) {
    throw new Error('POINTS_MIN_QUALIFYING_MON must be a non-negative number');
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
    claimProofIngestSecret,
    deployBlock,
    confirmations,
    chunkSize: Number(process.env.INDEXER_CHUNK_SIZE ?? 100),
    maxBlocksPerSync: Number(process.env.INDEXER_MAX_BLOCKS_PER_SYNC ?? 10_000),
    pollIntervalMs: Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 2000),
    pointsCheckpointIntervalSec: Number(process.env.POINTS_CHECKPOINT_INTERVAL_SEC ?? 604_800),
    pointsMinQualifyingMon,
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
  if (parsed.length === 0) {
    throw new Error('V5_DEPLOYMENTS_JSON must contain at least one deployment tuple');
  }

  const seenRoles = new Set<string>();
  const seenTuples = new Set<string>();
  return parsed.map((item, index) => {
    if (item == null || typeof item !== 'object') throw new Error(`Invalid V5 deployment at index ${index}`);
    const value = item as Record<string, unknown>;
    const deployment: V5DeploymentScope = {
      chainId: Number(value.chainId),
      vaultAddress: normalizeAddress(value.vaultAddress, 'vaultAddress', index),
      drawManagerAddress: normalizeAddress(value.drawManagerAddress, 'drawManagerAddress', index),
      claimManagerAddress: normalizeAddress(value.claimManagerAddress, 'claimManagerAddress', index),
    };
    const tupleKey = [deployment.chainId, deployment.vaultAddress, deployment.drawManagerAddress, deployment.claimManagerAddress].join(':');
    if (seenTuples.has(tupleKey)) {
      throw new Error(`Duplicate V5 deployment tuple at index ${index}`);
    }
    seenTuples.add(tupleKey);
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
