import 'dotenv/config';
import { openDatabase, applySchema } from '../src/db/database.js';

/**
 * One-time pre-public-launch points reset.
 *
 * Run this on the live indexer after deploying the POINTS_START_UNIX gate and
 * before opening the points system publicly. It truncates only points-derived
 * state: wallet_round_points, wallet_streaks, and wallet_points.
 *
 * It does NOT reset raw events, rounds, wallet_rounds, participation history,
 * auth data, or any protocol-derived historical data. After this reset, future
 * eligible round settlements at/after POINTS_START_UNIX compute points from a
 * clean slate, so first deposit / first win bonuses remain available for the
 * points launch era.
 */

const db = openDatabase();
applySchema(db);

const before = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM wallet_round_points) AS walletRoundPoints,
    (SELECT COUNT(*) FROM wallet_streaks) AS walletStreaks,
    (SELECT COUNT(*) FROM wallet_points) AS walletPoints
`).get() as { walletRoundPoints: number; walletStreaks: number; walletPoints: number };

const reset = db.transaction(() => {
  db.prepare('DELETE FROM wallet_round_points').run();
  db.prepare('DELETE FROM wallet_streaks').run();
  db.prepare('DELETE FROM wallet_points').run();
});

reset();

const after = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM wallet_round_points) AS walletRoundPoints,
    (SELECT COUNT(*) FROM wallet_streaks) AS walletStreaks,
    (SELECT COUNT(*) FROM wallet_points) AS walletPoints
`).get() as { walletRoundPoints: number; walletStreaks: number; walletPoints: number };

db.close();

console.log('[points-reset] deleted points-derived tables only');
console.log('[points-reset] before', before);
console.log('[points-reset] after ', after);
