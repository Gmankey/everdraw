import type Database from 'better-sqlite3';
import type { WalletRoundRow } from '../types/domain.js';
import { nowIso } from '../utils/time.js';

export interface WalletRoundsRepo {
  upsert(row: WalletRoundRow): void;
  // V5: attach the per-tranche-blended resolved base to a (wallet, draw) row without clobbering win/claim data.
  upsertV5ResolvedBase(wallet: string, roundId: number, poolAddress: string, resolvedBase: number): void;
  replaceForRound(roundId: number, rows: WalletRoundRow[], poolAddress?: string): void;
  listByRound(roundId: number, poolAddress?: string): WalletRoundRow[];
  listByWalletWithRound(wallet: string): Array<WalletRoundRow & { state: string; salesEndTime: string | null; isSkipped: number }>;
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
      pool_address,
      tickets,
      mon_paid,
      won,
      withdrew,
      prize_claimed,
      principal_withdrawn,
      withdrawn_at,
      net_position,
      created_at,
      updated_at
    ) VALUES (
      @wallet,
      @roundId,
      @poolAddress,
      @tickets,
      @monPaid,
      @won,
      @withdrew,
      @prizeClaimed,
      @principalWithdrawn,
      @withdrawnAt,
      @netPosition,
      @createdAt,
      @updatedAt
    )
    ON CONFLICT(wallet, round_id, pool_address) DO UPDATE SET
      tickets = excluded.tickets,
      mon_paid = excluded.mon_paid,
      won = excluded.won,
      withdrew = excluded.withdrew,
      prize_claimed = excluded.prize_claimed,
      principal_withdrawn = excluded.principal_withdrawn,
      withdrawn_at = excluded.withdrawn_at,
      net_position = excluded.net_position,
      updated_at = excluded.updated_at
  `);

  const upsertV5ResolvedBaseStmt = db.prepare(`
    INSERT INTO wallet_rounds (wallet, round_id, pool_address, v5_resolved_base, created_at, updated_at)
    VALUES (LOWER(@wallet), @roundId, LOWER(@poolAddress), @resolvedBase, @now, @now)
    ON CONFLICT(wallet, round_id, pool_address) DO UPDATE SET
      v5_resolved_base = excluded.v5_resolved_base,
      updated_at = excluded.updated_at
  `);

  const deleteForRoundStmt = db.prepare(`
    DELETE FROM wallet_rounds
    WHERE round_id = ? AND (? IS NULL OR LOWER(pool_address) = LOWER(?))
  `);

  const listByRoundStmt = db.prepare(`
    SELECT
      wallet,
      round_id as roundId,
      pool_address as poolAddress,
      tickets,
      mon_paid as monPaid,
      won,
      withdrew,
      prize_claimed as prizeClaimed,
      principal_withdrawn as principalWithdrawn,
      withdrawn_at as withdrawnAt,
      net_position as netPosition,
      v5_resolved_base as v5ResolvedBase,
      created_at as createdAt,
      updated_at as updatedAt
    FROM wallet_rounds
    WHERE round_id = ? AND (? IS NULL OR LOWER(pool_address) = LOWER(?))
    ORDER BY tickets DESC, wallet ASC, pool_address ASC
  `);

  const listByWalletWithRoundStmt = db.prepare(`
    SELECT
      wr.wallet,
      wr.round_id AS roundId,
      wr.pool_address AS poolAddress,
      wr.tickets,
      wr.mon_paid AS monPaid,
      wr.won,
      wr.withdrew,
      wr.prize_claimed AS prizeClaimed,
      wr.principal_withdrawn AS principalWithdrawn,
      wr.withdrawn_at AS withdrawnAt,
      wr.net_position AS netPosition,
      wr.created_at AS createdAt,
      wr.updated_at AS updatedAt,
      r.state,
      r.sales_end_time AS salesEndTime,
      r.is_skipped AS isSkipped
    FROM wallet_rounds wr
    LEFT JOIN rounds r ON r.round_id = wr.round_id AND r.pool_address = wr.pool_address
    WHERE LOWER(wr.wallet) = LOWER(?)
    ORDER BY wr.round_id DESC
  `);

  const listAllStmt = db.prepare(`
    SELECT
      wallet,
      round_id as roundId,
      pool_address as poolAddress,
      tickets,
      mon_paid as monPaid,
      won,
      withdrew,
      prize_claimed as prizeClaimed,
      principal_withdrawn as principalWithdrawn,
      withdrawn_at as withdrawnAt,
      net_position as netPosition,
      created_at as createdAt,
      updated_at as updatedAt
    FROM wallet_rounds
    ORDER BY round_id DESC, pool_address ASC, tickets DESC, wallet ASC
  `);

  const deleteAllStmt = db.prepare('DELETE FROM wallet_rounds');

  const countDistinctWalletsSettledOnlyStmt = db.prepare(`
    SELECT COUNT(DISTINCT wr.wallet) as count
    FROM wallet_rounds wr
    INNER JOIN rounds r ON r.round_id = wr.round_id AND r.pool_address = wr.pool_address
    WHERE r.state = 'settled'
  `);

  const getAverageRoundsPerWalletSettledOnlyStmt = db.prepare(`
    SELECT COALESCE(AVG(round_count), 0) as avgRounds
    FROM (
      SELECT wr.wallet, COUNT(*) as round_count
      FROM wallet_rounds wr
      INNER JOIN rounds r ON r.round_id = wr.round_id AND r.pool_address = wr.pool_address
      WHERE r.state = 'settled'
      GROUP BY wr.wallet
    )
  `);

  const replaceForRoundTx = db.transaction((roundId: number, rows: WalletRoundRow[], poolAddress?: string) => {
    deleteForRoundStmt.run(roundId, poolAddress ?? null, poolAddress ?? null);
    for (const row of rows) {
      upsertStmt.run(row);
    }
  });

  return {
    upsert(row) {
      upsertStmt.run(row);
    },
    upsertV5ResolvedBase(wallet, roundId, poolAddress, resolvedBase) {
      upsertV5ResolvedBaseStmt.run({ wallet, roundId, poolAddress, resolvedBase, now: nowIso() });
    },
    replaceForRound(roundId, rows, poolAddress) {
      replaceForRoundTx(roundId, rows, poolAddress);
    },
    listByRound(roundId, poolAddress) {
      return listByRoundStmt.all(roundId, poolAddress ?? null, poolAddress ?? null) as WalletRoundRow[];
    },
    listByWalletWithRound(wallet) {
      return listByWalletWithRoundStmt.all(wallet) as Array<WalletRoundRow & { state: string; salesEndTime: string | null; isSkipped: number }>;
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
