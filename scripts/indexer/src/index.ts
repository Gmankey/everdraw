import 'dotenv/config';
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
  const derivePointsService = createDerivePointsService({ pointsRepo, roundsRepo, walletRoundsRepo });

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

  const claimProofIngestSecret = process.env.CLAIM_PROOF_INGEST_SECRET;
  if (runnerConfig.v5Deployments.length > 0 && (!claimProofIngestSecret || claimProofIngestSecret.length < 32)) {
    throw new Error("CLAIM_PROOF_INGEST_SECRET must be at least 32 characters for V5 deployments");
  }
  const server = createApiServer({
    port,
    runner,
    roundsRepo,
    walletRoundsRepo,
    pointsRepo,
    v5TranchesRepo,
    v5ClaimProofsRepo,
    v5Deployments: runnerConfig.v5Deployments,
    claimProofIngestSecret,
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
