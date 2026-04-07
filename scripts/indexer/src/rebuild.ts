import { applySchema, openDatabase } from './db/database.js';
import { createRawEventsRepo } from './repositories/rawEventsRepo.js';
import { createRoundsRepo } from './repositories/roundsRepo.js';
import { createWalletRoundsRepo } from './repositories/walletRoundsRepo.js';
import { createWalletStatsRepo } from './repositories/walletStatsRepo.js';
import { createDeriveRoundsService } from './services/deriveRounds.js';
import { createDeriveWalletRoundsService } from './services/deriveWalletRounds.js';
import { createDeriveWalletStatsService } from './services/deriveWalletStats.js';

function main(): void {
  const db = openDatabase();
  applySchema(db);

  const rawEventsRepo = createRawEventsRepo(db);
  const roundsRepo = createRoundsRepo(db);
  const walletRoundsRepo = createWalletRoundsRepo(db);
  const walletStatsRepo = createWalletStatsRepo(db);

  roundsRepo.deleteAll();
  walletRoundsRepo.deleteAll();
  walletStatsRepo.deleteAll();

  const deriveRounds = createDeriveRoundsService(rawEventsRepo, roundsRepo);
  const deriveWalletRounds = createDeriveWalletRoundsService(rawEventsRepo, walletRoundsRepo);
  const deriveWalletStats = createDeriveWalletStatsService(walletRoundsRepo, walletStatsRepo);

  deriveRounds.rebuildFromRaw();
  deriveWalletRounds.rebuildFromRaw();
  deriveWalletStats.rebuild();

  console.log('Rebuild complete. Derived tables wiped and rebuilt from raw_events.');
}

main();
