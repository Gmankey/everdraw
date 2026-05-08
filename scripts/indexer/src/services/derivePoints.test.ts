import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { applySchema } from '../db/database.js';
import { createRoundsRepo } from '../repositories/roundsRepo.js';
import { createWalletRoundsRepo } from '../repositories/walletRoundsRepo.js';
import { createPointsRepo } from '../repositories/pointsRepo.js';
import { createDerivePointsService } from './derivePoints.js';

const db = new Database(':memory:');
applySchema(db);
const roundsRepo = createRoundsRepo(db);
const walletRoundsRepo = createWalletRoundsRepo(db);
const pointsRepo = createPointsRepo(db);
const service = createDerivePointsService({ pointsRepo, roundsRepo, walletRoundsRepo });

const wallet = '0x00000000000000000000000000000000000000aa';
const poolA = '0x00000000000000000000000000000000000000a1';
const poolB = '0x00000000000000000000000000000000000000b2';

function round(roundId: number, poolAddress: string, state: 'open' | 'settled' | 'skipped', settledAt: string | null, winner: string | null = null) {
  roundsRepo.upsert({
    roundId, poolAddress, state, isSkipped: state === 'skipped' ? 1 : 0,
    openedAt: '2026-05-01T00:00:00.000Z', salesEndTime: '2026-05-02T00:00:00.000Z', committedAt: null, drawnAt: null,
    unstakingAt: null, settledAt, depositTotalMon: '0', monReceived: '0', yieldMon: '0', lossRatio: '0', ticketCount: 0,
    uniqueWalletCount: 0, winnerWalletsCount: winner ? 1 : 0, winner, winningTicket: null, updatedAt: new Date().toISOString(),
  });
}
function wr(roundId: number, poolAddress: string, tickets: number, won: 0 | 1) {
  walletRoundsRepo.upsert({ wallet, roundId, poolAddress, tickets, monPaid: String(tickets), won, withdrew: 0, prizeClaimed: '0', principalWithdrawn: '0', withdrawnAt: null, netPosition: '0', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}

round(1, poolA, 'settled', '2026-05-03T00:00:00.000Z');
round(1, poolB, 'open', null);
wr(1, poolA, 10, 0);
wr(1, poolB, 3, 0);
service.rebuildSettlementPoints();
let profile = pointsRepo.getProfile(wallet)!;
assert.equal(profile.lifetimePoints, 36); // 10 base + 1 both-vaults + 25 first-deposit
assert.equal(profile.hasReceivedFirstDepositBonus, 1);
assert.equal(profile.consecutiveNonWins, 1);

round(2, poolA, 'settled', '2026-05-10T00:00:00.000Z', wallet);
wr(2, poolA, 5, 1);
service.rebuildSettlementPoints();
profile = pointsRepo.getProfile(wallet)!;
assert.equal(profile.hasReceivedFirstWinBonus, 1);
assert.equal(profile.consecutiveNonWins, 0);
assert.ok(profile.lifetimePoints > 100);

profile = pointsRepo.getProfile(wallet)!;
pointsRepo.upsertWalletStreak({ ...profile, currentStreakWeeks: 2, longestStreakWeeks: 2, lastCheckpointUnix: 0, consecutiveNonWins: 7, updatedAt: 1 });
const skipped = service.runWeeklyCheckpoint(Date.parse('2026-05-20T13:00:00.000Z') / 1000);
assert.equal(skipped.skipped, true);
assert.equal(pointsRepo.getWalletStreak(wallet)!.currentStreakWeeks, 2);

console.log('derivePoints.test.ts ok');
