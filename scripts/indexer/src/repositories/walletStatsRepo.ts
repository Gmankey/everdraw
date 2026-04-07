import type Database from 'better-sqlite3';
import type { WalletStatsRow } from '../types/domain.js';

export interface WalletStatsRepo {
  replaceAll(rows: WalletStatsRow[]): void;
  deleteAll(): void;
}

export function createWalletStatsRepo(db: Database.Database): WalletStatsRepo {
  const insertStmt = db.prepare(`
    INSERT INTO wallet_stats (
      wallet,
      total_rounds,
      total_tickets,
      total_mon_paid,
      rounds_won,
      rounds_withdrew,
      net_position,
      first_round_id,
      last_round_id,
      last_active_at,
      updated_at
    ) VALUES (
      @wallet,
      @totalRounds,
      @totalTickets,
      @totalMonPaid,
      @roundsWon,
      @roundsWithdrew,
      @netPosition,
      @firstRoundId,
      @lastRoundId,
      @lastActiveAt,
      @updatedAt
    )
  `);

  const deleteAllStmt = db.prepare('DELETE FROM wallet_stats');

  const replaceAllTx = db.transaction((rows: WalletStatsRow[]) => {
    deleteAllStmt.run();
    for (const row of rows) {
      insertStmt.run(row);
    }
  });

  return {
    replaceAll(rows) {
      replaceAllTx(rows);
    },
    deleteAll() {
      deleteAllStmt.run();
    },
  };
}
