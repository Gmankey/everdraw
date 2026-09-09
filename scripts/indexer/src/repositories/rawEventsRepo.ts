import type Database from 'better-sqlite3';
import type { RawEventRow } from '../types/domain.js';
import { RAW_EVENTS_GENERATION_KEY, createDataGenerationRepo } from './dataGenerationRepo.js';

export interface RawEventsRepo {
  getRange(fromBlock: number, toBlock: number): RawEventRow[];
  getByEventName(eventName: RawEventRow['eventName']): RawEventRow[];
  getLatestBlockNumber(): number | null;
  upsertMany(rows: RawEventRow[]): void;
  deleteFromBlock(fromBlock: number): void;
  deleteForBlockRange(fromBlock: number, toBlock: number): void;
  commitCanonicalRange(input: {
    fromBlock: number;
    toBlock: number;
    rows: RawEventRow[];
    stateUpdates: Array<{ key: string; value: string; updatedAt: string }>;
  }): void;
}

export function createRawEventsRepo(db: Database.Database): RawEventsRepo {
  // Every write bumps a counter in the same transaction so downstream consumers can tell
  // "nothing changed" from "a rewind deleted this range and wrote it again".
  const generations = createDataGenerationRepo(db);
  const bumpGeneration = (rowsChanged: number) => {
    generations.bump(RAW_EVENTS_GENERATION_KEY, rowsChanged);
  };

  const getRangeStmt = db.prepare(`
    SELECT
      tx_hash as txHash,
      log_index as logIndex,
      block_number as blockNumber,
      block_hash as blockHash,
      block_timestamp as blockTimestamp,
      contract_address as contractAddress,
      event_name as eventName,
      round_id as roundId,
      wallet,
      amount_mon as amountMon,
      payload,
      finalized,
      created_at as createdAt
    FROM raw_events
    WHERE block_number >= ? AND block_number <= ?
    ORDER BY block_number ASC, log_index ASC
  `);

  const getByEventNameStmt = db.prepare(`
    SELECT
      tx_hash as txHash,
      log_index as logIndex,
      block_number as blockNumber,
      block_hash as blockHash,
      block_timestamp as blockTimestamp,
      contract_address as contractAddress,
      event_name as eventName,
      round_id as roundId,
      wallet,
      amount_mon as amountMon,
      payload,
      finalized,
      created_at as createdAt
    FROM raw_events
    WHERE event_name = ?
    ORDER BY block_number ASC, log_index ASC
  `);

  const getLatestBlockNumberStmt = db.prepare(`
    SELECT MAX(block_number) as latestBlockNumber
    FROM raw_events
  `);

  const upsertStmt = db.prepare(`
    INSERT INTO raw_events (
      tx_hash,
      log_index,
      block_number,
      block_hash,
      block_timestamp,
      contract_address,
      event_name,
      round_id,
      wallet,
      amount_mon,
      payload,
      finalized,
      created_at
    ) VALUES (
      @txHash,
      @logIndex,
      @blockNumber,
      @blockHash,
      @blockTimestamp,
      @contractAddress,
      @eventName,
      @roundId,
      @wallet,
      @amountMon,
      @payload,
      @finalized,
      @createdAt
    )
    ON CONFLICT(tx_hash, log_index) DO UPDATE SET
      block_number = excluded.block_number,
      block_hash = excluded.block_hash,
      block_timestamp = excluded.block_timestamp,
      contract_address = excluded.contract_address,
      event_name = excluded.event_name,
      round_id = excluded.round_id,
      wallet = excluded.wallet,
      amount_mon = excluded.amount_mon,
      payload = excluded.payload,
      finalized = excluded.finalized,
      created_at = excluded.created_at
  `);

  const deleteFromBlockStmt = db.prepare(`
    DELETE FROM raw_events
    WHERE block_number >= ?
  `);

  const deleteForBlockRangeStmt = db.prepare(`
    DELETE FROM raw_events
    WHERE block_number >= ? AND block_number <= ?
  `);
  const setStateStmt = db.prepare(`
    INSERT INTO indexer_state (key, value, updated_at)
    VALUES (@key, @value, @updatedAt)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);


  const upsertManyTx = db.transaction((rows: RawEventRow[]) => {
    let changed = 0;
    for (const row of rows) {
      changed += upsertStmt.run(row).changes;
    }
    bumpGeneration(changed);
  });
  const commitCanonicalRangeTx = db.transaction((input: {
    fromBlock: number;
    toBlock: number;
    rows: RawEventRow[];
    stateUpdates: Array<{ key: string; value: string; updatedAt: string }>;
  }) => {
    let changed = deleteForBlockRangeStmt.run(input.fromBlock, input.toBlock).changes;
    for (const row of input.rows) changed += upsertStmt.run(row).changes;
    for (const update of input.stateUpdates) setStateStmt.run(update);
    bumpGeneration(changed);
  });

  return {
    getRange(fromBlock, toBlock) {
      return getRangeStmt.all(fromBlock, toBlock) as RawEventRow[];
    },
    getByEventName(eventName) {
      return getByEventNameStmt.all(eventName) as RawEventRow[];
    },
    getLatestBlockNumber() {
      const row = getLatestBlockNumberStmt.get() as { latestBlockNumber: number | null } | undefined;
      return row?.latestBlockNumber ?? null;
    },
    upsertMany(rows) {
      upsertManyTx(rows);
    },
    deleteFromBlock(fromBlock) {
      bumpGeneration(deleteFromBlockStmt.run(fromBlock).changes);
    },
    deleteForBlockRange(fromBlock, toBlock) {
      bumpGeneration(deleteForBlockRangeStmt.run(fromBlock, toBlock).changes);
    },
    commitCanonicalRange(input) {
      commitCanonicalRangeTx(input);
    },
  };
}
