import type Database from 'better-sqlite3';
import { nowIso } from '../utils/time.js';

/**
 * Monotonic write counters for the two tables everything the points replay reads is
 * ultimately derived from.
 *
 * `raw_events` is written by the block scanner. `v5_claim_proofs` is written by the
 * proof-ingestion HTTP route, outside the scanner entirely -- a published draw changes
 * who counts as a winner with no new event and no advancing block cursor, so counting
 * scanner inserts alone would miss it.
 *
 * Counting writes where they happen is exact in a way row counts are not: a rewind
 * deletes a block range and re-inserts it, which can leave `COUNT(*)`, `MAX(rowid)` and
 * even the contents identical. The counter still moves, so a reorg can never be mistaken
 * for "nothing changed". Every bump runs inside the caller's transaction, so a rolled-back
 * write does not leave the counter ahead of the data.
 */
export const RAW_EVENTS_GENERATION_KEY = 'data_generation:raw_events';
export const CLAIM_PROOFS_GENERATION_KEY = 'data_generation:v5_claim_proofs';

export interface DataGenerationRepo {
  /** Adds `delta` to the counter. Non-positive deltas are ignored so callers can pass row counts directly. */
  bump(key: string, delta: number): void;
  read(key: string): number;
}

export function createDataGenerationRepo(db: Database.Database): DataGenerationRepo {
  const bumpStmt = db.prepare(`
    INSERT INTO indexer_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = CAST(CAST(indexer_state.value AS INTEGER) + ? AS TEXT),
      updated_at = excluded.updated_at
  `);
  const readStmt = db.prepare('SELECT value FROM indexer_state WHERE key = ?');

  return {
    bump(key, delta) {
      if (!Number.isFinite(delta) || delta <= 0) return;
      const rounded = Math.floor(delta);
      bumpStmt.run(key, String(rounded), nowIso(), rounded);
    },
    read(key) {
      const row = readStmt.get(key) as { value: string } | undefined;
      const value = Number(row?.value ?? 0);
      return Number.isFinite(value) ? value : 0;
    },
  };
}
