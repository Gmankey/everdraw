import type Database from 'better-sqlite3';
import type { V5PositionEventRow, V5TrancheRow } from '../types/domain.js';

export interface V5TranchesRepo {
  deleteAll(): void;
  insertPositionEvent(row: V5PositionEventRow): void;
  insertTranche(row: V5TrancheRow): number;
  updateTrancheRemaining(input: {
    id: number;
    remainingAmount: string;
    closedAt: string | null;
    closedBlockNumber: number | null;
    closedLogIndex: number | null;
    closedTxHash: string | null;
  }): void;
  listOpenNewestFirst(wallet: string, vaultAddress: string, poolType: V5TrancheRow['poolType']): V5TrancheRow[];
  sumOpenRemaining(wallet: string, vaultAddress: string, poolType: V5TrancheRow['poolType']): string;
  listByWallet(wallet: string): V5TrancheRow[];
  listPositionEvents(wallet: string): V5PositionEventRow[];
}

export function createV5TranchesRepo(db: Database.Database): V5TranchesRepo {
  const deleteAllTx = db.transaction(() => {
    db.prepare('DELETE FROM v5_position_events').run();
    db.prepare('DELETE FROM v5_tranches').run();
  });

  const insertPositionEventStmt = db.prepare(`
    INSERT INTO v5_position_events (
      tx_hash, log_index, block_number, block_timestamp, vault_address, wallet,
      pool_type, action, amount, balance_after, raw_event_name
    ) VALUES (
      @txHash, @logIndex, @blockNumber, @blockTimestamp, LOWER(@vaultAddress), LOWER(@wallet),
      @poolType, @action, @amount, @balanceAfter, @rawEventName
    )
    ON CONFLICT(tx_hash, log_index) DO UPDATE SET
      block_number = excluded.block_number,
      block_timestamp = excluded.block_timestamp,
      vault_address = excluded.vault_address,
      wallet = excluded.wallet,
      pool_type = excluded.pool_type,
      action = excluded.action,
      amount = excluded.amount,
      balance_after = excluded.balance_after,
      raw_event_name = excluded.raw_event_name
  `);

  const insertTrancheStmt = db.prepare(`
    INSERT INTO v5_tranches (
      wallet, vault_address, pool_type, amount, remaining_amount,
      opened_block_number, opened_log_index, opened_at, opened_tx_hash, start_draw_id,
      closed_at, closed_block_number, closed_log_index, closed_tx_hash
    ) VALUES (
      LOWER(@wallet), LOWER(@vaultAddress), @poolType, @amount, @remainingAmount,
      @openedBlockNumber, @openedLogIndex, @openedAt, @openedTxHash, @startDrawId,
      @closedAt, @closedBlockNumber, @closedLogIndex, @closedTxHash
    )
  `);

  const updateTrancheRemainingStmt = db.prepare(`
    UPDATE v5_tranches SET
      remaining_amount = @remainingAmount,
      closed_at = @closedAt,
      closed_block_number = @closedBlockNumber,
      closed_log_index = @closedLogIndex,
      closed_tx_hash = @closedTxHash
    WHERE id = @id
  `);

  const listOpenNewestFirstStmt = db.prepare(`
    SELECT
      id,
      wallet,
      vault_address AS vaultAddress,
      pool_type AS poolType,
      amount,
      remaining_amount AS remainingAmount,
      opened_block_number AS openedBlockNumber,
      opened_log_index AS openedLogIndex,
      opened_at AS openedAt,
      opened_tx_hash AS openedTxHash,
      start_draw_id AS startDrawId,
      closed_at AS closedAt,
      closed_block_number AS closedBlockNumber,
      closed_log_index AS closedLogIndex,
      closed_tx_hash AS closedTxHash
    FROM v5_tranches
    WHERE LOWER(wallet) = LOWER(?)
      AND LOWER(vault_address) = LOWER(?)
      AND pool_type = ?
      AND CAST(remaining_amount AS TEXT) != '0'
    ORDER BY opened_block_number DESC, opened_log_index DESC, id DESC
  `);

  const listByWalletStmt = db.prepare(`
    SELECT
      id,
      wallet,
      vault_address AS vaultAddress,
      pool_type AS poolType,
      amount,
      remaining_amount AS remainingAmount,
      opened_block_number AS openedBlockNumber,
      opened_log_index AS openedLogIndex,
      opened_at AS openedAt,
      opened_tx_hash AS openedTxHash,
      start_draw_id AS startDrawId,
      closed_at AS closedAt,
      closed_block_number AS closedBlockNumber,
      closed_log_index AS closedLogIndex,
      closed_tx_hash AS closedTxHash
    FROM v5_tranches
    WHERE LOWER(wallet) = LOWER(?)
    ORDER BY opened_block_number ASC, opened_log_index ASC, id ASC
  `);

  const listPositionEventsStmt = db.prepare(`
    SELECT
      tx_hash AS txHash,
      log_index AS logIndex,
      block_number AS blockNumber,
      block_timestamp AS blockTimestamp,
      vault_address AS vaultAddress,
      wallet,
      pool_type AS poolType,
      action,
      amount,
      balance_after AS balanceAfter,
      raw_event_name AS rawEventName
    FROM v5_position_events
    WHERE LOWER(wallet) = LOWER(?)
    ORDER BY block_number ASC, log_index ASC
  `);

  const sumOpenRemainingStmt = db.prepare(`
    SELECT remaining_amount AS remainingAmount
    FROM v5_tranches
    WHERE LOWER(wallet) = LOWER(?)
      AND LOWER(vault_address) = LOWER(?)
      AND pool_type = ?
      AND CAST(remaining_amount AS TEXT) != '0'
  `);

  return {
    deleteAll() { deleteAllTx(); },
    insertPositionEvent(row) { insertPositionEventStmt.run(row); },
    insertTranche(row) {
      const result = insertTrancheStmt.run(row);
      return Number(result.lastInsertRowid);
    },
    updateTrancheRemaining(input) { updateTrancheRemainingStmt.run(input); },
    listOpenNewestFirst(wallet, vaultAddress, poolType) {
      return listOpenNewestFirstStmt.all(wallet, vaultAddress, poolType) as V5TrancheRow[];
    },
    sumOpenRemaining(wallet, vaultAddress, poolType) {
      const rows = sumOpenRemainingStmt.all(wallet, vaultAddress, poolType) as Array<{ remainingAmount: string }>;
      return rows.reduce((sum, row) => sum + BigInt(row.remainingAmount), 0n).toString();
    },
    listByWallet(wallet) {
      return listByWalletStmt.all(wallet) as V5TrancheRow[];
    },
    listPositionEvents(wallet) {
      return listPositionEventsStmt.all(wallet) as V5PositionEventRow[];
    },
  };
}
