import type Database from 'better-sqlite3';
import type { AuthNonceRow } from '../types.js';

export interface AuthNonceRepo {
  upsert(row: AuthNonceRow): void;
  get(wallet: string): AuthNonceRow | null;
  markConsumed(wallet: string): void;
  deleteExpired(nowIso: string): void;
}

export function createAuthNonceRepo(db: Database.Database): AuthNonceRepo {
  const upsertStmt = db.prepare(`
    INSERT INTO auth_nonces (
      wallet,
      nonce,
      statement,
      chain_id,
      issued_at,
      expires_at,
      consumed_at
    ) VALUES (
      @wallet,
      @nonce,
      @statement,
      @chainId,
      @issuedAt,
      @expiresAt,
      @consumedAt
    )
    ON CONFLICT(wallet) DO UPDATE SET
      nonce = excluded.nonce,
      statement = excluded.statement,
      chain_id = excluded.chain_id,
      issued_at = excluded.issued_at,
      expires_at = excluded.expires_at,
      consumed_at = excluded.consumed_at
  `);

  const getStmt = db.prepare(`
    SELECT
      wallet,
      nonce,
      statement,
      chain_id as chainId,
      issued_at as issuedAt,
      expires_at as expiresAt,
      consumed_at as consumedAt
    FROM auth_nonces
    WHERE wallet = ?
  `);

  const markConsumedStmt = db.prepare(`
    UPDATE auth_nonces
    SET consumed_at = ?
    WHERE wallet = ?
  `);

  const deleteExpiredStmt = db.prepare(`
    DELETE FROM auth_nonces
    WHERE expires_at <= ?
  `);

  return {
    upsert(row) {
      upsertStmt.run(row);
    },
    get(wallet) {
      return (getStmt.get(wallet) as AuthNonceRow | undefined) ?? null;
    },
    markConsumed(wallet) {
      markConsumedStmt.run(new Date().toISOString(), wallet);
    },
    deleteExpired(nowIso) {
      deleteExpiredStmt.run(nowIso);
    },
  };
}
