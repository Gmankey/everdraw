import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import type { AbstractProvider } from 'ethers';
import { applySchema } from '../db/database.js';
import { createIndexerStateRepo } from '../repositories/indexerStateRepo.js';
import { createRawEventsRepo } from '../repositories/rawEventsRepo.js';
import type { V5DeploymentScope } from '../types/domain.js';
import type { RunnerConfig } from './config.js';
import { assertProviderChainId, createIndexerRunner } from './service.js';

const deployment: V5DeploymentScope = {
  chainId: 143,
  vaultAddress: '0x0000000000000000000000000000000000000011',
  drawManagerAddress: '0x0000000000000000000000000000000000000022',
  claimManagerAddress: '0x0000000000000000000000000000000000000033',
};
const config: RunnerConfig = {
  rpcUrl: 'https://rpc.invalid',
  chainId: 143,
  poolAddresses: [deployment.vaultAddress, deployment.drawManagerAddress, deployment.claimManagerAddress],
  v5Deployments: [deployment],
  claimProofIngestSecret: 'a'.repeat(32),
  deployBlock: 100,
  confirmations: 12,
  chunkSize: 100,
  maxBlocksPerSync: 1000,
  pollIntervalMs: 1000,
  pointsMinQualifyingMon: 100,
};

function runnerWith(wiring: {
  vaultDrawManager: string;
  managerVault: string;
  managerClaimManager: string;
  sourceAuthorized: boolean;
}, providerChainIds: number[] = [config.chainId]) {
  const db = new Database(':memory:');
  applySchema(db);
  const providers = providerChainIds.map((chainId) => ({
    getNetwork: async () => ({ chainId: BigInt(chainId) }),
  })) as unknown as AbstractProvider[];
  return createIndexerRunner({
    config,
    rawEventsRepo: createRawEventsRepo(db),
    indexerStateRepo: createIndexerStateRepo(db),
    provider: providers[0],
    providersToValidate: providers,
    deploymentWiringReader: async () => wiring,
    deriveRoundsService: { rebuildFromRaw() {} },
    deriveWalletRoundsService: { rebuildFromRaw() {} },
    deriveWalletStatsService: { rebuild() {} },
  });
}

await runnerWith({
  vaultDrawManager: deployment.drawManagerAddress,
  managerVault: deployment.vaultAddress,
  managerClaimManager: deployment.claimManagerAddress,
  sourceAuthorized: true,
}).validateConfiguration();

await assert.rejects(
  runnerWith({
    vaultDrawManager: deployment.drawManagerAddress,
    managerVault: deployment.vaultAddress,
    managerClaimManager: deployment.claimManagerAddress,
    sourceAuthorized: true,
  }, [10143]).validateConfiguration(),
  /indexer RPC provider 1 chain mismatch: expected 143, got 10143/,
  'an otherwise valid deployment must reject a wrong-chain RPC',
);

await assert.rejects(
  runnerWith({
    vaultDrawManager: deployment.drawManagerAddress,
    managerVault: deployment.vaultAddress,
    managerClaimManager: deployment.claimManagerAddress,
    sourceAuthorized: true,
  }, [143, 10143]).validateConfiguration(),
  /indexer RPC provider 2 chain mismatch: expected 143, got 10143/,
  'a wrong-chain fallback must be rejected even when the primary matches',
);

await assert.rejects(
  assertProviderChainId(
    { getNetwork: async () => ({ chainId: 10143n }) } as AbstractProvider,
    143,
    'claim-proof RPC provider',
  ),
  /claim-proof RPC provider chain mismatch: expected 143, got 10143/,
  'the independent proof reader must reject a wrong-chain RPC',
);

await assert.rejects(
  runnerWith({
    vaultDrawManager: deployment.drawManagerAddress,
    managerVault: '0x0000000000000000000000000000000000000099',
    managerClaimManager: deployment.claimManagerAddress,
    sourceAuthorized: true,
  }).validateConfiguration(),
  /managerVault/
);

await assert.rejects(
  runnerWith({
    vaultDrawManager: deployment.drawManagerAddress,
    managerVault: deployment.vaultAddress,
    managerClaimManager: deployment.claimManagerAddress,
    sourceAuthorized: false,
  }).validateConfiguration(),
  /not authorized/
);

console.log('deploymentWiring.test.ts ok');
