import type Database from 'better-sqlite3';
import type { WalletPointsRow, WalletRoundPointsRow, WalletStreakRow } from '../types/domain.js';
import { STREAK_MILESTONE_POINTS } from '../services/pointsMath.js';

export interface PointsProfile extends WalletPointsRow, WalletStreakRow {}

export interface PointsRepo {
  resetRoundPointsAndTotals(): void;
  ensureWallet(wallet: string, nowUnix: number): void;
  getWalletPoints(wallet: string): WalletPointsRow | null;
  getWalletStreak(wallet: string): WalletStreakRow | null;
  getProfile(wallet: string): PointsProfile | null;
  upsertWalletPoints(row: WalletPointsRow): void;
  upsertWalletStreak(row: WalletStreakRow): void;
  insertRoundPoints(row: WalletRoundPointsRow): void;
  awardBonus(wallet: string, points: number, nowUnix: number): void;
  listHistory(wallet: string, limit: number): WalletRoundPointsRow[];
  listLeaderboard(limit: number, period: 'all' | 'month'): Array<{ wallet: string; lifetimePoints: number; monthPoints?: number; currentStreakWeeks: number }>;
  getRank(wallet: string, period: 'all' | 'month'): number | null;
  listWalletsWithDeposits(): string[];
  hasAnySettledRoundBetween(fromUnix: number, toUnix: number): boolean;
  hasActivePositionAt(wallet: string, checkpointUnix: number, poolAddress?: string): boolean;
  hadV5VaultFullExitBetween(wallet: string, fromUnix: number, toUnix: number): boolean;
  hadFirstDepositBefore(wallet: string, roundId: number): boolean;
  hasDegenDepositAtOrBefore(wallet: string, atUnix: number): boolean;
}

export function createPointsRepo(db: Database.Database): PointsRepo {
  const resetTx = db.transaction(() => {
    db.prepare('DELETE FROM wallet_round_points').run();
    db.prepare(`
      UPDATE wallet_points SET
        lifetime_points =
          CASE WHEN highest_streak_milestone_awarded >= 2 THEN ${STREAK_MILESTONE_POINTS.get(2) ?? 0} ELSE 0 END +
          CASE WHEN highest_streak_milestone_awarded >= 4 THEN ${STREAK_MILESTONE_POINTS.get(4) ?? 0} ELSE 0 END +
          CASE WHEN highest_streak_milestone_awarded >= 13 THEN ${STREAK_MILESTONE_POINTS.get(13) ?? 0} ELSE 0 END +
          CASE WHEN highest_streak_milestone_awarded >= 26 THEN ${STREAK_MILESTONE_POINTS.get(26) ?? 0} ELSE 0 END +
          CASE WHEN highest_streak_milestone_awarded >= 52 THEN ${STREAK_MILESTONE_POINTS.get(52) ?? 0} ELSE 0 END,
        has_received_first_deposit_bonus = 0,
        has_received_first_win_bonus = 0,
        has_received_comeback_king_bonus = 0,
        has_received_prize_patron_bonus = 0,
        highest_loss_streak_bonus_awarded = 0,
        updated_at = CAST(strftime('%s','now') AS INTEGER)
    `).run();
    db.prepare("UPDATE wallet_streaks SET consecutive_non_wins = 0, consecutive_missed_draws = 0, updated_at = CAST(strftime('%s','now') AS INTEGER)").run();
  });

  const ensureWalletStmt = db.prepare(`
    INSERT INTO wallet_points (wallet, updated_at) VALUES (LOWER(?), ?)
    ON CONFLICT(wallet) DO NOTHING
  `);
  const ensureStreakStmt = db.prepare(`
    INSERT INTO wallet_streaks (wallet, updated_at) VALUES (LOWER(?), ?)
    ON CONFLICT(wallet) DO NOTHING
  `);
  const getPointsStmt = db.prepare(`
    SELECT wallet, lifetime_points AS lifetimePoints,
      has_received_first_deposit_bonus AS hasReceivedFirstDepositBonus,
      has_received_first_win_bonus AS hasReceivedFirstWinBonus,
      has_received_comeback_king_bonus AS hasReceivedComebackKingBonus,
      has_received_prize_patron_bonus AS hasReceivedPrizePatronBonus,
      highest_loss_streak_bonus_awarded AS highestLossStreakBonusAwarded,
      highest_streak_milestone_awarded AS highestStreakMilestoneAwarded,
      updated_at AS updatedAt
    FROM wallet_points WHERE LOWER(wallet) = LOWER(?)
  `);
  const getStreakStmt = db.prepare(`
    SELECT wallet, current_streak_weeks AS currentStreakWeeks,
      longest_streak_weeks AS longestStreakWeeks,
      last_checkpoint_unix AS lastCheckpointUnix,
      consecutive_non_wins AS consecutiveNonWins,
      consecutive_missed_draws AS consecutiveMissedDraws,
      updated_at AS updatedAt
    FROM wallet_streaks WHERE LOWER(wallet) = LOWER(?)
  `);
  const upsertPointsStmt = db.prepare(`
    INSERT INTO wallet_points (wallet, lifetime_points, has_received_first_deposit_bonus, has_received_first_win_bonus, has_received_comeback_king_bonus, has_received_prize_patron_bonus, highest_loss_streak_bonus_awarded, highest_streak_milestone_awarded, updated_at)
    VALUES (LOWER(@wallet), @lifetimePoints, @hasReceivedFirstDepositBonus, @hasReceivedFirstWinBonus, @hasReceivedComebackKingBonus, @hasReceivedPrizePatronBonus, @highestLossStreakBonusAwarded, @highestStreakMilestoneAwarded, @updatedAt)
    ON CONFLICT(wallet) DO UPDATE SET lifetime_points = excluded.lifetime_points,
      has_received_first_deposit_bonus = excluded.has_received_first_deposit_bonus,
      has_received_first_win_bonus = excluded.has_received_first_win_bonus,
      has_received_comeback_king_bonus = excluded.has_received_comeback_king_bonus,
      has_received_prize_patron_bonus = excluded.has_received_prize_patron_bonus,
      highest_loss_streak_bonus_awarded = excluded.highest_loss_streak_bonus_awarded,
      highest_streak_milestone_awarded = excluded.highest_streak_milestone_awarded,
      updated_at = excluded.updated_at
  `);
  const upsertStreakStmt = db.prepare(`
    INSERT INTO wallet_streaks (wallet, current_streak_weeks, longest_streak_weeks, last_checkpoint_unix, consecutive_non_wins, consecutive_missed_draws, updated_at)
    VALUES (LOWER(@wallet), @currentStreakWeeks, @longestStreakWeeks, @lastCheckpointUnix, @consecutiveNonWins, @consecutiveMissedDraws, @updatedAt)
    ON CONFLICT(wallet) DO UPDATE SET current_streak_weeks = excluded.current_streak_weeks,
      longest_streak_weeks = excluded.longest_streak_weeks,
      last_checkpoint_unix = excluded.last_checkpoint_unix,
      consecutive_non_wins = excluded.consecutive_non_wins,
      consecutive_missed_draws = excluded.consecutive_missed_draws,
      updated_at = excluded.updated_at
  `);
  const insertRoundPointsStmt = db.prepare(`
    INSERT INTO wallet_round_points (wallet, pool_address, round_id, base_points, multiplier_x100, bonuses_breakdown, total_points, awarded_at_unix)
    VALUES (LOWER(@wallet), LOWER(@poolAddress), @roundId, @basePoints, @multiplierX100, @bonusesBreakdown, @totalPoints, @awardedAtUnix)
    ON CONFLICT(wallet, pool_address, round_id) DO UPDATE SET base_points = excluded.base_points,
      multiplier_x100 = excluded.multiplier_x100,
      bonuses_breakdown = excluded.bonuses_breakdown,
      total_points = excluded.total_points,
      awarded_at_unix = excluded.awarded_at_unix
  `);
  const awardBonusStmt = db.prepare('UPDATE wallet_points SET lifetime_points = lifetime_points + ?, updated_at = ? WHERE LOWER(wallet) = LOWER(?)');
  const historyStmt = db.prepare(`
    SELECT wallet, pool_address AS poolAddress, round_id AS roundId, base_points AS basePoints,
      multiplier_x100 AS multiplierX100, bonuses_breakdown AS bonusesBreakdown, total_points AS totalPoints,
      awarded_at_unix AS awardedAtUnix
    FROM wallet_round_points WHERE LOWER(wallet) = LOWER(?)
    ORDER BY awarded_at_unix DESC, round_id DESC LIMIT ?
  `);

  return {
    resetRoundPointsAndTotals() { resetTx(); },
    ensureWallet(wallet, nowUnix) { ensureWalletStmt.run(wallet, nowUnix); ensureStreakStmt.run(wallet, nowUnix); },
    getWalletPoints(wallet) { return (getPointsStmt.get(wallet) as WalletPointsRow | undefined) ?? null; },
    getWalletStreak(wallet) { return (getStreakStmt.get(wallet) as WalletStreakRow | undefined) ?? null; },
    getProfile(wallet) {
      const points = this.getWalletPoints(wallet);
      const streak = this.getWalletStreak(wallet);
      return points && streak ? { ...points, ...streak } : null;
    },
    upsertWalletPoints(row) { upsertPointsStmt.run(row); },
    upsertWalletStreak(row) { upsertStreakStmt.run(row); },
    insertRoundPoints(row) { insertRoundPointsStmt.run(row); },
    awardBonus(wallet, points, nowUnix) { awardBonusStmt.run(points, nowUnix, wallet); },
    listHistory(wallet, limit) { return historyStmt.all(wallet, Math.max(1, Math.min(100, limit))) as WalletRoundPointsRow[]; },
    listLeaderboard(limit, period) {
      if (period === 'month') {
        return db.prepare(`
          SELECT wp.wallet, wp.lifetime_points AS lifetimePoints, COALESCE(SUM(wrp.total_points), 0) AS monthPoints,
            COALESCE(ws.current_streak_weeks, 0) AS currentStreakWeeks
          FROM wallet_points wp
          LEFT JOIN wallet_round_points wrp ON wrp.wallet = wp.wallet AND wrp.awarded_at_unix >= CAST(strftime('%s','now','start of month') AS INTEGER)
          LEFT JOIN wallet_streaks ws ON ws.wallet = wp.wallet
          GROUP BY wp.wallet ORDER BY monthPoints DESC, wp.wallet ASC LIMIT ?
        `).all(Math.max(1, Math.min(500, limit))) as Array<{ wallet: string; lifetimePoints: number; monthPoints: number; currentStreakWeeks: number }>;
      }
      return db.prepare(`
        SELECT wp.wallet, wp.lifetime_points AS lifetimePoints, COALESCE(ws.current_streak_weeks, 0) AS currentStreakWeeks
        FROM wallet_points wp LEFT JOIN wallet_streaks ws ON ws.wallet = wp.wallet
        ORDER BY wp.lifetime_points DESC, wp.wallet ASC LIMIT ?
      `).all(Math.max(1, Math.min(500, limit))) as Array<{ wallet: string; lifetimePoints: number; currentStreakWeeks: number }>;
    },
    getRank(wallet, period) {
      const row = period === 'month'
        ? db.prepare(`
            SELECT rank FROM (
              SELECT wallet, RANK() OVER (ORDER BY month_points DESC, wallet ASC) AS rank FROM (
                SELECT wp.wallet, COALESCE(SUM(wrp.total_points), 0) AS month_points
                FROM wallet_points wp LEFT JOIN wallet_round_points wrp ON wrp.wallet = wp.wallet AND wrp.awarded_at_unix >= CAST(strftime('%s','now','start of month') AS INTEGER)
                GROUP BY wp.wallet
              )
            ) WHERE LOWER(wallet) = LOWER(?)
          `).get(wallet) as { rank: number } | undefined
        : db.prepare(`SELECT rank FROM (SELECT wallet, RANK() OVER (ORDER BY lifetime_points DESC, wallet ASC) AS rank FROM wallet_points) WHERE LOWER(wallet) = LOWER(?)`).get(wallet) as { rank: number } | undefined;
      return row?.rank ?? null;
    },
    listWalletsWithDeposits() {
      // V5 wallet-rounds never populate `tickets` (that's a V4 ticket-count field); their
      // entries live in `v5_resolved_base` instead. Without the OR here, every V5 wallet is
      // silently invisible to the weekly checkpoint and its streak never advances.
      return db.prepare(`
        SELECT DISTINCT LOWER(wallet) AS wallet FROM wallet_rounds
        WHERE tickets > 0 OR v5_resolved_base > 0
        ORDER BY wallet ASC
      `).all().map((r: any) => r.wallet as string);
    },
    hasAnySettledRoundBetween(fromUnix, toUnix) {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM rounds WHERE state = 'settled' AND settled_at IS NOT NULL AND CAST(strftime('%s', settled_at) AS INTEGER) >= ? AND CAST(strftime('%s', settled_at) AS INTEGER) < ?`).get(fromUnix, toUnix) as { c: number };
      return row.c > 0;
    },
    hasActivePositionAt(wallet, checkpointUnix, poolAddress) {
      const params: Array<string | number> = [wallet, checkpointUnix, checkpointUnix];
      let poolSql = '';
      if (poolAddress) { poolSql = ' AND LOWER(wr.pool_address) = LOWER(?)'; params.push(poolAddress); }
      const row = db.prepare(`
        SELECT COUNT(*) AS c FROM wallet_rounds wr
        JOIN rounds r ON r.round_id = wr.round_id AND r.pool_address = wr.pool_address
        WHERE LOWER(wr.wallet) = LOWER(?) AND wr.tickets > 0
          AND r.state IN ('open','committed')
          AND (r.opened_at IS NULL OR CAST(strftime('%s', r.opened_at) AS INTEGER) <= ?)
          AND (r.settled_at IS NULL OR CAST(strftime('%s', r.settled_at) AS INTEGER) >= ?)
          ${poolSql}
      `).get(...params) as { c: number };
      if (row.c > 0) return true;

      // V5 has no "open"/"committed" sales-window concept (deposits are continuous, not
      // round-gated) -- the correct signal for "does this wallet currently hold a position" is
      // simply an open tranche as of checkpointUnix, independent of any draw's lifecycle state.
      const v5Params: Array<string | number> = [wallet, checkpointUnix, checkpointUnix];
      let v5PoolSql = '';
      if (poolAddress) { v5PoolSql = ' AND LOWER(vault_address) = LOWER(?)'; v5Params.push(poolAddress); }
      const v5Row = db.prepare(`
        SELECT COUNT(*) AS c FROM v5_tranches
        WHERE LOWER(wallet) = LOWER(?)
          AND pool_type = 'vault'
          AND CAST(strftime('%s', opened_at) AS INTEGER) <= ?
          AND (closed_at IS NULL OR CAST(strftime('%s', closed_at) AS INTEGER) > ?)
          ${v5PoolSql}
      `).get(...v5Params) as { c: number };
      return v5Row.c > 0;
    },
    hadV5VaultFullExitBetween(wallet, fromUnix, toUnix) {
      const row = db.prepare(`
        SELECT 1
        FROM v5_tranches closed
        WHERE LOWER(closed.wallet) = LOWER(?)
          AND closed.pool_type = ?
          AND closed.closed_at IS NOT NULL
          AND CAST(strftime(?, closed.closed_at) AS INTEGER) > ?
          AND CAST(strftime(?, closed.closed_at) AS INTEGER) <= ?
          AND NOT EXISTS (
            SELECT 1
            FROM v5_tranches active
            WHERE LOWER(active.wallet) = LOWER(closed.wallet)
              AND LOWER(active.vault_address) = LOWER(closed.vault_address)
              AND active.pool_type = ?
              AND (
                active.opened_block_number < closed.closed_block_number
                OR (
                  active.opened_block_number = closed.closed_block_number
                  AND active.opened_log_index <= closed.closed_log_index
                )
              )
              AND (
                active.closed_block_number IS NULL
                OR active.closed_block_number > closed.closed_block_number
                OR (
                  active.closed_block_number = closed.closed_block_number
                  AND active.closed_log_index > closed.closed_log_index
                )
              )
          )
        LIMIT 1
      `).get(wallet, "vault", "%s", fromUnix, "%s", toUnix, "vault") as Record<string, number> | undefined;
      return row != null;
    },
    hadFirstDepositBefore(wallet, roundId) {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM wallet_rounds WHERE LOWER(wallet) = LOWER(?) AND tickets > 0 AND round_id < ?`).get(wallet, roundId) as { c: number };
      return row.c > 0;
    },
    hasDegenDepositAtOrBefore(wallet, atUnix) {
      const row = db.prepare(`
        SELECT COUNT(*) AS c FROM v5_position_events
        WHERE LOWER(wallet) = LOWER(?)
          AND pool_type = 'degen'
          AND action = 'deposit'
          AND CAST(strftime('%s', block_timestamp) AS INTEGER) <= ?
      `).get(wallet, atUnix) as { c: number };
      return row.c > 0;
    },
  };
}
