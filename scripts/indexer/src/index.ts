import 'dotenv/config';
import { Contract, JsonRpcProvider, parseEther } from 'ethers';
import { applySchema, openDatabase } from './db/database.js';
import { createRawEventsRepo } from './repositories/rawEventsRepo.js';
import { createRoundsRepo } from './repositories/roundsRepo.js';
import { createWalletRoundsRepo } from './repositories/walletRoundsRepo.js';
import { createWalletStatsRepo } from './repositories/walletStatsRepo.js';
import { createIndexerStateRepo } from './repositories/indexerStateRepo.js';
import { createV5ClaimProofsRepo } from "./repositories/v5ClaimProofsRepo.js";
import { createPointsRepo } from './repositories/pointsRepo.js';
import { createV5TranchesRepo } from './repositories/v5TranchesRepo.js';
import { createDeriveRoundsService } from './services/deriveRounds.js';
import { createDeriveWalletRoundsService } from './services/deriveWalletRounds.js';
import { createDeriveWalletStatsService } from './services/deriveWalletStats.js';
import { createDerivePointsService } from './services/derivePoints.js';
import { minQualifyingEntries } from './services/pointsMath.js';
import { createDeriveV5TranchesService } from './services/deriveV5Tranches.js';
import { getRunnerConfig } from './runner/config.js';
import { createIndexerRunner } from './runner/service.js';
import { createApiServer } from './server.js';

async function main(): Promise<void> {
  const dbPath = process.env.DB_PATH;
  const port = Number(process.env.PORT ?? 3001);
  const startedAt = Date.now();

  const db = openDatabase(dbPath);
  applySchema(db);

  const rawEventsRepo = createRawEventsRepo(db);
  const roundsRepo = createRoundsRepo(db);
  const walletRoundsRepo = createWalletRoundsRepo(db);
  const walletStatsRepo = createWalletStatsRepo(db);
  const indexerStateRepo = createIndexerStateRepo(db);
  const pointsRepo = createPointsRepo(db);
  const v5TranchesRepo = createV5TranchesRepo(db);
  const v5ClaimProofsRepo = createV5ClaimProofsRepo(db);
  const runnerConfig = getRunnerConfig();

  const deriveRoundsService = createDeriveRoundsService(rawEventsRepo, roundsRepo);
  const deriveWalletRoundsService = createDeriveWalletRoundsService(rawEventsRepo, walletRoundsRepo);
  const deriveWalletStatsService = createDeriveWalletStatsService(walletRoundsRepo, walletStatsRepo);
  const deriveV5TranchesService = createDeriveV5TranchesService(rawEventsRepo, v5TranchesRepo, walletRoundsRepo, runnerConfig.v5Deployments);
  // ADR-0049 §3 - one-time bonuses require a qualifying position held THROUGH the draw, so
  // the floor must be expressed in that draw's entries. The period is read from the chain
  // rather than configuration: a second source of truth for cadence is exactly what caused
  // the mismatch this design removes.
  const drawPeriodSec = await readDrawPeriodSec(runnerConfig);
  const derivePointsService = createDerivePointsService({
    pointsRepo,
    roundsRepo,
    walletRoundsRepo,
    v5ClaimProofsRepo,
    minQualifyingEntries: minQualifyingEntries(drawPeriodSec, runnerConfig.pointsMinQualifyingMon),
    // parseEther, not hand-rolled arithmetic: MON may be fractional and 1 MON = 1e18 wei,
    // which is past Number's exact-integer range.
    minQualifyingWei: parseEther(String(runnerConfig.pointsMinQualifyingMon)).toString(),
  });

  const runner = createIndexerRunner({
    config: runnerConfig,
    rawEventsRepo,
    indexerStateRepo,
    deriveRoundsService,
    deriveWalletRoundsService,
    deriveWalletStatsService,
    deriveV5TranchesService,
    derivePointsService,
  });

  await runner.validateConfiguration();
  const claimProofProvider = new JsonRpcProvider(runnerConfig.rpcUrl);
  const distributionAbi = [
    'function distributions(bytes32) view returns (address source,bytes32 sourceKey,bytes32 root,uint32 leafCount,bytes32 metadata,uint64 registeredAt)',
  ];
  const server = createApiServer({
    port,
    runner,
    roundsRepo,
    walletRoundsRepo,
    pointsRepo,
    v5TranchesRepo,
    v5ClaimProofsRepo,
    v5Deployments: runnerConfig.v5Deployments,
    claimProofIngestSecret: runnerConfig.claimProofIngestSecret,
    claimProofDistributionReader: async (claimManagerAddress, distributionId) => {
      const distribution = await new Contract(
        claimManagerAddress,
        distributionAbi,
        claimProofProvider,
      ).distributions(distributionId);
      return {
        source: distribution.source,
        sourceKey: distribution.sourceKey,
        root: distribution.root,
        leafCount: distribution.leafCount,
        registeredAt: distribution.registeredAt,
      };
    },
    startedAt,
  });

  await server.start();
  void runner.start();
  console.log(`Indexer API listening on :${port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * ADR-0049 §3 — read the draw period from the chain so the qualifying-bonus floor means
 * "N MON held through the draw" at whatever cadence is deployed.
 *
 * On failure this returns 0, which DISABLES the gate rather than blocking startup. Rationale:
 * the indexer also serves events, rounds, tranches and claim proofs that the product depends
 * on, and a recognition feature must not be able to take those down. An over-strict gate would
 * silently deny real users their bonuses; a disabled gate is visible in the leaderboard and
 * self-heals, because points are fully derived and a later pass with a readable period rebuilds
 * them correctly.
 */
async function readDrawPeriodSec(config: ReturnType<typeof getRunnerConfig>): Promise<number> {
  const deployment = config.v5Deployments[0];
  if (!deployment) return 0;
  try {
    const provider = new JsonRpcProvider(config.rpcUrl);
    const drawManager = new Contract(
      deployment.drawManagerAddress,
      ['function drawPeriod() view returns (uint64)'],
      provider,
    );
    const period = Number(await drawManager.drawPeriod());
    if (!Number.isFinite(period) || period <= 0) {
      throw new Error(`invalid on-chain drawPeriod: ${period}`);
    }
    return period;
  } catch (error) {
    console.error(
      '[indexer][points] could not read on-chain drawPeriod; the one-time-bonus qualifying gate'
      + ' is DISABLED for this process. Ingestion is unaffected and points rebuild once the'
      + ' period is readable. Cause:',
      error,
    );
    return 0;
  }
}
