import type Database from 'better-sqlite3';
import type { IndexerStateRow } from '../types/domain.js';

export interface IndexerStateRepo {
  get(key: string): IndexerStateRow | null;
  set(key: string, value: string, updatedAt: string): void;
}

export function createIndexerStateRepo(db: Database.Database): IndexerStateRepo {
  const getStmt = db.prepare(`
    SELECT key, value, updated_at as updatedAt
    FROM indexer_state
    WHERE key = ?
  `);

  const setStmt = db.prepare(`
    INSERT INTO indexer_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);

  return {
    get(key) {
      return (getStmt.get(key) as IndexerStateRow | undefined) ?? null;
    },
    set(key, value, updatedAt) {
      setStmt.run(key, value, updatedAt);
    },
  };
}
