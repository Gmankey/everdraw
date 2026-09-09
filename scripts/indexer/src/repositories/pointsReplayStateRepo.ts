import type Database from 'better-sqlite3';
import { nowIso } from '../utils/time.js';
import {
  CLAIM_PROOFS_GENERATION_KEY,
  RAW_EVENTS_GENERATION_KEY,
  createDataGenerationRepo,
} from './dataGenerationRepo.js';

export interface PointsReplayState {
  /** Input signature captured after the last successful replay, or null if there has not been one. */
  signature: string | null;
  lastSuccessUnix: number | null;
  lastErrorUnix: number | null;
  lastError: string | null;
}

export interface PointsReplayStateRepo {
  /**
   * A value that changes whenever anything the canonical points replay reads has changed.
   * Equal signatures mean a replay would write exactly what is already there.
   */
  computeInputSignature(formulaFingerprint: string): string;
  read(): PointsReplayState;
  /** Records a completed replay and clears any recorded failure. */
  recordSuccess(signature: string, atUnix: number): void;
  /** Records a failed replay. Leaves the stored signature alone so the retry is not skipped. */
  recordFailure(message: string, atUnix: number): void;
}

const SIGNATURE_KEY = 'points:last_replay_signature';
const LAST_SUCCESS_KEY = 'points:last_success_unix';
const LAST_ERROR_KEY = 'points:last_error';
const LAST_ERROR_UNIX_KEY = 'points:last_error_unix';
const MAX_RECORDED_ERROR_CHARS = 500;

export function createPointsReplayStateRepo(db: Database.Database): PointsReplayStateRepo {
  const generations = createDataGenerationRepo(db);

  // The replay's own output tables are part of the signature: an operator running
  // scripts/reset-points-tables.ts truncates them without touching raw events, and that
  // has to force a rebuild rather than look like "nothing changed".
  const outputsStmt = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM wallet_round_points) AS roundPointsRows,
      (SELECT COALESCE(SUM(total_points), 0) FROM wallet_round_points) AS roundPointsTotal,
      (SELECT COUNT(*) FROM wallet_points) AS walletPointsRows,
      (SELECT COALESCE(SUM(lifetime_points), 0) FROM wallet_points) AS lifetimeTotal,
      (SELECT COUNT(*) FROM wallet_streaks) AS streakRows,
      (SELECT COUNT(*) FROM points_formula_registry) AS registryRows
  `);

  const getStmt = db.prepare('SELECT value FROM indexer_state WHERE key = ?');
  const setStmt = db.prepare(`
    INSERT INTO indexer_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const deleteStmt = db.prepare('DELETE FROM indexer_state WHERE key = ?');

  const readValue = (key: string): string | null => {
    const row = getStmt.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  };
  const readNumber = (key: string): number | null => {
    const value = readValue(key);
    if (value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const recordSuccessTx = db.transaction((signature: string, atUnix: number) => {
    const updatedAt = nowIso();
    setStmt.run(SIGNATURE_KEY, signature, updatedAt);
    setStmt.run(LAST_SUCCESS_KEY, String(atUnix), updatedAt);
    deleteStmt.run(LAST_ERROR_KEY);
    deleteStmt.run(LAST_ERROR_UNIX_KEY);
  });

  const recordFailureTx = db.transaction((message: string, atUnix: number) => {
    const updatedAt = nowIso();
    setStmt.run(LAST_ERROR_KEY, message.slice(0, MAX_RECORDED_ERROR_CHARS), updatedAt);
    setStmt.run(LAST_ERROR_UNIX_KEY, String(atUnix), updatedAt);
  });

  return {
    computeInputSignature(formulaFingerprint) {
      const outputs = outputsStmt.get() as Record<string, number>;
      return [
        `raw=${generations.read(RAW_EVENTS_GENERATION_KEY)}`,
        `proofs=${generations.read(CLAIM_PROOFS_GENERATION_KEY)}`,
        `rp=${outputs.roundPointsRows}`,
        `rpt=${outputs.roundPointsTotal}`,
        `wp=${outputs.walletPointsRows}`,
        `wpt=${outputs.lifetimeTotal}`,
        `ws=${outputs.streakRows}`,
        `reg=${outputs.registryRows}`,
        `formula=${formulaFingerprint}`,
      ].join('|');
    },
    read() {
      return {
        signature: readValue(SIGNATURE_KEY),
        lastSuccessUnix: readNumber(LAST_SUCCESS_KEY),
        lastErrorUnix: readNumber(LAST_ERROR_UNIX_KEY),
        lastError: readValue(LAST_ERROR_KEY),
      };
    },
    recordSuccess(signature, atUnix) {
      recordSuccessTx(signature, atUnix);
    },
    recordFailure(message, atUnix) {
      recordFailureTx(message, atUnix);
    },
  };
}
