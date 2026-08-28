import { applySchema, openDatabase } from './db/database.js';
import { createRawEventsRepo } from './repositories/rawEventsRepo.js';
import { createRoundsRepo } from './repositories/roundsRepo.js';
import { createWalletRoundsRepo } from './repositories/walletRoundsRepo.js';
import { createWalletStatsRepo } from './repositories/walletStatsRepo.js';
import { createV5TranchesRepo } from './repositories/v5TranchesRepo.js';
import { createDeriveRoundsService } from './services/deriveRounds.js';
import { createDeriveWalletRoundsService } from './services/deriveWalletRounds.js';
import { createDeriveWalletStatsService } from './services/deriveWalletStats.js';
import { createDeriveV5TranchesService } from './services/deriveV5Tranches.js';
import { getRunnerConfig } from './runner/config.js';

function main(): void {
  const db = openDatabase();
  applySchema(db);

  const rawEventsRepo = createRawEventsRepo(db);
  const roundsRepo = createRoundsRepo(db);
  const walletRoundsRepo = createWalletRoundsRepo(db);
  const walletStatsRepo = createWalletStatsRepo(db);
  const v5TranchesRepo = createV5TranchesRepo(db);
  const runnerConfig = getRunnerConfig();

  roundsRepo.deleteAll();
  walletRoundsRepo.deleteAll();
  walletStatsRepo.deleteAll();
  v5TranchesRepo.deleteAll();

  const deriveRounds = createDeriveRoundsService(rawEventsRepo, roundsRepo);
  const deriveWalletRounds = createDeriveWalletRoundsService(rawEventsRepo, walletRoundsRepo);
  const deriveWalletStats = createDeriveWalletStatsService(walletRoundsRepo, walletStatsRepo);
  const deriveV5Tranches = createDeriveV5TranchesService(rawEventsRepo, v5TranchesRepo, walletRoundsRepo, runnerConfig.v5Deployments);

  deriveRounds.rebuildFromRaw();
  deriveWalletRounds.rebuildFromRaw();
  deriveV5Tranches.rebuildFromRaw();
  deriveWalletStats.rebuild();

  console.log('Rebuild complete. Derived tables wiped and rebuilt from raw_events.');
}

main();
