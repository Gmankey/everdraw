import type Database from 'better-sqlite3';
import type { AuthSessionRow } from '../types.js';

export interface AuthSessionRepo {
  insert(row: AuthSessionRow): void;
  get(sessionId: string): AuthSessionRow | null;
  revoke(sessionId: string, revokedAt: string): void;
  deleteExpired(nowIso: string): void;
}

export function createAuthSessionRepo(db: Database.Database): AuthSessionRepo {
  const insertStmt = db.prepare(`
    INSERT INTO auth_sessions (
      session_id,
      wallet,
      issued_at,
      expires_at,
      revoked_at
    ) VALUES (
      @sessionId,
      @wallet,
      @issuedAt,
      @expiresAt,
      @revokedAt
    )
  `);

  const getStmt = db.prepare(`
    SELECT
      session_id as sessionId,
      wallet,
      issued_at as issuedAt,
      expires_at as expiresAt,
      revoked_at as revokedAt
    FROM auth_sessions
    WHERE session_id = ?
  `);

  const revokeStmt = db.prepare(`
    UPDATE auth_sessions
    SET revoked_at = ?
    WHERE session_id = ?
  `);

  const deleteExpiredStmt = db.prepare(`
    DELETE FROM auth_sessions
    WHERE expires_at <= ?
  `);

  return {
    insert(row) {
      insertStmt.run(row);
    },
    get(sessionId) {
      return (getStmt.get(sessionId) as AuthSessionRow | undefined) ?? null;
    },
    revoke(sessionId, revokedAt) {
      revokeStmt.run(revokedAt, sessionId);
    },
    deleteExpired(nowIso) {
      deleteExpiredStmt.run(nowIso);
    },
  };
}
