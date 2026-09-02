import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import type { AbstractProvider } from 'ethers';
import { applySchema } from '../db/database.js';
import { createIndexerStateRepo } from '../repositories/indexerStateRepo.js';
import { createRawEventsRepo } from '../repositories/rawEventsRepo.js';
import type { V5DeploymentScope } from '../types/domain.js';
import type { RunnerConfig } from './config.js';
import { createIndexerRunner } from './service.js';

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
  pointsCheckpointIntervalSec: 604800,
  pointsMinQualifyingMon: 100,
};

function runnerWith(wiring: {
  vaultDrawManager: string;
  managerVault: string;
  managerClaimManager: string;
  sourceAuthorized: boolean;
  drawPeriodSec?: number;
}) {
  const db = new Database(':memory:');
  applySchema(db);
  return createIndexerRunner({
    config,
    rawEventsRepo: createRawEventsRepo(db),
    indexerStateRepo: createIndexerStateRepo(db),
    provider: {} as AbstractProvider,
    // Default to a matching cadence so the pre-existing wiring cases keep testing
    // wiring only; the cadence cases below set it explicitly.
    deploymentWiringReader: async () => ({
      drawPeriodSec: config.pointsCheckpointIntervalSec,
      ...wiring,
    }),
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

// ADR-0049 §5 — points curves advance per DRAW but are denominated in "weeks", so a
// checkpoint window must contain exactly one draw. A mismatch between the on-chain
// drawPeriod and POINTS_CHECKPOINT_INTERVAL_SEC is what produced the 486-week UAT
// streak and fired milestones that were never earned. Startup must refuse to run.
await assert.rejects(
  runnerWith({
    vaultDrawManager: deployment.drawManagerAddress,
    managerVault: deployment.vaultAddress,
    managerClaimManager: deployment.claimManagerAddress,
    sourceAuthorized: true,
    drawPeriodSec: 3600, // hourly draws against a weekly checkpoint: the UAT contamination
  }).validateConfiguration(),
  /Points cadence mismatch/,
  'hourly draws against a weekly checkpoint must refuse to start',
);

await assert.rejects(
  runnerWith({
    vaultDrawManager: deployment.drawManagerAddress,
    managerVault: deployment.vaultAddress,
    managerClaimManager: deployment.claimManagerAddress,
    sourceAuthorized: true,
    drawPeriodSec: 21_600, // 6-hourly, the cadence UAT is moving to
  }).validateConfiguration(),
  /Points cadence mismatch/,
  'any cadence change without a matching checkpoint interval must refuse to start',
);

// The error must tell the operator exactly what to set, not just that something is wrong.
await assert.rejects(
  runnerWith({
    vaultDrawManager: deployment.drawManagerAddress,
    managerVault: deployment.vaultAddress,
    managerClaimManager: deployment.claimManagerAddress,
    sourceAuthorized: true,
    drawPeriodSec: 21_600,
  }).validateConfiguration(),
  /POINTS_CHECKPOINT_INTERVAL_SEC=21600/,
);

// Matching cadence is accepted.
await runnerWith({
  vaultDrawManager: deployment.drawManagerAddress,
  managerVault: deployment.vaultAddress,
  managerClaimManager: deployment.claimManagerAddress,
  sourceAuthorized: true,
  drawPeriodSec: 604_800,
}).validateConfiguration();

console.log('deploymentWiring.test.ts ok');
