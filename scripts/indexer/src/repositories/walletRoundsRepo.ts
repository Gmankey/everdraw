import type Database from 'better-sqlite3';
import type { WalletRoundRow } from '../types/domain.js';

export interface WalletRoundsRepo {
  upsert(row: WalletRoundRow): void;
  replaceForRound(roundId: number, rows: WalletRoundRow[]): void;
  listByRound(roundId: number): WalletRoundRow[];
  listAll(): WalletRoundRow[];
  deleteAll(): void;
  countDistinctWalletsSettledOnly(): number;
  getAverageRoundsPerWalletSettledOnly(): number;
}

export function createWalletRoundsRepo(db: Database.Database): WalletRoundsRepo {
  const upsertStmt = db.prepare(`
    INSERT INTO wallet_rounds (
      wallet,
      round_id,
      tickets,
      mon_paid,
      won,
      withdrew,
      prize_claimed,
      principal_withdrawn,
      net_position,
      created_at,
      updated_at
    ) VALUES (
      @wallet,
      @roundId,
      @tickets,
      @monPaid,
      @won,
      @withdrew,
      @prizeClaimed,
      @principalWithdrawn,
      @netPosition,
      @createdAt,
      @updatedAt
    )
    ON CONFLICT(wallet, round_id) DO UPDATE SET
      tickets = excluded.tickets,
      mon_paid = excluded.mon_paid,
      won = excluded.won,
      withdrew = excluded.withdrew,
      prize_claimed = excluded.prize_claimed,
      principal_withdrawn = excluded.principal_withdrawn,
      net_position = excluded.net_position,
      updated_at = excluded.updated_at
  `);

  const deleteForRoundStmt = db.prepare(`
    DELETE FROM wallet_rounds
    WHERE round_id = ?
  `);

  const listByRoundStmt = db.prepare(`
    SELECT
      wallet,
      round_id as roundId,
      tickets,
      mon_paid as monPaid,
      won,
      withdrew,
      prize_claimed as prizeClaimed,
      principal_withdrawn as principalWithdrawn,
      net_position as netPosition,
      created_at as createdAt,
      updated_at as updatedAt
    FROM wallet_rounds
    WHERE round_id = ?
    ORDER BY tickets DESC, wallet ASC
  `);

  const listAllStmt = db.prepare(`
    SELECT
      wallet,
      round_id as roundId,
      tickets,
      mon_paid as monPaid,
      won,
      withdrew,
      prize_claimed as prizeClaimed,
      principal_withdrawn as principalWithdrawn,
      net_position as netPosition,
      created_at as createdAt,
      updated_at as updatedAt
    FROM wallet_rounds
    ORDER BY round_id DESC, tickets DESC, wallet ASC
  `);

  const deleteAllStmt = db.prepare('DELETE FROM wallet_rounds');

  const countDistinctWalletsSettledOnlyStmt = db.prepare(`
    SELECT COUNT(DISTINCT wr.wallet) as count
    FROM wallet_rounds wr
    INNER JOIN rounds r ON r.round_id = wr.round_id
    WHERE r.state = 'settled'
  `);

  const getAverageRoundsPerWalletSettledOnlyStmt = db.prepare(`
    SELECT COALESCE(AVG(round_count), 0) as avgRounds
    FROM (
      SELECT wr.wallet, COUNT(*) as round_count
      FROM wallet_rounds wr
      INNER JOIN rounds r ON r.round_id = wr.round_id
      WHERE r.state = 'settled'
      GROUP BY wr.wallet
    )
  `);

  const replaceForRoundTx = db.transaction((roundId: number, rows: WalletRoundRow[]) => {
    deleteForRoundStmt.run(roundId);
    for (const row of rows) {
      upsertStmt.run(row);
    }
  });

  return {
    upsert(row) {
      upsertStmt.run(row);
    },
    replaceForRound(roundId, rows) {
      replaceForRoundTx(roundId, rows);
    },
    listByRound(roundId) {
      return listByRoundStmt.all(roundId) as WalletRoundRow[];
    },
    listAll() {
      return listAllStmt.all() as WalletRoundRow[];
    },
    deleteAll() {
      deleteAllStmt.run();
    },
    countDistinctWalletsSettledOnly() {
      const row = countDistinctWalletsSettledOnlyStmt.get() as { count: number } | undefined;
      return row?.count ?? 0;
    },
    getAverageRoundsPerWalletSettledOnly() {
      const row = getAverageRoundsPerWalletSettledOnlyStmt.get() as { avgRounds: number } | undefined;
      return row?.avgRounds ?? 0;
    },
  };
}
