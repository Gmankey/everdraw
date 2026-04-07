import type Database from 'better-sqlite3';
import type { RoundRow } from '../types/domain.js';

export interface RoundsRepo {
  upsert(row: RoundRow): void;
  listAll(): RoundRow[];
  deleteAll(): void;
}

export function createRoundsRepo(db: Database.Database): RoundsRepo {
  const upsertStmt = db.prepare(`
    INSERT INTO rounds (
      round_id,
      state,
      is_skipped,
      opened_at,
      sales_end_time,
      committed_at,
      drawn_at,
      unstaking_at,
      settled_at,
      deposit_total_mon,
      mon_received,
      yield_mon,
      loss_ratio,
      ticket_count,
      unique_wallet_count,
      winner_wallets_count,
      winner,
      winning_ticket,
      updated_at
    ) VALUES (
      @roundId,
      @state,
      @isSkipped,
      @openedAt,
      @salesEndTime,
      @committedAt,
      @drawnAt,
      @unstakingAt,
      @settledAt,
      @depositTotalMon,
      @monReceived,
      @yieldMon,
      @lossRatio,
      @ticketCount,
      @uniqueWalletCount,
      @winnerWalletsCount,
      @winner,
      @winningTicket,
      @updatedAt
    )
    ON CONFLICT(round_id) DO UPDATE SET
      state = excluded.state,
      is_skipped = excluded.is_skipped,
      opened_at = excluded.opened_at,
      sales_end_time = excluded.sales_end_time,
      committed_at = excluded.committed_at,
      drawn_at = excluded.drawn_at,
      unstaking_at = excluded.unstaking_at,
      settled_at = excluded.settled_at,
      deposit_total_mon = excluded.deposit_total_mon,
      mon_received = excluded.mon_received,
      yield_mon = excluded.yield_mon,
      loss_ratio = excluded.loss_ratio,
      ticket_count = excluded.ticket_count,
      unique_wallet_count = excluded.unique_wallet_count,
      winner_wallets_count = excluded.winner_wallets_count,
      winner = excluded.winner,
      winning_ticket = excluded.winning_ticket,
      updated_at = excluded.updated_at
  `);

  const listAllStmt = db.prepare(`
    SELECT
      round_id as roundId,
      state,
      is_skipped as isSkipped,
      opened_at as openedAt,
      sales_end_time as salesEndTime,
      committed_at as committedAt,
      drawn_at as drawnAt,
      unstaking_at as unstakingAt,
      settled_at as settledAt,
      deposit_total_mon as depositTotalMon,
      mon_received as monReceived,
      yield_mon as yieldMon,
      loss_ratio as lossRatio,
      ticket_count as ticketCount,
      unique_wallet_count as uniqueWalletCount,
      winner_wallets_count as winnerWalletsCount,
      winner,
      winning_ticket as winningTicket,
      updated_at as updatedAt
    FROM rounds
    ORDER BY round_id DESC
  `);

  const deleteAllStmt = db.prepare('DELETE FROM rounds');

  return {
    upsert(row) {
      upsertStmt.run(row);
    },
    listAll() {
      return listAllStmt.all() as RoundRow[];
    },
    deleteAll() {
      deleteAllStmt.run();
    },
  };
}
