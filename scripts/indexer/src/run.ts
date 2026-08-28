import { applySchema, openDatabase } from './db/database.js';
import { createRawEventsRepo } from './repositories/rawEventsRepo.js';
import { createRoundsRepo } from './repositories/roundsRepo.js';
import { createWalletRoundsRepo } from './repositories/walletRoundsRepo.js';
import { createWalletStatsRepo } from './repositories/walletStatsRepo.js';
import { createIndexerStateRepo } from './repositories/indexerStateRepo.js';
import { createV5TranchesRepo } from './repositories/v5TranchesRepo.js';
import { createDeriveRoundsService } from './services/deriveRounds.js';
import { createDeriveWalletRoundsService } from './services/deriveWalletRounds.js';
import { createDeriveWalletStatsService } from './services/deriveWalletStats.js';
import { createDeriveV5TranchesService } from './services/deriveV5Tranches.js';
import { getRunnerConfig } from './runner/config.js';
import { createIndexerRunner } from './runner/service.js';

const db = openDatabase();
applySchema(db);

const rawEventsRepo = createRawEventsRepo(db);
const roundsRepo = createRoundsRepo(db);
const walletRoundsRepo = createWalletRoundsRepo(db);
const walletStatsRepo = createWalletStatsRepo(db);
const indexerStateRepo = createIndexerStateRepo(db);
const v5TranchesRepo = createV5TranchesRepo(db);
const runnerConfig = getRunnerConfig();

const deriveRoundsService = createDeriveRoundsService(rawEventsRepo, roundsRepo);
const deriveWalletRoundsService = createDeriveWalletRoundsService(rawEventsRepo, walletRoundsRepo);
const deriveWalletStatsService = createDeriveWalletStatsService(walletRoundsRepo, walletStatsRepo);
const deriveV5TranchesService = createDeriveV5TranchesService(rawEventsRepo, v5TranchesRepo, undefined, runnerConfig.v5Deployments);

const runner = createIndexerRunner({
  config: runnerConfig,
  rawEventsRepo,
  indexerStateRepo,
  deriveRoundsService,
  deriveWalletRoundsService,
  deriveWalletStatsService,
  deriveV5TranchesService,
});

await runner.start();
